/**
 * The proof gate.
 *
 * A pull request says "tests pass". That is a statement about a run, not
 * about the change: it does not say which behaviours the change touched, nor
 * whether the evidence for each of them was produced against the code under
 * review or against something older. The gate answers exactly that, per
 * capability, from the document alone:
 *
 *   proven    - passing evidence recorded at this commit, owner files unchanged since
 *   carried   - passing evidence from an earlier commit, but the owner files are
 *               byte-identical to what it ran against (fingerprint), so it still describes them
 *   stale     - there is a passing proof, but it does not describe this code
 *   unproven  - nothing has ever exercised this capability
 *   failing   - the last run of its evidence failed
 *
 * Everything here is recomputed from `.project/surface.json` and git, so a
 * receipt pasted into a pull request cannot say more than CI can reproduce.
 * Nothing is executed; `surface gate --verify` runs the missing proofs first
 * and then calls this.
 */

import { indexById } from "../model/ids.js";
import type { Capability, Command, Constraint, EvidenceEntry, Risk, Surface, VerificationRecord } from "../schema/types.js";
import { SURFACE_FILE } from "../version.js";
import { analyzeImpact, type ImpactRelation } from "./impact.js";

export type GateVerdict = "proven" | "carried" | "stale" | "unproven" | "failing";

export interface GateProof {
  evidenceId: string;
  path?: string;
  status: EvidenceEntry["status"];
  commandId?: string;
  commit?: string;
  dirty?: boolean;
  observedAt?: string;
}

export interface GatedCapability {
  id: string;
  title: string;
  relation: ImpactRelation;
  matchedPaths: string[];
  verdict: GateVerdict;
  /** One line per fact the verdict rests on, in the order they were checked. */
  reasons: string[];
  proofs: GateProof[];
  contracts: string[];
  /** An owner file changed and none of the capability's contract documents did. */
  contractUntouched: boolean;
}

export interface GateOptions {
  /** HEAD as the gate sees it; absent outside a git repository. */
  head?: string;
  /** Whether the working tree has uncommitted changes right now. */
  dirty?: boolean;
  /** Require `proven` (evidence at this very commit); `carried` no longer passes. Warn-level violations and approval-required risks block too. */
  strict?: boolean;
}

export interface GateReport {
  base: string;
  head?: string;
  dirty: boolean;
  strict: boolean;
  changedPaths: string[];
  capabilities: GatedCapability[];
  /** Capabilities that merely share a package with a changed file - context, never gated. */
  nearby: string[];
  /** Touched capabilities that are heuristic guesses. A guess is reported, never gated: nobody should be blocked on it. */
  inferred: string[];
  constraints: { violated: Constraint[]; unchecked: Constraint[] };
  /** Risks whose paths the change touches. */
  risks: Risk[];
  counts: Record<GateVerdict, number>;
  /** What the change must still do before it can pass, empty when it passes. */
  blocking: string[];
  /** Worth a look, never blocking on its own. */
  notes: string[];
  pass: boolean;
}

const VERDICT_ORDER: Record<GateVerdict, number> = { failing: 0, unproven: 1, stale: 2, carried: 3, proven: 4 };

function short(commit: string | undefined): string {
  return commit ? commit.slice(0, 7) : "";
}

/**
 * Judge one capability. The order of checks is the order of the reasons: the
 * last line is the one that decided, and the one a reviewer needs.
 */
