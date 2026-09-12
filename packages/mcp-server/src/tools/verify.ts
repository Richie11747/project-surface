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
 *      caller can supply a command string - only an id to look up.
 *
 * Together these mean the worst an adversarial prompt can achieve is running a
 * command the project itself already declares, which the user could have run.
 */

import { z } from "zod";
import { nowIso, resolveAllowedCommand, runCommand, writeSurface } from "@project-surface/core";
import type { Surface } from "@project-surface/core";
import { failure, loadSurface, text } from "../support.js";
import type { ToolContext, ToolResult } from "../support.js";

export const ALLOW_EXEC_ENV = "PROJECT_SURFACE_ALLOW_EXEC";

export const verifyTool = {
  name: "surface_verify",
  title: "Verify a command",
  description:
    "Run one of the project commands already recorded in the surface and store the result as evidence. " +
    "Only commands present in the surface document can be run; arbitrary shell strings are not accepted. " +
    "Requires the operator to have enabled execution.",
  inputSchema: {
    commandId: z
      .string()
      .describe("The id of a command from surface_overview. Not a shell string - ids only."),
    timeoutSeconds: z.number().int().min(1).max(900).optional(),
  },
  handler(args: { commandId: string; timeoutSeconds?: number }, ctx: ToolContext): ToolResult {
    const surface = loadSurface(ctx);

    if (!ctx.allowExec) {
      const suggestion = surface.commands.find((c) => c.id === args.commandId)?.run;
      return failure(
        `Execution is disabled for this server, so "${args.commandId}" was not run.\n` +
          `The user can enable it by setting ${ALLOW_EXEC_ENV}=1 in the MCP server environment.\n` +
          `Until then, suggest the command to the user instead: ${suggestion ?? "unknown command id"}`
      );
    }

    let command;
    try {
      command = resolveAllowedCommand(surface, args.commandId);
    } catch (error) {
      return failure(
        `${(error as Error).message}\n` +
          `Available command ids: ${surface.commands.map((c) => c.id).join(", ") || "none"}`
      );
    }

    const record = runCommand(ctx.root, command, {
      now: nowIso(),
      ...(args.timeoutSeconds ? { timeoutMs: args.timeoutSeconds * 1000 } : {}),
    });

    const updated: Surface = {
      ...surface,
      commands: surface.commands.map((c) => (c.id === command.id ? { ...c, verification: record } : c)),
      evidence: surface.evidence.map((e) =>
        e.commandId === command.id
          ? {
              ...e,
              status:
                record.status === "passed" ? "passed" : record.status === "failed" ? "failed" : e.status,
              observedAt: record.observedAt,
              ...(record.summary ? { summary: record.summary } : {}),
            }
          : e
      ),
    };
    writeSurface(ctx.root, updated);

    const exit =
      record.exitCode === null || record.exitCode === undefined ? "" : ` exit ${record.exitCode}`;
    return text(
      [
        `Command: ${command.id} (${command.run})`,
        `Result: ${record.status}${exit} in ${record.durationMs ?? 0} ms`,
        record.reason ? `Reason: ${record.reason}` : "",
        "",
        "Output (redacted and truncated):",
        record.summary ?? "(no output)",
        "",
        "This result is recorded as evidence. Run surface init to fold it into capability confidence.",
      ]
        .filter((line) => line !== "")
        .join("\n")
    );
  },
};
