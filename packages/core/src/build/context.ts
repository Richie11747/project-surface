/**
 * Construction of the read-only view handed to adapters.
 *
 * File reads are memoized because several adapters legitimately want the same
 * files (package.json, README, .env.example) and a project scan should not read
 * one file five times.
 */

import { existsSafe, readFileSafe, readJsonSafe } from "../fs/walk.js";
import type { AdapterContext } from "../adapter.js";
import type { GitInfo, Timestamp } from "../schema/types.js";

export interface CreateContextOptions {
  root: string;
  files: readonly string[];
  git: GitInfo;
  now: Timestamp;
  log?: (message: string) => void;
}

export function createAdapterContext(options: CreateContextOptions): AdapterContext {
  const { root, files, git, now } = options;
  const fileCache = new Map<string, string | null>();
  const matchCache = new Map<string, string[]>();
  const fileSet = new Set(files);

  return {
    root,
    files,
    git,
    now,

    readFile(relPath: string): string | null {
      if (!fileCache.has(relPath)) fileCache.set(relPath, readFileSafe(root, relPath));
      return fileCache.get(relPath) ?? null;
    },

    readJson<T>(relPath: string): T | null {
      return readJsonSafe<T>(root, relPath);
    },

    exists(relPath: string): boolean {
      return fileSet.has(relPath) || existsSafe(root, relPath);
    },

    match(pattern: RegExp): string[] {
      const key = `${pattern.source}\u0000${pattern.flags}`;
      const cached = matchCache.get(key);
      if (cached) return cached;
      const stateless = new RegExp(pattern.source, pattern.flags.replace("g", ""));
      const result = files.filter((f) => stateless.test(f));
      matchCache.set(key, result);
      return result;
    },

    log(message: string): void {
      options.log?.(message);
    },
  };
}
