import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  absorbInferred,
  expandDeclaredOwners,
  expandGlob,
  globToRegExp,
  loadDeclarations,
  matchesGlob,
} from "../dist/index.js";

/*
 * Globs, ignore lists, owner expansion and absorption: the mechanisms that let
 * a declaration set the scope and the granularity of a surface.
 */

const NOW = "2026-09-12T00:00:00Z";

test("glob: plain path names itself and its subtree", () => {
  assert.ok(matchesGlob("fixtures", "fixtures"));
  assert.ok(matchesGlob("fixtures/ts-api/package.json", "fixtures"));
  assert.ok(matchesGlob("fixtures/ts-api/package.json", "fixtures/"));
  assert.ok(!matchesGlob("fixtures-extra/x", "fixtures"));
  assert.ok(!matchesGlob("src/fixtures/x", "fixtures"));
});

test("glob: star stops at slashes, doublestar does not", () => {
  assert.ok(matchesGlob("README.md", "*.md"));
  assert.ok(!matchesGlob("docs/README.md", "*.md"));
  assert.ok(matchesGlob("docs/README.md", "**/*.md"));
  assert.ok(matchesGlob("README.md", "**/*.md"));
  assert.ok(matchesGlob("packages/core/src/model/ids.ts", "packages/core/src/model/**"));
  assert.ok(!matchesGlob("packages/core/src/models.ts", "packages/core/src/model/**"));
  assert.ok(matchesGlob("a/b/c.test.ts", "a/**/c.test.ts"));
  assert.ok(matchesGlob("a/c.test.ts", "a/**/c.test.ts"));
});

test("glob: question mark is one non-slash character; regex specials are literal", () => {
  assert.ok(matchesGlob("v1.ts", "v?.ts"));
  assert.ok(!matchesGlob("v/.ts", "v?.ts"));
  assert.ok(!matchesGlob("v1xts", "v?.ts"));
  assert.equal(globToRegExp("a+b(c).ts").test("a+b(c).ts"), true);
});

test("glob: expansion against a file list is ordered like the input", () => {
  const files = ["a/x.ts", "a/y.ts", "b/z.ts"];
  assert.deepEqual(expandGlob("a/**", files), ["a/x.ts", "a/y.ts"]);
  assert.deepEqual(expandGlob("nope/**", files), []);
});

function scratch(yaml) {
  const root = mkdtempSync(join(tmpdir(), "project-surface-decl-"));
  mkdirSync(join(root, ".project"));
  writeFileSync(join(root, ".project", "surface.declare.yaml"), yaml);
  return root;
}

