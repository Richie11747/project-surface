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

test("every command answers --help and unknown commands fail", () => {
  for (const cmd of ["init", "inspect", "map", "verify", "impact", "context", "diff", "doctor", "report", "mcp"]) {
    const help = surface(".", cmd, "--help");
    assert.equal(help.code, 0, `${cmd} --help exited ${help.code}`);
    assert.ok(help.stdout.length > 20, `${cmd} --help printed nothing`);
  }
  assert.equal(surface(".", "bogus").code, 1);
});