function judge(
  capability: Capability,
  proofs: GateProof[],
  commandById: Map<string, Command>,
  options: GateOptions
): { verdict: GateVerdict; reasons: string[] } {
  const reasons: string[] = [];
  const runnable = proofs.filter((p) => p.commandId !== undefined);

  if (proofs.length === 0) {
    reasons.push("No evidence is linked to this capability: nothing has ever exercised it.");
    return { verdict: "unproven", reasons };
  }
  if (runnable.length === 0) {
    reasons.push("Its evidence is not bound to any command, so nothing can run it.");
    return { verdict: "unproven", reasons };
  }
  if (proofs.some((p) => p.status === "failed")) {
    const failed = proofs.filter((p) => p.status === "failed").map((p) => p.path ?? p.evidenceId);
    reasons.push(`Evidence failed on its last run: ${failed.join(", ")}.`);
    return { verdict: "failing", reasons };
  }
  const passed = proofs.filter((p) => p.status === "passed");
  if (passed.length === 0) {
    reasons.push("Its evidence has been found but never run (status unknown).");
    return { verdict: "unproven", reasons };
  }

  /* From here on there is a passing proof. The question is what it describes. */
  const records = passed
    .map((p) => (p.commandId ? commandById.get(p.commandId)?.verification : undefined))
    .filter((r): r is VerificationRecord => r !== undefined);
  const freshness = capability.freshness?.status ?? "unknown";

  if (freshness === "stale") {
    reasons.push(capability.freshness?.reason ?? "Owner files changed since the proof was recorded.");
    return { verdict: "stale", reasons };
  }

  if (options.head === undefined) {
    /* Not a repository: the fingerprint is the only anchor there is, and it says the owners are unchanged. */
    reasons.push("Passing evidence; not a git repository, so the proof is bound to owner file fingerprints rather than a commit.");
    return { verdict: freshness === "fresh" ? "proven" : "stale", reasons };
  }

  const atHead = records.filter((r) => r.commit === options.head);
  if (atHead.length > 0 && records.every((r) => r.commit === options.head)) {
    const dirtyRun = atHead.some((r) => r.dirty);
    if (dirtyRun && !options.dirty) {
      reasons.push(`Proof recorded at ${short(options.head)} on a dirty tree; the tree is clean now, so it may describe different code.`);
      return { verdict: "stale", reasons };
    }
    reasons.push(
      `Passing evidence recorded at ${short(options.head)}, this commit${dirtyRun ? " (on a dirty tree, owner files unchanged since)" : ""}.`
    );
    return { verdict: "proven", reasons };
  }

  const elsewhere = records.filter((r) => r.commit && r.commit !== options.head).map((r) => short(r.commit));
  const unanchored = records.filter((r) => !r.commit).length;
  if (elsewhere.length > 0) {
    reasons.push(`Passing evidence recorded at ${[...new Set(elsewhere)].join(", ")}, not at ${short(options.head)}.`);
  }
  if (unanchored > 0) {
    reasons.push(`${unanchored} passing record${unanchored === 1 ? "" : "s"} carr${unanchored === 1 ? "ies" : "y"} no commit (recorded by an older version).`);
  }
  if (freshness === "fresh") {
    reasons.push("Owner files are byte-identical to what that run saw, so the proof still describes them.");
    return { verdict: "carried", reasons };
  }
  reasons.push("Freshness is unknown, so nothing ties that run to these files.");
  return { verdict: "stale", reasons };
}

