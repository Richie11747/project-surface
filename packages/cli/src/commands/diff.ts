/**
 * `surface diff` - what changed about the project.
 *
 * Compares the committed surface at a git ref against the current one. This is
 * what a pull request comment should contain: a route appeared, a command
 * changed, a claim went stale.
 */

import { parseArgs } from "node:util";
import {
  buildSurface,
  diffSurfaces,
  readSurface,
  showFileAtRef,
  validateSurface,
  SURFACE_FILE,
} from "@project-surface/core";
import type { Surface } from "@project-surface/core";
import { builtinAdapters } from "../adapters.js";
import { GLOBAL_OPTIONS, CliError, type GlobalOptions } from "../context.js";
import { bullet, heading, print, printJson, style } from "../output.js";

export async function run(args: string[], options: GlobalOptions): Promise<number> {
  const { values } = parseArgs({
    args,
    strict: false,
    options: {
      ...GLOBAL_OPTIONS,
      since: { type: "string", default: "HEAD" },
      "fail-on-change": { type: "boolean", default: false },
    },
  });

  const ref = typeof values.since === "string" ? values.since : "HEAD";
  const before = surfaceAtRef(options.root, ref);
  if (!before) {
    throw new CliError(
      `No ${SURFACE_FILE} at ref "${ref}". Commit one first, so future changes have a baseline.`
    );
  }

  /* Build fresh rather than reading the working copy: the point is to compare
     the recorded surface against reality, not against a possibly stale file. */
  const { surface: after } = await buildSurface({
    root: options.root,
    adapters: builtinAdapters,
    previous: readSurface(options.root).surface,
  });

  const result = diffSurfaces(before, after);

  if (options.json) {
    printJson({ ref, ...result });
    return result.empty || values["fail-on-change"] !== true ? 0 : 2;
  }

  print(heading(`Surface changes since ${ref}`));
  print("");

  if (result.empty) {
    print(`  ${style.green("Nothing changed.")}`);
    return 0;
  }

  section("Capabilities", result.capabilities);
  section("Commands", result.commands);
  section("Constraints", result.constraints);

  if (result.health.appeared.length > 0) {
    print(heading("New health findings"));
    for (const f of result.health.appeared) print(bullet(`${style.yellow(f.code)} ${f.message}`));
    print("");
  }
  if (result.health.resolved.length > 0) {
    print(heading("Resolved"));
    for (const f of result.health.resolved) print(bullet(`${style.green(f.code)} ${f.message}`));
    print("");
  }

  return values["fail-on-change"] === true ? 2 : 0;
}

function section(title: string, diff: { added: string[]; removed: string[]; changed: Array<{ id: string; changes: Array<{ field: string; before: string; after: string }> }> }): void {
  if (diff.added.length === 0 && diff.removed.length === 0 && diff.changed.length === 0) return;
  print(heading(title));
  for (const id of diff.added) print(bullet(`${style.green("added")}   ${id}`));
  for (const id of diff.removed) print(bullet(`${style.red("removed")} ${id}`));
  for (const entry of diff.changed) {
    print(bullet(`${style.yellow("changed")} ${entry.id}`));
    for (const c of entry.changes) {
      print(`      ${style.dim(c.field)}: ${c.before || style.dim("(none)")} ${style.dim("->")} ${c.after || style.dim("(none)")}`);
    }
  }
  print("");
}

function surfaceAtRef(root: string, ref: string): Surface | null {
  const raw = showFileAtRef(root, ref, SURFACE_FILE);
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return validateSurface(parsed).valid ? (parsed as Surface) : null;
  } catch {
    return null;
  }
}
