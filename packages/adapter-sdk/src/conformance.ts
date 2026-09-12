/**
 * The adapter conformance suite.
 *
 * Any adapter, first-party or third-party, must pass this before it can be
 * trusted in the ecosystem. The checks are not about extraction quality - an
 * adapter is free to find little. They are about the properties every consumer
 * of a surface document relies on:
 *
 *   provenance   every claim says where it came from
 *   portability  no absolute paths, no machine identity, no backslashes
 *   determinism  the same project produces byte-identical output
 *   honesty      a discovered test is `unknown`, not `passed`
 *
 * Determinism is the one contributors break most often, usually by calling
 * `Date.now()` or by iterating a Set built from unsorted input. That is exactly
 * why it is checked mechanically rather than trusted.
 */

import { createAdapterContext, readGitInfo, walkProject } from "@project-surface/core";
import type { Adapter, AdapterResult, Provenance } from "@project-surface/core";

/** Fixed so a determinism failure cannot be blamed on the clock. */
export const CONFORMANCE_NOW = "2026-01-01T00:00:00Z";

const IDENTIFIER = /^[a-z0-9][a-z0-9._:/-]*$/;

export interface ConformanceCheck {
  name: string;
  passed: boolean;
  detail?: string;
}

export interface ConformanceResult {
  adapter: string;
  passed: boolean;
  checks: ConformanceCheck[];
  failures: string[];
}

interface ClaimLike {
  provenance: Provenance;
}

function allClaims(result: AdapterResult): Array<{ kind: string; id: string; claim: ClaimLike }> {
  const out: Array<{ kind: string; id: string; claim: ClaimLike }> = [];
  for (const c of result.commands ?? []) out.push({ kind: "command", id: c.id, claim: c });
  for (const c of result.capabilities ?? []) out.push({ kind: "capability", id: c.id, claim: c });
  for (const c of result.constraints ?? []) out.push({ kind: "constraint", id: c.id, claim: c });
  for (const c of result.risks ?? []) out.push({ kind: "risk", id: c.id, claim: c });
  for (const c of result.evidence ?? []) out.push({ kind: "evidence", id: c.id, claim: c });
  for (const c of result.environment ?? []) out.push({ kind: "environment", id: c.name, claim: c });
  return out;
}

function collectPaths(result: AdapterResult): string[] {
  const paths: string[] = [];
  for (const { claim } of allClaims(result)) paths.push(...claim.provenance.sources.map((s) => s.path));
  for (const c of result.capabilities ?? []) {
    paths.push(...c.owners.map((o) => o.path), ...c.contracts.map((o) => o.path));
  }
  for (const e of result.evidence ?? []) if (e.path) paths.push(e.path);
  for (const r of result.risks ?? []) paths.push(...r.paths);
  for (const p of result.packages ?? []) paths.push(p.path);
  return paths;
}

function badPath(path: string): string | null {
  if (path.startsWith("/")) return "is absolute";
  if (/^[A-Za-z]:/.test(path)) return "has a drive letter";
  if (path.includes("\u005c")) return "contains a backslash";
  if (path.startsWith("~")) return "is home-relative";
  if (/(^|\/)\.\.(\/|$)/.test(path)) return "traverses upward";
  return null;
}

export async function runConformance(adapter: Adapter, fixtureRoot: string): Promise<ConformanceResult> {
  const checks: ConformanceCheck[] = [];
  const add = (name: string, passed: boolean, detail?: string): void => {
    checks.push({ name, passed, ...(detail ? { detail } : {}) });
  };

  const git = readGitInfo(fixtureRoot);
  const walk = walkProject(fixtureRoot);
  const makeContext = (): ReturnType<typeof createAdapterContext> =>
    createAdapterContext({ root: fixtureRoot, files: walk.files, git, now: CONFORMANCE_NOW });

  add("adapter declares an id", IDENTIFIER.test(adapter.id), adapter.id);
  add("adapter declares a version", typeof adapter.version === "string" && adapter.version.length > 0);

  const detected = await adapter.detect(makeContext());
  add("detect() returns a boolean", typeof detected === "boolean");
  if (!detected) {
    return finish(adapter.id, [...checks, { name: "detect() matched the fixture", passed: false, detail: "Adapter did not recognise the fixture project." }]);
  }
  add("detect() matched the fixture", true);

  const first = await adapter.extract(makeContext());
  add("stack.id matches adapter.id", first.stack.id === adapter.id, `${first.stack.id} vs ${adapter.id}`);
  add(
    "stack reports toolchain availability",
    typeof first.stack.toolchainAvailable === "boolean"
  );

  const claims = allClaims(first);
  const withoutSources = claims.filter((c) => (c.claim.provenance.sources ?? []).length === 0);
  add(
    "every claim has at least one source",
    withoutSources.length === 0,
    withoutSources.map((c) => `${c.kind}:${c.id}`).join(", ")
  );

  const badIds = claims.filter((c) => c.kind !== "environment" && !IDENTIFIER.test(c.id));
  add("every id matches the identifier pattern", badIds.length === 0, badIds.map((c) => c.id).join(", "));

  const pathProblems = collectPaths(first)
    .map((p) => ({ p, why: badPath(p) }))
    .filter((x) => x.why !== null);
  add(
    "every path is project-relative and POSIX",
    pathProblems.length === 0,
    pathProblems.slice(0, 5).map((x) => `${x.p} ${x.why}`).join("; ")
  );

  const serialized = JSON.stringify(first);
  const rootLeak = serialized.includes(fixtureRoot) || serialized.includes(fixtureRoot.replace(/\\/g, "/"));
  add("output does not leak the absolute root", !rootLeak);

  const dishonest = (first.evidence ?? []).filter((e) => e.status === "passed");
  add(
    "statically discovered evidence is not reported as passed",
    dishonest.length === 0,
    dishonest.map((e) => e.id).join(", ")
  );

  const second = await adapter.extract(makeContext());
  const deterministic = JSON.stringify(first) === JSON.stringify(second);
  add(
    "two runs produce identical output",
    deterministic,
    deterministic ? undefined : "Adapter output varies between runs. Check for Date.now(), unsorted iteration, or random ids."
  );

  return finish(adapter.id, checks);
}

function finish(adapterId: string, checks: ConformanceCheck[]): ConformanceResult {
  const failures = checks
    .filter((c) => !c.passed)
    .map((c) => (c.detail ? `${c.name}: ${c.detail}` : c.name));
  return { adapter: adapterId, passed: failures.length === 0, checks, failures };
}

/** Throwing wrapper, for use directly inside a `node:test` case. */
export async function assertConformance(adapter: Adapter, fixtureRoot: string): Promise<void> {
  const result = await runConformance(adapter, fixtureRoot);
  if (!result.passed) {
    throw new Error(
      `Adapter "${result.adapter}" failed conformance:\n  - ${result.failures.join("\n  - ")}`
    );
  }
}
