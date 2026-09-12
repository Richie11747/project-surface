/**
 * Surface diffing.
 *
 * What changed about the *project*, as opposed to what changed in the files.
 * This is what a pull request comment should say: a route appeared, a command
 * changed, a claim went stale, a constraint was dropped.
 *
 * Volatile fields (generation timestamp, git head) are ignored - they change on
 * every run and mean nothing to a reviewer.
 */

import type { Capability, Command, Constraint, HealthFinding, Surface } from "../schema/types.js";

export interface FieldChange {
  field: string;
  before: string;
  after: string;
}

export interface ChangedEntry {
  id: string;
  changes: FieldChange[];
}

export interface EntryDiff {
  added: string[];
  removed: string[];
  changed: ChangedEntry[];
}

export interface SurfaceDiff {
  capabilities: EntryDiff;
  commands: EntryDiff;
  constraints: EntryDiff;
  health: { appeared: HealthFinding[]; resolved: HealthFinding[] };
  /** True when nothing a reviewer would care about moved. */
  empty: boolean;
}

function byId<T extends { id: string }>(items: T[]): Map<string, T> {
  return new Map(items.map((i) => [i.id, i]));
}

function diffEntries<T extends { id: string }>(
  before: T[],
  after: T[],
  compare: (a: T, b: T) => FieldChange[]
): EntryDiff {
  const beforeMap = byId(before);
  const afterMap = byId(after);

  const added = [...afterMap.keys()].filter((id) => !beforeMap.has(id)).sort();
  const removed = [...beforeMap.keys()].filter((id) => !afterMap.has(id)).sort();

  const changed: ChangedEntry[] = [];
  for (const [id, a] of afterMap) {
    const b = beforeMap.get(id);
    if (!b) continue;
    const changes = compare(b, a);
    if (changes.length > 0) changed.push({ id, changes });
  }
  changed.sort((a, b) => a.id.localeCompare(b.id));

  return { added, removed, changed };
}

function field(name: string, before: unknown, after: unknown): FieldChange | null {
  const b = String(before ?? "");
  const a = String(after ?? "");
  return b === a ? null : { field: name, before: b, after: a };
}

function compact(changes: (FieldChange | null)[]): FieldChange[] {
  return changes.filter((c): c is FieldChange => c !== null);
}

function paths(refs: { path: string }[]): string {
  return refs.map((r) => r.path).sort().join(", ");
}

function ids(refs: { id: string }[]): string {
  return refs.map((r) => r.id).sort().join(", ");
}

function compareCapabilities(before: Capability, after: Capability): FieldChange[] {
  return compact([
    field("title", before.title, after.title),
    field("owners", paths(before.owners), paths(after.owners)),
    field("contracts", paths(before.contracts), paths(after.contracts)),
    field("evidence", ids(before.evidence), ids(after.evidence)),
    field("environment", [...before.environment].sort().join(", "), [...after.environment].sort().join(", ")),
    field("confidence", before.confidence.toFixed(2), after.confidence.toFixed(2)),
    field("freshness", before.freshness?.status ?? "unknown", after.freshness?.status ?? "unknown"),
    field("provenance", before.provenance.tier, after.provenance.tier),
  ]);
}

function compareCommands(before: Command, after: Command): FieldChange[] {
  return compact([
    field("run", before.run, after.run),
    field("cwd", before.cwd, after.cwd),
    field("kind", before.kind, after.kind),
    field("verification", before.verification?.status ?? "none", after.verification?.status ?? "none"),
  ]);
}

function compareConstraints(before: Constraint, after: Constraint): FieldChange[] {
  return compact([
    field("rule", before.rule, after.rule),
    field("severity", before.severity, after.severity),
    field("status", before.status, after.status),
  ]);
}

function healthKey(f: HealthFinding): string {
  return `${f.code}\u0000${f.subject?.kind ?? ""}\u0000${f.subject?.id ?? ""}`;
}

export function diffSurfaces(before: Surface, after: Surface): SurfaceDiff {
  const capabilities = diffEntries(before.capabilities, after.capabilities, compareCapabilities);
  const commands = diffEntries(before.commands, after.commands, compareCommands);
  const constraints = diffEntries(before.constraints, after.constraints, compareConstraints);

  const beforeHealth = new Map(before.health.map((f) => [healthKey(f), f]));
  const afterHealth = new Map(after.health.map((f) => [healthKey(f), f]));
  const appeared = [...afterHealth].filter(([k]) => !beforeHealth.has(k)).map(([, f]) => f);
  const resolved = [...beforeHealth].filter(([k]) => !afterHealth.has(k)).map(([, f]) => f);

  const isEmpty = (d: EntryDiff): boolean =>
    d.added.length === 0 && d.removed.length === 0 && d.changed.length === 0;

  return {
    capabilities,
    commands,
    constraints,
    health: { appeared, resolved },
    empty:
      isEmpty(capabilities) &&
      isEmpty(commands) &&
      isEmpty(constraints) &&
      appeared.length === 0 &&
      resolved.length === 0,
  };
}
