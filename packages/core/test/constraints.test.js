import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateConstraintChecks } from "../dist/index.js";

/*
 * Constraint checks: a rule with a `check` is evaluated on every scan, and
 * every outcome - passed, violated, unchecked - is explicit.
 */

const NOW = "2026-09-12T00:00:00Z";

function constraint(id, check, severity = "warn") {
  return {
    id: `constraint:${id}`,
    rule: id,
    severity,
    status: "active",
    ...(check ? { check } : {}),
    provenance: { tier: "declared", sources: [{ path: ".project/surface.declare.yaml" }], adapter: "declarations", observedAt: NOW },
  };
}

function capability(id, owners, evidence = []) {
  return {
    id,
    title: id,
    kind: "export",
    owners: owners.map((path) => ({ path })),
    contracts: [],
    evidence: evidence.map((e) => ({ id: `evidence:${e}`, link: "import-graph" })),
    environment: [],
    tags: [],
    provenance: { tier: "inferred", sources: owners.map((path) => ({ path })), adapter: "typescript", observedAt: NOW },
    confidence: 0.4,
  };
}

const files = new Set(["src/handlers/checkout.ts", "src/payments/stripe.ts", "src/util.ts", ".env.example", "tests/checkout.test.ts"]);
const imports = [
  { from: "src/handlers/checkout.ts", specifier: "../payments/stripe.js", to: "src/payments/stripe.ts" },
  { from: "src/handlers/checkout.ts", specifier: "stripe" },
  { from: "src/handlers/checkout.ts", specifier: "./util.js", to: "src/util.ts" },
  { from: "src/util.ts", specifier: "node:fs" },
];

test("forbid-import matches resolved project files and bare specifiers", () => {
  const { constraints, violations } = evaluateConstraintChecks({
    constraints: [
      constraint("no-provider", { kind: "forbid-import", from: ["src/handlers/**"], to: ["src/payments/**", "stripe", "@stripe/*"] }),
      constraint("prose-only"),
    ],
    capabilities: [],
    files,
    imports,
    importsAvailable: true,
  });
  assert.equal(constraints[0].checked.status, "violated");
  assert.equal(constraints[0].checked.violations, 2);
  assert.deepEqual(
    violations.map((v) => `${v.path} ${v.detail}`),
    ["src/handlers/checkout.ts imports src/payments/stripe.ts", "src/handlers/checkout.ts imports stripe"]
  );
  assert.equal(constraints[1].checked, undefined, "a constraint without a check is left alone");
});

test("forbid-import without an import graph is unchecked, never passed", () => {
  const { constraints, violations } = evaluateConstraintChecks({
    constraints: [constraint("no-provider", { kind: "forbid-import", from: ["src/**"], to: ["stripe"] })],
    capabilities: [],
    files,
    imports: [],
    importsAvailable: false,
  });
  assert.equal(constraints[0].checked.status, "unchecked");
  assert.match(constraints[0].checked.reason, /import graph/);
  assert.deepEqual(violations, []);
});

test("forbid-file reports every matching project file, and .env.example is not .env", () => {
  const { constraints, violations } = evaluateConstraintChecks({
    constraints: [constraint("no-env", { kind: "forbid-file", paths: [".env", "**/.env", "**/.env.local"] }, "error")],
    capabilities: [],
    files: new Set([...files, ".env", "apps/web/.env.local"]),
    imports: [],
    importsAvailable: false,
  });
  assert.equal(constraints[0].checked.status, "violated");
  assert.deepEqual(violations.map((v) => v.path), [".env", "apps/web/.env.local"]);
});

test("require-test passes when every covered capability has evidence", () => {
  const tested = capability("checkout.create", ["src/handlers/checkout.ts"], ["tests/checkout.test.ts"]);
  const untested = capability("util.helper", ["src/util.ts"]);
  const check = { kind: "require-test", paths: ["src/handlers/**"] };

  const ok = evaluateConstraintChecks({ constraints: [constraint("t", check)], capabilities: [tested, untested], files, imports: [], importsAvailable: false });
  assert.equal(ok.constraints[0].checked.status, "passed");

  const wider = evaluateConstraintChecks({ constraints: [constraint("t", { kind: "require-test", paths: ["src/**"] })], capabilities: [tested, untested], files, imports: [], importsAvailable: false });
  assert.equal(wider.constraints[0].checked.status, "violated");
  assert.deepEqual(wider.violations.map((v) => v.detail), ["capability util.helper has no linked evidence"]);
});
