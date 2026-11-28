/**
 * `surface hook pre-bash|post-bash` - the session ledger, in front of and
 * behind an agent's shell.
 *
 * A run through `surface verify` is on record; `npm test` typed into an
 * agent's shell is not, and that is the run an agent repeats. These two
 * subcommands read a Claude Code hook payload on stdin:
 *
 * - `pre-bash` (PreToolUse): when the line is exactly a documented command
 *   and its last attempt failed on this byte-identical working tree, deny the
 *   call with the reason. Otherwise print nothing. It never answers "allow":
 *   that would skip the user's own permission prompts.
 * - `post-bash` (PostToolUse / PostToolUseFailure): record the attempt and, if
 *   the history now says `same-failure` or `flapping`, add it to the context.
 *
 * A hook must never be the reason a tool call fails, so every problem - no
 * document, no git, malformed stdin, an unmatched line - ends in silence and
 * exit 0. What is matched and what is not: docs/sessions.md.
 */

import { existsSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  appendAttempt,
  assessAttempt,
  assessHistory,
  attemptFrom,
  headState,
  matchShellCommand,
  nowIso,
  parseShellRun,
  readLedger,
  readSurface,
  SURFACE_FILE,
  sanitizeOutput,
  workingTreeFingerprint,
  writeLedger,
} from "@project-surface/core";
import type { Command, LoopSignal, VerificationRecord } from "@project-surface/core";
import { CliError, GLOBAL_OPTIONS, type GlobalOptions } from "../context.js";

interface HookPayload {
  hook_event_name?: unknown;
  cwd?: unknown;
  tool_name?: unknown;
  tool_input?: { command?: unknown };
  tool_response?: unknown;
  error?: unknown;
  is_interrupt?: unknown;
}

export async function run(args: string[], options: GlobalOptions): Promise<number> {
  const { positionals } = parseArgs({ args, strict: true, allowPositionals: true, options: { ...GLOBAL_OPTIONS } });
  const mode = positionals[0];
  if (positionals.length !== 1 || (mode !== "pre-bash" && mode !== "post-bash")) {
    throw new CliError("Usage: surface hook pre-bash|post-bash  (reads a Claude Code hook payload on stdin)");
  }
  try {
    const payload = parsePayload(await readStdin());
    const target = payload && resolveTarget(payload, options.root);
    if (!payload || !target) return 0;
    const { root, command } = target;
    const output = mode === "pre-bash" ? preBash(root, command) : postBash(root, command, payload);
    if (output) process.stdout.write(`${JSON.stringify(output)}\n`);
  } catch {
    /* Silence is the contract: see the module comment. */
  }
  return 0;
}

function readStdin(): Promise<string> {
  return new Promise((done) => {
    if (process.stdin.isTTY) return done("");
    let text = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (text += chunk));
    process.stdin.on("end", () => done(text));
    process.stdin.on("error", () => done(""));
  });
}

function parsePayload(text: string): HookPayload | undefined {
  try {
    const value: unknown = JSON.parse(text);
    return value && typeof value === "object" ? (value as HookPayload) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The project the shell is in: the hook's own directory when it holds a
 * surface document, else the nearest ancestor of the shell's directory that
 * does - an agent that `cd`-ed into a package is still in the project.
 */
function findRoot(start: string, shellCwd: string): string | undefined {
  if (existsSync(join(start, SURFACE_FILE))) return start;
  for (let dir = resolve(shellCwd); ; dir = dirname(dir)) {
    if (existsSync(join(dir, SURFACE_FILE))) return dir;
    if (dirname(dir) === dir) return undefined;
  }
}

/** The documented command this shell call runs, if it is exactly one. */
function resolveTarget(payload: HookPayload, start: string): { root: string; command: Command } | undefined {
  if (payload.tool_name !== undefined && payload.tool_name !== "Bash") return undefined;
  const line = payload.tool_input?.command;
  if (typeof line !== "string") return undefined;
  const parsed = parseShellRun(line);
  if (!parsed) return undefined;

  const shellCwd = typeof payload.cwd === "string" ? payload.cwd : start;
  const root = findRoot(start, shellCwd);
  if (!root) return undefined;
  const where = relative(resolve(root), resolve(shellCwd, parsed.cd ?? "."));
  if (where.startsWith("..") || isAbsolute(where)) return undefined;

  const { surface } = readSurface(root);
  if (!surface) return undefined;
  const command = matchShellCommand(surface.commands, parsed.run, where || ".");
  return command ? { root, command } : undefined;
}

function preBash(root: string, command: Command): object | undefined {
  const ledger = readLedger(root, nowIso());
  const tree = workingTreeFingerprint(root);
  const unchanged = assessAttempt(ledger, attemptFrom("hook", command, tree)).find(
    (s) => s.kind === "unchanged-rerun"
  );
  if (!unchanged) return undefined;
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason:
        `project-surface: not run. ${unchanged.message} ` +
        `Edit something first - any change to the working tree lifts this. ` +
        `To forget the history instead: surface session --reset.`,
    },
  };
}

function postBash(root: string, command: Command, payload: HookPayload): object | undefined {
  const now = nowIso();
  const record = observed(root, payload, now);
  if (!record) return undefined;

  const head = headState(root);
  const tree = workingTreeFingerprint(root);
  const full: VerificationRecord = head
    ? { ...record, ...(head.commit ? { commit: head.commit } : {}), dirty: head.dirty }
    : record;
  const ledger = appendAttempt(readLedger(root, now), attemptFrom("hook", command, tree, full), now).ledger;
  writeLedger(root, ledger);

  const signals = assessHistory(ledger, attemptFrom("hook", command, tree));
  if (signals.length === 0) return undefined;
  return {
    hookSpecificOutput: {
      hookEventName: payload.hook_event_name,
      additionalContext: signals.map(render).join("\n"),
    },
  };
}

/**
 * What the shell call came to. A completed call is a pass; a failed one says
 * `Exit code N` on its first line. An interrupted call, or a failure that
 * does not say how it ended, is not a verdict on the command and is not
 * recorded at all.
 */
function observed(root: string, payload: HookPayload, now: string): VerificationRecord | undefined {
  if (payload.hook_event_name === "PostToolUse") {
    const response = payload.tool_response;
    if (response && typeof response === "object" && (response as { interrupted?: unknown }).interrupted === true) {
      return undefined;
    }
    return { status: "passed", exitCode: 0, observedAt: now };
  }
  if (payload.hook_event_name === "PostToolUseFailure") {
    if (payload.is_interrupt === true || typeof payload.error !== "string") return undefined;
    const match = /^Exit code (\d+)\s*\n?([\s\S]*)$/.exec(payload.error);
    if (!match) return undefined;
    const summary = sanitizeOutput(match[2] ?? "", { root });
    return { status: "failed", exitCode: Number(match[1]), observedAt: now, ...(summary ? { summary } : {}) };
  }
  return undefined;
}

function render(signal: LoopSignal): string {
  return `project-surface (${signal.kind}, ${signal.commandId}): ${signal.message} ${signal.advice}`;
}
