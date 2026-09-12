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

export function computeConfidence(input: ConfidenceInput): number {
  const tier = effectiveTier(input.tier, input.freshness);
  const floor = TIER_FLOOR[tier];
  const ceiling = TIER_CEILING[tier];

  const corroboration = Math.max(0, input.sourceCount - 1) * CORROBORATION_BONUS;
  let score = Math.min(ceiling, floor + corroboration);

  if (input.freshness === "stale" && input.tier !== "declared") {
    score *= STALE_PENALTY;
  }

  return round2(clamp01(score));
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
