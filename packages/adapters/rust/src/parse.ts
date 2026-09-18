/**
 * Rust source and manifest analysis.
 *
 * Structural only. There is no rustc and no `syn` here, for the same reason the
 * Go adapter has no Go parser: a zero-build, zero-native-module install is
 * worth more than the precision a real AST would add for the handful of
 * declarations that matter to a surface. Every claim is therefore reported at a
 * tier that reflects a line scan, and when `cargo` is absent the stack is marked
 * unavailable so nothing downstream can mistake discovery for verification.
 *
 * One thing is better than a guess: `use` statements. A test that says
 * `use pricing_svc::quote::quote_for` names the module it exercises, and that
 * is resolved to a file and reported as `import-graph`, exactly as the
 * TypeScript and Python adapters do.
 */

import { matchAll, stripLineComment } from "@project-surface/adapter-sdk";

/** Column-zero `pub` items. `pub(crate)` and friends are not public API. */
const ITEM =
  /^pub\s+(?:async\s+|unsafe\s+|const\s+|extern\s+"[^"]*"\s+)*(fn|struct|enum|trait|type|mod|const|static)\s+([A-Za-z_][A-Za-z0-9_]*)/;

const ENV = [
  /\benv::var(?:_os)?\(\s*"([A-Z][A-Z0-9_]*)"/g,
  /\b(?:option_)?env!\(\s*"([A-Z][A-Z0-9_]*)"/g,
];

/** Route registrations across axum, actix-web and rocket. The handler capture
 *  stops at the next `.route(`, so two registrations on one line do not share
 *  methods. */
const AXUM_ROUTE = /\.route\(\s*"([^"]+)"\s*,((?:(?!\.route\()[^;])*)/g;
const AXUM_METHOD = /\b(get|post|put|patch|delete|head|options)\s*\(/g;
const ATTRIBUTE_ROUTE = /#\[\s*(?:[A-Za-z_][A-Za-z0-9_]*::)?(get|post|put|patch|delete|head|options)\s*\(\s*"([^"]+)"/g;
const ACTIX_RESOURCE = /web::resource\(\s*"([^"]+)"\s*\)([^;]*)/g;
const ACTIX_METHOD = /web::(get|post|put|patch|delete|head)\s*\(\s*\)/g;

const USE = /^\s*(?:pub(?:\([^)]*\))?\s+)?use\s+([A-Za-z_][A-Za-z0-9_:]*(?:::\{[^}]*\})?)/;

export interface RustSymbol {
  name: string;
  kind: "fn" | "struct" | "enum" | "trait" | "type" | "mod" | "const" | "static";
  line: number;
}

export interface RustRoute {
  method: string;
  path: string;
  line: number;
}

export interface RustUse {
  /** The path as written, braces expanded: `pricing_svc::quote::quote_for`. */
  path: string;
  line: number;
}

export interface ParsedRust {
  symbols: RustSymbol[];
  routes: RustRoute[];
  uses: RustUse[];
  envNames: string[];
  /** `#[test]` or `#[cfg(test)]` appears in the file. */
  hasInlineTests: boolean;
}

/* Rust strings are double-quoted; a lone `'` opens a lifetime, not a string. */
const stripComment = (line: string): string => stripLineComment(line, "//", '"');
const all = matchAll;

/** `a::b::{c, d::e}` -> [`a::b::c`, `a::b::d::e`]; `a::b` -> [`a::b`]. */
function expandUse(path: string): string[] {
  const brace = path.indexOf("::{");
  if (brace === -1) return [path.replace(/::\*$/, "")];
  const prefix = path.slice(0, brace);
  const inner = path.slice(brace + 3, path.lastIndexOf("}"));
  return inner
    .split(",")
    .map((s) => s.trim().replace(/\s+as\s+\w+$/, ""))
    .filter((s) => s.length > 0 && s !== "self" && s !== "*")
    .map((s) => `${prefix}::${s}`);
}

