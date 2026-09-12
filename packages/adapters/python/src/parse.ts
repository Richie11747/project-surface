/**
 * Python source analysis.
 *
 * Line-oriented rather than AST-based, and deliberately so: shipping a Python
 * parser to a Node process means either a WASM grammar or a native module, both
 * of which break the "installs everywhere with no build step" property that
 * makes this tool easy to adopt.
 *
 * The cost is real and is reflected in the provenance. Structure that Python
 * states unambiguously at column zero - a top-level def, a route decorator, an
 * os.environ lookup - is read reliably and reported as `derived`. Anything that
 * would need scope analysis is simply not claimed.
 */

const TOP_LEVEL_DEF = /^(async\s+)?def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/;
const TOP_LEVEL_CLASS = /^class\s+([A-Za-z_][A-Za-z0-9_]*)\s*[(:]/;
const DECORATOR_ROUTE = /^@([A-Za-z_][A-Za-z0-9_.]*)\.(get|post|put|patch|delete|head|options)\(\s*["']([^"']+)["']/;
const DECORATOR_FLASK = /^@([A-Za-z_][A-Za-z0-9_.]*)\.route\(\s*["']([^"']+)["']/;
const FLASK_METHODS = /methods\s*=\s*\[([^\]]*)\]/;
const ENV_PATTERNS = [
  /os\.environ\.get\(\s*["']([A-Z][A-Z0-9_]*)["']/g,
  /os\.environ\[\s*["']([A-Z][A-Z0-9_]*)["']\s*\]/g,
  /os\.getenv\(\s*["']([A-Z][A-Z0-9_]*)["']/g,
  /environ\.get\(\s*["']([A-Z][A-Z0-9_]*)["']/g,
];
const IMPORT_FROM = /^from\s+(\.*)([A-Za-z0-9_.]*)\s+import\s+/;
const IMPORT_PLAIN = /^import\s+([A-Za-z0-9_.]+)/;

export interface PySymbol {
  name: string;
  kind: "function" | "class";
  line: number;
}

export interface PyRoute {
  method: string;
  path: string;
  line: number;
}

export interface PyImport {
  /** Number of leading dots for a relative import; 0 when absolute. */
  level: number;
  module: string;
}

export interface ParsedPython {
  symbols: PySymbol[];
  routes: PyRoute[];
  imports: PyImport[];
  envNames: string[];
}

function stripComment(line: string): string {
  /* Good enough for structure detection: a hash inside a string literal is rare
     on a decorator or def line, and a false negative simply means one fewer
     claim rather than a wrong one. */
  const hash = line.indexOf("#");
  return hash === -1 ? line : line.slice(0, hash);
}

export function parsePython(content: string): ParsedPython {
  const lines = content.split("\n");
  const symbols: PySymbol[] = [];
  const routes: PyRoute[] = [];
  const imports: PyImport[] = [];
  const envNames = new Set<string>();

  let pendingRoutes: PyRoute[] = [];

  lines.forEach((raw, index) => {
    const lineNumber = index + 1;
    const line = stripComment(raw);
    const trimmed = line.trim();
    const atColumnZero = line.length > 0 && !/^\s/.test(line);

    if (atColumnZero) {
      const decorated = DECORATOR_ROUTE.exec(trimmed);
      if (decorated?.[2] && decorated[3]) {
        pendingRoutes.push({
          method: decorated[2].toUpperCase(),
          path: decorated[3],
          line: lineNumber,
        });
      } else {
        const flask = DECORATOR_FLASK.exec(trimmed);
        if (flask?.[2]) {
          const methodList = FLASK_METHODS.exec(trimmed)?.[1];
          const methods = methodList
            ? methodList.split(",").map((m) => m.replace(/["'\s]/g, "").toUpperCase()).filter(Boolean)
            : ["GET"];
          for (const method of methods) {
            pendingRoutes.push({ method, path: flask[2], line: lineNumber });
          }
        }
      }

      const def = TOP_LEVEL_DEF.exec(trimmed);
      const cls = TOP_LEVEL_CLASS.exec(trimmed);
      const name = def?.[2] ?? cls?.[1];
      if (name) {
        /* A leading underscore is Python for "not part of the interface". */
        if (!name.startsWith("_")) {
          symbols.push({ name, kind: def ? "function" : "class", line: lineNumber });
        }
        routes.push(...pendingRoutes);
        pendingRoutes = [];
      } else if (trimmed.length > 0 && !trimmed.startsWith("@")) {
        pendingRoutes = [];
      }

      const from = IMPORT_FROM.exec(trimmed);
      if (from) {
        imports.push({ level: (from[1] ?? "").length, module: from[2] ?? "" });
      } else {
        const plain = IMPORT_PLAIN.exec(trimmed);
        if (plain?.[1]) imports.push({ level: 0, module: plain[1] });
      }
    }

    for (const pattern of ENV_PATTERNS) {
      const re = new RegExp(pattern.source, pattern.flags);
      let match: RegExpExecArray | null;
      while ((match = re.exec(line)) !== null) {
        if (match[1]) envNames.add(match[1]);
      }
    }
  });

  return { symbols, routes, imports, envNames: [...envNames].sort() };
}

/** `pkg.module` -> `pkg/module.py`, honouring relative import depth. */
export function pythonModuleToPaths(fromPath: string, imp: PyImport): string[] {
  const asPath = imp.module.replace(/\./g, "/");

  if (imp.level === 0) {
    return [`${asPath}.py`, `${asPath}/__init__.py`];
  }

  const dirs = fromPath.split("/").slice(0, -1);
  const base = dirs.slice(0, Math.max(0, dirs.length - (imp.level - 1)));
  const joined = [...base, asPath].filter(Boolean).join("/");
  return [`${joined}.py`, `${joined}/__init__.py`];
}

export function isPythonTest(path: string): boolean {
  const file = path.split("/").pop() ?? path;
  return /^test_.*\.py$/.test(file) || /_test\.py$/.test(file);
}
