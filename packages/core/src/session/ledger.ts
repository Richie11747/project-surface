/**
 * The session ledger: what was run, what was served, and what that says about
 * the next run.
 *
 * The surface document remembers one verification per command - the latest -
 * because it is committed and must not change when nothing about the project
 * did. A session is the opposite kind of record: machine-local, append-only,
 * and interested precisely in repetition. Its one job is to let a tool say
 * "you already did this, and nothing has changed since" with the same
 * fingerprint discipline the trust model uses for freshness.
 *
 * Everything here is pure. Reading and writing the file lives in store.ts.
 */

import { hashContent } from "../model/freshness.js";
import { keywords } from "../analysis/context.js";
import type { ServedEntry } from "../analysis/context.js";
import type { Command, Timestamp, VerificationRecord } from "../schema/types.js";

export const MAX_ATTEMPTS = 200;
export const MAX_PACKS = 50;

export type SessionSource = "cli" | "mcp";

export interface Attempt {
  seq: number;
  at: Timestamp;
  source: SessionSource;
  commandId: string;
  run: string;
  cwd: string;
  /** Working-tree fingerprint at the time of the run; null outside git. */
  tree: string | null;
  commit?: string;
  dirty?: boolean;
  status: VerificationRecord["status"];
  exitCode?: number | null;
  /** Hash of the normalised failure output; null when the command passed. */
  signature: string | null;
  durationMs?: number;
}

export interface ServedFile {
  path: string;
  /** `${size}:${mtimeMs}` - a change key, not a content hash, so sizing a pack never opens a file. */
  key: string;
  tokens: number;
}

export interface PackRecord {
  seq: number;
  at: Timestamp;
  source: SessionSource;
  task: string;
  taskKey: string;
  tree: string | null;
  files: ServedFile[];
  usedTokens: number;
  savedTokens: number;
}

export interface SessionLedger {
  version: 1;
  startedAt: Timestamp;
  attempts: Attempt[];
  packs: PackRecord[];
}

export type LoopKind = "unchanged-rerun" | "same-failure" | "flapping";

export interface LoopSignal {
  kind: LoopKind;
  severity: "warn" | "info";
  commandId: string;
  /** Sequence numbers of the attempts the signal is drawn from, oldest first. */
  attempts: number[];
  message: string;
  advice: string;
}

export type AttemptInput = Omit<Attempt, "seq" | "at">;

/** The ledger's view of a command that is about to run, or has just run. */
export function attemptFrom(
  source: SessionSource,
  command: Pick<Command, "id" | "run" | "cwd">,
  tree: string | null,
  record?: VerificationRecord
): AttemptInput {
  return {
    source,
    commandId: command.id,
    run: command.run,
    cwd: command.cwd,
    tree,
    status: record?.status ?? "unknown",
    signature: record ? failureSignature(record) : null,
    ...(record?.commit ? { commit: record.commit } : {}),
    ...(record?.dirty !== undefined ? { dirty: record.dirty } : {}),
    ...(record?.exitCode !== undefined ? { exitCode: record.exitCode } : {}),
    ...(record?.durationMs !== undefined ? { durationMs: record.durationMs } : {}),
  };
}

export function emptyLedger(now: Timestamp): SessionLedger {
  return { version: 1, startedAt: now, attempts: [], packs: [] };
}

/**
 * Two failures are the same failure when their output is the same once the
 * parts that vary between identical runs are removed: durations, timestamps,
 * hashes and addresses, and line:column pairs that move when a file is edited
 * above the failing line without touching it.
 */
export function normaliseOutput(summary: string): string {
  return summary
    .replace(/\d+(?:\.\d+)? ?(?:ms|s|seconds?|milliseconds?)\b/g, "<t>")
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?/g, "<ts>")
    .replace(/\b[0-9a-f]{7,}\b/gi, "<hex>")
    .replace(/:\d+:\d+\b/g, ":<l>:<c>")
    .replace(/\s+/g, " ")
    .trim();
}