export function parseRust(content: string): ParsedRust {
  const lines = content.split("\n");
  const symbols: RustSymbol[] = [];
  const routes: RustRoute[] = [];
  const uses: RustUse[] = [];
  const envNames = new Set<string>();
  let hasInlineTests = false;

  /* A `#[cfg(test)] mod tests { ... }` block is test code living in a source
     file. Routes it registers and items it declares are not the crate's
     behaviour, so everything between the attribute and the block's closing
     brace at column zero is skipped - but its presence still makes the file a
     unit-test host. */
  let testAttrPending = false;
  let inTestModule = false;

  lines.forEach((raw, index) => {
    const lineNumber = index + 1;
    const line = stripComment(raw);
    const trimmed = line.trim();

    /* `#[test]`, `#[cfg(test)]`, and any runtime-provided form: `#[tokio::test]`,
       `#[async_std::test]`, `#[sqlx::test]`, `#[actix_web::test]`. */
    if (/^#\[\s*(test|cfg\(test\)|[A-Za-z0-9_]+(::[A-Za-z0-9_]+)*::test)\b/.test(trimmed)) hasInlineTests = true;

    if (inTestModule) {
      if (line === "}") inTestModule = false;
      return;
    }
    if (/^#\[cfg\(test\)\]/.test(line)) {
      testAttrPending = true;
      return;
    }
    if (testAttrPending) {
      if (/^(?:pub(?:\([^)]*\))?\s+)?mod\s+[A-Za-z_][A-Za-z0-9_]*\s*\{/.test(line)) inTestModule = true;
      if (!/^\s*#\[/.test(line)) testAttrPending = false;
      if (inTestModule) return;
    }

    if (line.length > 0 && !/^\s/.test(line)) {
      const item = ITEM.exec(line);
      if (item?.[1] && item[2]) {
        symbols.push({ name: item[2], kind: item[1] as RustSymbol["kind"], line: lineNumber });
      }
    }

    const use = USE.exec(line);
    if (use?.[1]) for (const path of expandUse(use[1].replace(/;\s*$/, ""))) uses.push({ path, line: lineNumber });

    for (const m of all(AXUM_ROUTE, line)) {
      const path = m[1];
      const handlers = m[2] ?? "";
      if (!path?.startsWith("/")) continue;
      const methods = all(AXUM_METHOD, handlers).map((x) => (x[1] ?? "get").toUpperCase());
      for (const method of methods.length > 0 ? methods : ["GET"]) routes.push({ method, path, line: lineNumber });
    }
    for (const m of all(ATTRIBUTE_ROUTE, line)) {
      if (m[1] && m[2]?.startsWith("/")) routes.push({ method: m[1].toUpperCase(), path: m[2], line: lineNumber });
    }
    for (const m of all(ACTIX_RESOURCE, line)) {
      const path = m[1];
      if (!path?.startsWith("/")) continue;
      const methods = all(ACTIX_METHOD, m[2] ?? "").map((x) => (x[1] ?? "get").toUpperCase());
      for (const method of methods.length > 0 ? methods : ["GET"]) routes.push({ method, path, line: lineNumber });
    }

    for (const pattern of ENV) for (const m of all(pattern, line)) if (m[1] && !isCargoBuildVariable(m[1])) envNames.add(m[1]);
  });

  return { symbols, routes, uses, envNames: [...envNames].sort(), hasInlineTests };
}

export interface CargoManifest {
  name: string | null;
  rustVersion: string | null;
  edition: string | null;
  workspaceMembers: string[];
  bins: string[];
  dependencies: string[];
}

/**
 * Just enough TOML for a manifest: `[section]` and `[[array.section]]` headers,
 * `key = "string"`, single- and multi-line `key = [ ... ]`, and the keys of a
 * table. Values that are inline tables are read for their key only, which is
 * all a dependency list needs.
 */
export function parseCargoToml(content: string): CargoManifest {
  const manifest: CargoManifest = {
    name: null,
    rustVersion: null,
    edition: null,
    workspaceMembers: [],
    bins: [],
    dependencies: [],
  };
  let section = "";
  let pendingArray: { section: string; key: string; items: string[] } | null = null;

  for (const raw of content.split("\n")) {
    /* `#` starts a comment outside a string; `description = "Issue #12"` keeps its value. */
    const line = stripLineComment(raw, "#", "\"'").trim();
    if (line.length === 0) continue;

    if (pendingArray) {
      for (const m of all(/"([^"]+)"/g, line)) if (m[1]) pendingArray.items.push(m[1]);
      if (line.includes("]")) {
        applyArray(manifest, pendingArray);
        pendingArray = null;
      }
      continue;
    }

    if (line.startsWith("[")) {
      const header = /^(\[\[?)\s*([A-Za-z0-9_.-]+)\s*\]\]?$/.exec(line);
      /* A header this parser does not read - a quoted key such as
         `[target.'cfg(unix)'.dependencies]` - still closes the previous
         section, or its keys would be credited to `[package]`. */
      section = header?.[2] ?? "?";
      if (header?.[1] === "[[" && section === "bin") manifest.bins.push("");
      const dotted = /^dependencies\.([A-Za-z0-9_-]+)$/.exec(section);
      if (dotted?.[1]) manifest.dependencies.push(dotted[1]);
      continue;
    }

    const kv = /^([A-Za-z0-9_.-]+)\s*=\s*(.*)$/.exec(line);
    if (!kv?.[1]) continue;
    const [, key, value = ""] = kv;

    if (value.startsWith("[")) {
      const items = all(/"([^"]+)"/g, value).map((m) => m[1] ?? "");
      if (value.includes("]")) applyArray(manifest, { section, key, items });
      else pendingArray = { section, key, items };
      continue;
    }

    const str = /^"([^"]*)"/.exec(value)?.[1] ?? null;
    if (section === "package") {
      if (key === "name" && str) manifest.name = str;
      if (key === "rust-version" && str) manifest.rustVersion = str;
      if (key === "edition" && str) manifest.edition = str;
    } else if (section === "bin") {
      if (key === "name" && str) manifest.bins[manifest.bins.length - 1] = str;
    } else if (section === "dependencies" || section === "dev-dependencies" || section === "build-dependencies") {
      manifest.dependencies.push(key);
    }
  }

  manifest.bins = manifest.bins.filter((b) => b.length > 0);
  manifest.dependencies = [...new Set(manifest.dependencies)].sort();
  return manifest;
}

