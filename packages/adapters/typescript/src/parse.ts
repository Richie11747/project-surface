/**
 * Syntactic analysis via the TypeScript compiler API.
 *
 * `ts.createSourceFile` is used rather than `ts.createProgram`: this is a
 * syntax-only pass with no type checking and no module resolution, which makes
 * it fast enough to run over a whole repository and, importantly, means the
 * adapter needs no native modules and no tree-sitter grammar to install.
 *
 * The trade-off is honest and deliberate. We can see that a function is
 * exported and that a route string is registered; we cannot resolve a re-export
 * chain or infer a type. Claims from this file are therefore tier `derived` -
 * read from a real parse tree - and never `verified`.
 */

import ts from "typescript";

const HTTP_METHODS = new Set(["get", "post", "put", "patch", "delete", "head", "options", "all"]);

export type SymbolKind = "function" | "class" | "const";

export interface ExportedSymbol {
  name: string;
  kind: SymbolKind;
  line: number;
}

export interface DetectedRoute {
  method: string;
  path: string;
  line: number;
}

export interface ParsedFile {
  exports: ExportedSymbol[];
  routes: DetectedRoute[];
  /** Raw module specifiers, in source order. */
  imports: string[];
  envNames: string[];
}

function scriptKind(path: string): ts.ScriptKind {
  if (path.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (path.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (/\.(js|mjs|cjs)$/.test(path)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function isExported(node: ts.Node): boolean {
  const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
  return modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false;
}

function isFunctionLike(node: ts.Node): boolean {
  return (
    ts.isArrowFunction(node) ||
    ts.isFunctionExpression(node) ||
    ts.isIdentifier(node) ||
    ts.isCallExpression(node)
  );
}

export function parseSource(path: string, content: string): ParsedFile {
  const sourceFile = ts.createSourceFile(path, content, ts.ScriptTarget.Latest, true, scriptKind(path));
  const lineOf = (node: ts.Node): number =>
    sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;

  const exports: ExportedSymbol[] = [];
  const routes: DetectedRoute[] = [];
  const imports: string[] = [];
  const envNames = new Set<string>();

  /* Only top-level statements can be module exports, so this loop does not need
     to descend - which also avoids reporting a nested helper as public API. */
  for (const statement of sourceFile.statements) {
    if (!isExported(statement)) continue;

    if (ts.isFunctionDeclaration(statement) && statement.name) {
      exports.push({ name: statement.name.text, kind: "function", line: lineOf(statement) });
    } else if (ts.isClassDeclaration(statement) && statement.name) {
      exports.push({ name: statement.name.text, kind: "class", line: lineOf(statement) });
    } else if (ts.isVariableStatement(statement)) {
      for (const decl of statement.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name)) continue;
        /* An exported const is only interesting as a capability when it holds
           behaviour. An exported constant string is configuration. */
        if (decl.initializer && isFunctionLike(decl.initializer)) {
          exports.push({ name: decl.name.text, kind: "const", line: lineOf(decl) });
        }
      }
    }
  }

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      imports.push(node.moduleSpecifier.text);
    } else if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "require" &&
      node.arguments.length === 1 &&
      node.arguments[0] &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      imports.push((node.arguments[0] as ts.StringLiteral).text);
    }

    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const method = node.expression.name.text.toLowerCase();
      const first = node.arguments[0];
      /* Two arguments with a leading string path is the shape of every router
         registration and is not the shape of Map.get or similar. */
      if (
        HTTP_METHODS.has(method) &&
        node.arguments.length >= 2 &&
        first &&
        ts.isStringLiteralLike(first) &&
        first.text.startsWith("/")
      ) {
        routes.push({ method: method.toUpperCase(), path: first.text, line: lineOf(node) });
      }
    }

    if (ts.isPropertyAccessExpression(node) && isProcessEnv(node.expression)) {
      envNames.add(node.name.text);
    }
    /* `const { DATABASE_URL, PORT = "3000" } = process.env` reads two variables. */
    if (
      ts.isVariableDeclaration(node) &&
      node.initializer &&
      isProcessEnv(node.initializer) &&
      ts.isObjectBindingPattern(node.name)
    ) {
      for (const element of node.name.elements) {
        const key = element.propertyName ?? element.name;
        if (ts.isIdentifier(key)) envNames.add(key.text);
        else if (ts.isStringLiteralLike(key)) envNames.add(key.text);
      }
    }
    if (
      ts.isElementAccessExpression(node) &&
      isProcessEnv(node.expression) &&
      node.argumentExpression &&
      ts.isStringLiteralLike(node.argumentExpression)
    ) {
      envNames.add(node.argumentExpression.text);
    }

    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  return {
    exports,
    routes,
    imports,
    envNames: [...envNames].filter((n) => /^[A-Z][A-Z0-9_]*$/.test(n)).sort(),
  };
}

function isProcessEnv(node: ts.Node): boolean {
  return (
    ts.isPropertyAccessExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === "process" &&
    node.name.text === "env"
  );
}

/** Next.js App Router: `app/**\/route.ts` exporting an HTTP method name. */
export function isRouteHandlerFile(path: string): boolean {
  return /(^|\/)(app|src\/app)\/.*\/route\.(ts|tsx|js|jsx)$/.test(path);
}

export function routeHandlerPath(path: string): string {
  const match = /(?:^|\/)(?:src\/)?app\/(.*)\/route\.(?:ts|tsx|js|jsx)$/.exec(path);
  if (!match?.[1]) return "/";
  const segments = match[1]
    .split("/")
    .filter((s) => !(s.startsWith("(") && s.endsWith(")")))
    .map((s) => s.replace(/^\[\.{3}(.+)\]$/, ":$1*").replace(/^\[(.+)\]$/, ":$1"));
  return `/${segments.join("/")}`;
}

export function isHttpMethodName(name: string): boolean {
  return HTTP_METHODS.has(name.toLowerCase());
}
