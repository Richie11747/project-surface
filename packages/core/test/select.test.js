import { test } from "node:test";
import assert from "node:assert/strict";
import { commandsForStale, commandsProving, packageTestCommands } from "../dist/index.js";

/**
 * The claim-to-command rule that `surface verify --stale`, `--capability` and
 * the MCP verify tool all share: evidence names the command; a claim whose
 * evidence names none falls back to its package test command, and says so.
 */

const prov = { tier: "derived", sources: [{ path: "x" }], adapter: "t", observedAt: "2026-01-01T00:00:00Z" };
const cmd = (id, kind, packageId) => ({ id, run: `npm run ${id}`, cwd: ".", kind, ...(packageId ? { packageId } : {}), provenance: prov, confidence: 0.7 });
const cap = (id, evidence, extra = {}) => ({
  id, title: id, owners: [{ path: `src/${id}.ts` }], contracts: [], evidence, environment: [], tags: [],
  provenance: prov, confidence: 0.7, ...extra,
});

function surface() {
  return {
    commands: [cmd("test", "test"), cmd("test:api", "test", "api"), cmd("build", "build"), cmd("lint", "lint")],
    evidence: [
      { id: "ev:a", kind: "test", status: "unknown", path: "tests/a.test.ts", commandId: "test", provenance: prov, confidence: 0.7 },
      { id: "ev:b", kind: "test", status: "unknown", path: "tests/b.test.ts", commandId: "test:api", provenance: prov, confidence: 0.7 },
      { id: "ev:static", kind: "test", status: "unknown", path: "tests/c.test.ts", provenance: prov, confidence: 0.7 },
    ],
    capabilities: [
      cap("a", [{ id: "ev:a", link: "import-graph" }], { freshness: { status: "stale" } }),
      cap("b", [{ id: "ev:b", link: "import-graph" }], { packageId: "api", freshness: { status: "fresh" } }),
      cap("c", [{ id: "ev:static", link: "path-proximity" }], { packageId: "api", freshness: { status: "stale" } }),
      cap("d", [], { freshness: { status: "unknown" } }),
    ],
  };
}

test("a capability is proved by the commands its evidence was recorded from", () => {
  const s = surface();
  const chosen = commandsProving(s, [s.capabilities[0], s.capabilities[1]]);
  assert.deepEqual(chosen.commands.map((c) => c.id), ["test", "test:api"]);
  assert.deepEqual(chosen.capabilities, [
    { id: "a", commandIds: ["test"], fallback: false },
    { id: "b", commandIds: ["test:api"], fallback: false },
  ]);
});

test("evidence bound to no command falls back to the package test command, and the fallback is reported", () => {
  const s = surface();
  const chosen = commandsProving(s, [s.capabilities[2], s.capabilities[3]]);
  /* c lives in package api: that package's test command, and the root one,
     which runs everything. d names no package: every test command qualifies.
     Nothing but a test command ever does. */
  assert.deepEqual(chosen.capabilities, [
    { id: "c", commandIds: ["test", "test:api"], fallback: true },
    { id: "d", commandIds: ["test", "test:api"], fallback: true },
  ]);
  assert.deepEqual(chosen.commands.map((c) => c.id), ["test", "test:api"]);
  assert.deepEqual(packageTestCommands(s, { packageId: "api" }).map((c) => c.id), ["test", "test:api"]);
  assert.deepEqual(packageTestCommands(s, {}).map((c) => c.id), ["test", "test:api"]);
  assert.deepEqual(packageTestCommands(s, { packageId: "web" }).map((c) => c.id), ["test"]);
});

test("the stale selection names only stale claims, deduplicates commands, and orders everything by id", () => {
  const s = surface();
  const chosen = commandsForStale(s);
  assert.deepEqual(chosen.capabilities.map((c) => c.id), ["a", "c"]);
  assert.deepEqual(chosen.commands.map((c) => c.id), ["test", "test:api"]);

  s.capabilities.forEach((c) => (c.freshness = { status: "fresh" }));
  const none = commandsForStale(s);
  assert.deepEqual(none.commands, []);
  assert.deepEqual(none.capabilities, []);
});
