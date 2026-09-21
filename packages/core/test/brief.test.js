import { test } from "node:test";
import assert from "node:assert/strict";
import { buildBrief, renderBrief } from "../dist/index.js";

/*
 * The brief is a projection, not a new claim: proven commands first, only
 * error-severity rules, only approval-required paths, and areas grouped by the
 * first segment of the capability id with the directory their owners share.
 */

const prov = (tier) => ({ tier, sources: [{ path: "x" }], adapter: "t", observedAt: "2026-01-01T00:00:00Z" });
const cap = (id, owners, extra = {}) => ({
  id, title: id, owners: owners.map((path) => ({ path })), contracts: [], evidence: [{ id: "ev", link: "declared" }],
  environment: [], tags: [], provenance: prov("declared"), confidence: 1, ...extra,
});
const cmd = (id, kind, verification) => ({
  id, run: `npm run ${id}`, cwd: ".", kind, provenance: prov("derived"), confidence: 0.7, ...(verification ? { verification } : {}),
});

function surface() {
  return {
    project: { name: "demo", root: ".", stacks: [{ id: "typescript", adapter: "t", adapterVersion: "1", toolchainAvailable: true }], packages: [{ id: "root", path: "." }] },
    commands: [
      cmd("dev", "dev"),
      cmd("test", "test", { status: "passed", observedAt: "2026-01-01T00:00:00Z", commit: "abcdef1234567" }),
      cmd("build", "build"),
      cmd("typecheck", "typecheck", { status: "failed", observedAt: "2026-01-01T00:00:00Z" }),
      cmd("other", "other"),
    ],
    capabilities: [
      cap("checkout.create", ["src/checkout/create.ts"]),
      cap("checkout.get", ["src/checkout/get.ts"]),
      cap("checkout.complete", ["src/checkout/complete.ts"], { evidence: [], provenance: prov("inferred"), confidence: 0.5 }),
      cap("auth.verify", ["src/auth/verify.ts"], { freshness: { status: "stale" } }),
      cap("server", ["src/server.ts", "bin/start.js"]),
    ],
    constraints: [
      { id: "c:a", rule: "No provider in handlers.", severity: "error", status: "active", provenance: prov("declared"), confidence: 1, check: { kind: "forbid-import" }, checked: { status: "passed", violations: 0 } },
      { id: "c:b", rule: "Handlers need tests.", severity: "warn", status: "active", provenance: prov("declared"), confidence: 1 },
      { id: "c:c", rule: "Old rule.", severity: "error", status: "stale", provenance: prov("declared"), confidence: 1 },
      { id: "c:d", rule: "Names only.", severity: "error", status: "active", provenance: prov("declared"), confidence: 1 },
    ],
    environment: [],
    risks: [
      { id: "r:a", type: "migration", paths: ["db/migrations"], approval: "required", reason: "x", provenance: prov("declared"), confidence: 1 },
      { id: "r:b", type: "infra", paths: [".github"], approval: "advisory", reason: "y", provenance: prov("declared"), confidence: 1 },
    ],
    evidence: [],
    health: [
      { code: "STALE_CLAIM", severity: "warn", message: "m" },
      { code: "UNPROVEN_CAPABILITY", severity: "info", message: "m" },
    ],
    git: { available: false },
  };
}

test("commands: orienting kinds only, proven first, then by kind", () => {
  const brief = buildBrief(surface());
  assert.deepEqual(brief.commands.map((c) => [c.id, c.proven]), [
    ["test", true],
    ["typecheck", false],
    ["build", false],
    ["dev", false],
  ]);
  assert.equal(brief.commands[0].commit, "abcdef1234567");
});

test("rules are the active error-severity ones; care is the approval-required risks; counts are honest", () => {
  const brief = buildBrief(surface());
  assert.deepEqual(brief.rules.map((r) => [r.rule, r.checked]), [
    ["No provider in handlers.", "passing"],
    ["Names only.", "none"],
  ]);
  assert.equal(brief.rulesOmitted, 0);
  assert.deepEqual(brief.care.map((c) => c.paths), [["db/migrations"]]);
  assert.deepEqual(brief.counts, { capabilities: 5, declared: 4, verified: 0, derived: 0, inferred: 1, stale: 1, unproven: 1 });
  assert.deepEqual(brief.health, { error: 0, warn: 1, info: 1 });
});

test("areas group by id prefix, largest first, with the directory their owners share", () => {
  const brief = buildBrief(surface());
  assert.deepEqual(brief.areas.map((a) => [a.prefix, a.count, a.dir]), [
    ["checkout", 3, "src/checkout"],
    ["auth", 1, "src/auth"],
    ["server", 1, "."],
  ]);
  /* Highest confidence first within an area, so the sample is the best-known members. */
  assert.deepEqual(brief.areas[0].sample, ["checkout.create", "checkout.get", "checkout.complete"]);
});

test("the rendering is deterministic, names every section, and carries no timestamp", () => {
  const a = renderBrief(buildBrief(surface()));
  const b = renderBrief(buildBrief(surface()));
  assert.equal(a, b);
  for (const heading of ["Commands", "Rules that fail the build", "Paths that need approval", "Where things live", "Next"]) {
    assert.ok(a.includes(heading), heading);
  }
  assert.match(a, /proven at abcdef1/);
  assert.match(a, /1 stale, 1 without evidence/);
  assert.doesNotMatch(a, /2026-01-01/);
});
