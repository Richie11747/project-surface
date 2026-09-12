/**
 * Reading the JavaScript/TypeScript manifest layer.
 *
 * package.json is the single richest structured file in this ecosystem: it
 * names the package, lists the commands, pins the package manager, and declares
 * the workspace layout. Everything here is tier `derived` - read out of
 * structured configuration, not guessed.
 */

import { classifyCommand, provenance, source } from "@project-surface/adapter-sdk";
import { commandId, constraintId, packageIdFromPath } from "@project-surface/core";
import type {
  AdapterContext,
  DraftCommand,
  DraftConstraint,
  PackageInfo,
} from "@project-surface/adapter-sdk";

export const ADAPTER_ID = "typescript";

export interface PackageJson {
  name?: string;
  private?: boolean;
  type?: string;
  packageManager?: string;
  engines?: Record<string, string>;
  scripts?: Record<string, string>;
  workspaces?: string[] | { packages?: string[] };
}

export interface DiscoveredPackage {
  info: PackageInfo;
  manifestPath: string;
  json: PackageJson;
}

const LOCKFILES: Array<[string, string]> = [
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
  ["bun.lockb", "bun"],
  ["package-lock.json", "npm"],
];

/** Which package manager this project actually uses, and how we know. */
export function detectPackageManager(ctx: AdapterContext): { name: string; evidence: string } | null {
  const root = ctx.readJson<PackageJson>("package.json");
  if (root?.packageManager) {
    const name = root.packageManager.split("@")[0];
    if (name) return { name, evidence: "package.json" };
  }
  for (const [file, name] of LOCKFILES) {
    if (ctx.exists(file)) return { name, evidence: file };
  }
  return null;
}

export function findPackages(ctx: AdapterContext): DiscoveredPackage[] {
  const manifests = ctx.match(/(^|\/)package\.json$/).filter((p) => !p.includes("node_modules/"));
  const out: DiscoveredPackage[] = [];

  for (const manifestPath of manifests) {
    const json = ctx.readJson<PackageJson>(manifestPath);
    if (!json) continue;
    const dir = manifestPath === "package.json" ? "." : manifestPath.slice(0, -"/package.json".length);
    out.push({
      manifestPath,
      json,
      info: {
        id: packageIdFromPath(dir),
        path: dir,
        ...(typeof json.name === "string" ? { name: json.name } : {}),
        manager: detectPackageManager(ctx)?.name ?? "npm",
        ...(typeof json.private === "boolean" ? { private: json.private } : {}),
      },
    });
  }

  return out.sort((a, b) => a.info.id.localeCompare(b.info.id));
}

export function commandsFrom(
  ctx: AdapterContext,
  packages: DiscoveredPackage[],
  manager: string
): DraftCommand[] {
  const commands: DraftCommand[] = [];

  for (const pkg of packages) {
    for (const [name, script] of Object.entries(pkg.json.scripts ?? {})) {
      if (typeof script !== "string" || script.trim().length === 0) continue;
      commands.push({
        id: commandId(name, pkg.info.id),
        run: `${manager} run ${name}`,
        cwd: pkg.info.path,
        kind: classifyCommand(name),
        packageId: pkg.info.id,
        description: script,
        provenance: provenance({
          tier: "derived",
          adapter: ADAPTER_ID,
          now: ctx.now,
          sources: [source(pkg.manifestPath, `scripts.${name}`)],
        }),
      });
    }
  }

  return commands;
}

export function constraintsFrom(ctx: AdapterContext, packages: DiscoveredPackage[]): DraftConstraint[] {
  const constraints: DraftConstraint[] = [];
  const manager = detectPackageManager(ctx);

  if (manager) {
    constraints.push({
      id: constraintId("package-manager"),
      rule: `Use ${manager.name} to install and run scripts in this project.`,
      rationale: `Detected from ${manager.evidence}. Mixing package managers produces conflicting lockfiles.`,
      severity: "error",
      status: "active",
      provenance: provenance({
        tier: "derived",
        adapter: ADAPTER_ID,
        now: ctx.now,
        sources: [source(manager.evidence)],
      }),
    });
  }

  const rootPackage = packages.find((p) => p.info.path === ".");
  const nodeRange = rootPackage?.json.engines?.node;
  if (rootPackage && typeof nodeRange === "string") {
    constraints.push({
      id: constraintId("engines-node"),
      rule: `Requires Node ${nodeRange}.`,
      severity: "warn",
      status: "active",
      provenance: provenance({
        tier: "derived",
        adapter: ADAPTER_ID,
        now: ctx.now,
        sources: [source(rootPackage.manifestPath, "engines.node")],
      }),
    });
  }

  if (rootPackage?.json.type === "module") {
    constraints.push({
      id: constraintId("esm-only"),
      rule: "This package is ESM. Use import syntax and include file extensions in relative imports.",
      severity: "warn",
      status: "active",
      provenance: provenance({
        tier: "derived",
        adapter: ADAPTER_ID,
        now: ctx.now,
        sources: [source(rootPackage.manifestPath, "type")],
      }),
    });
  }

  return constraints;
}
