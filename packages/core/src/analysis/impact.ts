/**
 * Change impact analysis.
 *
 * Given a set of changed paths, answer the question a reviewer actually has:
 * what might this break, and what should I run to find out?
 *
 * Every impacted capability carries the reason it was included, because an
 * impact list without reasons is just a longer file list.
 */

import { indexById } from "../model/ids.js";
import type {
  Capability,
  Command,
  Constraint,
  EvidenceEntry,
  Risk,
  Surface,
} from "../schema/types.js";

export type ImpactRelation = "owner" | "contract" | "evidence" | "package";

export interface ImpactedCapability {
  capability: Capability;
  relation: ImpactRelation;
  reason: string;
  matchedPaths: string[];
}

export interface ImpactReport {
  changedPaths: string[];
  capabilities: ImpactedCapability[];
  risks: Risk[];
  /** Commands worth running to check this change. */
  commands: Command[];
  evidence: EvidenceEntry[];
  /** Active constraints, so a change does not silently violate a project rule. */
  constraints: Constraint[];
}

/**
 * Directory-aware, in both directions: a declared `db/migrations` is touched
 * by a change to `db/migrations/001.sql`, and a declared `docs/cli.md` is
 * touched by a change named `docs`. The same rule serves owners, evidence
 * and contracts, so the three relations agree on what "changed" means.
 */
function touches(declaredPath: string, changedPath: string): boolean {
  return (
    changedPath === declaredPath ||
    changedPath.startsWith(`${declaredPath}/`) ||
    declaredPath.startsWith(`${changedPath}/`)
  );
}

/**
 * Changed paths arrive from a shell (`surface impact packages\core\x.ts`), an
 * MCP caller or git; the document is POSIX and root-relative, so meet it there.
 */
function normalizeChanged(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/{2,}/g, "/").replace(/^(?:\.\/)+/, "").replace(/\/+$/, "");
}

const RELATION_ORDER: Record<ImpactRelation, number> = {
  owner: 0,
  evidence: 1,
  contract: 2,
  package: 3,
};

export function analyzeImpact(surface: Surface, changedPaths: string[]): ImpactReport {
<<<<<<< HEAD
  const changed = [...new Set(changedPaths.map(normalizeChanged).filter((p) => p.length > 0))].sort();
  const evidenceById = new Map(surface.evidence.map((e) => [e.id, e]));
=======
  const changed = [...new Set(changedPaths)].sort();
  const evidenceById = indexById(surface.evidence);
>>>>>>> origin/refactor/core-perf-cleanup

  const impacted = new Map<string, ImpactedCapability>();
  const record = (
    capability: Capability,
    relation: ImpactRelation,
    reason: string,
    matchedPaths: string[]
  ): void => {
    const existing = impacted.get(capability.id);
    if (existing && RELATION_ORDER[existing.relation] <= RELATION_ORDER[relation]) return;
    impacted.set(capability.id, { capability, relation, reason, matchedPaths });
  };

  for (const capability of surface.capabilities) {
    const owned = capability.owners.map((o) => o.path).filter((p) => changed.some((c) => touches(p, c)));
    if (owned.length > 0) {
      record(capability, "owner", "Implemented by a changed file.", owned);
      continue;
    }

    const evidencePaths = capability.evidence
      .map((ref) => evidenceById.get(ref.id)?.path)
      .filter((p): p is string => typeof p === "string")
      .filter((p) => changed.some((c) => touches(p, c)));
    if (evidencePaths.length > 0) {
      record(capability, "evidence", "A test that proves this capability changed.", evidencePaths);
      continue;
    }

    const contractPaths = capability.contracts.map((c) => c.path).filter((p) => changed.some((c) => touches(p, c)));
    if (contractPaths.length > 0) {
      record(capability, "contract", "Its contract document changed.", contractPaths);
      continue;
    }

    /* Weakest signal, kept last: something in the same package moved. Useful for
       "look around here", not a claim that this capability is affected. */
    const pkg = capability.packageId
      ? surface.project.packages.find((p) => p.id === capability.packageId)
      : undefined;
    if (pkg && pkg.path !== "." && changed.some((c) => touches(pkg.path, c))) {
      record(capability, "package", `Another file in package ${pkg.id} changed.`, [pkg.path]);
    }
  }

  const capabilities = [...impacted.values()].sort(
    (a, b) =>
      RELATION_ORDER[a.relation] - RELATION_ORDER[b.relation] ||
      b.capability.confidence - a.capability.confidence ||
      a.capability.id.localeCompare(b.capability.id)
  );

  const risks = surface.risks
    .filter((r) => r.paths.some((p) => changed.some((c) => touches(p, c))))
    .sort((a, b) => a.id.localeCompare(b.id));

  const relevantEvidence = capabilities
    .flatMap((i) => i.capability.evidence.map((ref) => evidenceById.get(ref.id)))
    .filter((e): e is EvidenceEntry => e !== undefined);
  const evidence = dedupeById(relevantEvidence);

  const commandIds = new Set(
    evidence.map((e) => e.commandId).filter((id): id is string => typeof id === "string")
  );
  const affectedPackages = new Set(
    capabilities.map((i) => i.capability.packageId).filter((p): p is string => typeof p === "string")
  );
  const commands = surface.commands
    .filter(
      (c) =>
        commandIds.has(c.id) ||
        (c.kind === "test" && (affectedPackages.size === 0 || !c.packageId || affectedPackages.has(c.packageId)))
    )
    .sort((a, b) => a.id.localeCompare(b.id));

  const constraints = surface.constraints
    .filter((c) => c.status === "active")
    .sort((a, b) => a.id.localeCompare(b.id));

  return { changedPaths: changed, capabilities, risks, commands, evidence, constraints };
}

function dedupeById<T extends { id: string }>(items: T[]): T[] {
  const byId = new Map(items.map((i) => [i.id, i]));
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}