test("declarations: ignore accepts relative globs and rejects escapes", () => {
  const root = scratch(`
ignore:
  - fixtures/**
  - /etc/passwd
  - ../sibling
  - ""
`);
  try {
    const decl = loadDeclarations(root, NOW);
    assert.deepEqual(decl.ignore, ["fixtures/**"]);
    assert.equal(decl.errors.length, 3, decl.errors.join("\n"));
    assert.match(decl.errors[0], /project-relative/);
    assert.match(decl.errors[1], /project-relative/);
    assert.match(decl.errors[2], /path or glob/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("declarations: glob owners expand to concrete files, and an empty match is an error", () => {
  const root = scratch(`
capabilities:
  - id: trust-model
    title: The trust model
    owners: [src/model/**, src/index.ts]
  - id: ghost
    title: Nothing here
    owners: [src/nowhere/**]
`);
  try {
    const decl = loadDeclarations(root, NOW);
    expandDeclaredOwners(decl, ["src/index.ts", "src/model/a.ts", "src/model/b.ts", "src/other.ts"]);
    assert.equal(decl.capabilities.length, 1);
    assert.deepEqual(
      decl.capabilities[0].owners.map((o) => o.path),
      ["src/model/a.ts", "src/model/b.ts", "src/index.ts"]
    );
    assert.equal(decl.errors.length, 1);
    assert.match(decl.errors[0], /matches no files/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function cap(id, tier, owners, extra = {}) {
  return {
    id,
    title: id,
    kind: "export",
    owners: owners.map((path) => ({ path })),
    contracts: [],
    evidence: [],
    environment: [],
    tags: [],
    provenance: {
      tier,
      sources: owners.map((path) => ({ path, locator: `export:${id}` })),
      adapter: tier === "declared" ? "declarations" : "typescript",
      observedAt: NOW,
    },
    ...extra,
  };
}

test("absorb: inferred claims fully covered by a declaration fold into it", () => {
  const declared = cap("trust-model", "declared", ["src/model/a.ts", "src/model/b.ts"]);
  const guessA = cap("model.a-fn", "inferred", ["src/model/a.ts"], {
    evidence: [{ id: "evidence:test/a.test.ts", link: "import-graph" }],
    environment: ["LOG_LEVEL"],
  });
  const guessB = cap("model.b-fn", "inferred", ["src/model/b.ts"]);
  const outside = cap("other.fn", "inferred", ["src/other.ts"]);
  const partial = cap("model.mixed", "inferred", ["src/model/a.ts", "src/other.ts"]);
  const structured = cap("model.route", "derived", ["src/model/a.ts"]);

  const out = absorbInferred([declared, guessA, guessB, outside, partial, structured]);
  const ids = out.map((c) => c.id);
  assert.deepEqual(ids, ["model.mixed", "model.route", "other.fn", "trust-model"]);

  const host = out.find((c) => c.id === "trust-model");
  assert.equal(host.provenance.tier, "declared");
  assert.deepEqual(host.aliases, ["model.a-fn", "model.b-fn"]);
  assert.deepEqual(host.environment, ["LOG_LEVEL"]);
  assert.deepEqual(host.evidence, [{ id: "evidence:test/a.test.ts", link: "import-graph" }]);
  // Sources union: the guesses become corroboration for the declaration.
  assert.ok(host.provenance.sources.some((s) => s.locator === "export:model.a-fn"));
});

test("absorb: without any declaration nothing changes", () => {
  const input = [cap("a", "inferred", ["x.ts"]), cap("b", "derived", ["y.ts"])];
  assert.deepEqual(absorbInferred(input), input);
});

test("declarations: forbid-env and max-owners checks are validated, not silently dropped", () => {
  const root = scratch(`
constraints:
  - id: keys-in-config
    rule: Provider keys are read only in src/config.
    check:
      kind: forbid-env
      names: ["STRIPE_*", PAYMENT_PROVIDER_KEY]
      paths: [src/config/**]
  - id: no-legacy
    rule: LEGACY_DB_URL is read nowhere.
    check:
      kind: forbid-env
      names: [LEGACY_DB_URL]
  - id: small
    rule: A capability owns at most four files.
    check:
      kind: max-owners
      limit: 4
  - id: bad-name
    rule: Names must look like variable names.
    check:
      kind: forbid-env
      names: ["not a name"]
  - id: bad-limit
    rule: The limit is a whole number.
    check:
      kind: max-owners
      limit: 0
  - id: bad-scope
    rule: Scope globs stay inside the project.
    check:
      kind: max-owners
      limit: 2
      paths: [../elsewhere/**]
`);
  try {
    const decl = loadDeclarations(root, NOW);
    const checks = Object.fromEntries(decl.constraints.map((c) => [c.id, c.check]));
    assert.deepEqual(checks["constraint:keys-in-config"], { kind: "forbid-env", names: ["STRIPE_*", "PAYMENT_PROVIDER_KEY"], paths: ["src/config/**"] });
    assert.deepEqual(checks["constraint:no-legacy"], { kind: "forbid-env", names: ["LEGACY_DB_URL"] });
    assert.deepEqual(checks["constraint:small"], { kind: "max-owners", limit: 4 });
    assert.equal(decl.errors.length, 3, decl.errors.join("\n"));
    assert.match(decl.errors[0], /names must be variable names/);
    assert.match(decl.errors[1], /limit must be a whole number/);
    assert.match(decl.errors[2], /project-relative/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("declarations: a plain directory owner expands to its files, a missing one stays as written", () => {
  const root = scratch(`
capabilities:
  - id: model
    title: The model
    owners: [src/model, src/index.ts, src/vanished]
`);
  try {
    const decl = loadDeclarations(root, NOW);
    expandDeclaredOwners(decl, ["src/index.ts", "src/model/a.ts", "src/model/b.ts", "src/modeller.ts"]);
    assert.deepEqual(
      decl.capabilities[0].owners.map((o) => o.path),
      ["src/model/a.ts", "src/model/b.ts", "src/index.ts", "src/vanished"]
    );
    assert.deepEqual(decl.errors, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
