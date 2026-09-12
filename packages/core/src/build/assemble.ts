/**
 * Assembly helpers used by the pipeline.
 *
 * Kept separate so `pipeline.ts` reads as the sequence of decisions it makes,
 * rather than as a pile of string and hash plumbing.
 */

import { basename, resolve } from "node:path";
import type { AdapterResult } from "../adapter.js";
import { hashObjects } from "../git/git.js";
import { computeConfidence } from "../model/confidence.js";
import { fingerprintFiles, hashContent, ownerPaths } from "../model/freshness.js";
import { packageIdFromPath } from "../model/ids.js";
import type {
  DraftCapability,
  PackageInfo,
  Provenance,
  SourceRef,
} from "../schema/types.js";

const ENV_EXAMPLE_FILES = [".env.example", ".env.sample", ".env.template"];

/**
 * Corroboration is counted in distinct *files*, not distinct references. Three
 * findings inside one file are one file agreeing with itself.
 */
export function distinctSources(sources: SourceRef[]): number {
  return new Set(sources.map((s) => s.path)).size;
}

export function scoreClaim<T extends { provenance: Provenance }>(item: T): T & { confidence: number } {
  return {
    ...item,
    confidence: computeConfidence({
      tier: item.provenance.tier,
      sourceCount: distinctSources(item.provenance.sources),
    }),
  };
}

/**
 * A fingerprint per capability, over the files that implement it.
 *
 * Git blob hashes are preferred because git has already read and hashed every
 * tracked file, making this nearly free. Outside a repository we fall back to
 * hashing content directly.
 */
export function buildFingerprints(
  root: string,
  gitAvailable: boolean,
  capabilities: DraftCapability[],
  readFile: (relPath: string) => string | null
): Map<string, string> {
  const allPaths = [...new Set(capabilities.flatMap((c) => c.owners.map((o) => o.path)))].sort();
  if (allPaths.length === 0) return new Map();

  const hashes = gitAvailable ? hashObjects(root, allPaths) : new Map<string, string>();
  const hashFor = (path: string): string => {
    const fromGit = hashes.get(path);
    if (fromGit) return fromGit;
    const content = readFile(path);
    return content === null ? "missing" : hashContent(content);
  };

  const out = new Map<string, string>();
  for (const capability of capabilities) {
    const paths = ownerPaths(capability.owners);
    out.set(
      capability.id,
      fingerprintFiles(paths.map((path) => ({ path, hash: hashFor(path) })))
    );
  }
  return out;
}

export function collectPackages(results: AdapterResult[]): PackageInfo[] {
  const byId = new Map<string, PackageInfo>();
  for (const result of results) {
    for (const pkg of result.packages ?? []) {
      if (!byId.has(pkg.id)) byId.set(pkg.id, pkg);
    }
  }
  if (byId.size === 0) {
    byId.set("root", { id: packageIdFromPath("."), path: "." });
  }
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Variable names documented in the project example env file. Only names are
 * read; the file may contain placeholder values and they are never stored.
 */
export function readEnvExample(
  files: ReadonlySet<string>,
  readFile: (relPath: string) => string | null
): { path: string; names: ReadonlySet<string> } | null {
  const path = ENV_EXAMPLE_FILES.find((f) => files.has(f));
  if (!path) return null;
  const content = readFile(path);
  if (content === null) return null;

  const names = new Set<string>();
  for (const line of content.split("\n")) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
    if (match?.[1]) names.add(match[1]);
  }
  return { path, names };
}

interface PackageJsonName {
  name?: unknown;
}

/**
 * Naming precedence: what a human declared, then what the root package of any
 * ecosystem calls itself, then package.json, then the directory. The adapter
 * layer is consulted before package.json so a Python or Go project is named by
 * its own manifest rather than by whatever happens to sit in the folder.
 */
export function resolveProjectName(
  root: string,
  declared: string | undefined,
  readJson: <T>(relPath: string) => T | null,
  packages: PackageInfo[] = []
): string {
  if (declared && declared.trim().length > 0) return declared.trim();

  const rootPackage = packages.find((p) => p.path === "." && typeof p.name === "string" && p.name.length > 0);
  if (rootPackage?.name) return rootPackage.name;

  const pkg = readJson<PackageJsonName>("package.json");
  if (pkg && typeof pkg.name === "string" && pkg.name.length > 0) return pkg.name;

  const dir = basename(resolve(root));
  return dir.length > 0 ? dir : "project";
}
