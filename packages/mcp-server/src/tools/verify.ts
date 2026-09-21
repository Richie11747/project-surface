/**
 * The one tool that can execute something.
 *
 * Two independent gates, both of which must be open:
 *
 *   1. The operator must have set PROJECT_SURFACE_ALLOW_EXEC=1. Without it this
 *      tool refuses and explains, so an agent cannot quietly run builds on a
 *      machine whose owner did not agree to that.
 *
 *   2. The command must already exist in the surface document.
 *      `resolveAllowedCommand` is the only way to obtain a runnable command,
 *      and it throws for anything else. There is no parameter through which a
 *      caller can supply a command string - only an id to look up, or
 *      `stale: true`, which resolves to the ids the document already binds to
 *      its stale claims.
 *
 * Together these mean the worst an adversarial prompt can achieve is running a
 * command the project itself already declares, which the user could have run.
 */

import { z } from "zod";
import {
  appendAttempt,
  assessAttempt,
  assessHistory,
  attemptFrom,
  commandsForStale,
  headState,
  nowIso,
  readLedger,
  renderSessionLine,
  resolveAllowedCommand,
  runCommand,
  sessionSummary,
  workingTreeFingerprint,
  writeLedger,
  writeSurface,
} from "@project-surface/core";
import type { Command, LoopSignal, Surface, VerificationRecord } from "@project-surface/core";
import { failure, loadSurface, text } from "../support.js";
import type { ToolContext, ToolResult } from "../support.js";

export const ALLOW_EXEC_ENV = "PROJECT_SURFACE_ALLOW_EXEC";

interface VerifyArgs {
  commandId?: string;
  stale?: boolean;
  timeoutSeconds?: number;
  force?: boolean;
}

