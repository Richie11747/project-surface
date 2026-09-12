// @ts-check
/**
 * The examples shipped with the spec must validate against the spec. A spec
 * whose own examples are wrong would be a poor start for third-party authors.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateSurface } from "@project-surface/core";

const EXAMPLES = fileURLToPath(new URL("../spec/v1/examples/", import.meta.url));
const files = readdirSync(EXAMPLES).filter((f) => f.endsWith(".json")).sort();

test("the spec ships at least a minimal and a full example", () => {
  assert.ok(files.includes("minimal.surface.json"), files.join(", "));
  assert.ok(files.includes("full.surface.json"), files.join(", "));
});

for (const file of files) {
  test(`spec/v1/examples/${file} validates`, () => {
    const doc = JSON.parse(readFileSync(join(EXAMPLES, file), "utf8"));
    const result = validateSurface(doc);
    assert.ok(result.valid, result.errors.join("\n"));
  });
}

test("a document with an unknown schema version is rejected", () => {
  const doc = JSON.parse(readFileSync(join(EXAMPLES, "minimal.surface.json"), "utf8"));
  doc.schema = "project-surface/v0";
  assert.equal(validateSurface(doc).valid, false);
});

test("a claim without provenance is rejected", () => {
  const doc = JSON.parse(readFileSync(join(EXAMPLES, "full.surface.json"), "utf8"));
  delete doc.capabilities[0].provenance;
  assert.equal(validateSurface(doc).valid, false);
});
