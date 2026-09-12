/**
 * The freshness model.
 *
 * A TTL alone is a weak signal: a claim about a file nobody touched is still
 * true after a year, and a claim about a file edited a minute ago is already
 * suspect. So the primary invalidation signal here is a *fingerprint* over the
 * owner files. The TTL is only a backstop for claims whose truth can drift
 * without the owner files changing (a network dependency, a CI runner image).
 */

import { createHash } from "node:crypto";
import type { Freshness, SourceRef, Timestamp } from "../schema/types.js";

/** Default backstop TTL for a verified claim, in days. */
export const DEFAULT_STALE_AFTER_DAYS = 14;

export interface FileFingerprint {
  path: string;
  /** Git blob SHA when available, otherwise a content hash. */
  hash: string;
}

/**
 * Order-independent fingerprint over a set of files. Sorting before hashing is
 * what makes the surface document byte-stable across runs.
 */
export function fingerprintFiles(files: FileFingerprint[]): string {
  const canonical = files
    .map((f) => `${f.path}:${f.hash}`)
    .sort()
    .join("\n");
  return createHash("sha256").update(canonical).digest("hex").slice(0, 32);
}

export function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 32);
}

export interface FreshnessInput {
  /**
   * The fingerprint as it was *at the moment of verification*, carried forward
   * across scans. It deliberately does not track the current files: if it did,
   * a stale claim would silently become fresh again on the next scan without
   * anyone re-running anything.
   */
  previousFingerprint?: string;
  /** Fingerprint of the owner files right now. */
  currentFingerprint?: string;
  verifiedAt?: Timestamp;
  now: Timestamp;
  staleAfterDays?: number;
}

/**
 * Decide whether a claim still describes the code.
 *
 * `unknown` is a real answer and is used deliberately: a claim that was never
 * verified is not fresh, but it is not stale either - we simply have not looked.
 */
export function evaluateFreshness(input: FreshnessInput): Freshness {
  const staleAfterDays = input.staleAfterDays ?? DEFAULT_STALE_AFTER_DAYS;

  if (!input.verifiedAt) {
    return {
      status: "unknown",
      ...(input.currentFingerprint ? { ownersFingerprint: input.currentFingerprint } : {}),
      staleAfterDays,
      reason: "Never verified.",
    };
  }

  /* The stored fingerprint is the verification anchor, not a snapshot of the
     working tree. It only moves when the claim is verified again. */
  const anchor = input.previousFingerprint ?? input.currentFingerprint;
  const base: Freshness = {
    status: "fresh",
    verifiedAt: input.verifiedAt,
    staleAfterDays,
    ...(anchor ? { ownersFingerprint: anchor } : {}),
  };

  if (
    input.previousFingerprint &&
    input.currentFingerprint &&
    input.previousFingerprint !== input.currentFingerprint
  ) {
    return { ...base, status: "stale", reason: "Owner files changed since verification." };
  }

  const ageDays = daysBetween(input.verifiedAt, input.now);
  if (ageDays > staleAfterDays) {
    return {
      ...base,
      status: "stale",
      reason: `Verification is ${Math.floor(ageDays)} days old (limit ${staleAfterDays}).`,
    };
  }

  return base;
}

export function daysBetween(from: Timestamp, to: Timestamp): number {
  const ms = Date.parse(to) - Date.parse(from);
  if (Number.isNaN(ms)) return 0;
  return ms / 86_400_000;
}

/** Owner paths, deduplicated and sorted - the input set for a fingerprint. */
export function ownerPaths(owners: SourceRef[]): string[] {
  return [...new Set(owners.map((o) => o.path))].sort();
}
