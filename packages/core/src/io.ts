/**
 * Reading and writing the surface document.
 *
 * The output is deliberately plain, indented JSON with a trailing newline: it
 * is meant to be committed, reviewed in a pull request, and diffed by humans.
 * A compact single-line document would be smaller and far less useful.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { assertValidSurface, validateSurface } from "./schema/validate.js";
import type { Surface } from "./schema/types.js";
import { SURFACE_FILE } from "./version.js";

export function surfacePath(root: string, file: string = SURFACE_FILE): string {
  return join(root, file);
}

export function serializeSurface(surface: Surface): string {
  return `${JSON.stringify(surface, null, 2)}\n`;
}

/**
 * Validates before writing. A malformed document is a bug in an adapter, and
 * writing it anyway would hand every downstream consumer bad data.
 */
export function writeSurface(root: string, surface: Surface, file: string = SURFACE_FILE): string {
  assertValidSurface(surface);
  const target = surfacePath(root, file);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, serializeSurface(surface), "utf8");
  return target;
}

export interface ReadSurfaceResult {
  surface: Surface | null;
  /** Populated when a document exists but does not match the schema. */
  errors: string[];
}

/**
 * Reads an existing document. An invalid document is reported rather than
 * thrown, so `doctor` can explain the problem instead of crashing.
 */
export function readSurface(root: string, file: string = SURFACE_FILE): ReadSurfaceResult {
  let raw: string;
  try {
    raw = readFileSync(surfacePath(root, file), "utf8");
  } catch {
    return { surface: null, errors: [] };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return { surface: null, errors: [`Not valid JSON: ${(e as Error).message}`] };
  }

  const result = validateSurface(parsed);
  if (!result.valid) return { surface: null, errors: result.errors };
  return { surface: parsed as Surface, errors: [] };
}
