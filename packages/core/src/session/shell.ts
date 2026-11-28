/**
 * Which documented command, if any, a shell line runs.
 *
 * The session ledger only knows about runs that went through the tool. An
 * agent that types `npm test` into its shell bypasses it, and that is exactly
 * the run an agent repeats. A hook in front of the shell can close the gap if
 * it can say, without guessing, that the line it is about to run *is* the
 * documented `test` command. This module is that judgement, and it errs on
 * the side of "no": a line it is not sure about is not matched, and an
 * unmatched line is never blocked.
 *
 * Accepted: one command, optionally preceded by a single `cd <dir> &&`, and
 * optionally followed by `2>&1` and one `| tail ...` / `| head ...` - the
 * shapes an agent uses to keep output short, none of which change what runs.
 * Anything else that chains, substitutes or redirects is not matched.
 *
 * Pure. Resolving the directory against the file system is the caller's job.
 */

import type { Command } from "../schema/types.js";

export interface ShellRun {
  /** The directory of a leading `cd <dir> &&`, exactly as written. */
  cd?: string;
  /** The command itself, with the output-trimming tail removed. */
  run: string;
}

const TRIM_TAIL = /\s*(?:2>&1\s*)?\|\s*(?:tail|head)(?:\s+-{0,2}[\w=]+)*\s*$/;
const TRAILING_MERGE = /\s+2>&1\s*$/;
const LEADING_CD = /^cd\s+("[^"]+"|'[^']+'|[^\s;&|]+)\s*&&\s*/;
/* After the accepted shapes are removed, any of these means "not one command". */
const NOT_SIMPLE = /[;&|<>`]|\$\(|\n/;

export function parseShellRun(line: string): ShellRun | undefined {
  let rest = line.trim();
  let cd: string | undefined;
  const lead = LEADING_CD.exec(rest);
  if (lead) {
    cd = lead[1]!.replace(/^["']|["']$/g, "");
    rest = rest.slice(lead[0].length);
  }
  rest = rest.replace(TRIM_TAIL, "").replace(TRAILING_MERGE, "").trim();
  if (!rest || NOT_SIMPLE.test(rest)) return undefined;
  return cd === undefined ? { run: rest } : { cd, run: rest };
}

const RUN_ALIASES = new Set(["run", "run-script", "rum", "urn"]);
/* Lifecycle scripts every package manager here runs without `run`. */
const LIFECYCLE = new Set(["test", "start", "stop", "restart"]);
const NPM_SHORT: Record<string, string> = { t: "test", tst: "test" };

/**
 * One spelling per meaning: `npm test`, `npm t` and `npm run test` all become
 * `npm run test`. Only lifecycle scripts lose their `run`, because `pnpm
 * build` and `yarn build` may be a built-in rather than the script.
 */
export function canonicalRun(run: string): string {
  const words = run.trim().split(/\s+/);
  const [manager, verb, ...rest] = words;
  if (!manager || !verb || !["npm", "pnpm", "yarn"].includes(manager)) return words.join(" ");
  if (RUN_ALIASES.has(verb)) return [manager, "run", ...rest].join(" ");
  const script = manager === "npm" ? (NPM_SHORT[verb] ?? verb) : verb;
  if (LIFECYCLE.has(script)) return [manager, "run", script, ...rest].join(" ");
  return words.join(" ");
}

/** `./bench/`, `bench` and `bench/.` are the same directory. */
export function normaliseCwd(cwd: string): string {
  const parts = cwd.replace(/\\/g, "/").split("/").filter((p) => p && p !== ".");
  return parts.length === 0 ? "." : parts.join("/");
}

/**
 * The documented command a shell run executes from `cwd` (relative to the
 * project root, after any `cd` was applied), or undefined. When two commands
 * share a run string and directory - one script exposed under two ids - the
 * first in document order wins, which is the order every listing uses.
 */
export function matchShellCommand<C extends Pick<Command, "id" | "run" | "cwd">>(
  commands: readonly C[],
  run: string,
  cwd: string
): C | undefined {
  const wanted = canonicalRun(run);
  const where = normaliseCwd(cwd);
  return commands.find((c) => normaliseCwd(c.cwd) === where && canonicalRun(c.run) === wanted);
}
