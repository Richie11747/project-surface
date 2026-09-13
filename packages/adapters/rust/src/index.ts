/**
 * @project-surface/adapter-rust
 *
 * Structural extraction for Cargo projects: the manifest, workspace members,
 * public items, route registrations (axum, actix-web, rocket), environment
 * usage, integration tests and inline test modules.
 *
 * Honest about its ceiling in the same way as the Go adapter: no rustc, no
 * `syn`, so public items are `inferred` and routes are `derived` from a line
 * scan; `cargo` missing from PATH marks the stack unavailable; a discovered test
 * is `unknown` until something runs it. Where it can do better than a guess it
 * does: a test's `use` statements are resolved to the files they name and the
 * link is reported as `import-graph`.
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
  ImportEdge,
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
import { crateRootOf, isRustTestPath, parseCargoToml, parseRust, usePathToFiles } from "./parse.js";
import type { CargoManifest, ParsedRust } from "./parse.js";

export const ADAPTER_ID = "rust";
export const ADAPTER_VERSION = "0.2.0";

const NOT_BEHAVIOUR = /(^|\/)(target|vendor|examples)\//;
const MAX_PARSED_FILES = 4000;
/** Items worth a capability. `mod` is layout, `const`/`static` are data. */
const BEHAVIOUR_KINDS = new Set(["fn", "struct", "enum", "trait", "type"]);

function dirOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? "." : path.slice(0, i);
}

function standardCommands(ctx: AdapterContext, root: CargoManifest | null): DraftCommand[] {
  if (!root) return [];
  const fromManifest = provenance({ tier: "derived", adapter: ADAPTER_ID, now: ctx.now, sources: [source("Cargo.toml")] });
  const commands: DraftCommand[] = [
    { id: commandId("test"), run: "cargo test", cwd: ".", kind: "test", description: "Run every test in the workspace.", provenance: fromManifest },
    { id: commandId("build"), run: "cargo build", cwd: ".", kind: "build", description: "Compile every crate.", provenance: fromManifest },
    { id: commandId("check"), run: "cargo check", cwd: ".", kind: "typecheck", description: "Type-check without producing binaries.", provenance: fromManifest },
  ];
  const bins = root.bins.filter(isSafeCommandToken);
  if (bins.length > 0) {
    for (const bin of bins) {
      commands.push({
        id: commandId(`run-${bin}`),
        run: `cargo run --bin ${bin}`,
        cwd: ".",
        kind: "start",
        description: `Run the ${bin} binary.`,
        provenance: provenance({ tier: "derived", adapter: ADAPTER_ID, now: ctx.now, sources: [source("Cargo.toml", "bin")] }),
      });
    }
  } else if (ctx.exists("src/main.rs")) {
    commands.push({
      id: commandId("run"),
      run: "cargo run",
      cwd: ".",
      kind: "start",
      description: "Run the package binary.",
      provenance: provenance({ tier: "derived", adapter: ADAPTER_ID, now: ctx.now, sources: [source("src/main.rs")] }),
    });
  }
  return commands;
}

