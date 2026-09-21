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

import { lstatSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { listFiles } from "../git/git.js";
import { redactText } from "../redact.js";

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

const IGNORED_DIRS: ReadonlySet<string> = new Set(DEFAULT_IGNORES);

/** Guard against pathological trees; exceeded counts are reported, not hidden. */
export const MAX_FILES = 20_000;

/**
 * Largest file `readFileSafe` will load. Adapters parse source, not archives;
 * a repository can commit anything, and one multi-hundred-megabyte file must
 * not be what a scan spends its memory on.
 */
export const MAX_FILE_BYTES = 2 * 1024 * 1024;

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

/**
 * `exclude` is applied before the `maxFiles` cap, so a declared `ignore:` -
 * a vendored tree, a fixture corpus - does not spend the budget that the
 * project's own files then run out of. (The cap truncates the sorted list, so
 * without this an ignored `assets/` could push all of `src/` past the limit.)
 */
export function walkProject(
  root: string,
  maxFiles: number = MAX_FILES,
  exclude: (relPath: string) => boolean = () => false
): WalkResult {
  const fromGit = listFiles(root);
  if (fromGit) {
    const files = fromGit.map(toPosix).filter((f) => !exclude(f)).sort();
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
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        /* The ignore list names directories; a file called `build` or `env` is a file. */
        if (!IGNORED_DIRS.has(entry.name)) visit(full);
      } else if (entry.isFile()) {
        const rel = toPosix(relative(root, full));
        if (!exclude(rel)) collected.push(rel);
      }
    }
  };

  visit(root);
  return { files: collected.sort(), truncated, source: "filesystem" };
}

/**
 * The real path of a root does not change during a scan, and `resolveInside`
 * runs once per file read - thousands of times. Resolved once per root.
 */
const REAL_ROOTS = new Map<string, string>();

function realRootOf(root: string): string {
  let real = REAL_ROOTS.get(root);
  if (real === undefined) {
    real = realpathSync(root);
    REAL_ROOTS.set(root, real);
  }
  return real;
}

/**
 * Resolve a project-relative path to something that is physically inside the
 * project, or null.
 *
 * A repository can commit a symlink pointing anywhere on the machine - a
 * private key, a credentials file - and `git ls-files` lists it like any other
 * path. Reading through it would hand that content to an adapter or, via
 * `surface_context`, straight back to an MCP caller. So the real path must sit
 * under the real root, and the final component must not be a link at all.
 */
export function resolveInside(root: string, relPath: string): string | null {
  const full = join(root, relPath);
  try {
    if (lstatSync(full).isSymbolicLink()) return null;
    const realRoot = realRootOf(root);
    const real = realpathSync(full);
    if (real !== realRoot && !real.startsWith(realRoot + sep)) return null;
    return full;
  } catch {
    return null;
  }
}

/**
 * Read a project file, returning null rather than throwing on any failure.
 *
 * Text is normalised on the way in: a UTF-8 byte-order mark is dropped and
 * CRLF becomes LF. Every parser downstream splits on `\n` and anchors on
 * `^`; a BOM made `JSON.parse` throw on a valid `package.json` and hid the
 * first line of every manifest, and a stray `\r` made `line === "}"` false.
 */
export function readFileSafe(root: string, relPath: string): string | null {
  const target = resolveInside(root, relPath);
  if (target === null) return null;
  try {
    if (lstatSync(target).size > MAX_FILE_BYTES) return null;
    return readFileSync(target, "utf8").replace(/^﻿/, "").replace(/\r\n/g, "\n");
  } catch {
    return null;
  }
}

/**
 * Byte size of a file inside the project, under the same rules as
 * `readFileSafe` - null for anything that reader would refuse - so a caller
 * can size a file without paying for its body.
 */
export function fileSizeSafe(root: string, relPath: string): number | null {
  const target = resolveInside(root, relPath);
  if (target === null) return null;
  try {
    const stat = lstatSync(target);
    if (!stat.isFile() || stat.size > MAX_FILE_BYTES) return null;
    return stat.size;
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
  return resolveInside(root, relPath) !== null;
}

export type FileReader = (relPath: string) => string | null;

/** A reader plus a size probe; see `createGuardedAccess`. */
export interface FileAccess {
  size(relPath: string): number | null;
  read: FileReader;
}

/**
 * Paths whose content is never handed out, whatever a surface document says.
 * The document is repository-authored: a declaration can name any path as an
 * owner, and an orphaned owner is a health finding, not a refusal to read.
 */
const NEVER_SERVED: readonly RegExp[] = [
  /^\.git(?:\/|$)/,
  /(?:^|\/)\.env(?!\.(?:example|sample|template)$)(?:\..*)?$/,
  /(?:^|\/)\.(?:npmrc|netrc|pypirc|git-credentials)$/,
  /(?:^|\/)id_(?:rsa|dsa|ecdsa|ed25519)$/,
  /\.(?:pem|key|p12|pfx|jks|keystore|kdbx)$/i,
];

/**
 * A reader for content that leaves the process - `surface context --content`
 * and the MCP `surface_context` tool. `readFileSafe` keeps reads inside the
 * root; this additionally serves only files the project itself lists (tracked
 * or untracked-but-not-ignored, so a gitignored `.env` is invisible), refuses
 * the credential files above, and redacts what it returns.
 */
export function createGuardedReader(root: string, files?: readonly string[]): FileReader {
  return createGuardedAccess(root, files).read;
}

/**
 * The guarded reader plus a size probe under the same allow-list, so a
 * context pack of paths can be sized with a `stat` per file and never opens a
 * file it would refuse to serve.
 */
export function createGuardedAccess(root: string, files?: readonly string[]): FileAccess {
  const allowed = new Set(files ?? walkProject(root).files);
  const served = (relPath: string): string | null => {
    const path = toPosix(relPath);
    return !allowed.has(path) || NEVER_SERVED.some((re) => re.test(path)) ? null : path;
  };
  return {
    size: (relPath) => {
      const path = served(relPath);
      return path === null ? null : fileSizeSafe(root, path);
    },
    read: (relPath) => {
      const path = served(relPath);
      if (path === null) return null;
      const content = readFileSafe(root, path);
      return content === null ? null : redactText(content);
    },
  };
}
