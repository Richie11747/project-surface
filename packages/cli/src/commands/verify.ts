/**
 * `surface verify` - turn claims into observations.
 *
 * This is the only command that executes anything, and it can only execute
 * commands already present in the surface document. The results are written
 * back, which is what promotes a capability from `derived` to `verified` and
 * starts the freshness clock against its owner files.
 */

import { parseArgs } from "node:util";
import {
  buildSurface,
  nowIso,
  resolveAllowedCommand,
  runCommand,
  writeSurface,
} from "@project-surface/core";
import type { Command, Surface, VerificationRecord } from "@project-surface/core";
import { builtinAdapters } from "../adapters.js";
import { GLOBAL_OPTIONS, requireSurface, CliError, type GlobalOptions } from "../context.js";
import { heading, print, printJson, style } from "../output.js";

export async function run(args: string[], options: GlobalOptions): Promise<number> {
  const { values } = parseArgs({
    args,
    strict: false,
    options: {
      ...GLOBAL_OPTIONS,
      command: { type: "string", multiple: true },
      capability: { type: "string" },
      all: { type: "boolean", default: false },
      timeout: { type: "string" },
    },
  });

  const surface = requireSurface(options);
  const selected = select(surface, values);
  if (selected.length === 0) {
    throw new CliError(
      "Nothing to verify. Pass --command <id>, --capability <id>, or --all.\n" +
        `Known commands: ${surface.commands.map((c) => c.id).join(", ") || "none"}`
    );
  }

  const now = nowIso();
  const timeoutMs = typeof values.timeout === "string" ? Number(values.timeout) * 1000 : undefined;
  const results: Array<{ command: Command; record: VerificationRecord }> = [];

  for (const command of selected) {
    if (!options.json) print(`${style.dim("running")} ${style.bold(command.id)}  ${command.run}`);
    const record = runCommand(options.root, command, {
      now,
      ...(timeoutMs && Number.isFinite(timeoutMs) ? { timeoutMs } : {}),
    });
    results.push({ command, record });
    if (!options.json) print(`  ${label(record.status)} ${style.dim(`${record.durationMs ?? 0} ms`)}`);
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
  writeSurface(options.root, updated);
  const warnings: string[] = [];
  try {
    const rebuild = await buildSurface({
      root: options.root,
      adapters: builtinAdapters,
      previous: updated,
      now,
    });
    warnings.push(...rebuild.warnings);
    writeSurface(options.root, rebuild.surface);
  } catch (error) {
    warnings.push(
      `Results were recorded, but the surface could not be rebuilt: ${(error as Error).message}. ` +
        `Run surface init to propagate them.`
    );
  }

  if (options.json) {
    printJson({ results: results.map((r) => ({ id: r.command.id, run: r.command.run, ...r.record })), warnings });
  } else {
    print("");
    print(heading("Recorded"));
    for (const { command, record } of results) {
      print(`  ${label(record.status)} ${command.id}`);
      if (record.status === "failed" && record.summary) {
        print(style.dim(indent(record.summary.split("\n").slice(-6).join("\n"))));
      }
      if (record.reason) print(style.dim(`      ${record.reason}`));
    }
    for (const w of warnings) print(style.yellow(`  ${w}`));
    print("");
    print(style.dim("  Capability confidence and freshness updated. See: surface inspect"));
  }

  return results.some((r) => r.record.status === "failed") ? 2 : 0;
}

function select(surface: Surface, values: Record<string, unknown>): Command[] {
  if (values.all === true) return surface.commands.filter((c) => c.kind === "test" || c.kind === "build" || c.kind === "typecheck");

  const ids = Array.isArray(values.command) ? (values.command as string[]) : [];
  if (ids.length > 0) return ids.map((id) => resolveAllowedCommand(surface, id));

  if (typeof values.capability === "string") {
    const capability = surface.capabilities.find((c) => c.id === values.capability);
    if (!capability) throw new CliError(`No capability "${values.capability}".`);
    const commandIds = new Set(
      capability.evidence
        .map((ref) => surface.evidence.find((e) => e.id === ref.id)?.commandId)
        .filter((id): id is string => typeof id === "string")
    );
    const linked = surface.commands.filter((c) => commandIds.has(c.id));
    if (linked.length > 0) return linked;
    /* No command is bound to this capability's evidence, so fall back to the
       test command for its package - stated plainly rather than silently. */
    return surface.commands.filter(
      (c) => c.kind === "test" && (!capability.packageId || !c.packageId || c.packageId === capability.packageId)
    );
  }

  return [];
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
