import { test } from "node:test";
import assert from "node:assert/strict";
import {
  analyzeImpact,
  commandId,
  detectHealth,
  evaluateConstraintChecks,
  mergeEnvironment,
  riskId,
  slug,
} from "../dist/index.js";

/*
 * Health, impact, merge and id rules that a fixture snapshot cannot pin down
 * on its own: a dangling evidence link, a change named with backslashes, a
 * declared `required: false`, an identifier longer than the schema allows.
 */

const NOW = "2026-09-12T00:00:00Z";

function provenance(tier, path, adapter = "typescript") {
  return { tier, sources: [{ path }], adapter, observedAt: NOW };
}

function capability(id, owners, evidence = [], extra = {}) {
  return {
    id,
    title: id,
    kind: "export",
    owners: owners.map((path) => ({ path })),
    contracts: [],
    evidence: evidence.map((e) => ({ id: e, link: "declared" })),
    environment: [],
    tags: [],
    provenance: provenance("declared", ".project/surface.declare.yaml", "declarations"),
    confidence: 1,
    ...extra,
  };
}

function evidence(path) {
  return { id: `evidence:${slug(path)}`, kind: "test", path, status: "unknown", provenance: provenance("derived", path) };
}

test("health: an evidence link that resolves to nothing is reported, not counted as proof", () => {
  const real = evidence("tests/a.test.ts");
  const findings = detectHealth({
    capabilities: [
      capability("proven", ["src/a.ts"], [real.id]),
      capability("dangling", ["src/b.ts"], ["evidence:tests-typo.test.ts"]),
    ],
    commands: [],
    evidence: [real],
    environment: [],
    stacks: [],
    files: new Set(["src/a.ts", "src/b.ts", "tests/a.test.ts"]),
    declarationErrors: [],
    fileScanTruncated: false,
  });
  const dangling = findings.filter((f) => f.code === "DANGLING_EVIDENCE");
  assert.equal(dangling.length, 1);
  assert.equal(dangling[0].subject.id, "dangling");
  assert.match(dangling[0].message, /evidence:tests-typo\.test\.ts/);
  assert.ok(!findings.some((f) => f.code === "DANGLING_EVIDENCE" && f.subject.id === "proven"));
});

test("constraints: require-test is satisfied only by evidence that exists", () => {
  const real = evidence("tests/a.test.ts");
  const check = {
    id: "constraint:tested",
    rule: "tested",
    severity: "warn",
    status: "active",
    check: { kind: "require-test", paths: ["src/**"] },
    provenance: provenance("declared", ".project/surface.declare.yaml", "declarations"),
  };
  const capabilities = [
    capability("proven", ["src/a.ts"], [real.id]),
    capability("dangling", ["src/b.ts"], ["evidence:nope"]),
  ];
  const common = { constraints: [check], capabilities, files: new Set(["src/a.ts", "src/b.ts"]), imports: [], importsAvailable: true };

  const withEvidence = evaluateConstraintChecks({ ...common, evidence: [real] });
  assert.deepEqual(withEvidence.violations.map((v) => v.detail), ["capability dangling has no linked evidence"]);

  /* Callers that do not pass the evidence list keep the old, trusting behaviour. */
  const without = evaluateConstraintChecks(common);
  assert.deepEqual(without.violations, []);
});

test("merge: a maintainer's `required: false` overrides an adapter's assumption", () => {
  const adapter = {
    name: "PORT",
    required: true,
    secret: false,
    usedBy: [{ path: "src/server.ts" }],
    provenance: provenance("derived", "src/server.ts"),
  };
  const declared = {
    name: "PORT",
    required: false,
    secret: false,
    usedBy: [],
    provenance: provenance("declared", ".project/surface.declare.yaml", "declarations"),
  };
  assert.equal(mergeEnvironment([adapter, declared])[0].required, false);
  assert.equal(mergeEnvironment([declared, adapter])[0].required, false);
  /* `secret` stays sticky: either side saying so is enough. */
  assert.equal(mergeEnvironment([{ ...adapter, secret: true }, declared])[0].secret, true);
});

test("impact: changed paths are normalised and matched directory-wise in both directions", () => {
  const surface = {
    schema: "project-surface/v1",
    project: { name: "x", stacks: [], packages: [{ id: "root", path: "." }] },
    capabilities: [
      capability("owned", ["src/checkout/create.ts"], [], { contracts: [{ path: "docs/contracts/checkout.md" }] }),
      capability("documented", ["src/other.ts"], [], { contracts: [{ path: "docs/cli.md" }] }),
    ],
    commands: [],
    constraints: [],
    environment: [],
    risks: [{ id: riskId("migration", "db/migrations"), type: "migration", paths: ["db/migrations"], approval: "required", reason: "r", provenance: provenance("derived", "db/migrations"), confidence: 0.7 }],
    evidence: [],
    health: [],
  };
  const windows = analyzeImpact(surface, ["src\\checkout\\create.ts"]);
  assert.deepEqual(windows.changedPaths, ["src/checkout/create.ts"]);
  assert.deepEqual(windows.capabilities.map((c) => c.capability.id), ["owned"]);

  const dir = analyzeImpact(surface, ["./docs/"]);
  assert.deepEqual(dir.capabilities.map((c) => [c.capability.id, c.relation]).sort(), [["documented", "contract"], ["owned", "contract"]]);

  const file = analyzeImpact(surface, ["db/migrations/002.sql"]);
  assert.equal(file.risks.length, 1);
});

test("ids: every producer stays under the schema cap, stably and without collisions", () => {
  const long = "a".repeat(150) + "/" + "b".repeat(150);
  const other = "a".repeat(150) + "/" + "c".repeat(150);
  for (const id of [slug(long), commandId(long, slug(long)), riskId("migration", long)]) {
    assert.ok(id.length <= 200, `${id.length} chars`);
    assert.match(id, /^[a-z0-9][a-z0-9._:/-]*$/);
  }
  assert.equal(slug(long), slug(long));
  assert.notEqual(slug(long), slug(other));
  assert.equal(slug("short/name.ts"), "short/name.ts");
});
