/**
 * `surface session` - what this machine has run and served, and what that
 * says about the next run.
 *
 * The ledger behind it is machine-local (`.project/session.local.json`) and
 * never part of the surface document: it records repetition, which is exactly
 * what a committed, deterministic artifact must not contain.
 */

import { parseArgs } from "node:util";
import { SESSION_FILE, nowIso, readLedger, resetLedger, sessionSummary } from "@project-surface/core";
import type { LoopSignal } from "@project-surface/core";
import { GLOBAL_OPTIONS, type GlobalOptions } from "../context.js";
import { bullet, heading, print, printJson, style, table } from "../output.js";

export async function run(args: string[], options: GlobalOptions): Promise<number> {
  const { values } = parseArgs({
    args,
    strict: true,
    options: { ...GLOBAL_OPTIONS, reset: { type: "boolean", default: false } },
  });

  if (values.reset) {
    const existed = resetLedger(options.root);
    if (options.json) printJson({ reset: existed });
    else print(existed ? `Forgot the session (${SESSION_FILE}).` : style.dim("No session to forget."));
    return 0;
  }

  const ledger = readLedger(options.root, nowIso());
  const summary = sessionSummary(ledger);

  if (options.json) {
    printJson({ ...summary, attempts: ledger.attempts, packs: ledger.packs });
    return 0;
  }

  print(heading("Session"));
  print("");
  if (ledger.attempts.length === 0 && ledger.packs.length === 0) {
    print(style.dim("  Nothing recorded yet. surface verify and surface context --delta write here."));
    return 0;
  }
  print(
    `  started ${style.dim(summary.startedAt)}` +
      (summary.treeKnown ? "" : style.dim("  (tree state unknown outside git)"))
  );
  print("");

  if (ledger.attempts.length > 0) {
    print(heading("  Runs"));
    print(
      table(
        ledger.attempts.map((a) => [
          `    #${a.seq}`,
          style.bold(a.commandId),
          statusStyle(a.status),
          a.exitCode === null || a.exitCode === undefined ? style.dim("-") : `exit ${a.exitCode}`,
          style.dim(a.tree ? a.tree.slice(0, 8) : "no-tree"),
          style.dim(a.commit ? `${a.commit.slice(0, 7)}${a.dirty ? "*" : ""}` : ""),
          style.dim(a.at),
        ])
      )
    );
    print("");
  }

  if (summary.signals.length > 0) {
    print(heading("  Signals"));
    for (const signal of summary.signals) printSignal(signal);
    print("");
  }

  if (ledger.packs.length > 0) {
    print(heading("  Context packs"));
    print(
      `    ${summary.packs} served, ~${summary.tokensServed} tokens` +
        (summary.tokensSaved > 0 ? `, ~${summary.tokensSaved} not repeated` : "")
    );
    for (const f of summary.frequent) print(bullet(`${f.path} ${style.dim(`x${f.times}`)}`));
    print("");
  }

  print(style.dim(`  ${SESSION_FILE} - machine-local; surface session --reset forgets it.`));
  return 0;
}

function statusStyle(status: string): string {
  if (status === "passed") return style.green(status);
  if (status === "failed") return style.red(status);
  return style.yellow(status);
}

function printSignal(signal: LoopSignal): void {
  const colour = signal.severity === "warn" ? style.yellow : style.dim;
  print(`    ${colour(signal.severity.padEnd(6))} ${style.bold(signal.kind)} ${style.dim(`[${signal.commandId}]`)}`);
  print(`        ${signal.message}`);
  print(style.dim(`        ${signal.advice}`));
}
