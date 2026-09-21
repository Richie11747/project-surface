/**
 * `surface verify` - turn claims into observations.
 *
 * This is the only command that executes anything, and it can only execute
 * commands already present in the surface document. The results are written
 * back, which is what promotes a capability from `derived` to `verified` and
 * starts the freshness clock against its owner files.
 *
 * Selection is the interesting part. `--command` and `--all` name commands
 * directly; `--capability`, `--stale` and a change set (`--since`, `--staged`,
 * paths) name *claims*, and the document says which commands prove them. That
 * is what closes the loop: `doctor` reports a claim as stale, `verify --stale`
 * runs exactly the commands that re-prove it, and the freshness anchor moves.
 */

import { parseArgs } from "node:util";
import {
  analyzeImpact,
  changedSince,
  commandsForStale,
  commandsProving,
  resolveAllowedCommand,
  stagedPaths,
} from "@project-surface/core";
import type { Command, CommandSelection, Surface, VerificationRecord } from "@project-surface/core";
import { GLOBAL_OPTIONS, requireSurface, CliError, type GlobalOptions } from "../context.js";
import { bullet, heading, print, printJson, style } from "../output.js";
import { recordRuns } from "../verification.js";

type SelectionMode = "command" | "all" | "capability" | "stale" | "change";

interface Selection {
  mode: SelectionMode;
  commands: Command[];
  /** Capabilities that led to the selection, when it was made by claim. */
  capabilities: CommandSelection["capabilities"];
  /** Changed paths, when the selection was made from a change set. */
  paths: string[];
  /** Why nothing was selected, when that is a normal outcome rather than an error. */
  empty?: string;
}

export async function run(args: string[], options: GlobalOptions): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    strict: true,
    options: {
      ...GLOBAL_OPTIONS,
      command: { type: "string", multiple: true },
      capability: { type: "string" },
      all: { type: "boolean", default: false },
      stale: { type: "boolean", default: false },
      since: { type: "string" },
      staged: { type: "boolean", default: false },
      timeout: { type: "string" },
    },
  });

  const surface = requireSurface(options);
  const selection = select(surface, options.root, values, positionals);

  if (selection.commands.length === 0) {
    if (selection.empty) {
      /* Nothing stale, or nothing affected, is a clean result - CI runs
         `verify --stale` unconditionally and must not fail on a quiet day. */
      if (options.json) {
        printJson({ selection: describe(selection), results: [], refreshed: [], stillStale: [], warnings: [] });
      } else {
        print(style.dim(`  ${selection.empty}`));
      }
      return 0;
    }
    throw new CliError(
      "Nothing to verify. Pass --command <id>, --capability <id>, --stale, --since <ref>, --staged, paths, or --all.\n" +
        `Known commands: ${surface.commands.map((c) => c.id).join(", ") || "none"}`
    );
  }

  if (!options.json) announce(selection);

  const timeoutMs = typeof values.timeout === "string" ? Number(values.timeout) * 1000 : undefined;
  const { results, rebuilt, warnings } = await recordRuns(options.root, surface, selection.commands, {
    ...(timeoutMs && Number.isFinite(timeoutMs) ? { timeoutMs } : {}),
    onStart: (command) => {
      if (!options.json) print(`${style.dim("running")} ${style.bold(command.id)}  ${command.run}`);
    },
    onDone: ({ record }) => {
      if (!options.json) print(`  ${label(record.status)} ${style.dim(`${record.durationMs ?? 0} ms`)}`);
    },
  });

  /* Which of the claims we set out to re-prove are fresh now. Only meaningful
     for a selection made by claim; `--command` names no claim to report on. */
  const watched = selection.capabilities.map((c) => c.id);
  const freshnessOf = (id: string): string | undefined =>
    rebuilt?.capabilities.find((c) => c.id === id)?.freshness?.status;
  const refreshed = rebuilt ? watched.filter((id) => freshnessOf(id) === "fresh") : [];
  const stillStale = rebuilt ? watched.filter((id) => freshnessOf(id) === "stale") : [];

  if (options.json) {
    printJson({
      selection: describe(selection),
      results: results.map((r) => ({ id: r.command.id, run: r.command.run, ...r.record })),
      refreshed,
      stillStale,
      warnings,
    });
  } else {
    print("");
    print(heading("Recorded"));
    for (const { command, record } of results) {
      print(`  ${label(record.status)} ${command.id}${anchor(record)}`);
      if (record.status === "failed" && record.summary) {
        print(style.dim(indent(record.summary.split("\n").slice(-6).join("\n"))));
      }
      if (record.reason) print(style.dim(`      ${record.reason}`));
    }
    if (watched.length > 0 && rebuilt) {
      print("");
      const noun = watched.length === 1 ? "capability is" : "capabilities are";
      const state = selection.mode === "stale" ? "fresh again" : "fresh";
      print(`  ${style.green(String(refreshed.length))} of ${watched.length} ${noun} ${state}`);
      for (const id of stillStale) print(bullet(`${id} ${style.dim("- still stale: its commands did not pass")}`));
    }
    for (const w of warnings) print(style.yellow(`  ${w}`));
    print("");
    print(style.dim("  Capability confidence and freshness updated. See: surface inspect"));
  }

  return results.some((r) => r.record.status === "failed") ? 2 : 0;
}

