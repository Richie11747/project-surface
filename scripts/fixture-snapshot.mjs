/**
 * Shared by `scripts/update-fixtures.mjs` and `test/fixtures.test.js`, so the
 * golden files are produced and checked by exactly the same code path.
 *
 * A snapshot is a clean scan of a fixture: no previous document, a fixed clock,
 * and the fields that legitimately vary between machines normalised away.
 * Everything else must be byte-identical - that is the promise being tested.
 */

import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSurface, serializeSurface } from "@project-surface/core";
import { CONFORMANCE_NOW } from "@project-surface/adapter-sdk";
import { typescriptAdapter } from "@project-surface/adapter-typescript";
import { pythonAdapter } from "@project-surface/adapter-python";
import { goAdapter } from "@project-surface/adapter-go";

export const FIXTURES_DIR = fileURLToPath(new URL("../fixtures/", import.meta.url));
export const EXPECTED_FILE = "expected.surface.json";
export const ADAPTERS = [typescriptAdapter, pythonAdapter, goAdapter];

/** Placeholder for values that differ by design between environments. */
const NORMALISED = "<normalised>";

export function listFixtures() {
  return readdirSync(FIXTURES_DIR)
    .filter((name) => statSync(join(FIXTURES_DIR, name)).isDirectory())
    .sort();
}

/**
 * Fingerprints are git blob SHAs inside a repository and content hashes
 * outside one, so the same fixture legitimately produces two different values.
 * Git metadata describes the enclosing repository, not the fixture. Both are
 * replaced; everything else is compared verbatim.
 */
export function normaliseSurface(surface) {
  const copy = structuredClone(surface);
  copy.generatedAt = CONFORMANCE_NOW;
  copy.git = { available: false };
  for (const claim of [...(copy.capabilities ?? []), ...(copy.commands ?? [])]) {
    if (claim.freshness?.ownersFingerprint) claim.freshness.ownersFingerprint = NORMALISED;
  }
  /* Whether a language toolchain is on PATH is a fact about the machine, not
     the fixture: CI runners ship Go, a contributor's laptop may not. The
     adapter must report it honestly, and the snapshot must not depend on it. */
  for (const stack of copy.project?.stacks ?? []) {
    stack.toolchainAvailable = NORMALISED;
    stack.notes = (stack.notes ?? []).filter((n) => !/toolchain/i.test(n));
  }
  copy.health = (copy.health ?? []).filter((h) => h.code !== "TOOLCHAIN_UNAVAILABLE");
  return copy;
}

export async function buildFixtureSnapshot(name) {
  const root = join(FIXTURES_DIR, name);
  const { surface, warnings } = await buildSurface({
    root,
    adapters: ADAPTERS,
    previous: null,
    now: CONFORMANCE_NOW,
  });
  return { root, surface, warnings, text: serializeSurface(normaliseSurface(surface)) };
}
