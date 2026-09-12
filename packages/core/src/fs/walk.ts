/**
 * Project file discovery.
 *
 * Preference order matters. When the project is a git repository we ask git for
 * the file list, which gives exact .gitignore semantics - including nested
 * ignore files, negations, and the global excludes - at zero implementation
 * cost. Only when git is unavailable do we fall back to a directory walk with a
 * conservative built-in ignore list, and the result records which path was
 * taken so consumers know how trustworthy the listing is.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { listFiles } from "../git/git.js";

/** Directories never worth walking. Build output, caches, dependency trees. */
export const DEFAULT_IGNORES: readonly string[] = Object.freeze([
  ".git", ".hg", ".svn",
  "node_modules", "bower_components", "vendor",
  "dist", "build", "out", "target", "bin", "obj",
  ".next", ".nuxt", ".svelte-kit", ".turbo", ".parcel-cache",
  ".venv", "venv", "env", "__pycache__", ".pytest_cache", ".mypy_cache", ".ruff_cache", ".tox",
  "coverage", ".nyc_output",
  ".gradle", ".idea", ".vscode", ".cache", ".DS_Store",
]);

/** Guard against pathological trees; exceeded counts are reported, not hidden. */
export const MAX_FILES = 20_000;

export type WalkSource = "git" | "filesystem";

export interface WalkResult {
  /** POSIX-separated, root-relative, sorted. */
  files: string[];
  truncated: boolean;
  source: WalkSource;
}

export function toPosix(p: string): string {
  return p.split(sep).join("/").replace(/\\/g, "/");
}

export function walkProject(root: string, maxFiles: number = MAX_FILES): WalkResult {
  const fromGit = listFiles(root);
  if (fromGit) {
    const files = fromGit.map(toPosix).sort();
    return {
      files: files.slice(0, maxFiles),
      truncated: files.length > maxFiles,
      source: "git",
    };
  }

  const collected: string[] = [];
  let truncated = false;

  const visit = (dir: string): void => {
    if (collected.length >= maxFiles) {
      truncated = true;
      return;
    }
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (collected.length >= maxFiles) {
        truncated = true;
        return;
      }
      if (DEFAULT_IGNORES.includes(entry.name)) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(full);
      } else if (entry.isFile()) {
        collected.push(toPosix(relative(root, full)));
      }
    }
  };

  visit(root);
  return { files: collected.sort(), truncated, source: "filesystem" };
}

/** Read a project file, returning null rather than throwing on any failure. */
export function readFileSafe(root: string, relPath: string): string | null {
  try {
    return readFileSync(join(root, relPath), "utf8");
  } catch {
    return null;
  }
}

export function readJsonSafe<T>(root: string, relPath: string): T | null {
  const raw = readFileSafe(root, relPath);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function existsSafe(root: string, relPath: string): boolean {
  try {
    statSync(join(root, relPath));
    return true;
  } catch {
    return false;
  }
}
