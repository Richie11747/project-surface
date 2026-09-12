// @ts-check
/**
 * Golden snapshot suite.
 *
 * Every fixture is scanned from scratch and compared against the committed
 * `expected.surface.json`. A mismatch means extraction changed; regenerate with
 * `npm run fixtures:update` only after reviewing the diff.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { validateSurface } from "@project-surface/core";
import { EXPECTED_FILE, buildFixtureSnapshot, listFixtures } from "../scripts/fixture-snapshot.mjs";

const fixtures = listFixtures();

test("there are fixtures to test", () => {
  assert.ok(fixtures.length >= 3, fixtures.join(", "));
});

for (const name of fixtures) {
  test(`fixtures/${name} matches its golden snapshot`, async () => {
    const { root, surface, text, warnings } = await buildFixtureSnapshot(name);
    assert.deepEqual(warnings, [], `unexpected warnings: ${warnings.join("; ")}`);

    const result = validateSurface(surface);
    assert.ok(result.valid, result.errors.join("\n"));

    const expected = readFileSync(join(root, EXPECTED_FILE), "utf8");
    assert.equal(
      text,
      expected,
      `fixtures/${name}/${EXPECTED_FILE} is out of date. Review and run: npm run fixtures:update`
    );
  });

  test(`fixtures/${name} scans deterministically`, async () => {
    const first = await buildFixtureSnapshot(name);
    const second = await buildFixtureSnapshot(name);
    assert.equal(first.text, second.text);
  });

  test(`fixtures/${name} never reports statically discovered evidence as passed`, async () => {
    const { surface } = await buildFixtureSnapshot(name);
    const dishonest = surface.evidence.filter((e) => e.status === "passed");
    assert.deepEqual(dishonest, []);
  });
}
