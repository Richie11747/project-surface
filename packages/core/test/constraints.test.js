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

const environment = [
  { name: "STRIPE_SECRET_KEY", required: true, secret: true, usedBy: [{ path: "src/payments/stripe.ts", locator: "L4" }, { path: "src/handlers/checkout.ts", locator: "L9" }, { path: ".env.example", locator: "STRIPE_SECRET_KEY" }] },
  { name: "PORT", required: false, secret: false, usedBy: [{ path: "src/util.ts" }] },
];

test("forbid-env reports reads outside the allowed paths; a dotenv listing is not a read", () => {
  const { constraints, violations } = evaluateConstraintChecks({
    constraints: [constraint("keys", { kind: "forbid-env", names: ["STRIPE_*"], paths: ["src/payments/**"] })],
    capabilities: [],
    files,
    imports: [],
    importsAvailable: false,
    environment,
    environmentAvailable: true,
  });
  assert.equal(constraints[0].checked.status, "violated");
  assert.deepEqual(
    violations.map((v) => `${v.path} ${v.detail}`),
    ["src/handlers/checkout.ts reads STRIPE_SECRET_KEY"]
  );
});

test("forbid-env without paths forbids every read, and passes when nothing reads the name", () => {
  const nowhere = evaluateConstraintChecks({
    constraints: [constraint("legacy", { kind: "forbid-env", names: ["PORT"] })],
    capabilities: [],
    files,
    imports: [],
    importsAvailable: false,
    environment,
    environmentAvailable: true,
  });
  assert.equal(nowhere.constraints[0].checked.status, "violated");
  assert.deepEqual(nowhere.violations.map((v) => v.path), ["src/util.ts"]);

  const unused = evaluateConstraintChecks({
    constraints: [constraint("legacy", { kind: "forbid-env", names: ["LEGACY_DB_URL"] })],
    capabilities: [],
    files,
    imports: [],
    importsAvailable: false,
    environment,
    environmentAvailable: true,
  });
  assert.equal(unused.constraints[0].checked.status, "passed");
});

test("forbid-env is unchecked when only the fallback adapter saw the project", () => {
  const { constraints, violations } = evaluateConstraintChecks({
    constraints: [constraint("keys", { kind: "forbid-env", names: ["STRIPE_*"], paths: ["src/payments/**"] })],
    capabilities: [],
    files,
    imports: [],
    importsAvailable: false,
    environment: [{ name: "STRIPE_SECRET_KEY", required: false, secret: true, usedBy: [{ path: ".env.example" }] }],
    environmentAvailable: false,
  });
  assert.equal(constraints[0].checked.status, "unchecked");
  assert.match(constraints[0].checked.reason, /environment reads/);
  assert.deepEqual(violations, []);
});

test("max-owners flags a capability over the limit, scoped by paths when given", () => {
  const wide = capability("checkout", ["src/handlers/checkout.ts", "src/payments/stripe.ts", "src/util.ts"]);
  const narrow = capability("util.helper", ["src/util.ts"]);
  const base = { capabilities: [wide, narrow], files, imports: [], importsAvailable: false, environment: [], environmentAvailable: true };

  const all = evaluateConstraintChecks({ ...base, constraints: [constraint("small", { kind: "max-owners", limit: 2 })] });
  assert.equal(all.constraints[0].checked.status, "violated");
  assert.deepEqual(all.violations.map((v) => `${v.path} ${v.detail}`), ["src/handlers/checkout.ts capability checkout has 3 owner files, limit 2"]);

  const roomy = evaluateConstraintChecks({ ...base, constraints: [constraint("small", { kind: "max-owners", limit: 3 })] });
  assert.equal(roomy.constraints[0].checked.status, "passed");

  const elsewhere = evaluateConstraintChecks({ ...base, constraints: [constraint("small", { kind: "max-owners", limit: 2, paths: ["src/jobs/**"] })] });
  assert.equal(elsewhere.constraints[0].checked.status, "passed", "no owner under paths means the capability is out of scope");
});

test("max-owners counts distinct files, not owner entries with different locators", () => {
  const twice = capability("checkout.create", ["src/handlers/checkout.ts", "src/handlers/checkout.ts"]);
  const { constraints } = evaluateConstraintChecks({
    constraints: [constraint("one-file", { kind: "max-owners", limit: 1 })],
    capabilities: [twice],
    files,
    imports: [],
    importsAvailable: false,
    environment: [],
    environmentAvailable: true,
  });
  assert.equal(constraints[0].checked.status, "passed");
});
