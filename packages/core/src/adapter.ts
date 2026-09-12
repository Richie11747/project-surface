/**
 * The adapter contract.
 *
 * An adapter knows how to read one ecosystem. It is handed a read-only view of
 * the project and returns *drafts* - claims with provenance but without a
 * confidence score. Two properties of this interface are load-bearing:
 *
 *   1. There is no exec capability. An adapter can propose that `npm test` is
 *      the test command; only `evidence/runner.ts` may ever run it. This keeps
 *      the blast radius of a third-party adapter to "reads your files".
 *
 *   2. `now` is supplied by the caller and fixed for the whole build. Adapters
 *      must never call `Date.now()`. That is what makes two runs over an
 *      unchanged project produce byte-identical output, which the conformance
 *      suite enforces.
 */

import type {
  DraftCapability,
  DraftCommand,
  DraftConstraint,
  DraftEnvironmentVariable,
  DraftEvidenceEntry,
  DraftRisk,
  GitInfo,
  ImportEdge,
  PackageInfo,
  StackInfo,
  Timestamp,
} from "./schema/types.js";

export interface AdapterContext {
  /**
   * Absolute filesystem root. Provided so adapters can be given to helpers that
   * need it; it must never appear in any emitted value. The conformance suite
   * fails an adapter that leaks it.
   */
  readonly root: string;
  /** Every project file, POSIX-separated and root-relative. Sorted. */
  readonly files: readonly string[];
  readonly git: GitInfo;
  /** Fixed for the whole build. Adapters must use this, never the clock. */
  readonly now: Timestamp;

  readFile(relPath: string): string | null;
  readJson<T>(relPath: string): T | null;
  exists(relPath: string): boolean;
  /** Project files matching a pattern, in sorted order. */
  match(pattern: RegExp): string[];
  log(message: string): void;
}

export interface AdapterResult {
  stack: StackInfo;
  packages?: PackageInfo[];
  commands?: DraftCommand[];
  capabilities?: DraftCapability[];
  constraints?: DraftConstraint[];
  environment?: DraftEnvironmentVariable[];
  risks?: DraftRisk[];
  evidence?: DraftEvidenceEntry[];
  /**
   * Import edges between project files (and to bare module specifiers). Not
   * stored in the document; core uses them to evaluate `forbid-import`
   * constraint checks. An adapter that cannot see imports omits this, and
   * such checks are reported as `unchecked` rather than silently passed.
   */
  imports?: ImportEdge[];
}

export interface Adapter {
  /** Stable, lowercase. Becomes `stack.id` and appears in every provenance record. */
  readonly id: string;
  readonly version: string;
  /** Cheap check: does this ecosystem appear in the project at all? */
  detect(ctx: AdapterContext): boolean | Promise<boolean>;
  extract(ctx: AdapterContext): AdapterResult | Promise<AdapterResult>;
}

/** An empty result, so adapters can bail out without constructing boilerplate. */
export function emptyResult(stack: StackInfo): AdapterResult {
  return { stack };
}
