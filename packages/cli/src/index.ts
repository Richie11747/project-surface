#!/usr/bin/env node
/**
 * The project-surface CLI.
 *
 * Argument parsing uses node:util parseArgs rather than a dependency; the
 * surface area is small and a CLI framework would be most of the install size.
 *
 * The command name must come first, git-style. Everything after it belongs to
 * the subcommand, which also understands the global flags - so `surface inspect
 * checkout.create --json` parses the way a reader expects rather than having
 * `--json` consumed here and the value stolen from the subcommand.
 *
 * Commands return an exit code rather than calling process.exit, so they stay
 * testable as plain functions.
 */

import { parseArgs } from "node:util";
import { resolve } from "node:path";
import { GENERATOR_VERSION } from "@project-surface/core";
import { CliError, GLOBAL_OPTIONS, type GlobalOptions } from "./context.js";
import { printError, setColor } from "./output.js";
import { commandHelp, mainHelp } from "./usage.js";

type CommandRunner = (args: string[], options: GlobalOptions) => Promise<number>;

const COMMANDS: Record<string, () => Promise<{ run: CommandRunner }>> = {
  init: () => import("./commands/init.js"),
  brief: () => import("./commands/brief.js"),
  inspect: () => import("./commands/inspect.js"),
  why: () => import("./commands/why.js"),
  agents: () => import("./commands/agents.js"),
  map: () => import("./commands/map.js"),
  verify: () => import("./commands/verify.js"),
  impact: () => import("./commands/impact.js"),
  gate: () => import("./commands/gate.js"),
  context: () => import("./commands/context.js"),
  session: () => import("./commands/session.js"),
  diff: () => import("./commands/diff.js"),
  doctor: () => import("./commands/doctor.js"),
  report: () => import("./commands/report.js"),
  mcp: () => import("./commands/mcp.js"),
};

export async function main(argv: string[]): Promise<number> {
  const first = argv[0];

  if (first === undefined || first === "help" || first === "--help" || first === "-h") {
    setColor(process.stdout.isTTY === true);
    const topic = first === undefined ? undefined : argv[1];
    process.stdout.write(`${(topic ? commandHelp(topic) : null) ?? mainHelp()}\n`);
    return 0;
  }

  if (first === "--version" || first === "-v") {
    process.stdout.write(`${GENERATOR_VERSION}\n`);
    return 0;
  }

  if (first.startsWith("-")) {
    setColor(process.stdout.isTTY === true);
    printError(`Expected a command, got "${first}".`);
    process.stdout.write(`${mainHelp()}\n`);
    return 1;
  }

  const loader = COMMANDS[first];
  if (!loader) {
    setColor(process.stdout.isTTY === true);
    printError(`Unknown command "${first}". Run surface --help for the list.`);
    return 1;
  }

  /* `--no-color` is handled here, before any parser sees it, so it works on
     every Node this project supports (parseArgs learned negation only in 22.4)
     and in every command. NO_COLOR (https://no-color.org) is honoured too. */
  const noColor = argv.includes("--no-color") || (process.env.NO_COLOR ?? "") !== "";
  const rest = argv.slice(1).filter((a) => a !== "--no-color");
  const { values } = parseArgs({
    args: rest,
    allowPositionals: true,
    strict: false,
    options: { ...GLOBAL_OPTIONS },
  });

  const json = values.json === true;
  /* Colour off when piped: the most common consumer of this output is another
     program, and escape codes would be noise in its input. */
  const color = !noColor && values.color !== false && process.stdout.isTTY === true && !json;
  setColor(color);

  if (values.help === true) {
    process.stdout.write(`${commandHelp(first) ?? mainHelp()}\n`);
    return 0;
  }

  const options: GlobalOptions = {
    root: resolve(typeof values.root === "string" ? values.root : process.cwd()),
    json,
    color,
  };

  try {
    const module = await loader();
    return await module.run(rest, options);
  } catch (error) {
    if (error instanceof CliError) {
      printError(error.message);
      return error.exitCode;
    }
    /* A mistyped flag must fail loudly. Swallowing `--budget-tokens 2000`
       would silently append "2000" to the task and run with the default
       budget - wrong output that looks right. */
    const code = (error as { code?: string }).code ?? "";
    if (code.startsWith("ERR_PARSE_ARGS")) {
      printError(`${(error as Error).message.split(". ")[0]}. Run surface ${first} --help for the options.`);
      return 1;
    }
    printError((error as Error).message);
    return 1;
  }
}

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    printError((error as Error).message);
    process.exitCode = 1;
  });