export function gateChange(surface: Surface, changedPaths: string[], base: string, options: GateOptions = {}): GateReport {
  const strict = options.strict === true;
  /* The document itself is regenerated by every scan; a change to it is not a change to the project. */
  const impact = analyzeImpact(surface, changedPaths.filter((p) => p !== SURFACE_FILE));
  const evidenceById = indexById(surface.evidence);
  const commandById = indexById(surface.commands);
  const changed = new Set(impact.changedPaths);

  const gated: GatedCapability[] = [];
  const nearby: string[] = [];
  const inferred: string[] = [];
  for (const impacted of impact.capabilities) {
    if (impacted.relation === "package") {
      nearby.push(impacted.capability.id);
      continue;
    }
    const c = impacted.capability;
    if (c.provenance.tier === "inferred") {
      inferred.push(c.id);
      continue;
    }
    const proofs: GateProof[] = c.evidence.map((ref) => {
      const entry = evidenceById.get(ref.id);
      const record = entry?.commandId ? commandById.get(entry.commandId)?.verification : undefined;
      return {
        evidenceId: ref.id,
        ...(entry?.path ? { path: entry.path } : {}),
        status: entry?.status ?? "unknown",
        ...(entry?.commandId ? { commandId: entry.commandId } : {}),
        ...(record?.commit ? { commit: record.commit } : {}),
        ...(record?.dirty !== undefined ? { dirty: record.dirty } : {}),
        ...(entry?.observedAt ? { observedAt: entry.observedAt } : {}),
      };
    });
    const { verdict, reasons } = judge(c, proofs, commandById, options);
    const contracts = c.contracts.map((x) => x.path);
    gated.push({
      id: c.id,
      title: c.title,
      relation: impacted.relation,
      matchedPaths: impacted.matchedPaths,
      verdict,
      reasons,
      proofs,
      contracts,
      contractUntouched: impacted.relation === "owner" && contracts.length > 0 && !contracts.some((p) => changed.has(p)),
    });
  }
  gated.sort((a, b) => VERDICT_ORDER[a.verdict] - VERDICT_ORDER[b.verdict] || a.id.localeCompare(b.id));

  const violated = surface.constraints.filter((k) => k.status === "active" && k.checked?.status === "violated");
  const unchecked = surface.constraints.filter((k) => k.status === "active" && k.checked?.status === "unchecked");

  const counts: Record<GateVerdict, number> = { proven: 0, carried: 0, stale: 0, unproven: 0, failing: 0 };
  for (const g of gated) counts[g.verdict] += 1;

  const blocking: string[] = [];
  const notes: string[] = [];
  const fails = (v: GateVerdict): boolean => (strict ? v !== "proven" : v !== "proven" && v !== "carried");
  for (const g of gated) {
    if (fails(g.verdict)) blocking.push(`${g.id} is ${g.verdict}: ${g.reasons[g.reasons.length - 1] ?? ""}`.trim());
  }
  /* One note per contract document, not per capability: a spec shared by five
     handlers is one thing to re-read, not five. */
  const untouched = new Map<string, string[]>();
  for (const g of gated) {
    if (!g.contractUntouched) continue;
    for (const path of g.contracts) {
      if (changed.has(path)) continue;
      untouched.set(path, [...(untouched.get(path) ?? []), g.id]);
    }
  }
  for (const [path, ids] of [...untouched.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    notes.push(
      `${path} did not change while ${ids.length === 1 ? "a capability" : `${ids.length} capabilities`} it specifies did (${ids.join(", ")}). Confirm the behaviour still matches the document.`
    );
  }
  for (const k of violated) {
    const line = `Constraint "${k.rule}" is violated in ${k.checked?.violations ?? 0} place(s).`;
    if (k.severity === "error" || strict) blocking.push(line);
    else notes.push(line);
  }
  for (const k of unchecked) notes.push(`Constraint "${k.rule}" could not be checked: ${k.checked?.reason ?? "no adapter supplied the facts it needs"}.`);
  for (const r of impact.risks) {
    const touched = r.paths.filter((p) => impact.changedPaths.some((c) => c === p || c.startsWith(`${p}/`)));
    const line = `${r.type} paths touched (${touched.join(", ")}): ${r.reason}`;
    if (r.approval === "required" && strict) blocking.push(`Approval required - ${line}`);
    else notes.push(`${r.approval === "required" ? "Approval required" : "Advisory"} - ${line}`);
  }
  if (inferred.length > 0) {
    notes.push(
      `${inferred.length} inferred capabilit${inferred.length === 1 ? "y was" : "ies were"} touched and not gated (${inferred.join(", ")}): a heuristic guess never blocks a change. Declare it to have it judged.`
    );
  }
  if (gated.length === 0 && inferred.length === 0) {
    notes.push("No capability is known to depend on these paths. The gate has nothing to judge; the change is outside the surface.");
  }

  return {
    base,
    ...(options.head ? { head: options.head } : {}),
    dirty: options.dirty === true,
    strict,
    changedPaths: impact.changedPaths,
    capabilities: gated,
    nearby,
    inferred,
    constraints: { violated, unchecked },
    risks: impact.risks,
    counts,
    blocking,
    notes,
    pass: blocking.length === 0,
  };
}

export const GATE_COMMENT_MARKER = "<!-- project-surface:gate -->";

const VERDICT_MARK: Record<GateVerdict, string> = {
  proven: "✅ proven",
  carried: "☑️ carried",
  stale: "⚠️ stale",
  unproven: "❌ unproven",
  failing: "❌ failing",
};

function cell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

/** The receipt as a pull-request comment. Deterministic for a given report. */
export function renderGateMarkdown(report: GateReport): string {
  const lines: string[] = [GATE_COMMENT_MARKER, "## Proof of change", ""];
  const at = report.head ? ` at \`${short(report.head)}\`` : "";
  const n = report.capabilities.length;
  lines.push(
    report.pass
      ? `**Passes.** ${n} capabilit${n === 1 ? "y" : "ies"} touched since \`${report.base}\`, each with passing evidence${at}${report.strict ? " (strict)" : ""}.`
      : `**Does not pass.** ${report.blocking.length} thing${report.blocking.length === 1 ? "" : "s"} to do before this change carries proof${at}.`
  );
  lines.push("");

  if (n > 0) {
    lines.push("| Capability | Touched via | Verdict | Why |", "|---|---|---|---|");
    for (const g of report.capabilities) {
      lines.push(`| \`${cell(g.id)}\` | ${g.relation} | ${VERDICT_MARK[g.verdict]} | ${cell(g.reasons[g.reasons.length - 1] ?? "")} |`);
    }
    lines.push("");
  }

  if (report.blocking.length > 0) {
    lines.push("**Blocking**", "");
    for (const b of report.blocking) lines.push(`- ${b}`);
    lines.push("");
  }
  if (report.notes.length > 0) {
    lines.push("**Worth a look**", "");
    for (const x of report.notes) lines.push(`- ${x}`);
    lines.push("");
  }
  lines.push(
    `<sub>Recomputed from \`.project/surface.json\` and git by \`surface gate --since ${cell(report.base)}\`; a proof counts only when the run that produced it is recorded against the commit under review, or its owner files are byte-identical to what that run saw.</sub>`
  );
  return `${lines.join("\n")}\n`;
}
