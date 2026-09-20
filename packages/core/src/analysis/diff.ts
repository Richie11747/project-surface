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

import { hashContent } from "../model/freshness.js";
import { indexById } from "../model/ids.js";
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


function diffEntries<T extends { id: string }>(
  before: T[],
  after: T[],
  compare: (a: T, b: T) => FieldChange[]
): EntryDiff {
  const beforeMap = indexById(before);
  const afterMap = indexById(after);

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

/**
 * Findings are compared by code and subject. Every DECLARATION_INVALID shares
 * the subject `declarations`, so those carry their message too - otherwise a
 * fixed error and a new one on the same scan cancel out to "no change".
 */
function healthKey(f: HealthFinding): string {
  const message = f.code === "DECLARATION_INVALID" ? hashContent(f.message).slice(0, 12) : "";
  return `${f.code}\u0000${f.subject?.kind ?? ""}\u0000${f.subject?.id ?? ""}\u0000${message}`;
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

/** Marker that lets a bot find and update its own comment instead of posting a new one. */
export const DIFF_COMMENT_MARKER = "<!-- project-surface:diff -->";

function escapeCell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

/** Long lists are collapsed so a large refactor does not become a wall of text. */
const COLLAPSE_AFTER = 12;

function collapsible(lines: string[], items: string[], summary: string): void {
  if (items.length > COLLAPSE_AFTER) {
    lines.push(`<details><summary>${summary}</summary>`, "");
    lines.push(...items);
    lines.push("", "</details>");
  } else {
    lines.push(...items);
  }
}

function markdownSection(title: string, diff: EntryDiff, lines: string[]): void {
  const total = diff.added.length + diff.removed.length + diff.changed.length;
  if (total === 0) return;
  lines.push(`### ${title}`);
  lines.push("");
  const items: string[] = [];
  for (const id of diff.added) items.push(`- **added** \`${id}\``);
  for (const id of diff.removed) items.push(`- **removed** \`${id}\``);
  for (const entry of diff.changed) {
    items.push(`- **changed** \`${entry.id}\``);
    for (const c of entry.changes) {
      items.push(`  - ${c.field}: ${c.before ? `\`${escapeCell(c.before)}\`` : "_(none)_"} → ${c.after ? `\`${escapeCell(c.after)}\`` : "_(none)_"}`);
    }
  }
  collapsible(lines, items, `${total} entries`);
  lines.push("");
}

/**
 * Render a diff as a pull-request comment. The first line is a one-glance
 * summary; the rest is the same information `surface diff` prints, in
 * Markdown. Health findings are listed with severity so a reviewer sees a
 * violated constraint or a stale claim without opening the CLI.
 */
export function renderDiffMarkdown(diff: SurfaceDiff, ref: string): string {
  const lines: string[] = [DIFF_COMMENT_MARKER, "## Surface changes", ""];

  if (diff.empty) {
    lines.push(`Nothing about the project surface changed since \`${ref}\`: no capability, command or constraint moved and no health finding appeared or resolved.`);
    lines.push("");
    lines.push("_Generated by [project-surface](https://github.com/Richie11747/project-surface) from `.project/surface.json`._");
    return lines.join("\n");
  }

  const count = (d: EntryDiff): string => {
    const parts: string[] = [];
    if (d.added.length) parts.push(`+${d.added.length}`);
    if (d.removed.length) parts.push(`-${d.removed.length}`);
    if (d.changed.length) parts.push(`~${d.changed.length}`);
    return parts.join(" ");
  };
  const summary = [
    count(diff.capabilities) && `capabilities ${count(diff.capabilities)}`,
    count(diff.commands) && `commands ${count(diff.commands)}`,
    count(diff.constraints) && `constraints ${count(diff.constraints)}`,
    diff.health.appeared.length && `${diff.health.appeared.length} new finding${diff.health.appeared.length === 1 ? "" : "s"}`,
    diff.health.resolved.length && `${diff.health.resolved.length} resolved`,
  ].filter((s): s is string => typeof s === "string" && s.length > 0);
  lines.push(`Since \`${ref}\`: ${summary.join(" · ")}.`);
  lines.push("");

  markdownSection("Capabilities", diff.capabilities, lines);
  markdownSection("Commands", diff.commands, lines);
  markdownSection("Constraints", diff.constraints, lines);

  const finding = (f: HealthFinding): string =>
    `- **${f.severity}** \`${f.code}\`${f.subject ? ` (${f.subject.kind} \`${f.subject.id}\`)` : ""}: ${escapeCell(f.message)}` +
    (f.remediation ? `\n  - fix: ${escapeCell(f.remediation)}` : "");
  if (diff.health.appeared.length > 0) {
    lines.push("### New health findings");
    lines.push("");
    collapsible(lines, diff.health.appeared.map(finding), `${diff.health.appeared.length} findings`);
    lines.push("");
  }
  if (diff.health.resolved.length > 0) {
    lines.push("### Resolved");
    lines.push("");
    collapsible(
      lines,
      diff.health.resolved.map((f) => `- \`${f.code}\`${f.subject ? ` (${f.subject.kind} \`${f.subject.id}\`)` : ""}`),
      `${diff.health.resolved.length} findings`
    );
    lines.push("");
  }

  lines.push("_Generated by [project-surface](https://github.com/Richie11747/project-surface) from `.project/surface.json`. Run `surface diff` locally for the same view._");
  return lines.join("\n");
}
