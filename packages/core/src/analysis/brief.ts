/**
 * The brief: one screen of orientation, meant to be the first thing an agent
 * reads in a session.
 *
 * `surface_overview` used to answer with every claim in the document, which
 * on a repository of any size is thousands of tokens before the task has been
 * named. The brief is the same facts at the granularity a newcomer needs:
 * which commands are proven, which rules are errors, which paths need
 * approval, and where things live - grouped by the first segment of the
 * capability id, which is how maintainers name areas. Nothing here is a new
 * claim; every line is a projection of one already in the document.
 *
 * One renderer serves the CLI and the MCP tool, so a person and an agent are
 * looking at the same text.
 */

import type { Capability, Command, Risk, Severity, Surface } from "../schema/types.js";

const MAX_COMMANDS = 5;
const MAX_RULES = 5;
const MAX_CARE = 5;
const MAX_AREAS = 10;
const AREA_SAMPLE = 3;
const ORIENTING_KINDS: ReadonlySet<Command["kind"]> = new Set(["test", "build", "typecheck", "dev", "lint"]);

export interface BriefCommand {
  id: string;
  run: string;
  kind: Command["kind"];
  proven: boolean;
  commit?: string;
}

export interface BriefRule {
  rule: string;
  severity: Severity;
  checked: "passing" | "violated" | "unchecked" | "none";
}

export interface BriefCare {
  paths: string[];
  type: Risk["type"];
  approval: Risk["approval"];
}

export interface BriefArea {
  /** The id prefix: `checkout` for `checkout.create`, `checkout.get`. */
  prefix: string;
  count: number;
  /** The directory every owner of the area shares, `.` when there is none. */
  dir: string;
  sample: string[];
}

export interface Brief {
  project: { name: string; stacks: string[]; packages: number };
  counts: {
    capabilities: number;
    declared: number;
    verified: number;
    derived: number;
    inferred: number;
    stale: number;
    unproven: number;
  };
  health: { error: number; warn: number; info: number };
  commands: BriefCommand[];
  rules: BriefRule[];
  rulesOmitted: number;
  care: BriefCare[];
  areas: BriefArea[];
  areasOmitted: number;
  next: string[];
}

const KIND_ORDER: Record<string, number> = { test: 0, typecheck: 1, build: 2, lint: 3, dev: 4 };

export function buildBrief(surface: Surface): Brief {
  const caps = surface.capabilities;
  const count = (tier: string): number => caps.filter((c) => c.provenance.tier === tier).length;

  const commands = surface.commands
    .filter((c) => ORIENTING_KINDS.has(c.kind))
    .map<BriefCommand>((c) => ({
      id: c.id,
      run: c.run,
      kind: c.kind,
      proven: c.verification?.status === "passed",
      ...(c.verification?.status === "passed" && c.verification.commit ? { commit: c.verification.commit } : {}),
    }))
    .sort(
      (a, b) =>
        Number(b.proven) - Number(a.proven) ||
        (KIND_ORDER[a.kind] ?? 9) - (KIND_ORDER[b.kind] ?? 9) ||
        a.id.localeCompare(b.id)
    )
    .slice(0, MAX_COMMANDS);

  const errorRules = surface.constraints
    .filter((c) => c.status === "active" && c.severity === "error")
    .sort((a, b) => a.id.localeCompare(b.id));
  const rules = errorRules.slice(0, MAX_RULES).map<BriefRule>((c) => ({
    rule: c.rule,
    severity: c.severity,
    checked: c.checked ? (c.checked.status === "passed" ? "passing" : c.checked.status) : "none",
  }));

  const required = surface.risks
    .filter((r) => r.approval === "required")
    .sort((a, b) => a.id.localeCompare(b.id));
  const care = required
    .slice(0, MAX_CARE)
    .map<BriefCare>((r) => ({ paths: r.paths, type: r.type, approval: r.approval }));

  const areas = groupAreas(caps);

  return {
    project: {
      name: surface.project.name,
      stacks: surface.project.stacks.map((s) => s.id),
      packages: surface.project.packages.length,
    },
    counts: {
      capabilities: caps.length,
      declared: count("declared"),
      verified: count("verified"),
      derived: count("derived"),
      inferred: count("inferred"),
      stale: caps.filter((c) => c.freshness?.status === "stale").length,
      unproven: caps.filter((c) => c.evidence.length === 0).length,
    },
    health: {
      error: surface.health.filter((h) => h.severity === "error").length,
      warn: surface.health.filter((h) => h.severity === "warn").length,
      info: surface.health.filter((h) => h.severity === "info").length,
    },
    commands,
    rules,
    rulesOmitted: errorRules.length - rules.length,
    care,
    areas: areas.slice(0, MAX_AREAS),
    areasOmitted: Math.max(0, areas.length - MAX_AREAS),
    next: [
      'surface context "<task>" - the files, rules and tests for a task, within a token budget',
      "surface impact <paths> - what a change touches and what to run",
      "surface inspect <id> - one capability: owners, contract, evidence, trust",
      "surface doctor - stale claims and broken rules",
    ],
  };
}

