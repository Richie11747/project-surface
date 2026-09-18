/**
 * Claim merging.
 *
 * Two adapters can legitimately describe the same thing - a monorepo with a
 * Python service and a TypeScript client both know about `docker-compose.yml`;
 * a route can be found both by file convention and by a decorator. When that
 * happens the claims are combined rather than duplicated, and the merge follows
 * two rules:
 *
 *   1. The strongest provenance tier wins the scalar fields. A human
 *      declaration beats an observation, which beats a config read, which beats
 *      a guess.
 *   2. Sources always union. That is what makes corroboration real: a claim
 *      backed by three independent files scores higher than the same claim
 *      backed by one, and `computeConfidence` can see the difference.
 */

import type {
  DraftCapability,
  DraftCommand,
  DraftConstraint,
  DraftEnvironmentVariable,
  DraftEvidenceEntry,
  DraftRisk,
  EvidenceRef,
  Provenance,
  ProvenanceTier,
  SourceRef,
} from "../schema/types.js";

const TIER_STRENGTH: Record<ProvenanceTier, number> = {
  declared: 4,
  verified: 3,
  derived: 2,
  inferred: 1,
};

export function strongerTier(a: ProvenanceTier, b: ProvenanceTier): ProvenanceTier {
  return TIER_STRENGTH[a] >= TIER_STRENGTH[b] ? a : b;
}

function dedupeSources(sources: SourceRef[]): SourceRef[] {
  const seen = new Map<string, SourceRef>();
  for (const s of sources) {
    const key = `${s.path}\u0000${s.locator ?? ""}`;
    if (!seen.has(key)) seen.set(key, s);
  }
  return [...seen.values()].sort(
    (a, b) => a.path.localeCompare(b.path) || (a.locator ?? "").localeCompare(b.locator ?? "")
  );
}

export function mergeProvenance(a: Provenance, b: Provenance): Provenance {
  const winner = TIER_STRENGTH[a.tier] >= TIER_STRENGTH[b.tier] ? a : b;
  return {
    tier: strongerTier(a.tier, b.tier),
    sources: dedupeSources([...a.sources, ...b.sources]),
    adapter: winner.adapter,
    observedAt: winner.observedAt,
  };
}

