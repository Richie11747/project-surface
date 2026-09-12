/**
 * Git access.
 *
 * Implemented by shelling out to the `git` binary rather than linking a native
 * library: no build step, no platform-specific binaries, and it degrades to a
 * clearly-reported `available: false` when git is missing. Every function here
 * is read-only - this module never mutates a repository.
 */

import { spawnSync } from "node:child_process";
import type { GitInfo, GitRecentChange } from "../schema/types.js";

const MAX_BUFFER = 32 * 1024 * 1024;
const RECENT_WINDOW_DAYS = 30;
const RECENT_LIMIT = 40;
/** Keep argv comfortably under the Windows command-line limit. */
const ARG_BATCH = 80;

export interface GitResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  code: number | null;
}

export function runGit(root: string, args: string[]): GitResult {
  const r = spawnSync("git", args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: MAX_BUFFER,
    windowsHide: true,
  });
  if (r.error) return { ok: false, stdout: "", stderr: String(r.error), code: null };
  return {
    ok: r.status === 0,
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? "",
    code: r.status,
  };
}

export function isRepository(root: string): boolean {
  return runGit(root, ["rev-parse", "--is-inside-work-tree"]).stdout.trim() === "true";
}

/**
 * Files git considers part of the project: tracked plus untracked-but-not-
 * ignored. This gives exact .gitignore semantics for free, which is far more
 * reliable than reimplementing the ignore-matching rules.
 */
export function listFiles(root: string): string[] | null {
  const r = runGit(root, ["ls-files", "--cached", "--others", "--exclude-standard", "-z"]);
  if (!r.ok) return null;
  return r.stdout.split("\0").filter((p) => p.length > 0);
}

/**
 * Content hashes for the working-tree version of each path. Batched to stay
 * within argv limits. Paths that git cannot hash are simply omitted; callers
 * fall back to hashing file content directly.
 */
export function hashObjects(root: string, paths: string[]): Map<string, string> {
  const out = new Map<string, string>();
  for (let i = 0; i < paths.length; i += ARG_BATCH) {
    const batch = paths.slice(i, i + ARG_BATCH);
    const r = runGit(root, ["hash-object", "--", ...batch]);
    if (!r.ok) continue;
    const hashes = r.stdout.split("\n").filter((l) => l.length > 0);
    if (hashes.length !== batch.length) continue;
    batch.forEach((p, idx) => {
      const h = hashes[idx];
      if (h) out.set(p, h);
    });
  }
  return out;
}

/**
 * A revision name that is safe to hand to git as a positional argument.
 *
 * `ref` comes from a CLI flag or an MCP tool parameter. git is spawned with
 * an argv array, so there is no shell to inject into - but a value beginning
 * with `-` would be parsed as a git option (`--output=<path>` writes a file),
 * which is the one thing an untrusted caller must not be able to do.
 */
const SAFE_REF = /^[A-Za-z0-9][A-Za-z0-9._\/~^@{}-]{0,255}$/;

export function isSafeRef(ref: string): boolean {
  return SAFE_REF.test(ref) && !ref.includes("..") && !ref.includes("@{");
}

/** Contents of a tracked file at a revision, or null when absent or the ref is unsafe. */
export function showFileAtRef(root: string, ref: string, file: string): string | null {
  if (!isSafeRef(ref)) return null;
  const r = runGit(root, ["show", `${ref}:${file}`]);
  return r.ok ? r.stdout : null;
}

/** Paths changed between `ref` and the working tree. */
export function changedSince(root: string, ref: string): string[] | null {
  if (!isSafeRef(ref)) return null;
  const r = runGit(root, ["diff", "--name-only", `${ref}...HEAD`]);
  if (!r.ok) return null;
  const committed = r.stdout.split("\n").filter(Boolean);
  const working = runGit(root, ["diff", "--name-only", "HEAD"]);
  const dirty = working.ok ? working.stdout.split("\n").filter(Boolean) : [];
  return [...new Set([...committed, ...dirty])].sort();
}

export function stagedPaths(root: string): string[] {
  const r = runGit(root, ["diff", "--name-only", "--cached"]);
  return r.ok ? r.stdout.split("\n").filter(Boolean).sort() : [];
}

/**
 * Which files have been churning lately. Used to flag risk, not to make claims:
 * a recently-edited file is a reason to look closer, nothing more.
 */
function recentChanges(root: string): GitRecentChange[] {
  const r = runGit(root, [
    "log",
    `--since=${RECENT_WINDOW_DAYS}.days`,
    "--name-only",
    "--pretty=format:%cI",
  ]);
  if (!r.ok) return [];

  const counts = new Map<string, { commits: number; lastTouched?: string }>();
  let currentDate: string | undefined;
  for (const raw of r.stdout.split("\n")) {
    const line = raw.trim();
    if (line.length === 0) continue;
    if (/^\d{4}-\d{2}-\d{2}T/.test(line)) {
      currentDate = line;
      continue;
    }
    const entry = counts.get(line) ?? { commits: 0 };
    entry.commits += 1;
    entry.lastTouched ??= currentDate;
    counts.set(line, entry);
  }

  return [...counts.entries()]
    .map(([path, v]) => ({
      path,
      commits: v.commits,
      ...(v.lastTouched ? { lastTouched: toIsoUtc(v.lastTouched) } : {}),
    }))
    .sort((a, b) => b.commits - a.commits || a.path.localeCompare(b.path))
    .slice(0, RECENT_LIMIT);
}

export function readGitInfo(root: string): GitInfo {
  if (!isRepository(root)) return { available: false };

  const head = runGit(root, ["rev-parse", "HEAD"]).stdout.trim();
  const branch = runGit(root, ["rev-parse", "--abbrev-ref", "HEAD"]).stdout.trim();
  const status = runGit(root, ["status", "--porcelain"]);

  return {
    available: true,
    ...(head ? { head } : {}),
    ...(branch && branch !== "HEAD" ? { branch } : {}),
    dirty: status.ok ? status.stdout.trim().length > 0 : false,
    recentChanges: recentChanges(root),
  };
}

/** Normalize any git date to the Z-suffixed form the spec requires. */
export function toIsoUtc(input: string): string {
  const ms = Date.parse(input);
  if (Number.isNaN(ms)) return input;
  return `${new Date(ms).toISOString().slice(0, 19)}Z`;
}
