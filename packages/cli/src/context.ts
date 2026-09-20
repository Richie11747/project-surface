/**
 * Shared command context: where the project is, how to talk to the user, and
 * the already-loaded surface document when a command needs one.
 */

import { existsSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
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
 * Where a command that writes may write: inside the project, and nowhere else.
 *
 * `target` is a user-supplied path, relative to the root or absolute. It is
 * resolved before it is compared, so `docs/../../x` does not pass a check that
 * only looks at the leading segment; and the nearest existing ancestor is
 * checked physically, so a symlinked directory inside the tree cannot carry
 * the write out of it. Returns the absolute path and the root-relative one.
 */
export function resolveWriteTarget(root: string, target: string): { full: string; rel: string } {
  const absRoot = resolve(root);
  const full = resolve(absRoot, target);
  const contained = (base: string, candidate: string): boolean => {
    const r = relative(base, candidate);
    return r === "" || (!r.startsWith("..") && !isAbsolute(r));
  };
  if (!contained(absRoot, full)) {
    throw new CliError(`Refusing to write outside the project root: ${target}`);
  }
  let ancestor = dirname(full);
  while (!existsSync(ancestor) && contained(absRoot, ancestor) && ancestor !== absRoot) ancestor = dirname(ancestor);
  try {
    if (!contained(realpathSync(absRoot), realpathSync(ancestor))) {
      throw new CliError(`Refusing to write outside the project root: ${target}`);
    }
  } catch (error) {
    if (error instanceof CliError) throw error;
    /* The root itself is missing or unreadable; the write will report that. */
  }
  return { full, rel: relative(absRoot, full).replace(/\\/g, "/") };
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
