/**
 * The evidence runner - the only code in this project that executes anything.
 *
 * Everything else reads files. Concentrating execution in one small module
 * means the security review has exactly one place to look, and the rules it
 * enforces hold for every caller, including the MCP server:
 *
 *   1. Only a command that already exists in the surface document may run.
 *      Callers pass a `Command` object taken from the surface, and
 *      `resolveAllowedCommand` is the only sanctioned way to obtain one. There
 *      is no code path that runs an arbitrary string.
 *   2. The working directory must resolve inside the project root.
 *   3. Execution is time-bounded and output-bounded.
 *   4. Captured output passes through `sanitizeOutput` before it is stored.
 *
 * A shell is used because commands are shell strings (`npm test -- foo`). That
 * is precisely why rule 1 exists: the allowlist, not shell quoting, is the
 * boundary.
 */

import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { sanitizeOutput, secretEnvValues } from "../redact.js";
import type { Command, Surface, Timestamp, VerificationRecord } from "../schema/types.js";

export const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;

export class CommandNotAllowedError extends Error {
  constructor(id: string) {
    super(
      `Command "${id}" is not present in the surface document. ` +
        `Only commands discovered or declared in .project/surface.json may be executed. ` +
        `Run "surface init" first, or declare the command in .project/surface.declare.yaml.`
    );
    this.name = "CommandNotAllowedError";
  }
}

export class UnsafeWorkingDirectoryError extends Error {
  constructor(cwd: string) {
    super(`Command working directory "${cwd}" resolves outside the project root.`);
    this.name = "UnsafeWorkingDirectoryError";
  }
}

/**
 * The allowlist gate. Every execution path must obtain its `Command` here.
 */
export function resolveAllowedCommand(surface: Surface, commandId: string): Command {
  const found = surface.commands.find((c) => c.id === commandId);
  if (!found) throw new CommandNotAllowedError(commandId);
  return found;
}

/**
 * The working directory must be inside the project both lexically and
 * physically: a `cwd` that names a symlinked directory pointing elsewhere
 * would pass a string comparison and still run the command outside the tree.
 */
function safeCwd(root: string, cwd: string): string {
  const target = resolve(root, cwd || ".");
  const contained = (base: string, candidate: string): boolean => {
    const rel = relative(base, candidate);
    return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
  };
  if (!contained(resolve(root), target)) throw new UnsafeWorkingDirectoryError(cwd);
  try {
    if (!contained(realpathSync(root), realpathSync(target))) throw new UnsafeWorkingDirectoryError(cwd);
  } catch (error) {
    if (error instanceof UnsafeWorkingDirectoryError) throw error;
    /* Missing directory: spawn will report that itself. */
  }
  return target;
}

export interface RunOptions {
  timeoutMs?: number;
  now: Timestamp;
}

/**
 * Execute one allowlisted command and describe what happened.
 *
 * Never throws on command failure - a failing test run is a legitimate,
 * recordable observation. It throws only when the request itself is unsafe.
 */
export function runCommand(
  root: string,
  command: Command,
  options: RunOptions
): VerificationRecord {
  const cwd = safeCwd(root, command.cwd);
  const timeout = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const line = command.run;

  const started = Date.now();
  const result = spawnSync(line, {
    cwd,
    shell: true,
    encoding: "utf8",
    timeout,
    maxBuffer: MAX_OUTPUT_BYTES,
    windowsHide: true,
    env: process.env,
  });
  const durationMs = Date.now() - started;

  /* The child inherited this environment, so any credential it prints is one
     whose exact value is known here. Remove those before pattern matching. */
  const secrets = secretEnvValues(process.env);
  const combined = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  const summary = sanitizeOutput(combined, { root, secrets });

  if (result.error) {
    const code = (result.error as NodeJS.ErrnoException).code;
    /* ETIMEDOUT and ENOBUFS both mean the command ran and was cut short - by
       the clock, or by printing more than the capture buffer holds. Neither is
       "could not be started", and neither is a verdict on the command. On
       Windows the timeout kills the shell, not necessarily the process tree
       it started; that limitation is documented, not hidden. */
    const reason =
      code === "ETIMEDOUT"
        ? `Command exceeded the ${timeout} ms timeout.`
        : code === "ENOBUFS"
          ? `Command printed more than the ${MAX_OUTPUT_BYTES} byte capture limit and was stopped.`
          : `Command could not be started: ${sanitizeOutput(String(result.error), { root, secrets })}`;
    return {
      status: "unknown",
      exitCode: null,
      durationMs,
      observedAt: options.now,
      ...(summary ? { summary } : {}),
      reason,
    };
  }

  return {
    status: result.status === 0 ? "passed" : "failed",
    exitCode: result.status,
    durationMs,
    observedAt: options.now,
    ...(summary ? { summary } : {}),
  };
}

/**
 * What to record when a command cannot be run at all - a missing toolchain, or
 * execution not being permitted in this context. Reported honestly as
 * `unknown` with a reason, never as a pass.
 */
export function skipped(reason: string, now: Timestamp): VerificationRecord {
  return { status: "skipped", observedAt: now, reason };
}
