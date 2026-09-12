import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeConfidence,
  confidenceLabel,
  effectiveTier,
  promoteWithEvidence,
  TIER_CEILING,
  TIER_FLOOR,
} from "../dist/index.js";

test("each tier sits at its floor with a single source", () => {
  assert.equal(computeConfidence({ tier: "declared", sourceCount: 1 }), TIER_FLOOR.declared);
  assert.equal(computeConfidence({ tier: "verified", sourceCount: 1 }), TIER_FLOOR.verified);
  assert.equal(computeConfidence({ tier: "derived", sourceCount: 1 }), TIER_FLOOR.derived);
  assert.equal(computeConfidence({ tier: "inferred", sourceCount: 1 }), TIER_FLOOR.inferred);
});

test("a guess never outranks an observation, however corroborated", () => {
  const inferred = computeConfidence({ tier: "inferred", sourceCount: 50 });
  const derived = computeConfidence({ tier: "derived", sourceCount: 1 });
  assert.ok(inferred <= TIER_CEILING.inferred);
  assert.ok(inferred < derived, `${inferred} should be below ${derived}`);
});

test("corroborating sources raise confidence within the tier band", () => {
  const one = computeConfidence({ tier: "derived", sourceCount: 1 });
  const three = computeConfidence({ tier: "derived", sourceCount: 3 });
  assert.ok(three > one);
  assert.ok(three <= TIER_CEILING.derived);
});

test("a stale verified claim is demoted, because the proof no longer describes the code", () => {
  const fresh = computeConfidence({ tier: "verified", sourceCount: 1, freshness: "fresh" });
  const stale = computeConfidence({ tier: "verified", sourceCount: 1, freshness: "stale" });
  assert.equal(effectiveTier("verified", "stale"), "derived");
  assert.ok(stale < fresh);
  assert.ok(stale < TIER_FLOOR.verified);
});

test("a declaration never decays: a human owns the statement", () => {
  assert.equal(computeConfidence({ tier: "declared", sourceCount: 1, freshness: "stale" }), 1);
  assert.equal(effectiveTier("declared", "stale"), "declared");
});

test("evidence promotes by exactly one tier", () => {
  assert.equal(promoteWithEvidence("inferred"), "derived");
  assert.equal(promoteWithEvidence("derived"), "verified");
  assert.equal(promoteWithEvidence("verified"), "verified");
  assert.equal(promoteWithEvidence("declared"), "declared");
});

test("confidence stays inside the unit interval", () => {
  for (const tier of ["declared", "verified", "derived", "inferred"]) {
    for (const sourceCount of [0, 1, 5, 100]) {
      const score = computeConfidence({ tier, sourceCount });
      assert.ok(score >= 0 && score <= 1, `${tier}/${sourceCount} produced ${score}`);
    }
  }
});

test("labels track the numeric bands", () => {
  assert.equal(confidenceLabel(0.95), "high");
  assert.equal(confidenceLabel(0.7), "medium");
  assert.equal(confidenceLabel(0.4), "low");
});
