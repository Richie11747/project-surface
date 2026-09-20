/**
 * Run recorded commands and fold the results into the document.
 *
 * Shared by `surface verify` and `surface gate --verify`, so both record the
 * same thing the same way: the observation, the commit it was taken at, and
 * then a rebuild through the pipeline - which is what turns a passing test
 * into capability confidence and moves the freshness anchor.
 */

import { buildSurface, headState, nowIso, runCommand, writeSurface } from "@project-surface/core";
import type { Command, Surface, VerificationRecord } from "@project-surface/core";
import { builtinAdapters } from "./adapters.js";

export interface RunOutcome {
  command: Command;
  record: VerificationRecord;
}

export interface RecordedRuns {
  now: string;
  results: RunOutcome[];
  /** The document after the pipeline folded the results in; absent when the rebuild failed. */
  rebuilt?: Surface;
  warnings: string[];
}

export interface RecordOptions {
  timeoutMs?: number;
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
  const results: RunOutcome[] = [];

  for (const command of commands) {
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
    options.onDone?.(outcome);
  }

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

  return { now, results, ...(rebuilt ? { rebuilt } : {}), warnings };
}
