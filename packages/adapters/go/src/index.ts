/**
 * @project-surface/adapter-go
 *
 * Structural extraction for Go modules: go.mod, package layout, exported
 * declarations, router registrations, environment usage, and test files.
 *
 * This adapter is deliberately honest about its ceiling. Without the Go
 * toolchain present it marks the stack unavailable, and it never reports a
 * discovered `_test.go` file as anything better than `unknown`. Finding a test
 * is not the same as running one, and on a machine with no Go installed there
 * is no way to run one at all.
 */

import { emptyResult, findContracts, isOnPath, isSafeCommandToken, provenance, source } from "@project-surface/adapter-sdk";
import type {
  Adapter,
  AdapterContext,
  AdapterResult,
  DraftCapability,
  DraftCommand,
  DraftConstraint,
  DraftEnvironmentVariable,
  DraftEvidenceEntry,
  PackageInfo,
} from "@project-surface/adapter-sdk";
import {
  capabilityIdFromRoute,
  capabilityIdFromSymbol,
  commandId,
  constraintId,
  evidenceId,
  looksSecretName,
  packageIdFromPath,
} from "@project-surface/core";
import { goPackageDir, isGoTest, parseGo, parseGoMod } from "./parse.js";
import type { ParsedGo } from "./parse.js";

export const ADAPTER_ID = "go";
export const ADAPTER_VERSION = "0.1.0";

const NOT_BEHAVIOUR = /(^|\/)(vendor|testdata|third_party)\//;
const MAX_PARSED_FILES = 4000;

function standardCommands(ctx: AdapterContext): DraftCommand[] {
  if (!ctx.exists("go.mod")) return [];
  const fromGoMod = (tier: "derived") =>
    provenance({ tier, adapter: ADAPTER_ID, now: ctx.now, sources: [source("go.mod")] });

  const commands: DraftCommand[] = [
    {
      id: commandId("test"),
      run: "go test ./...",
      cwd: ".",
      kind: "test",
      description: "Run every test in the module.",
      provenance: fromGoMod("derived"),
    },
    {
      id: commandId("build"),
      run: "go build ./...",
      cwd: ".",
      kind: "build",
      description: "Compile every package in the module.",
      provenance: fromGoMod("derived"),
    },
    {
      id: commandId("vet"),
      run: "go vet ./...",
      cwd: ".",
      kind: "lint",
      description: "Report suspicious constructs.",
      provenance: fromGoMod("derived"),
    },
  ];

  for (const main of ctx.match(/^cmd\/[^/]+\/main\.go$/)) {
    const name = main.split("/")[1] ?? "main";
    if (!isSafeCommandToken(name)) continue;
    commands.push({
      id: commandId(`run-${name}`),
      run: `go run ./cmd/${name}`,
      cwd: ".",
      kind: "start",
      description: `Run the ${name} binary.`,
      provenance: provenance({ tier: "derived", adapter: ADAPTER_ID, now: ctx.now, sources: [source(main)] }),
    });
  }

  return commands;
}

