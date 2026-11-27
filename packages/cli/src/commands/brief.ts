/**
 * `surface brief` - one screen of orientation, the first thing to read in a
 * new session. The text is rendered by core so the MCP `surface_overview`
 * tool shows an agent exactly what this shows a person.
 */

import { parseArgs } from "node:util";
import { buildBrief, renderBrief } from "@project-surface/core";
import { GLOBAL_OPTIONS, requireSurface, type GlobalOptions } from "../context.js";
import { print, printJson } from "../output.js";

export async function run(args: string[], options: GlobalOptions): Promise<number> {
  parseArgs({ args, strict: true, options: { ...GLOBAL_OPTIONS } });
  const brief = buildBrief(requireSurface(options));
  if (options.json) printJson(brief);
  else print(renderBrief(brief));
  return 0;
}
