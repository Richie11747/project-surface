/**
 * `surface why` - the derivation behind a number.
 *
 * A confidence score that cannot be explained is an opinion with decimals.
 * This module reads a claim back out of the document and reconstructs, step by
 * step, how its score came to be: which files it was read from, which tests
 * were run against it and what they said, whether that earned a promotion,
 * whether the owner files have moved since, and the arithmetic in between.
 *
 * The reconstruction uses only what is in the document, so it can be run by
 * any consumer - and if it disagrees with the recorded score, it says so
 * instead of trusting either side.
 */

import { distinctSources } from "../build/assemble.js";
import { strongerTier } from "../build/merge.js";
import { explainConfidence, promoteWithEvidence, type ConfidenceTrace } from "../model/confidence.js";
import { indexById } from "../model/ids.js";
import type {
  Capability,
  Command,
  Constraint,
  EnvironmentVariable,
  EvidenceEntry,
  Freshness,
  ProvenanceTier,
  Risk,
  SourceRef,
  Surface,
} from "../schema/types.js";

export type ExplainedKind = "capability" | "command" | "constraint" | "risk" | "environment";

export interface ExplainedEvidence {
  id: string;
  path?: string;
  status: EvidenceEntry["status"];
  link?: string;
  commandId?: string;
  observedAt?: string;
}

export interface ClaimExplanation {
  id: string;
  kind: ExplainedKind;
  title: string;
  provenance: {
    tier: ProvenanceTier;
    adapter: string;
    observedAt: string;
    sources: SourceRef[];
    distinctSources: number;
  };
  /** Absorbed or renamed ids that resolve to this claim. */
  aliases: string[];
  evidence: ExplainedEvidence[];
  /** Why the tier used for scoring differs from the recorded provenance tier, if it does. */
  promotion: { from: ProvenanceTier; to: ProvenanceTier; reason: string } | null;
  freshness: Freshness | null;
  trace: ConfidenceTrace;
  /** The score stored in the document. */
  recorded: number;
  /** Whether re-deriving the score from the document reproduces the recorded value. */
  consistent: boolean;
}

function findCapability(surface: Surface, id: string): Capability | undefined {
  return (
    surface.capabilities.find((c) => c.id === id) ??
    surface.capabilities.find((c) => c.aliases?.includes(id)) ??
    surface.capabilities.find((c) => c.id.endsWith(`.${id}`))
  );
}

function explainCapability(surface: Surface, c: Capability): ClaimExplanation {
  const byId = indexById(surface.evidence);
  const evidence: ExplainedEvidence[] = c.evidence.map((ref) => {
    const entry = byId.get(ref.id);
    return {
      id: ref.id,
      link: ref.link,
      status: entry?.status ?? "unknown",
      ...(entry?.path ? { path: entry.path } : {}),
      ...(entry?.commandId ? { commandId: entry.commandId } : {}),
      ...(entry?.observedAt ? { observedAt: entry.observedAt } : {}),
    };
  });

  const proven = evidence.some((e) => e.status === "passed");
  const stale = c.freshness?.status === "stale";
  const promoted = proven && !stale ? promoteWithEvidence(c.provenance.tier) : c.provenance.tier;

  let promotion: ClaimExplanation["promotion"] = null;
  if (proven && !stale && promoted !== c.provenance.tier) {
    promotion = {
      from: c.provenance.tier,
      to: promoted,
      reason: "Linked evidence passed; passing evidence raises a claim by exactly one tier.",
    };
  } else if (proven && stale) {
    promotion = {
      from: c.provenance.tier,
      to: c.provenance.tier,
      reason: "Linked evidence passed, but the owner files changed since; the promotion is withheld until re-verified.",
    };
  } else if (proven && c.provenance.tier === "declared") {
    promotion = { from: "declared", to: "declared", reason: "Declared claims are already at the top; evidence corroborates but does not promote." };
  }

  const trace = explainConfidence({
    tier: promoted,
    sourceCount: distinctSources(c.provenance.sources),
    ...(c.freshness ? { freshness: c.freshness.status } : {}),
  });

  return {
    id: c.id,
    kind: "capability",
    title: c.title,
    provenance: {
      tier: c.provenance.tier,
      adapter: c.provenance.adapter,
      observedAt: c.provenance.observedAt,
      sources: c.provenance.sources,
      distinctSources: distinctSources(c.provenance.sources),
    },
    aliases: c.aliases ?? [],
    evidence,
    promotion,
    freshness: c.freshness ?? null,
    trace,
    recorded: c.confidence,
    consistent: trace.score === c.confidence,
  };
}

