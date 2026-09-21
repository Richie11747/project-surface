/**
 * `surface gate` - does this change carry proof?
 *
 * For every capability a change touches, say whether its evidence was
 * produced against this very commit, carried over unchanged files, or is
 * missing, stale or failing. Exit `2` unless every touched capability passes
 * and no rule is broken, so a pull request cannot merge on "tests pass"
 * alone - it merges on "the behaviours I touched are proven here".
 *
 * `--verify` runs the missing proofs first, through the same path as
 * `surface verify`, then judges. `--format markdown` is the receipt the
 * GitHub Action posts; CI recomputes it, so a pasted receipt cannot lie.
 */

import { parseArgs } from "node:util";
import {
  changedSince,
  commandsProving,
  gateChange,
  headState,
  renderGateMarkdown,
  stagedPaths,
} from "@project-surface/core";
import type { GateReport, GateVerdict } from "@project-surface/core";
import { GLOBAL_OPTIONS, requireSurface, CliError, type GlobalOptions } from "../context.js";
import { bullet, heading, print, printJson, style } from "../output.js";
import { recordRuns } from "../verification.js";

export async function run(args: string[], options: GlobalOptions): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    strict: true,
    options: {
      ...GLOBAL_OPTIONS,
      since: { type: "string" },
      staged: { type: "boolean", default: false },
      strict: { type: "boolean", default: false },
      verify: { type: "boolean", default: false },
      format: { type: "string" },
      timeout: { type: "string" },
    },
  });

  const format = values.format ?? (options.json ? "json" : "text");
  if (format !== "text" && format !== "json" && format !== "markdown") {
    throw new CliError(`Unknown format "${format}". Use text, json or markdown.`);
  }

  let surface = requireSurface(options);
  const strict = values.strict === true;
  const { paths, base } = changeSet(options.root, values, positionals);
  let report = gateChange(surface, paths, base, { ...anchor(options.root), strict });
  const ran: string[] = [];

  if (values.verify === true && paths.length > 0) {
    /* Prove what is not yet proven at this commit, then judge again. What
       counts as "not yet" follows the strictness: `carried` is good enough
       unless --strict says otherwise. */
    const needs = report.capabilities.filter((g) =>
      strict ? g.verdict !== "proven" : g.verdict !== "proven" && g.verdict !== "carried"
    );
    const targets = surface.capabilities.filter((c) => needs.some((g) => g.id === c.id));
    const selection = commandsProving(surface, targets);
    if (selection.commands.length > 0) {
      if (format === "text") {
        print(heading(`Proving ${needs.length} capabilit${needs.length === 1 ? "y" : "ies"} via ${selection.commands.length} command(s)`));
      }
      const timeoutMs = typeof values.timeout === "string" ? Number(values.timeout) * 1000 : undefined;
      const runs = await recordRuns(options.root, surface, selection.commands, {
        ...(timeoutMs && Number.isFinite(timeoutMs) ? { timeoutMs } : {}),
        onStart: (command) => {
          if (format === "text") print(`${style.dim("running")} ${style.bold(command.id)}  ${command.run}`);
        },
        onDone: ({ record }) => {
          if (format === "text") print(`  ${label(record.status)} ${style.dim(`${record.durationMs ?? 0} ms`)}`);
        },
      });
      ran.push(...runs.results.map((r) => r.command.id));
      if (format === "text") {
        for (const w of runs.warnings) print(style.yellow(`  ${w}`));
        print("");
      }
      if (runs.rebuilt) surface = runs.rebuilt;
      report = gateChange(surface, paths, base, { ...anchor(options.root), strict });
    }
  }

  emit(report, format, ran);
  return report.pass ? 0 : 2;
}

function anchor(root: string): { head?: string; dirty?: boolean } {
  const head = headState(root);
  if (!head) return {};
  return { ...(head.commit ? { head: head.commit } : {}), dirty: head.dirty };
}

/** The change under judgement: since a ref (default `main`), the staged set, or explicit paths. */
function changeSet(root: string, values: Record<string, unknown>, positionals: string[]): { paths: string[]; base: string } {
  if (values.staged === true) return { paths: stagedPaths(root), base: "staged" };
  if (positionals.length > 0) return { paths: positionals, base: "paths" };
  const ref = typeof values.since === "string" ? values.since : "main";
  const changed = changedSince(root, ref);
  if (changed === null) {
    throw new CliError(`Could not diff against "${ref}". Pass --since <ref> with a valid git ref, --staged, or explicit paths.`);
  }
  return { paths: changed, base: ref };
}

function emit(report: GateReport, format: string, ran: string[]): void {
  if (format === "json") {
    printJson({ ...report, ran });
    return;
  }
  if (format === "markdown") {
    process.stdout.write(renderGateMarkdown(report));
    return;
  }

  const at = report.head ? ` at ${style.bold(report.head.slice(0, 7))}${report.dirty ? style.dim(" (dirty tree)") : ""}` : "";
  const n = report.capabilities.length;
  print(heading(`Proof of change since ${report.base}${at}`));
  print(style.dim(`  ${report.changedPaths.length} changed path(s), ${n} capabilit${n === 1 ? "y" : "ies"} touched${report.strict ? ", strict" : ""}`));
  print("");

  if (n > 0) {
    for (const g of report.capabilities) print(`  ${verdict(g.verdict)}  ${style.bold(g.id)} ${style.dim(`(${g.relation})`)}`);
    print("");
    const detail = report.capabilities.filter((g) => g.verdict !== "proven");
    for (const g of detail) {
      print(`  ${style.bold(g.id)}`);
      for (const r of g.reasons) print(style.dim(`    ${r}`));
    }
    if (detail.length > 0) print("");
  }

  if (report.blocking.length > 0) {
    print(heading("Blocking"));
    for (const b of report.blocking) print(bullet(b));
    print("");
  }
  if (report.notes.length > 0) {
    print(heading("Worth a look"));
    for (const x of report.notes) print(bullet(x));
    print("");
  }

  const summary = Object.entries(report.counts)
    .filter(([, count]) => count > 0)
    .map(([v, count]) => `${count} ${v}`)
    .join(", ");
  if (report.pass) {
    print(`  ${style.green("passes")}${summary ? style.dim(`  ${summary}`) : ""}`);
  } else {
    print(`  ${style.red("does not pass")}${summary ? style.dim(`  ${summary}`) : ""}`);
    if (ran.length === 0) print(style.dim("  Run with --verify to prove what is missing at this commit."));
  }
}

function verdict(v: GateVerdict): string {
  const padded = v.padEnd(8);
  if (v === "proven") return style.green(padded);
  if (v === "carried") return style.cyan(padded);
  if (v === "stale") return style.yellow(padded);
  return style.red(padded);
}

function label(status: string): string {
  if (status === "passed") return style.green("passed");
  if (status === "failed") return style.red("failed");
  return style.yellow(status);
}