export function failureSignature(
  record: Pick<VerificationRecord, "status" | "exitCode" | "summary" | "reason">
): string | null {
  if (record.status === "passed") return null;
  const exit = record.exitCode === undefined || record.exitCode === null ? "none" : String(record.exitCode);
  return hashContent(`${record.status}\n${exit}\n${normaliseOutput(record.summary ?? record.reason ?? "")}`);
}

/** The same task asked twice in different words is still the same task. */
export function taskKey(task: string): string {
  return [...keywords(task)].sort().join(" ");
}

type CommandKey = Pick<Attempt, "commandId" | "run" | "cwd">;

function sameCommand(a: CommandKey, b: CommandKey): boolean {
  /* The id alone collides across stacks in a polyglot repository (#26). */
  return a.commandId === b.commandId && a.run === b.run && a.cwd === b.cwd;
}

function history(ledger: SessionLedger, command: CommandKey): Attempt[] {
  return ledger.attempts.filter((a) => sameCommand(a, command));
}

const SAME_FAILURE_RUNS = 3;
const FLAPPING_WINDOW = 4;

/**
 * What the ledger says about a run that is about to happen. Rules that need
 * the working-tree fingerprint are skipped, not guessed, when it is null.
 */
export function assessAttempt(ledger: SessionLedger, candidate: AttemptInput): LoopSignal[] {
  const signals: LoopSignal[] = [];
  const past = history(ledger, candidate);
  const last = past[past.length - 1];
  if (!last) return signals;

  if (
    candidate.tree !== null &&
    last.tree === candidate.tree &&
    (last.status === "failed" || last.status === "unknown")
  ) {
    signals.push({
      kind: "unchanged-rerun",
      severity: "warn",
      commandId: candidate.commandId,
      attempts: [last.seq],
      message:
        `${candidate.commandId} ${last.status === "failed" ? "failed" : "did not complete"} at attempt #${last.seq} ` +
        `and nothing in the working tree has changed since. Running it again will produce the same result.`,
      advice: "Change something first, or pass force to run it anyway.",
    });
  }

  return signals.concat(patternSignals(past, candidate.commandId));
}

/**
 * What the ledger says after a run was recorded - patterns across attempts
 * rather than a statement about the next one.
 */
export function assessHistory(ledger: SessionLedger, command: CommandKey): LoopSignal[] {
  return patternSignals(history(ledger, command), command.commandId);
}

