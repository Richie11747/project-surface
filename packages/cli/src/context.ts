/**
 * Shared command context: where the project is, how to talk to the user, and
 * the already-loaded surface document when a command needs one.
 */

import { resolve } from "node:path";
import { readSurface, SURFACE_FILE } from "@project-surface/core";
import type { Surface } from "@project-surface/core";
import { printError, style } from "./output.js";

/**
 * Options every command accepts. Declared in one place and spread into each
 * subcommand parser so that a global flag written after the subcommand is
 * recognised there rather than being mistaken for a positional argument.
 */
export const GLOBAL_OPTIONS = {
  root: { type: "string" },
  json: { type: "boolean", default: false },
  color: { type: "boolean", default: true },
  help: { type: "boolean", default: false },
} as const;

export interface GlobalOptions {
  root: string;
  json: boolean;
  color: boolean;
}

export class CliError extends Error {
  readonly exitCode: number;
  constructor(message: string, exitCode = 1) {
    super(message);
    this.name = "CliError";
    this.exitCode = exitCode;
  }
}

/**
 * Load the surface, or explain precisely what to do about its absence. A tool
 * whose failure mode is "file not found" teaches the user nothing.
 */
export function requireSurface(options: GlobalOptions): Surface {
  const { surface, errors } = readSurface(options.root);
  if (surface) return surface;

  if (errors.length > 0) {
    printError(`${SURFACE_FILE} exists but does not match the schema:`);
    for (const e of errors.slice(0, 8)) printError(`  ${e}`);
    throw new CliError("Regenerate it with: surface init");
  }
  throw new CliError(
    `No ${SURFACE_FILE} in ${resolve(options.root)}.\n` +
      `Create one with: ${style.bold("surface init")}`
  );
}
