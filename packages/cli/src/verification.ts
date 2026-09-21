/**
 * Run recorded commands and fold the results into the document.
 *
 * Shared by `surface verify` and `surface gate --verify`, so both record the
 * same thing the same way: the observation, the commit it was taken at, and
 * then a rebuild through the pipeline - which is what turns a passing test
 * into capability confidence and moves the freshness anchor.
 */

import {
  appendAttempt,
  assessAttempt,
  assessHistory,
  attemptFrom,
  buildSurface,
  headState,
  nowIso,
  readLedger,
  runCommand,
  workingTreeFingerprint,
  writeLedger,
  writeSurface,
} from "@project-surface/core";
import type { Command, LoopSignal, Surface, VerificationRecord } from "@project-surface/core";
import { builtinAdapters } from "./adapters.js";

export interface RunOutcome {
  command: Command;
  record: VerificationRecord;
}

export interface SkippedRun {
  command: Command;
  signal: LoopSignal;
}

export interface RecordedRuns {
  now: string;
  results: RunOutcome[];
  /** Commands not run because the session said the result could not differ (`--if-changed`). */
  skipped: SkippedRun[];
  /** What the session ledger said before the runs, and what it says about the history after them. */
  signals: { before: LoopSignal[]; after: LoopSignal[] };
  /** The document after the pipeline folded the results in; absent when the rebuild failed, or nothing ran. */
  rebuilt?: Surface;
  warnings: string[];
}

export interface RecordOptions {
  timeoutMs?: number;
  /**
   * Skip a command whose last recorded attempt failed on a working tree with
   * this exact fingerprint: nothing changed, so nothing can change.
   */
  ifChanged?: boolean;
  /** Called once with what the session ledger says, before the first command starts. */
  onSignals?: (signals: LoopSignal[]) => void;
  /** Called before each command starts, and after it finishes. For progress output. */
  onStart?: (command: Command) => void;
  onDone?: (outcome: RunOutcome) => void;
}

export async function recordRuns(
  root: string,
  surface: Surface,
  commands: readonly Command[],
  options: RecordOptions = {}
): Promise<RecordedRuns> {
  const now = nowIso();
  /* Read once, before anything runs: a command that touches the tree must not
     change what the record says the tree was. */
  const head = headState(root);
  const tree = workingTreeFingerprint(root);
  let ledger = readLedger(root, now);
  const results: RunOutcome[] = [];
  const skipped: SkippedRun[] = [];
  const before: LoopSignal[] = [];

  /* The ledger speaks before anything runs: it knows the tree this run would
     see and what the last run on that same tree produced. */
  const toRun: Command[] = [];
  for (const command of commands) {
    const signals = assessAttempt(ledger, attemptFrom("cli", command, tree));
    before.push(...signals);
    const unchanged = signals.find((s) => s.kind === "unchanged-rerun");
    if (options.ifChanged && unchanged) skipped.push({ command, signal: unchanged });
    else toRun.push(command);
  }
  if (toRun.length === 0) {
    return { now, results, skipped, signals: { before, after: [] }, warnings: [] };
  }
  options.onSignals?.(before);

  for (const command of toRun) {
    options.onStart?.(command);
    const observed = runCommand(root, command, {
      now,
      ...(options.timeoutMs && Number.isFinite(options.timeoutMs) ? { timeoutMs: options.timeoutMs } : {}),
    });
    const record: VerificationRecord = head
      ? { ...observed, ...(head.commit ? { commit: head.commit } : {}), dirty: head.dirty }
      : observed;
    const outcome = { command, record };
    results.push(outcome);
    /* Written after every command, not once at the end, so an interrupted
       batch still leaves the attempts it made on record. */
    ledger = appendAttempt(ledger, attemptFrom("cli", command, tree, record), now).ledger;
    writeLedger(root, ledger);
    options.onDone?.(outcome);
  }
  const after = toRun.flatMap((command) => assessHistory(ledger, attemptFrom("cli", command, tree)));

  const updated: Surface = {
    ...surface,
    commands: surface.commands.map((c) => {
      const result = results.find((r) => r.command.id === c.id);
      return result ? { ...c, verification: result.record } : c;
    }),
    evidence: surface.evidence.map((e) => {
      const result = results.find((r) => r.command.id === e.commandId);
      if (!result) return e;
      return {
        ...e,
        status: result.record.status === "passed" ? "passed" : result.record.status === "failed" ? "failed" : e.status,
        observedAt: result.record.observedAt,
        ...(result.record.summary ? { summary: result.record.summary } : {}),
      };
    }),
  };
  /* Recording a result is only half the job. The pipeline is what turns a
     passing test into capability confidence and anchors the freshness
     fingerprint, so rebuild from the updated document rather than leaving that
     to the next `init`. If the rebuild fails, the raw results are still saved. */
  writeSurface(root, updated);
  const warnings: string[] = [];
  let rebuilt: Surface | undefined;
  try {
    const rebuild = await buildSurface({ root, adapters: builtinAdapters, previous: updated, now });
    warnings.push(...rebuild.warnings);
    writeSurface(root, rebuild.surface);
    rebuilt = rebuild.surface;
  } catch (error) {
    warnings.push(
      `Results were recorded, but the surface could not be rebuilt: ${(error as Error).message}. ` +
        `Run surface init to propagate them.`
    );
  }

  return { now, results, skipped, signals: { before, after }, ...(rebuilt ? { rebuilt } : {}), warnings };
}