function patternSignals(past: Attempt[], commandId: string): LoopSignal[] {
  const signals: LoopSignal[] = [];

  /* Same failure across different edits: the edits are not reaching it. */
  const tail = past.slice(-SAME_FAILURE_RUNS);
  const first = tail[0];
  if (first && tail.length === SAME_FAILURE_RUNS) {
    const identical = tail.every((a) => a.status === "failed" && a.signature !== null && a.signature === first.signature);
    const trees = new Set(tail.map((a) => a.tree ?? `unknown:${a.seq}`));
    if (identical && trees.size >= 2) {
      signals.push({
        kind: "same-failure",
        severity: "warn",
        commandId,
        attempts: tail.map((a) => a.seq),
        message:
          `The last ${tail.length} attempts of ${commandId} failed identically across ${trees.size} different ` +
          `edits; the edits are not reaching the failure.`,
        advice:
          "Read the failure output before editing again, then surface why <capability>, surface impact <paths>, " +
          "or the capability's contract to find where the behaviour is specified.",
      });
    }
  }

  /* Pass and fail on an identical tree: the result does not depend on the code. */
  const byTree = new Map<string, Attempt[]>();
  for (const a of past.slice(-FLAPPING_WINDOW)) {
    if (a.tree === null) continue;
    byTree.set(a.tree, [...(byTree.get(a.tree) ?? []), a]);
  }
  for (const group of byTree.values()) {
    const passed = group.some((a) => a.status === "passed");
    const failed = group.some((a) => a.status === "failed");
    if (passed && failed) {
      signals.push({
        kind: "flapping",
        severity: "info",
        commandId,
        attempts: group.map((a) => a.seq),
        message:
          `${commandId} passed and failed on an identical working tree (attempts ${group
            .map((a) => `#${a.seq}`)
            .join(", ")}): the result does not depend on the code.`,
        advice: "Treat it as flaky, not as proof; a passing run on the same tree proves nothing a failing one disproved.",
      });
      break;
    }
  }

  return signals;
}

function nextSeq(ledger: SessionLedger): number {
  const last = Math.max(0, ...ledger.attempts.map((a) => a.seq), ...ledger.packs.map((p) => p.seq));
  return last + 1;
}

export function appendAttempt(
  ledger: SessionLedger,
  input: AttemptInput,
  now: Timestamp
): { ledger: SessionLedger; attempt: Attempt } {
  const attempt: Attempt = { seq: nextSeq(ledger), at: now, ...input };
  const attempts = [...ledger.attempts, attempt].slice(-MAX_ATTEMPTS);
  return { ledger: { ...ledger, attempts }, attempt };
}

export function appendPack(
  ledger: SessionLedger,
  input: Omit<PackRecord, "seq" | "at">,
  now: Timestamp
): { ledger: SessionLedger; pack: PackRecord } {
  const pack: PackRecord = { seq: nextSeq(ledger), at: now, ...input };
  const packs = [...ledger.packs, pack].slice(-MAX_PACKS);
  return { ledger: { ...ledger, packs }, pack };
}

/** The most recent change key under which each path was served, so a pack can skip what has not changed. */
export function servedIndex(ledger: SessionLedger): Map<string, ServedEntry> {
  const index = new Map<string, ServedEntry>();
  for (const pack of ledger.packs) {
    for (const file of pack.files) index.set(file.path, { key: file.key, seq: pack.seq });
  }
  return index;
}

export interface SessionSummary {
  startedAt: Timestamp;
  attempts: number;
  failed: number;
  packs: number;
  tokensServed: number;
  tokensSaved: number;
  /** Signals that hold for the latest attempt of each command. */
  signals: LoopSignal[];
  /** Paths served most often, most first. */
  frequent: Array<{ path: string; times: number }>;
  treeKnown: boolean;
}

export function sessionSummary(ledger: SessionLedger): SessionSummary {
  const seen = new Set<string>();
  const signals: LoopSignal[] = [];
  for (const attempt of [...ledger.attempts].reverse()) {
    const key = `${attempt.commandId}\n${attempt.run}\n${attempt.cwd}`;
    if (seen.has(key)) continue;
    seen.add(key);
    signals.push(...assessAttempt(ledger, attempt));
  }
  const counts = new Map<string, number>();
  for (const pack of ledger.packs) for (const f of pack.files) counts.set(f.path, (counts.get(f.path) ?? 0) + 1);
  const frequent = [...counts.entries()]
    .map(([path, times]) => ({ path, times }))
    .sort((a, b) => b.times - a.times || a.path.localeCompare(b.path))
    .slice(0, 5);
  return {
    startedAt: ledger.startedAt,
    attempts: ledger.attempts.length,
    failed: ledger.attempts.filter((a) => a.status === "failed").length,
    packs: ledger.packs.length,
    tokensServed: ledger.packs.reduce((n, p) => n + p.usedTokens, 0),
    tokensSaved: ledger.packs.reduce((n, p) => n + p.savedTokens, 0),
    signals: signals.sort((a, b) => a.commandId.localeCompare(b.commandId) || a.kind.localeCompare(b.kind)),
    frequent,
    treeKnown: ledger.attempts.some((a) => a.tree !== null) || ledger.packs.some((p) => p.tree !== null),
  };
}

/** One line for the foot of a tool result. */
export function renderSessionLine(summary: SessionSummary): string {
  const parts = [`${summary.attempts} run${summary.attempts === 1 ? "" : "s"}`];
  if (summary.failed > 0) parts.push(`${summary.failed} failed`);
  parts.push(`${summary.packs} context pack${summary.packs === 1 ? "" : "s"}`);
  if (summary.tokensSaved > 0) parts.push(`~${summary.tokensSaved} tokens not repeated`);
  const warnings = summary.signals.filter((s) => s.severity === "warn").length;
  if (warnings > 0) parts.push(`${warnings} loop warning${warnings === 1 ? "" : "s"}`);
  return `Session: ${parts.join(", ")}.`;
}