function select(surface: Surface, root: string, values: Record<string, unknown>, positionals: string[]): Selection {
  const none: Pick<Selection, "capabilities" | "paths"> = { capabilities: [], paths: [] };

  if (values.all === true) {
    return {
      mode: "all",
      ...none,
      commands: surface.commands.filter((c) => c.kind === "test" || c.kind === "build" || c.kind === "typecheck"),
    };
  }

  const ids = Array.isArray(values.command) ? (values.command as string[]) : [];
  if (ids.length > 0) return { mode: "command", ...none, commands: ids.map((id) => resolveAllowedCommand(surface, id)) };

  if (typeof values.capability === "string") {
    const capability = surface.capabilities.find((c) => c.id === values.capability);
    if (!capability) throw new CliError(`No capability "${values.capability}".`);
    const chosen = commandsProving(surface, [capability]);
    return { mode: "capability", commands: chosen.commands, capabilities: chosen.capabilities, paths: [] };
  }

  if (values.stale === true) {
    const chosen = commandsForStale(surface);
    return {
      mode: "stale",
      commands: chosen.commands,
      capabilities: chosen.capabilities,
      paths: [],
      ...(chosen.capabilities.length === 0
        ? { empty: "Nothing is stale. Every verified claim still matches its owner files." }
        : {}),
    };
  }

  const paths = changedPaths(root, values, positionals);
  if (paths !== null) {
    if (paths.length === 0) return { mode: "change", ...none, commands: [], empty: "No changed paths, so nothing to re-prove." };
    /* Impact already answers "what should I run for this change": the commands
       bound to affected evidence, plus the test command of each affected
       package - or every test command when nothing is known to depend on the
       paths, which is the conservative reading and is said out loud in
       `announce`. */
    const report = analyzeImpact(surface, paths);
    const chosen = commandsProving(surface, report.capabilities.map((i) => i.capability));
    return {
      mode: "change",
      commands: report.commands,
      capabilities: chosen.capabilities,
      paths: report.changedPaths,
    };
  }

  return { mode: "command", ...none, commands: [] };
}

/** Explicit paths, the staged set, or everything since a ref; null when none was asked for. */
function changedPaths(root: string, values: Record<string, unknown>, positionals: string[]): string[] | null {
  if (values.staged === true) return stagedPaths(root);
  if (typeof values.since === "string") {
    const changed = changedSince(root, values.since);
    if (changed === null) throw new CliError(`Could not diff against "${values.since}". Is it a valid git ref?`);
    return changed;
  }
  if (positionals.length > 0) return positionals;
  return null;
}

function announce(selection: Selection): void {
  const n = selection.commands.length;
  const commands = `${n} command${n === 1 ? "" : "s"}`;
  const c = selection.capabilities.length;
  if (selection.mode === "stale") {
    print(heading(`Re-proving ${c} stale ${c === 1 ? "capability" : "capabilities"} via ${commands}`));
  } else if (selection.mode === "change") {
    print(heading(`Verifying ${commands} for ${selection.paths.length} changed path(s)`));
    if (c === 0) print(style.dim("  No capability is known to depend on these paths; running every test command."));
  } else if (selection.mode === "capability") {
    print(heading(`Verifying ${selection.capabilities[0]?.id ?? ""} via ${commands}`));
  }
  const fallbacks = selection.capabilities.filter((x) => x.fallback);
  if (fallbacks.length > 0 && selection.mode !== "change") {
    print(
      style.dim(`  ${fallbacks.length} of ${c} have no evidence bound to a command; using the package test command.`)
    );
  }
  if (selection.mode !== "command" && selection.mode !== "all") print("");
}

function describe(selection: Selection): Record<string, unknown> {
  return {
    mode: selection.mode,
    commandIds: selection.commands.map((c) => c.id),
    capabilities: selection.capabilities,
    ...(selection.paths.length > 0 ? { paths: selection.paths } : {}),
  };
}

function anchor(record: VerificationRecord): string {
  if (!record.commit) return "";
  return style.dim(`  at ${record.commit.slice(0, 7)}${record.dirty ? " (dirty tree)" : ""}`);
}

function label(status: string): string {
  if (status === "passed") return style.green("passed");
  if (status === "failed") return style.red("failed");
  return style.yellow(status);
}

function indent(text: string): string {
  return text
    .split("\n")
    .map((l) => `      ${l}`)
    .join("\n");
}