export const rustAdapter: Adapter = {
  id: ADAPTER_ID,
  version: ADAPTER_VERSION,

  detect(ctx: AdapterContext): boolean {
    return ctx.exists("Cargo.toml") || ctx.match(/\.rs$/).length > 0;
  },

  extract(ctx: AdapterContext): AdapterResult {
    const toolchainAvailable = isOnPath("cargo");
    const notes = ["Rust extraction is line-based rather than AST-based; claims are structural."];
    if (!toolchainAvailable) {
      notes.unshift(
        "The Rust toolchain (cargo) was not found on PATH. Declarations were read from source, " +
          "but no Rust claim can be verified on this machine."
      );
    }
    const stack = { id: ADAPTER_ID, adapter: "@project-surface/adapter-rust", adapterVersion: ADAPTER_VERSION, toolchainAvailable, notes };

    const rsFiles = ctx.match(/\.rs$/).filter((p) => !NOT_BEHAVIOUR.test(p));
    if (rsFiles.length === 0) return emptyResult(stack);

    /* Every Cargo.toml is a crate root; the one at "." is the package or the
       virtual workspace manifest. */
    const manifests = new Map<string, CargoManifest>();
    for (const path of ctx.match(/(^|\/)Cargo\.toml$/).filter((p) => !NOT_BEHAVIOUR.test(p)).sort()) {
      const content = ctx.readFile(path);
      if (content !== null) manifests.set(dirOf(path), parseCargoToml(content));
    }
    const crateDirs = [...manifests.keys()].sort();
    const root = manifests.get(".") ?? null;

    const constraints: DraftConstraint[] = [];
    if (root?.rustVersion) {
      constraints.push({
        id: constraintId("rust-version"),
        rule: `Requires Rust ${root.rustVersion} or newer.`,
        severity: "warn",
        status: "active",
        provenance: provenance({ tier: "derived", adapter: ADAPTER_ID, now: ctx.now, sources: [source("Cargo.toml", "package.rust-version")] }),
      });
    }

    const packages: PackageInfo[] = crateDirs.map((dir) => {
      const m = manifests.get(dir);
      return { id: packageIdFromPath(dir), path: dir, ...(m?.name ? { name: m.name } : {}), manager: "cargo" };
    });

    const parsed = new Map<string, ParsedRust>();
    const tests = new Map<string, ParsedRust>();
    for (const path of rsFiles.slice(0, MAX_PARSED_FILES).sort()) {
      const content = ctx.readFile(path);
      if (content === null) continue;
      (isRustTestPath(path) ? tests : parsed).set(path, parseRust(content));
    }

    /* An integration test names what it exercises in its `use` lines; that is
       an import-graph link. An inline `#[cfg(test)]` module lives in the file
       it tests - reported as path-proximity, the weakest link, because the
       format has no stronger word for "same file" and a guess must not be
       dressed up as a fact. */
    const evidenceByOwner = new Map<string, Array<{ id: string; link: "import-graph" | "path-proximity" }>>();
    const link = (owner: string, id: string, kind: "import-graph" | "path-proximity"): void => {
      const existing = evidenceByOwner.get(owner) ?? [];
      if (!existing.some((e) => e.id === id)) existing.push({ id, link: kind });
      evidenceByOwner.set(owner, existing);
    };
    const resolve = (from: string, usePath: string): string | undefined => {
      const crateRoot = crateRootOf(from, crateDirs);
      return usePathToFiles(usePath, crateRoot, manifests.get(crateRoot)?.name ?? null).find((c) => parsed.has(c));
    };
    for (const [testPath, file] of [...tests.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      for (const use of file.uses) {
        const owner = resolve(testPath, use.path);
        if (owner) link(owner, evidenceId(testPath), "import-graph");
      }
    }
    for (const [path, file] of parsed) if (file.hasInlineTests) link(path, evidenceId(path), "path-proximity");

    const imports: ImportEdge[] = [];
    for (const [from, file] of [...parsed.entries(), ...tests.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      for (const use of file.uses) {
        const to = resolve(from, use.path);
        imports.push({ from, specifier: use.path, ...(to ? { to } : {}) });
      }
    }

    const capabilities: DraftCapability[] = [];
    for (const path of [...parsed.keys()].sort()) {
      const file = parsed.get(path);
      if (!file) continue;
      const packageId = packageIdFromPath(crateRootOf(path, crateDirs));
      const evidence = evidenceByOwner.get(path) ?? [];

      for (const route of file.routes) {
        const id = capabilityIdFromRoute(route.method, route.path);
        capabilities.push({
          id,
          title: `${route.method} ${route.path}`,
          description: `HTTP route registered in ${path}.`,
          kind: "route",
          packageId,
          owners: [source(path, `L${route.line}`)],
          contracts: findContracts(ctx, id.split(".")[0] ?? ""),
          evidence,
          environment: file.envNames,
          tags: ["http", route.method.toLowerCase()],
          route: { method: route.method, path: route.path },
          provenance: provenance({ tier: "derived", adapter: ADAPTER_ID, now: ctx.now, sources: [source(path, `L${route.line}`)] }),
        });
      }

      for (const symbol of file.symbols) {
        if (!BEHAVIOUR_KINDS.has(symbol.kind)) continue;
        const id = capabilityIdFromSymbol(path, symbol.name);
        capabilities.push({
          id,
          title: symbol.name,
          description: `Public ${symbol.kind} in ${path}.`,
          kind: "export",
          packageId,
          owners: [source(path, `${symbol.kind}:${symbol.name}`)],
          contracts: findContracts(ctx, id.split(".")[0] ?? ""),
          evidence,
          environment: file.envNames,
          tags: [symbol.kind],
          provenance: provenance({ tier: "inferred", adapter: ADAPTER_ID, now: ctx.now, sources: [source(path, `L${symbol.line}`)] }),
        });
      }
    }

    const testHosts = [...tests.keys(), ...[...parsed.entries()].filter(([, f]) => f.hasInlineTests).map(([p]) => p)].sort();
    const evidence: DraftEvidenceEntry[] = testHosts.map((path) => ({
      id: evidenceId(path),
      kind: "test",
      path,
      status: "unknown",
      ...(root ? { commandId: commandId("test") } : {}),
      provenance: provenance({ tier: "derived", adapter: ADAPTER_ID, now: ctx.now, sources: [source(path)] }),
    }));

    const usage = new Map<string, string[]>();
    for (const [path, file] of parsed) for (const name of file.envNames) usage.set(name, [...(usage.get(name) ?? []), path]);
    const environment: DraftEnvironmentVariable[] = [...usage.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, paths]) => ({
        name,
        required: true,
        secret: looksSecretName(name),
        usedBy: paths.sort().map((p) => source(p)),
        provenance: provenance({ tier: "derived", adapter: ADAPTER_ID, now: ctx.now, sources: paths.sort().map((p) => source(p)) }),
      }));

    return { stack, packages, commands: standardCommands(ctx, root), constraints, capabilities, evidence, environment, imports };
  },
};

export default rustAdapter;
export { parseRust, parseCargoToml, isRustTestPath, crateRootOf, usePathToFiles } from "./parse.js";
export type { ParsedRust, RustRoute, RustSymbol, RustUse, CargoManifest } from "./parse.js";
