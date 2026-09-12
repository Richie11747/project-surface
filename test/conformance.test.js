// @ts-check
/**
 * Every built-in adapter must pass the same conformance suite that is asked of
 * third-party adapters. First-party code gets no exemption from honesty.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { runConformance } from "@project-surface/adapter-sdk";
import { typescriptAdapter } from "@project-surface/adapter-typescript";
import { pythonAdapter } from "@project-surface/adapter-python";
import { goAdapter } from "@project-surface/adapter-go";
import { FIXTURES_DIR } from "../scripts/fixture-snapshot.mjs";

const CASES = [
  [typescriptAdapter, "ts-api"],
  [pythonAdapter, "py-api"],
  [goAdapter, "go-svc"],
];

for (const [adapter, fixture] of CASES) {
  test(`${adapter.id} adapter passes conformance on fixtures/${fixture}`, async () => {
    const result = await runConformance(adapter, join(FIXTURES_DIR, fixture));
    assert.ok(result.passed, `failed checks:\n  - ${result.failures.join("\n  - ")}`);
    assert.ok(result.checks.length >= 10, `only ${result.checks.length} checks ran`);
  });
}

test("an adapter that does not recognise a project fails detection, not extraction", async () => {
  const result = await runConformance(goAdapter, join(FIXTURES_DIR, "ts-api"));
  assert.equal(result.passed, false);
  assert.ok(
    result.failures.some((f) => f.startsWith("detect() matched the fixture")),
    result.failures.join("; ")
  );
});