/** Whether `b` should overwrite `a` for scalar fields. */
function bWins(a: Provenance, b: Provenance): boolean {
  return TIER_STRENGTH[b.tier] > TIER_STRENGTH[a.tier];
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function uniqueRefs(refs: SourceRef[]): SourceRef[] {
  return dedupeSources(refs);
}

function uniqueEvidence(refs: EvidenceRef[]): EvidenceRef[] {
  const linkStrength: Record<EvidenceRef["link"], number> = {
    declared: 4,
    config: 3,
    "import-graph": 2,
    "path-proximity": 1,
  };
  const best = new Map<string, EvidenceRef>();
  for (const r of refs) {
    const existing = best.get(r.id);
    if (!existing || linkStrength[r.link] > linkStrength[existing.link]) best.set(r.id, r);
  }
  return [...best.values()].sort((a, b) => a.id.localeCompare(b.id));
}

/** Generic id-keyed merge. `combine` decides how two claims with one id fuse. */
function mergeBy<T extends { id: string }>(items: T[], combine: (a: T, b: T) => T): T[] {
  const byId = new Map<string, T>();
  for (const item of items) {
    const existing = byId.get(item.id);
    byId.set(item.id, existing ? combine(existing, item) : item);
  }
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export function mergeCommands(items: DraftCommand[]): DraftCommand[] {
  return mergeBy(items, (a, b) => ({
    ...(bWins(a.provenance, b.provenance) ? b : a),
    provenance: mergeProvenance(a.provenance, b.provenance),
    ...(a.verification || b.verification
      ? { verification: b.verification ?? a.verification }
      : {}),
  }));
}

export function mergeCapabilities(items: DraftCapability[]): DraftCapability[] {
  return mergeBy(items, (a, b) => {
    const base = bWins(a.provenance, b.provenance) ? b : a;
    return {
      ...base,
      provenance: mergeProvenance(a.provenance, b.provenance),
      owners: uniqueRefs([...a.owners, ...b.owners]),
      contracts: uniqueRefs([...a.contracts, ...b.contracts]),
      evidence: uniqueEvidence([...a.evidence, ...b.evidence]),
      environment: uniqueStrings([...a.environment, ...b.environment]),
      tags: uniqueStrings([...a.tags, ...b.tags]),
      ...(a.aliases || b.aliases
        ? { aliases: uniqueStrings([...(a.aliases ?? []), ...(b.aliases ?? [])]) }
        : {}),
    };
  });
}

/**
 * Fold inferred capabilities into the declared capability that owns their files.
 *
 * Inference works at the granularity it can see - one exported symbol, one
 * route. A human declaration works at the granularity that matters: "the trust
 * model" is one capability, not thirty exports. When a declaration's owners
 * cover every owner file of an inferred claim, the guess is not a separate
 * capability any more; it is corroboration. Its sources and evidence links
 * move onto the declaration and its id is kept as an alias so consumers that
 * learned the old id still resolve. Only `inferred` claims are folded:
 * structured facts (`derived`, `verified`) stand on their own unless a
 * declaration reuses their id, which `mergeCapabilities` already handles.
 */
export function absorbInferred(capabilities: DraftCapability[]): DraftCapability[] {
  const declared = capabilities.filter((c) => c.provenance.tier === "declared");
  if (declared.length === 0) return capabilities;

  const coverage = declared.map((c) => ({ c, owners: new Set(c.owners.map((o) => o.path)) }));
  const absorbedInto = new Map<string, DraftCapability[]>();
  const kept: DraftCapability[] = [];

  for (const capability of capabilities) {
    if (capability.provenance.tier !== "inferred") {
      kept.push(capability);
      continue;
    }
    const host = coverage.find(({ owners }) => capability.owners.every((o) => owners.has(o.path)));
    if (!host) {
      kept.push(capability);
      continue;
    }
    const list = absorbedInto.get(host.c.id) ?? [];
    list.push(capability);
    absorbedInto.set(host.c.id, list);
  }

  return kept
    .map((capability) => {
      const absorbed = absorbedInto.get(capability.id);
      if (!absorbed) return capability;
      return {
        ...capability,
        provenance: absorbed.reduce((p, a) => mergeProvenance(p, a.provenance), capability.provenance),
        evidence: uniqueEvidence([...capability.evidence, ...absorbed.flatMap((a) => a.evidence)]),
        environment: uniqueStrings([...capability.environment, ...absorbed.flatMap((a) => a.environment)]),
        aliases: uniqueStrings([...(capability.aliases ?? []), ...absorbed.map((a) => a.id)]),
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function mergeConstraints(items: DraftConstraint[]): DraftConstraint[] {
  return mergeBy(items, (a, b) => ({
    ...(bWins(a.provenance, b.provenance) ? b : a),
    provenance: mergeProvenance(a.provenance, b.provenance),
  }));
}

export function mergeRisks(items: DraftRisk[]): DraftRisk[] {
  return mergeBy(items, (a, b) => ({
    ...(bWins(a.provenance, b.provenance) ? b : a),
    provenance: mergeProvenance(a.provenance, b.provenance),
    paths: uniqueStrings([...a.paths, ...b.paths]),
  }));
}

export function mergeEvidence(items: DraftEvidenceEntry[]): DraftEvidenceEntry[] {
  return mergeBy(items, (a, b) => ({
    ...(bWins(a.provenance, b.provenance) ? b : a),
    provenance: mergeProvenance(a.provenance, b.provenance),
  }));
}

/** Environment variables are keyed by NAME rather than id. */
export function mergeEnvironment(items: DraftEnvironmentVariable[]): DraftEnvironmentVariable[] {
  const byName = new Map<string, DraftEnvironmentVariable>();
  for (const item of items) {
    const existing = byName.get(item.name);
    if (!existing) {
      byName.set(item.name, item);
      continue;
    }
    /* `required` follows rule 1: a maintainer declaring `required: false`
       overrides an adapter that assumed every read is mandatory. `secret` is
       sticky in either direction - the cost of the two mistakes is not equal. */
    const winner = bWins(existing.provenance, item.provenance) ? item : existing;
    byName.set(item.name, {
      ...winner,
      provenance: mergeProvenance(existing.provenance, item.provenance),
      usedBy: uniqueRefs([...existing.usedBy, ...item.usedBy]),
      required: winner.required,
      secret: existing.secret || item.secret,
    });
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}