function explainCommand(cmd: Command): ClaimExplanation {
  const passed = cmd.verification?.status === "passed";
  const tier: ProvenanceTier = passed ? strongerTier(cmd.provenance.tier, "verified") : cmd.provenance.tier;
  const trace = explainConfidence({
    tier,
    sourceCount: distinctSources(cmd.provenance.sources),
    ...(cmd.freshness ? { freshness: cmd.freshness.status } : {}),
  });
  return {
    id: cmd.id,
    kind: "command",
    title: cmd.run,
    provenance: {
      tier: cmd.provenance.tier,
      adapter: cmd.provenance.adapter,
      observedAt: cmd.provenance.observedAt,
      sources: cmd.provenance.sources,
      distinctSources: distinctSources(cmd.provenance.sources),
    },
    aliases: [],
    evidence: cmd.verification
      ? [
          {
            id: `verification:${cmd.id}`,
            status: cmd.verification.status === "passed" ? "passed" : cmd.verification.status === "failed" ? "failed" : "unknown",
            commandId: cmd.id,
            ...(cmd.verification.observedAt ? { observedAt: cmd.verification.observedAt } : {}),
          },
        ]
      : [],
    promotion: passed && tier !== cmd.provenance.tier
      ? { from: cmd.provenance.tier, to: "verified", reason: "The command was executed and exited successfully." }
      : null,
    freshness: cmd.freshness ?? null,
    trace,
    recorded: cmd.confidence,
    consistent: trace.score === cmd.confidence,
  };
}

function explainScored(
  kind: ExplainedKind,
  item: (Constraint | Risk | EnvironmentVariable) & { title?: string }
): ClaimExplanation {
  const id = "id" in item ? item.id : item.name;
  const title =
    "rule" in item ? item.rule : "reason" in item ? item.reason : "name" in item ? item.name : id;
  const trace = explainConfidence({
    tier: item.provenance.tier,
    sourceCount: distinctSources(item.provenance.sources),
  });
  return {
    id,
    kind,
    title,
    provenance: {
      tier: item.provenance.tier,
      adapter: item.provenance.adapter,
      observedAt: item.provenance.observedAt,
      sources: item.provenance.sources,
      distinctSources: distinctSources(item.provenance.sources),
    },
    aliases: [],
    evidence: [],
    promotion: null,
    freshness: null,
    trace,
    recorded: item.confidence,
    consistent: trace.score === item.confidence,
  };
}

/**
 * Explain any claim by id. Capabilities are looked up first (by id, alias, or
 * trailing segment), then commands, constraints, risks and environment names.
 */
export function explainClaim(surface: Surface, id: string): ClaimExplanation | null {
  const capability = findCapability(surface, id);
  if (capability) return explainCapability(surface, capability);

  const command = surface.commands.find((c) => c.id === id);
  if (command) return explainCommand(command);

  const constraint = surface.constraints.find((c) => c.id === id);
  if (constraint) return explainScored("constraint", constraint);

  const risk = surface.risks.find((r) => r.id === id);
  if (risk) return explainScored("risk", risk);

  const env = surface.environment.find((e) => e.name === id);
  if (env) return explainScored("environment", env);

  return null;
}
