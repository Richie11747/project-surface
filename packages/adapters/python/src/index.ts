/**
 * @project-surface/adapter-python
 *
 * Reads pyproject.toml, setup.cfg and requirements files for packaging and
 * commands; reads source files for routes, public symbols, environment usage,
 * and the import edges that connect tests to implementations.
 */

import { parse as parseToml } from "smol-toml";
import { classifyCommand, emptyResult, findContracts, isSafeCommandToken, provenance, source } from "@project-surface/adapter-sdk";
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
import { isPythonTest, parsePython, pythonModuleToPaths } from "./parse.js";
import type { ParsedPython } from "./parse.js";

export const ADAPTER_ID = "python";
export const ADAPTER_VERSION = "0.1.0";

const NOT_BEHAVIOUR = /(^|\/)(\.venv|venv|build|dist|__pycache__|migrations)\//;
const MAX_PARSED_FILES = 4000;

interface PyProjectSection {
  name?: unknown;
  scripts?: Record<string, unknown>;
  "requires-python"?: unknown;
}

interface PyProject {
  project?: PyProjectSection;
  tool?: Record<string, unknown>;
}

function readPyProject(ctx: AdapterContext): PyProject | null {
  const raw = ctx.readFile("pyproject.toml");
  if (raw === null) return null;
  try {
    return parseToml(raw) as PyProject;
  } catch {
    return null;
  }
}

/**
 * The test command. pytest is assumed only when something in the project points
 * at it; otherwise no test command is claimed rather than a wrong one.
 */
function testCommand(ctx: AdapterContext, pyproject: PyProject | null): DraftCommand | null {
  const configFile = ["pyproject.toml", "pytest.ini", "tox.ini", "setup.cfg"].find((f) => ctx.exists(f));
  const configured = Boolean(pyproject?.tool && "pytest" in pyproject.tool) || ctx.exists("pytest.ini");
  const hasTests = ctx.match(/(^|\/)(test_[^/]*|[^/]*_test)\.py$/).length > 0;
  if (!configured && !hasTests) return null;

  const evidencePath = configured && configFile ? configFile : (ctx.match(/(^|\/)test_[^/]*\.py$/)[0] ?? configFile);
  if (!evidencePath) return null;

  return {
    id: commandId("test"),
    run: "python -m pytest",
    cwd: ".",
    kind: "test",
    description: "Run the Python test suite.",
    provenance: provenance({
      tier: configured ? "derived" : "inferred",
      adapter: ADAPTER_ID,
      now: ctx.now,
      sources: [source(evidencePath)],
    }),
  };
}

function packagingClaims(
  ctx: AdapterContext,
  pyproject: PyProject | null
): { packages: PackageInfo[]; commands: DraftCommand[]; constraints: DraftConstraint[] } {
  const packages: PackageInfo[] = [
    {
      id: packageIdFromPath("."),
      path: ".",
      ...(typeof pyproject?.project?.name === "string" ? { name: pyproject.project.name } : {}),
      manager: ctx.exists("poetry.lock") ? "poetry" : ctx.exists("uv.lock") ? "uv" : "pip",
    },
  ];

  const commands: DraftCommand[] = [];
  for (const [name, target] of Object.entries(pyproject?.project?.scripts ?? {})) {
    if (typeof target !== "string" || !isSafeCommandToken(name)) continue;
    commands.push({
      id: commandId(name),
      run: name,
      cwd: ".",
      kind: classifyCommand(name),
      description: `Console entry point for ${target}.`,
      provenance: provenance({
        tier: "derived",
        adapter: ADAPTER_ID,
        now: ctx.now,
        sources: [source("pyproject.toml", `project.scripts.${name}`)],
      }),
    });
  }

  const constraints: DraftConstraint[] = [];
  const requiresPython = pyproject?.project?.["requires-python"];
  if (typeof requiresPython === "string") {
    constraints.push({
      id: constraintId("requires-python"),
      rule: `Requires Python ${requiresPython}.`,
      severity: "warn",
      status: "active",
      provenance: provenance({
        tier: "derived",
        adapter: ADAPTER_ID,
        now: ctx.now,
        sources: [source("pyproject.toml", "project.requires-python")],
      }),
    });
  }

  return { packages, commands, constraints };
}

