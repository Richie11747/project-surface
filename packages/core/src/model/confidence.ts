/**
 * The confidence model.
 *
 * Confidence is *computed*, never authored. An adapter cannot decide that it is
 * 95% sure of something - it reports how it learned the fact, and this module
 * turns that into a number. That separation is what makes the score meaningful.
 *
 * The rules, in plain language:
 *
 *  1. Each provenance tier has a floor and a ceiling. A guess can never score
 *     as high as an observation.
 *  2. Independent corroborating sources raise the score within the tier band.
 *     Two files agreeing is better evidence than one.
 *  3. A stale `verified` claim is *demoted to `derived`*. Execution proves what
 *     the code did at a point in time; once the owner files change, that proof
 *     no longer describes the current code.
 *  4. `declared` never decays. A human owns the statement, so a stale
 *     declaration is reported as a health finding rather than quietly discounted.
 */

import type { ProvenanceTier, FreshnessStatus } from "../schema/types.js";

export const TIER_FLOOR: Readonly<Record<ProvenanceTier, number>> = Object.freeze({
  declared: 1.0,
  verified: 0.95,
  derived: 0.7,
  inferred: 0.4,
});

export const TIER_CEILING: Readonly<Record<ProvenanceTier, number>> = Object.freeze({
  declared: 1.0,
  verified: 0.99,
  derived: 0.9,
  inferred: 0.65,
});

/** Added per corroborating source beyond the first. */
export const CORROBORATION_BONUS = 0.05;

/** Multiplier applied to a stale claim, after any tier demotion. */
export const STALE_PENALTY = 0.8;

export interface ConfidenceInput {
  tier: ProvenanceTier;
  /** Number of *distinct* source paths backing the claim. */
  sourceCount: number;
  freshness?: FreshnessStatus;
}

/**
 * Passing evidence raises a claim by exactly one tier - it does not turn a
 * guess into a certainty.
 *
 * A passing test proves the code behaves; it does not prove that the thing we
 * guessed was a capability really is one. So an `inferred` capability with a
 * green test becomes `derived`, not `verified`. Only a claim that was already
 * read from real structure earns `verified` from an observed run.
 *
 * `declared` is left alone: a human already asserted it, and no test result
 * outranks that.
 */
export function promoteWithEvidence(tier: ProvenanceTier): ProvenanceTier {
  if (tier === "declared") return "declared";
  if (tier === "inferred") return "derived";
  return "verified";
}

/**
 * A stale `verified` claim is no longer verified. Everything else keeps its
 * tier; `declared` is explicitly immune.
 */
export function effectiveTier(tier: ProvenanceTier, freshness?: FreshnessStatus): ProvenanceTier {
  if (freshness === "stale" && tier === "verified") return "derived";
  return tier;
}

/** One line of the derivation. `value` is the running score after the step. */
export interface ConfidenceStep {
  rule: string;
  detail: string;
  value: number;
}

/**
 * The full derivation of a score. Everything `computeConfidence` does is
 * recorded here so that a number in the document can be read back as an
 * argument rather than taken on faith.
 */
export interface ConfidenceTrace {
  input: ConfidenceInput;
  effectiveTier: ProvenanceTier;
  floor: number;
  ceiling: number;
  corroboration: number;
  stalePenaltyApplied: boolean;
  steps: ConfidenceStep[];
  score: number;
}

export function explainConfidence(input: ConfidenceInput): ConfidenceTrace {
  const steps: ConfidenceStep[] = [];
  const tier = effectiveTier(input.tier, input.freshness);
  const floor = TIER_FLOOR[tier];
  const ceiling = TIER_CEILING[tier];

  if (tier !== input.tier) {
    steps.push({
      rule: "stale-demotion",
      detail: `A stale ${input.tier} claim is treated as ${tier}: the run proved an older version of the owner files.`,
      value: floor,
    });
  }
  steps.push({
    rule: "tier-floor",
    detail: `${tier} starts at ${floor.toFixed(2)} and cannot exceed ${ceiling.toFixed(2)}.`,
    value: floor,
  });

  const extra = Math.max(0, input.sourceCount - 1);
  const corroboration = extra * CORROBORATION_BONUS;
  let score = floor + corroboration;
  if (extra > 0) {
    steps.push({
      rule: "corroboration",
      detail: `${input.sourceCount} distinct source files agree: +${CORROBORATION_BONUS.toFixed(2)} for each of the ${extra} beyond the first.`,
      value: round2(score),
    });
  } else {
    steps.push({ rule: "corroboration", detail: "One source file; no corroboration bonus.", value: round2(score) });
  }
  if (score > ceiling) {
    score = ceiling;
    steps.push({ rule: "tier-ceiling", detail: `Capped at the ${tier} ceiling of ${ceiling.toFixed(2)}.`, value: score });
  }

  const stalePenaltyApplied = input.freshness === "stale" && input.tier !== "declared";
  if (stalePenaltyApplied) {
    score *= STALE_PENALTY;
    steps.push({
      rule: "stale-penalty",
      detail: `Owner files changed since verification: multiplied by ${STALE_PENALTY}.`,
      value: round2(clamp01(score)),
    });
  } else if (input.freshness === "stale") {
    steps.push({
      rule: "declared-immune",
      detail: "A declaration never decays; staleness is reported as a health finding instead.",
      value: round2(clamp01(score)),
    });
  }

  const final = round2(clamp01(score));
  return { input, effectiveTier: tier, floor, ceiling, corroboration, stalePenaltyApplied, steps, score: final };
}

export function computeConfidence(input: ConfidenceInput): number {
  return explainConfidence(input).score;
}

export type ConfidenceLabel = "high" | "medium" | "low";

/** Bucketing used by human-facing output. Machines should read the number. */
export function confidenceLabel(score: number): ConfidenceLabel {
  if (score >= 0.85) return "high";
  if (score >= 0.6) return "medium";
  return "low";
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
