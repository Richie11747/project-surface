/**
 * @project-surface/adapter-typescript
 *
 * Reads the JavaScript and TypeScript ecosystem: package manifests, scripts,
 * workspaces, exported symbols, HTTP routes, environment usage, and the import
 * graph that connects tests to the code they exercise.
 */

import { emptyResult } from "@project-surface/adapter-sdk";
import type { Adapter, AdapterContext, AdapterResult, ImportEdge } from "@project-surface/adapter-sdk";
import {
  buildCapabilities,
  buildEnvironment,
  buildEvidence,
  buildRisks,
} from "./discover.js";
import { isSourceFile, isTestFile, linkTests, resolveImport } from "./evidence-link.js";
import type { TestFile } from "./evidence-link.js";
import {
  ADAPTER_ID,
  commandsFrom,
  constraintsFrom,
  detectPackageManager,
  findPackages,
} from "./manifest.js";
import { isHttpMethodName, isRouteHandlerFile, parseSource, routeHandlerPath } from "./parse.js";
import type { ParsedFile } from "./parse.js";

export const ADAPTER_VERSION = "0.1.0";

/** Build output, type stubs and tool config are not project behaviour. */
const NOT_BEHAVIOUR = /(\.d\.ts$|\.config\.[cm]?[jt]s$|(^|\/)(dist|build|out|coverage)\/)/;

/** A ceiling so a huge monorepo degrades in speed rather than hanging. */
const MAX_PARSED_FILES = 4000;

function isCandidateSource(path: string): boolean {
  return isSourceFile(path) && !NOT_BEHAVIOUR.test(path);
}

/**
 * Next.js App Router files declare their method by export name and their path
 * by directory. Rewrite them into ordinary routes so they are described the
 * same way as an Express or Fastify registration.
 */
function applyRouteHandlerConvention(path: string, parsed: ParsedFile): ParsedFile {
  if (!isRouteHandlerFile(path)) return parsed;
  const methods = parsed.exports.filter((e) => isHttpMethodName(e.name));
  if (methods.length === 0) return parsed;

  const routePath = routeHandlerPath(path);
  return {
    ...parsed,
    exports: parsed.exports.filter((e) => !isHttpMethodName(e.name)),
    routes: [
      ...parsed.routes,
      ...methods.map((m) => ({ method: m.name.toUpperCase(), path: routePath, line: m.line })),
    ],
  };
}

export const typescriptAdapter: Adapter = {
  id: ADAPTER_ID,
  version: ADAPTER_VERSION,

  detect(ctx: AdapterContext): boolean {
    return (
      ctx.exists("package.json") ||
      ctx.exists("tsconfig.json") ||
      ctx.match(/\.(ts|tsx|mts|cts)$/).length > 0
    );
  },

  extract(ctx: AdapterContext): AdapterResult {
    const stack = {
      id: ADAPTER_ID,
      adapter: "@project-surface/adapter-typescript",
      adapterVersion: ADAPTER_VERSION,
      /* The runtime is executing this code, so it is by definition present. */
      toolchainAvailable: true,
      notes: [] as string[],
    };

    const packages = findPackages(ctx);
    if (packages.length === 0 && ctx.match(/\.(ts|tsx)$/).length === 0) {
      return emptyResult(stack);
    }

    const manager = detectPackageManager(ctx)?.name ?? "npm";
    const packageInfos = packages.map((p) => p.info);

    const candidates = ctx.files.filter(isCandidateSource);
    if (candidates.length > MAX_PARSED_FILES) {
      stack.notes.push(
        `Only the first ${MAX_PARSED_FILES} of ${candidates.length} source files were parsed.`
      );
    }
    const selected = candidates.slice(0, MAX_PARSED_FILES);

    const parsed = new Map<string, ParsedFile>();
    const tests: TestFile[] = [];
    const testPaths: string[] = [];
    const sourcePaths = new Set<string>();

    for (const path of selected) {
      const content = ctx.readFile(path);
      if (content === null) continue;
      const file = applyRouteHandlerConvention(path, parseSource(path, content));

      if (isTestFile(path)) {
        tests.push({ path, imports: file.imports });
        testPaths.push(path);
        continue;
      }
      parsed.set(path, file);
      sourcePaths.add(path);
    }

    const allFiles = new Set(ctx.files);
    const links = linkTests(tests, sourcePaths, allFiles);

    /* Every import in every parsed file, resolved where it points at project
       code. Core uses these for `forbid-import` checks; they are not stored. */
    const imports: ImportEdge[] = [];
    const withImports: Array<[string, string[]]> = [
      ...[...parsed.entries()].map(([path, file]): [string, string[]] => [path, file.imports]),
      ...tests.map((t): [string, string[]] => [t.path, t.imports]),
    ];
    for (const [from, specifiers] of withImports.sort((a, b) => a[0].localeCompare(b[0]))) {
      for (const specifier of specifiers) {
        const to = resolveImport(from, specifier, allFiles);
        imports.push({ from, specifier, ...(to ? { to } : {}) });
      }
    }
    const commands = commandsFrom(ctx, packages, manager);
    const testCommands = commands
      .filter((c) => c.kind === "test")
      .map((c) => ({ id: c.id, ...(c.packageId ? { packageId: c.packageId } : {}) }));

    return {
      stack,
      packages: packageInfos,
      commands,
      constraints: constraintsFrom(ctx, packages),
      capabilities: buildCapabilities({ ctx, parsed, packages: packageInfos, links }),
      evidence: buildEvidence({ ctx, testPaths, packages: packageInfos, testCommands }),
      environment: buildEnvironment(ctx, parsed),
      risks: buildRisks(ctx),
      imports,
    };
  },
};

export default typescriptAdapter;
export { ADAPTER_ID } from "./manifest.js";
export { linkTests, resolveImport, isTestFile, isSourceFile } from "./evidence-link.js";
export { parseSource, type ParsedFile, type DetectedRoute, type ExportedSymbol } from "./parse.js";