export const pythonAdapter: Adapter = {
  id: ADAPTER_ID,
  version: ADAPTER_VERSION,

  detect(ctx: AdapterContext): boolean {
    return (
      ctx.exists("pyproject.toml") ||
      ctx.exists("setup.py") ||
      ctx.exists("setup.cfg") ||
      ctx.exists("requirements.txt") ||
      ctx.match(/\.py$/).length > 0
    );
  },

  extract(ctx: AdapterContext): AdapterResult {
    const stack = {
      id: ADAPTER_ID,
      adapter: "@project-surface/adapter-python",
      adapterVersion: ADAPTER_VERSION,
      /* Extraction is static and always works. Whether the interpreter exists
         matters only for verification, which the runner checks separately. */
      toolchainAvailable: true,
      notes: [] as string[],
    };

    const candidates = ctx.match(/\.py$/).filter((p) => !NOT_BEHAVIOUR.test(p));
    if (candidates.length === 0) return emptyResult(stack);
    if (candidates.length > MAX_PARSED_FILES) {
      stack.notes.push(`Only the first ${MAX_PARSED_FILES} of ${candidates.length} files were parsed.`);
    }

    const pyproject = readPyProject(ctx);
    const { packages, commands, constraints } = packagingClaims(ctx, pyproject);
    const test = testCommand(ctx, pyproject);
    if (test) commands.push(test);

    const parsed = new Map<string, ParsedPython>();
    const tests = new Map<string, ParsedPython>();
    for (const path of candidates.slice(0, MAX_PARSED_FILES)) {
      const content = ctx.readFile(path);
      if (content === null) continue;
      const file = parsePython(content);
      if (isPythonTest(path)) tests.set(path, file);
      else parsed.set(path, file);
    }

    /* Link a test to an implementation only when the test actually imports it.
       Python has no extension in import statements, so both the module file and
       the package __init__ are checked. */
    const allFiles = new Set(ctx.files);
    const evidenceByOwner = new Map<string, Array<{ id: string; link: "import-graph" }>>();
    for (const testPath of [...tests.keys()].sort()) {
      const file = tests.get(testPath);
      if (!file) continue;
      for (const imp of file.imports) {
        for (const candidate of pythonModuleToPaths(testPath, imp)) {
          if (!parsed.has(candidate) || !allFiles.has(candidate)) continue;
          const existing = evidenceByOwner.get(candidate) ?? [];
          if (!existing.some((e) => e.id === evidenceId(testPath))) {
            existing.push({ id: evidenceId(testPath), link: "import-graph" });
          }
          evidenceByOwner.set(candidate, existing);
        }
      }
    }

    const packageId = packages[0]?.id ?? "root";
    const capabilities: DraftCapability[] = [];
    for (const path of [...parsed.keys()].sort()) {
      const file = parsed.get(path);
      if (!file) continue;
      const evidence = (evidenceByOwner.get(path) ?? []).sort((a, b) => a.id.localeCompare(b.id));

      for (const route of file.routes) {
        capabilities.push({
          id: capabilityIdFromRoute(route.method, route.path),
          title: `${route.method} ${route.path}`,
          description: `HTTP endpoint declared in ${path}.`,
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
          description: `Public ${symbol.kind} in ${path}.`,
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

    const evidence: DraftEvidenceEntry[] = [...tests.keys()].sort().map((path) => ({
      id: evidenceId(path),
      kind: "test",
      path,
      status: "unknown",
      ...(test ? { commandId: test.id } : {}),
      provenance: provenance({
        tier: "derived",
        adapter: ADAPTER_ID,
        now: ctx.now,
        sources: [source(path)],
      }),
    }));

    const usage = new Map<string, string[]>();
    for (const [path, file] of [...parsed, ...tests]) {
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

    return { stack, packages, commands, constraints, capabilities, evidence, environment };
  },
};

export default pythonAdapter;
export { parsePython, isPythonTest, pythonModuleToPaths } from "./parse.js";
export type { ParsedPython, PyRoute, PySymbol } from "./parse.js";