export const goAdapter: Adapter = {
  id: ADAPTER_ID,
  version: ADAPTER_VERSION,

  detect(ctx: AdapterContext): boolean {
    return ctx.exists("go.mod") || ctx.match(/\.go$/).length > 0;
  },

  extract(ctx: AdapterContext): AdapterResult {
    const toolchainAvailable = isOnPath("go");
    const notes = ["Go extraction is line-based rather than AST-based; claims are structural."];
    if (!toolchainAvailable) {
      notes.unshift(
        "The Go toolchain was not found on PATH. Declarations were read from source, " +
          "but no Go claim can be verified on this machine."
      );
    }

    const stack = {
      id: ADAPTER_ID,
      adapter: "@project-surface/adapter-go",
      adapterVersion: ADAPTER_VERSION,
      toolchainAvailable,
      notes,
    };

    const goFiles = ctx.match(/\.go$/).filter((p) => !NOT_BEHAVIOUR.test(p));
    if (goFiles.length === 0) return emptyResult(stack);

    const goMod = ctx.readFile("go.mod");
    const module = goMod ? parseGoMod(goMod) : { module: null, goVersion: null };

    const constraints: DraftConstraint[] = [];
    if (module.goVersion) {
      constraints.push({
        id: constraintId("go-version"),
        rule: `Requires Go ${module.goVersion} or newer.`,
        severity: "warn",
        status: "active",
        provenance: provenance({
          tier: "derived",
          adapter: ADAPTER_ID,
          now: ctx.now,
          sources: [source("go.mod", "go")],
        }),
      });
    }

    const parsed = new Map<string, ParsedGo>();
    const testPaths: string[] = [];
    for (const path of goFiles.slice(0, MAX_PARSED_FILES)) {
      if (isGoTest(path)) {
        testPaths.push(path);
        continue;
      }
      const content = ctx.readFile(path);
      if (content === null) continue;
      parsed.set(path, parseGo(content));
    }

    /* Go convention places `foo_test.go` beside `foo.go` in the same package,
       so directory adjacency is the language's own rule rather than a filename
       guess - but it is still weaker than an observed import, and is reported
       as path-proximity accordingly. */
    const testsByDir = new Map<string, string[]>();
    for (const path of testPaths.sort()) {
      const dir = goPackageDir(path);
      testsByDir.set(dir, [...(testsByDir.get(dir) ?? []), path]);
    }

    const packageDirs = [...new Set([...parsed.keys()].map(goPackageDir))].sort();
    /* The module itself is a package even when no .go file sits at the root, so
       the project takes its name from go.mod rather than from the directory. */
    if (module.module && !packageDirs.includes(".")) packageDirs.unshift(".");
    const packages: PackageInfo[] = packageDirs.map((dir) => ({
      id: packageIdFromPath(dir),
      path: dir,
      ...(module.module
        ? { name: dir === "." ? module.module : `${module.module}/${dir}` }
        : {}),
      manager: "go",
    }));

    const capabilities: DraftCapability[] = [];
    for (const path of [...parsed.keys()].sort()) {
      const file = parsed.get(path);
      if (!file) continue;
      const dir = goPackageDir(path);
      const packageId = packageIdFromPath(dir);
      const evidence = (testsByDir.get(dir) ?? []).map((t) => ({
        id: evidenceId(t),
        link: "path-proximity" as const,
      }));

      for (const route of file.routes) {
        capabilities.push({
          id: capabilityIdFromRoute(route.method, route.path),
          title: `${route.method} ${route.path}`,
          description: `HTTP route registered in ${path}.`,
          kind: "route",
          packageId,
          owners: [source(path, `L${route.line}`)],
          contracts: findContracts(ctx, capabilityIdFromRoute(route.method, route.path).split(".")[0] ?? ""),
          evidence,
          environment: file.envNames,
          tags: ["http", route.method.toLowerCase()],
          route: { method: route.method, path: route.path },
          provenance: provenance({
            tier: "derived",
            adapter: ADAPTER_ID,
            now: ctx.now,
            sources: [source(path, `L${route.line}`)],
          }),
        });
      }

    /* Exports are emitted even for a file that also registers routes. When a
       symbol and a route derive the same id - `createCheckout` in
       checkout/create.ts and `POST /checkout` both yield `checkout.create` -
       the merge layer folds them into one capability with both owners and the
       stronger provenance. Suppressing exports here would instead discard real
       behaviour that happens to live beside a route. */
      for (const symbol of file.symbols) {
        capabilities.push({
          id: capabilityIdFromSymbol(path, symbol.name),
          title: symbol.name,
          description: `Exported ${symbol.kind} in ${path}.`,
          kind: "export",
          packageId,
          owners: [source(path, `${symbol.kind}:${symbol.name}`)],
          contracts: findContracts(ctx, capabilityIdFromSymbol(path, symbol.name).split(".")[0] ?? ""),
          evidence,
          environment: file.envNames,
          tags: [symbol.kind],
          provenance: provenance({
            tier: "inferred",
            adapter: ADAPTER_ID,
            now: ctx.now,
            sources: [source(path, `L${symbol.line}`)],
          }),
        });
      }
    }

    const hasModule = ctx.exists("go.mod");
    const evidence: DraftEvidenceEntry[] = testPaths.sort().map((path) => ({
      id: evidenceId(path),
      kind: "test",
      path,
      status: "unknown",
      ...(hasModule ? { commandId: commandId("test") } : {}),
      provenance: provenance({ tier: "derived", adapter: ADAPTER_ID, now: ctx.now, sources: [source(path)] }),
    }));

    const usage = new Map<string, string[]>();
    for (const [path, file] of parsed) {
      for (const name of file.envNames) usage.set(name, [...(usage.get(name) ?? []), path]);
    }
    const environment: DraftEnvironmentVariable[] = [...usage.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, paths]) => ({
        name,
        required: true,
        secret: looksSecretName(name),
        usedBy: paths.sort().map((p) => source(p)),
        provenance: provenance({
          tier: "derived",
          adapter: ADAPTER_ID,
          now: ctx.now,
          sources: paths.sort().map((p) => source(p)),
        }),
      }));

    return {
      stack,
      packages,
      commands: standardCommands(ctx),
      constraints,
      capabilities,
      evidence,
      environment,
    };
  },
};

export default goAdapter;
export { parseGo, parseGoMod, isGoTest, goPackageDir } from "./parse.js";
export type { ParsedGo, GoRoute, GoSymbol } from "./parse.js";