function groupAreas(caps: readonly Capability[]): BriefArea[] {
  const groups = new Map<string, Capability[]>();
  for (const c of caps) {
    const prefix = c.id.includes(".") ? c.id.slice(0, c.id.indexOf(".")) : c.id;
    groups.set(prefix, [...(groups.get(prefix) ?? []), c]);
  }
  return [...groups.entries()]
    .map<BriefArea>(([prefix, members]) => {
      const sorted = [...members].sort((a, b) => b.confidence - a.confidence || a.id.localeCompare(b.id));
      return {
        prefix,
        count: members.length,
        dir: commonDir(members.flatMap((m) => m.owners.map((o) => o.path))),
        sample: sorted.slice(0, AREA_SAMPLE).map((m) => m.id),
      };
    })
    .sort((a, b) => b.count - a.count || a.prefix.localeCompare(b.prefix));
}

/** The longest directory prefix shared by every path; `.` when they share none. */
function commonDir(paths: readonly string[]): string {
  if (paths.length === 0) return ".";
  let prefix = (paths[0] ?? "").split("/").slice(0, -1);
  for (const p of paths.slice(1)) {
    const parts = p.split("/").slice(0, -1);
    let i = 0;
    while (i < prefix.length && i < parts.length && prefix[i] === parts[i]) i += 1;
    prefix = prefix.slice(0, i);
    if (prefix.length === 0) break;
  }
  return prefix.length === 0 ? "." : prefix.join("/");
}

export function renderBrief(brief: Brief): string {
  const lines: string[] = [];
  const { project, counts, health } = brief;
  lines.push(
    `${project.name} - ${project.stacks.join(", ") || "no recognised stack"}, ${plural(project.packages, "package")}, ` +
      `${plural(counts.capabilities, "capability", "capabilities")} ` +
      `(${counts.declared} declared, ${counts.verified} verified, ${counts.derived} derived, ${counts.inferred} inferred)`
  );
  const state: string[] = [];
  if (counts.stale > 0) state.push(`${counts.stale} stale`);
  if (counts.unproven > 0) state.push(`${counts.unproven} without evidence`);
  lines.push(
    `health: ${health.error} error, ${health.warn} warning, ${health.info} info` +
      (state.length ? `; ${state.join(", ")}` : "")
  );
  lines.push("");

  lines.push("Commands");
  if (brief.commands.length === 0) lines.push("  none recorded");
  for (const c of brief.commands) {
    const proof = c.proven ? `proven${c.commit ? ` at ${c.commit.slice(0, 7)}` : ""}` : "not yet run here";
    lines.push(`  ${c.id.padEnd(10)} ${c.run}  - ${c.kind}; ${proof}`);
  }
  lines.push("");

  lines.push("Rules that fail the build");
  if (brief.rules.length === 0) lines.push("  none at error severity");
  for (const r of brief.rules) {
    const check = r.checked === "none" ? "not machine-checked" : `machine-checked, ${r.checked}`;
    lines.push(`  - ${r.rule} (${check})`);
  }
  if (brief.rulesOmitted > 0) lines.push(`  ...and ${brief.rulesOmitted} more; surface inspect lists them`);
  lines.push("");

  if (brief.care.length > 0) {
    lines.push("Paths that need approval");
    for (const c of brief.care) lines.push(`  ${c.paths.join(", ")}  - ${c.type}`);
    lines.push("");
  }

  lines.push("Where things live");
  if (brief.areas.length === 0) lines.push("  no capabilities; see surface doctor");
  for (const a of brief.areas) {
    const more = a.count > a.sample.length ? `, +${a.count - a.sample.length}` : "";
    lines.push(`  ${a.prefix.padEnd(12)} ${String(a.count).padStart(3)}  ${a.dir}  (${a.sample.join(", ")}${more})`);
  }
  if (brief.areasOmitted > 0) lines.push(`  ...and ${brief.areasOmitted} more areas; surface map lists every capability`);
  lines.push("");

  lines.push("Next");
  for (const n of brief.next) lines.push(`  ${n}`);
  return lines.join("\n");
}

function plural(n: number, one: string, many: string = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}