function applyArray(manifest: CargoManifest, entry: { section: string; key: string; items: string[] }): void {
  if (entry.section === "workspace" && entry.key === "members") manifest.workspaceMembers.push(...entry.items);
}

/**
 * Anything under a `tests/` or `benches/` directory, at any depth: integration
 * tests, their helper modules, and trybuild-style compile-test fixtures such as
 * `tests/ui/pass/*.rs` - none of which is the crate's behaviour. A file with
 * `#[test]` elsewhere is a unit-test host and stays a source file.
 */
export function isRustTestPath(path: string): boolean {
  return /(^|\/)(tests|benches)\/.*\.rs$/.test(path) || /(^|\/)tests?\.rs$/.test(path);
}

/**
 * Variables Cargo itself sets at build time. `env!("CARGO_PKG_VERSION")` is
 * how a crate reads its own metadata, not configuration a deployment supplies.
 */
export function isCargoBuildVariable(name: string): boolean {
  return name.startsWith("CARGO_") || name === "OUT_DIR" || name === "RUSTC" || name === "RUSTDOC" || name === "TARGET" || name === "HOST" || name === "PROFILE";
}

/** The crate root directory (the one holding Cargo.toml) that owns a path. */
export function crateRootOf(path: string, crateDirs: string[]): string {
  let best = ".";
  for (const dir of crateDirs) {
    if (dir === ".") continue;
    if (path.startsWith(`${dir}/`) && dir.length > best.length) best = dir;
  }
  return best;
}

/**
 * Resolve a `use` path to candidate files inside the crate. `pricing_svc::quote::quote_for`
 * with crate name `pricing-svc` yields `src/quote.rs`, `src/quote/mod.rs` and, one level up,
 * `src/lib.rs` - the shortest that exists wins, longest module path first.
 */
export function usePathToFiles(usePath: string, crateRoot: string, crateName: string | null): string[] {
  const segments = usePath.split("::").filter((s) => s.length > 0);
  if (segments.length === 0) return [];
  const head = segments[0] ?? "";
  const normalisedCrate = crateName?.replace(/-/g, "_") ?? null;
  let modules: string[];
  if (head === "crate" || (normalisedCrate !== null && head === normalisedCrate)) modules = segments.slice(1);
  else if (head === "self" || head === "super") return [];
  else return [];

  const src = crateRoot === "." ? "src" : `${crateRoot}/src`;
  const candidates: string[] = [];
  for (let depth = modules.length; depth >= 1; depth -= 1) {
    const rel = modules.slice(0, depth).join("/");
    candidates.push(`${src}/${rel}.rs`, `${src}/${rel}/mod.rs`);
  }
  candidates.push(`${src}/lib.rs`);
  return candidates;
}

/** The first segment of an external `use`: `axum::Router` -> `axum`. */
export function crateOf(usePath: string): string {
  return usePath.split("::")[0] ?? usePath;
}