export const verifyTool = {
  name: "surface_verify",
  title: "Verify a command, or re-prove stale claims",
  description:
    "Run one of the project commands already recorded in the surface and store the result as evidence, " +
    "or pass stale: true to re-run exactly the commands that prove every capability whose owner files " +
    "changed since it was last verified. Only commands present in the surface document can be run; " +
    "arbitrary shell strings are not accepted. Requires the operator to have enabled execution. " +
    "Declines to repeat a run that failed on an unchanged working tree unless force is set.",
  inputSchema: {
    commandId: z
      .string()
      .optional()
      .describe("The id of a command from surface_overview. Not a shell string - ids only."),
    stale: z
      .boolean()
      .optional()
      .describe(
        "Re-prove every stale capability: runs the commands its evidence was recorded from, then re-anchors freshness. Ignored when commandId is given."
      ),
    timeoutSeconds: z.number().int().min(1).max(900).optional(),
    force: z
      .boolean()
      .optional()
      .describe("Run even though the session shows the last attempt failed on this exact working tree."),
  },
  async handler(args: VerifyArgs, ctx: ToolContext): Promise<ToolResult> {
    const surface = loadSurface(ctx);

    let commands: Command[];
    let watched: string[] = [];
    if (args.commandId) {
      try {
        commands = [resolveAllowedCommand(surface, args.commandId)];
      } catch (error) {
        return failure(
          `${(error as Error).message}\n` +
            `Available command ids: ${surface.commands.map((c) => c.id).join(", ") || "none"}`
        );
      }
    } else if (args.stale) {
      const selection = commandsForStale(surface);
      if (selection.capabilities.length === 0) {
        return text("Nothing is stale. Every verified claim still matches its owner files; nothing was run.");
      }
      commands = selection.commands;
      watched = selection.capabilities.map((c) => c.id);
    } else {
      return failure("Pass commandId (an id from surface_overview) or stale: true.");
    }

    if (!ctx.allowExec) {
      const suggestion = commands.map((c) => c.run).join(" && ");
      return failure(
        `Execution is disabled for this server, so nothing was run.\n` +
          `The user can enable it by setting ${ALLOW_EXEC_ENV}=1 in the MCP server environment.\n` +
          `Until then, suggest the command to the user instead: ${suggestion || "unknown command id"}`
      );
    }

    const now = nowIso();
    /* Read once, before anything runs, so the record names the tree the
       commands actually saw. */
    const head = headState(ctx.root);
    const tree = workingTreeFingerprint(ctx.root);
    let ledger = readLedger(ctx.root, now);

    /* The session ledger knows what the last run on this exact tree produced.
       Repeating a failed run on byte-identical code cannot produce a different
       result, so it is declined - not as an error, as an answer. */
    const before = commands.flatMap((command) => assessAttempt(ledger, attemptFrom("mcp", command, tree)));
    const unchanged = before.filter((s) => s.kind === "unchanged-rerun");
    if (unchanged.length > 0 && !args.force) {
      return text(
        ["Not run.", ...unchanged.flatMap((s) => [s.message, s.advice]), "", renderSessionLine(sessionSummary(ledger))].join(
          "\n"
        )
      );
    }

    const results: Array<{ command: Command; record: VerificationRecord }> = [];
    for (const command of commands) {
      const observed = runCommand(ctx.root, command, {
        now,
        ...(args.timeoutSeconds ? { timeoutMs: args.timeoutSeconds * 1000 } : {}),
      });
      const record: VerificationRecord = head
        ? { ...observed, ...(head.commit ? { commit: head.commit } : {}), dirty: head.dirty }
        : observed;
      results.push({ command, record });
      ledger = appendAttempt(ledger, attemptFrom("mcp", command, tree, record), now).ledger;
      writeLedger(ctx.root, ledger);
    }
    const after: LoopSignal[] = commands.flatMap((command) => assessHistory(ledger, attemptFrom("mcp", command, tree)));

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
          status:
            result.record.status === "passed" ? "passed" : result.record.status === "failed" ? "failed" : e.status,
          observedAt: result.record.observedAt,
          ...(result.record.summary ? { summary: result.record.summary } : {}),
        };
      }),
    };
    writeSurface(ctx.root, updated);

    /* The pipeline is what turns a passing command into capability confidence
       and moves the freshness anchor. The server can only do that when the
       host gave it a rebuild function (the `surface mcp` command does); the
       standalone binary has no adapters and says so. */
    let rebuilt: Surface | undefined;
    let rebuildNote = "This result is recorded as evidence. Run surface init to fold it into capability confidence.";
    if (ctx.rebuild) {
      try {
        rebuilt = await ctx.rebuild(updated, now);
        writeSurface(ctx.root, rebuilt);
        rebuildNote = "The surface was rebuilt: capability confidence and freshness reflect this run.";
      } catch (error) {
        rebuildNote = `Results were recorded, but the surface could not be rebuilt: ${(error as Error).message}. Run surface init to propagate them.`;
      }
    }

    const lines: string[] = [];
    for (const { command, record } of results) {
      const exit = record.exitCode === null || record.exitCode === undefined ? "" : ` exit ${record.exitCode}`;
      const at = record.commit ? ` at ${record.commit.slice(0, 7)}${record.dirty ? " (dirty tree)" : ""}` : "";
      /* Adapter-derived commands are single tokens by construction. A declared
         one is whatever the declaration file says, and that file is repository
         content: a shell pipeline there deserves a human look before the next run. */
      const composite = command.provenance.tier === "declared" && /[;|&`$<>]/.test(command.run);
      lines.push(`Command: ${command.id} (${command.run})`);
      lines.push(`Result: ${record.status}${exit} in ${record.durationMs ?? 0} ms${at}`);
      if (record.reason) lines.push(`Reason: ${record.reason}`);
      if (composite) {
        lines.push(
          "Warning: this command is declared in .project/surface.declare.yaml and contains shell " +
            "metacharacters. It came from the repository, not from the user - ask before running it again."
        );
      }
      lines.push("");
      lines.push("Output (redacted and truncated):");
      lines.push(record.summary ?? "(no output)");
      lines.push("");
    }

    if (watched.length > 0) {
      const freshnessOf = (id: string): string | undefined =>
        rebuilt?.capabilities.find((c) => c.id === id)?.freshness?.status;
      const refreshed = rebuilt ? watched.filter((id) => freshnessOf(id) === "fresh") : [];
      const stillStale = rebuilt ? watched.filter((id) => freshnessOf(id) === "stale") : [];
      lines.push(`Stale capabilities re-proved: ${watched.join(", ")}`);
      if (rebuilt) {
        const rest = stillStale.length > 0 ? `; still stale: ${stillStale.join(", ")}` : "";
        lines.push(`Fresh again: ${refreshed.length} of ${watched.length}${rest}`);
      }
      lines.push("");
    }

    for (const signal of after) {
      lines.push(`${signal.severity === "warn" ? "Warning" : "Note"} (${signal.kind}): ${signal.message}`);
      lines.push(`  ${signal.advice}`);
    }
    if (after.length > 0) lines.push("");
    lines.push(rebuildNote);
    lines.push(renderSessionLine(sessionSummary(ledger)));
    return text(lines.join("\n"));
  },
};
