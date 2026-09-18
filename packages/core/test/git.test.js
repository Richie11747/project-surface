import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { changedSince, hashObjects, readGitInfo, stagedPaths } from "../dist/index.js";

/*
 * The git queries on a throwaway repository: non-ASCII names, a scan rooted in
 * a subdirectory, a commit that touched nothing, and a hash batch with a hole.
 * Skipped honestly when git is not installed.
 */

function git(cwd, ...args) {
  const r = spawnSync("git", ["-c", "user.email=t@example.com", "-c", "user.name=t", ...args], {
    cwd,
    encoding: "utf8",
    windowsHide: true,
  });
  if (r.error) return null;
  assert.equal(r.status, 0, `git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout;
}

function repo() {
  const root = mkdtempSync(join(tmpdir(), "project-surface-git-"));
  if (git(root, "init", "-q", "-b", "main") === null) return null;
  git(root, "config", "core.quotePath", "true");
  mkdirSync(join(root, "pkg", "src"), { recursive: true });
  writeFileSync(join(root, "top.txt"), "top\n");
  writeFileSync(join(root, "pkg", "src", "café.ts"), "export const x = 1;\n");
  writeFileSync(join(root, "pkg", "src", "plain.ts"), "export const y = 2;\n");
  git(root, "add", ".");
  git(root, "commit", "-q", "-m", "one");
  git(root, "commit", "-q", "--allow-empty", "-m", "empty");
  writeFileSync(join(root, "pkg", "src", "café.ts"), "export const x = 2;\n");
  git(root, "add", ".");
  git(root, "commit", "-q", "-m", "two");
  return root;
}

test("recent changes carry raw non-ASCII names, relative to the scanned root, past an empty commit", (t) => {
  const root = repo();
  if (root === null) return t.skip("git is not installed");
  try {
    const sub = readGitInfo(join(root, "pkg"));
    assert.equal(sub.available, true);
    const paths = sub.recentChanges.map((c) => c.path);
    assert.ok(paths.includes("src/café.ts"), paths.join(", "));
    assert.ok(!paths.some((p) => p.includes('"') || p.includes("\\")), paths.join(", "));
    assert.ok(!paths.includes("top.txt"), "a file outside the scanned root is not a recent change of it");
    const cafe = sub.recentChanges.find((c) => c.path === "src/café.ts");
    assert.equal(cafe.commits, 2);
    assert.match(cafe.lastTouched, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);

    const top = readGitInfo(root);
    assert.ok(top.recentChanges.some((c) => c.path === "pkg/src/café.ts"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("changed and staged paths are root-relative and unquoted", (t) => {
  const root = repo();
  if (root === null) return t.skip("git is not installed");
  try {
    assert.deepEqual(changedSince(join(root, "pkg"), "HEAD~2"), ["src/café.ts"]);
    writeFileSync(join(root, "pkg", "src", "über.ts"), "export const z = 3;\n");
    git(root, "add", ".");
    assert.deepEqual(stagedPaths(join(root, "pkg")), ["src/über.ts"]);
    assert.deepEqual(stagedPaths(root), ["pkg/src/über.ts"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("one missing path does not cost the rest of its batch their git hashes", (t) => {
  const root = repo();
  if (root === null) return t.skip("git is not installed");
  try {
    const hashes = hashObjects(root, ["top.txt", "nope.txt", "pkg/src/plain.ts"]);
    assert.equal(hashes.has("nope.txt"), false);
    assert.match(hashes.get("top.txt"), /^[0-9a-f]{40}$/);
    assert.match(hashes.get("pkg/src/plain.ts"), /^[0-9a-f]{40}$/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
