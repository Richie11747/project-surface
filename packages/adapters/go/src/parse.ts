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

function stripComment(line: string): string {
  const i = line.indexOf("//");
  return i === -1 ? line : line.slice(0, i);
}

export function parseGo(content: string): ParsedGo {
  const lines = content.split("\n");
  const symbols: GoSymbol[] = [];
  const routes: GoRoute[] = [];
  const envNames = new Set<string>();
  let packageName: string | null = null;

  lines.forEach((raw, index) => {
    const lineNumber = index + 1;
    const line = stripComment(raw);
    const trimmed = line.trim();

    if (packageName === null) {
      const pkg = PACKAGE.exec(trimmed);
      if (pkg?.[1]) packageName = pkg[1];
    }

    /* Only column-zero declarations are package-level exports. */
    if (line.length > 0 && !/^\s/.test(line)) {
      const fn = FUNC.exec(trimmed);
      if (fn?.[1]) symbols.push({ name: fn[1], kind: "function", line: lineNumber });
      const ty = TYPE.exec(trimmed);
      if (ty?.[1]) symbols.push({ name: ty[1], kind: "type", line: lineNumber });
    }

    for (const pattern of ROUTE_PATTERNS) {
      const re = new RegExp(pattern.source, pattern.flags);
      let match: RegExpExecArray | null;
      while ((match = re.exec(line)) !== null) {
        const hasMethod = match.length > 2;
        const method = hasMethod ? (match[1] ?? "GET").toUpperCase() : "GET";
        const path = hasMethod ? match[2] : match[1];
        if (path && path.startsWith("/")) routes.push({ method, path, line: lineNumber });
      }
    }

    for (const pattern of ENV) {
      const re = new RegExp(pattern.source, pattern.flags);
      let match: RegExpExecArray | null;
      while ((match = re.exec(line)) !== null) {
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
