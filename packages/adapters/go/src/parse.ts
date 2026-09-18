/**
 * Go source analysis.
 *
 * Structural only. Go is a first-class target for the surface model, but this
 * adapter deliberately ships without a Go parser: the value of a zero-build,
 * zero-native-module install outweighs the extra precision a real AST would
 * buy for the handful of declarations that matter here.
 *
 * Consequently every claim is reported at a tier that reflects a line scan, and
 * when the Go toolchain is absent the stack is marked unavailable so nothing
 * downstream can mistake discovery for verification.
 */

import { matchAll, stripLineComment } from "@project-surface/adapter-sdk";

const FUNC = /^func\s+(?:\([^)]*\)\s*)?([A-Z][A-Za-z0-9_]*)\s*[(\[]/;
const TYPE = /^type\s+([A-Z][A-Za-z0-9_]*)\s+(struct|interface|func|\[|map|chan|[A-Za-z])/;
const PACKAGE = /^package\s+([A-Za-z_][A-Za-z0-9_]*)/;
const ENV = [
  /os\.Getenv\(\s*"([A-Z][A-Z0-9_]*)"/g,
  /os\.LookupEnv\(\s*"([A-Z][A-Z0-9_]*)"/g,
];

/** Router registrations across net/http, chi, gin, echo and gorilla. */
const ROUTE_PATTERNS: RegExp[] = [
  /\.(?:HandleFunc|Handle)\(\s*"([^"]+)"/g,
  /\.(Get|Post|Put|Patch|Delete|Head|Options)\(\s*"([^"]+)"/g,
  /\.(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\(\s*"([^"]+)"/g,
];

export interface GoSymbol {
  name: string;
  kind: "function" | "type";
  line: number;
}

export interface GoRoute {
  method: string;
  path: string;
  line: number;
}

export interface ParsedGo {
  packageName: string | null;
  symbols: GoSymbol[];
  routes: GoRoute[];
  envNames: string[];
}

/** Go 1.22 `ServeMux` patterns carry the method in the string: `"GET /items/{id}"`. */
const MUX_PATTERN = /^(?:(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+)?(\/\S*)$/;

/**
 * Remove comments from one line, carrying block-comment state between lines.
 * A route registered inside `/* ... *\/` is not a route; a `//` inside a
 * string literal (`"https://..."`) is not a comment.
 */
function stripComments(raw: string, state: { inBlock: boolean }): string {
  let line = raw;
  let out = "";
  while (line.length > 0) {
    if (state.inBlock) {
      const end = line.indexOf("*/");
      if (end === -1) return out;
      state.inBlock = false;
      line = line.slice(end + 2);
      continue;
    }
    const code = stripLineComment(line, "//", "\"'`");
    const start = code.indexOf("/*");
    if (start === -1) return out + code;
    out += code.slice(0, start);
    state.inBlock = true;
    line = code.slice(start + 2);
  }
  return out;
}

export function parseGo(content: string): ParsedGo {
  const lines = content.split("\n");
  const symbols: GoSymbol[] = [];
  const routes: GoRoute[] = [];
  const envNames = new Set<string>();
  let packageName: string | null = null;
  const comments = { inBlock: false };
  /* Inside `type ( ... )` every member is a declaration although indented. */
  let inTypeGroup = false;

  lines.forEach((raw, index) => {
    const lineNumber = index + 1;
    const line = stripComments(raw, comments);
    const trimmed = line.trim();

    if (packageName === null) {
      const pkg = PACKAGE.exec(trimmed);
      if (pkg?.[1]) packageName = pkg[1];
    }

    if (inTypeGroup) {
      if (trimmed === ")") inTypeGroup = false;
      else {
        const member = TYPE.exec(`type ${trimmed}`);
        if (member?.[1]) symbols.push({ name: member[1], kind: "type", line: lineNumber });
      }
    } else if (line.length > 0 && !/^\s/.test(line)) {
      /* Only column-zero declarations are package-level exports. */
      if (/^type\s*\($/.test(trimmed)) inTypeGroup = true;
      const fn = FUNC.exec(trimmed);
      if (fn?.[1]) symbols.push({ name: fn[1], kind: "function", line: lineNumber });
      const ty = TYPE.exec(trimmed);
      if (ty?.[1]) symbols.push({ name: ty[1], kind: "type", line: lineNumber });
    }

    for (const pattern of ROUTE_PATTERNS) {
      for (const match of matchAll(pattern, line)) {
        const hasMethod = match.length > 2;
        const target = hasMethod ? match[2] : match[1];
        const mux = target ? MUX_PATTERN.exec(target) : null;
        if (!mux?.[2]) continue;
        const method = (mux[1] ?? (hasMethod ? match[1] : undefined) ?? "GET").toUpperCase();
        routes.push({ method, path: mux[2], line: lineNumber });
      }
    }

    for (const pattern of ENV) {
      for (const match of matchAll(pattern, line)) {
        if (match[1]) envNames.add(match[1]);
      }
    }
  });

  return { packageName, symbols, routes, envNames: [...envNames].sort() };
}

export interface GoModule {
  module: string | null;
  goVersion: string | null;
}

export function parseGoMod(content: string): GoModule {
  const module = /^module\s+(\S+)/m.exec(content)?.[1] ?? null;
  const goVersion = /^go\s+(\S+)/m.exec(content)?.[1] ?? null;
  return { module, goVersion };
}

export function isGoTest(path: string): boolean {
  return path.endsWith("_test.go");
}

/** `internal/checkout/create.go` -> `internal/checkout`. */
export function goPackageDir(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? "." : path.slice(0, i);
}
