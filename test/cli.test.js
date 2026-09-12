// @ts-check
/**
 * End-to-end: the CLI on a throwaway copy of the TypeScript fixture.
 *
 * This is the README walkthrough, run for real. In particular it pins the exit
 * code contract - `doctor` exits 2 on drift, which is what lets CI gate on it.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { FIXTURES_DIR } from "../scripts/fixture-snapshot.mjs";

const CLI = fileURLToPath(new URL("../packages/cli/dist/index.js", import.meta.url));

function surface(root, command, ...args) {
  const result = spawnSync(process.execPath, [CLI, command, "--root", root, ...args], {
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" },
  });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

function freshCopy() {
  const dir = mkdtempSync(join(tmpdir(), "project-surface-cli-"));
  cpSync(join(FIXTURES_DIR, "ts-api"), dir, { recursive: true });
  rmSync(join(dir, "expected.surface.json"), { force: true });
  return dir;
}

test("init writes a valid document and inspect reads it back", () => {
  const root = freshCopy();
  try {
    const init = surface(root, "init");
    assert.equal(init.code, 0, init.stderr);
    assert.ok(existsSync(join(root, ".project", "surface.json")));
    assert.match(init.stdout, /capabilities\s+7/);

    const inspect = surface(root, "inspect", "checkout.create", "--json");
    assert.equal(inspect.code, 0, inspect.stderr);
    const doc = JSON.parse(inspect.stdout);
    assert.match(JSON.stringify(doc), /src\/checkout\/create\.ts/);

    const doctor = surface(root, "doctor");
    assert.equal(doctor.code, 0, `doctor should be clean on a fresh scan:\n${doctor.stdout}${doctor.stderr}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a verified claim goes stale when its owner file changes, and doctor --strict exits 2", () => {
  const root = freshCopy();
  try {
    assert.equal(surface(root, "init").code, 0);

    /* Simulate verification without running anything: stamp the claim as
       verified against the current fingerprint, exactly as `verify` would. */
    const file = join(root, ".project", "surface.json");
    const doc = JSON.parse(readFileSync(file, "utf8"));
    const claim = doc.capabilities.find((c) => c.id === "checkout.create");
    assert.ok(claim, "fixture must expose checkout.create");
    claim.freshness = { ...claim.freshness, status: "fresh", verifiedAt: doc.generatedAt };
    writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`);

    const owner = join(root, "src", "checkout", "create.ts");
    writeFileSync(owner, `${readFileSync(owner, "utf8")}\n// touched\n`);

    assert.equal(surface(root, "init").code, 0);

    /* A stale claim is a warning: reported always, fatal only under --strict.
       That split is what lets CI choose between "inform" and "gate". */
    const doctor = surface(root, "doctor");
    assert.equal(doctor.code, 0, `${doctor.stdout}${doctor.stderr}`);
    assert.match(doctor.stdout, /STALE_CLAIM \[checkout\.create\]/);

    const strict = surface(root, "doctor", "--strict");
    assert.equal(strict.code, 2, `expected drift exit code 2 under --strict:\n${strict.stdout}${strict.stderr}`);

    const json = surface(root, "doctor", "--json");
    const report = JSON.parse(json.stdout);
    assert.ok(report.findings.some((f) => f.code === "STALE_CLAIM" && f.subject.id === "checkout.create"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("verify runs a recorded command and promotes the capability it proves", () => {
  const root = freshCopy();
  try {
    assert.equal(surface(root, "init").code, 0);

    const verify = surface(root, "verify", "--command", "test", "--json");
    assert.equal(verify.code, 0, verify.stderr);
    const report = JSON.parse(verify.stdout);
    assert.equal(report.results[0].id, "test");
    assert.equal(report.results[0].status, "passed");
    assert.deepEqual(report.warnings, []);

    /* No second init: verify rebuilds the document itself. */
    const inspect = surface(root, "inspect", "checkout.create", "--json");
    const doc = JSON.parse(inspect.stdout);
    const claim = doc.capability ?? doc;
    assert.equal(claim.freshness.status, "fresh");
    assert.ok(claim.confidence >= 0.95, `confidence ${claim.confidence}`);

    const evidence = JSON.parse(readFileSync(join(root, ".project", "surface.json"), "utf8")).evidence;
    assert.ok(evidence.some((e) => e.status === "passed"), "evidence should record the observed pass");

    /* `why` must reproduce the recorded number from the document alone, and
       name the promotion the passing test earned. */
    const why = surface(root, "why", "checkout.create", "--json");
    assert.equal(why.code, 0, why.stderr);
    const explanation = JSON.parse(why.stdout);
    assert.equal(explanation.consistent, true, JSON.stringify(explanation.trace));
    assert.equal(explanation.trace.score, claim.confidence);
    assert.equal(explanation.promotion?.from, "derived");
    assert.equal(explanation.promotion?.to, "verified");
    assert.ok(explanation.evidence.some((e) => e.status === "passed"));
    assert.ok(explanation.trace.steps.some((s) => s.rule === "tier-floor"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("why explains every kind of claim and reproduces the recorded score", () => {
  const root = freshCopy();
  try {
    assert.equal(surface(root, "init").code, 0);
    const doc = JSON.parse(readFileSync(join(root, ".project", "surface.json"), "utf8"));
    const ids = [
      ...doc.capabilities.map((c) => c.id),
      ...doc.commands.map((c) => c.id),
      ...doc.constraints.map((c) => c.id),
      ...doc.risks.map((r) => r.id),
      ...doc.environment.map((e) => e.name),
    ];
    assert.ok(ids.length > 5);
    for (const id of ids) {
      const why = surface(root, "why", id, "--json");
      assert.equal(why.code, 0, `${id}: ${why.stderr}`);
      const e = JSON.parse(why.stdout);
      assert.equal(e.consistent, true, `${id}: recomputed ${e.trace.score}, recorded ${e.recorded}`);
    }
    const text = surface(root, "why", "checkout.create");
    assert.match(text.stdout, /Read from/);
    assert.match(text.stdout, /Score/);
    assert.match(text.stdout, /matches the recorded/);

    assert.equal(surface(root, "why", "no.such.thing").code, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("verify refuses a command that is not in the document", () => {
  const root = freshCopy();
  try {
    assert.equal(surface(root, "init").code, 0);
    const result = surface(root, "verify", "--command", "rm -rf /");
    assert.equal(result.code, 1);
    assert.match(result.stderr, /not present in the surface document/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("every command answers --help and unknown commands fail", () => {
  for (const cmd of ["init", "inspect", "why", "map", "verify", "impact", "context", "diff", "doctor", "report", "mcp"]) {
    const help = surface(".", cmd, "--help");
    assert.equal(help.code, 0, `${cmd} --help exited ${help.code}`);
    assert.ok(help.stdout.length > 20, `${cmd} --help printed nothing`);
  }
  assert.equal(surface(".", "bogus").code, 1);
});
