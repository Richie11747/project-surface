/**
 * `surface init` - detect the stack and write the document.
 *
 * Re-running init is the normal way to refresh a surface, so it deliberately
 * reads the previous document first and carries forward everything that was
 * actually observed. Losing verification results on every scan would make
 * `verify` pointless.
 */

import { parseArgs } from "node:util";
import { buildSurface, isRepository, readSurface, runGit, writeSurface, SESSION_FILE, SURFACE_FILE } from "@project-surface/core";
import { builtinAdapters } from "../adapters.js";
import { GLOBAL_OPTIONS, type GlobalOptions } from "../context.js";
import { bullet, heading, print, printJson, style } from "../output.js";

export async function run(args: string[], options: GlobalOptions): Promise<number> {
  const { values } = parseArgs({
    args,
    strict: true,
    options: {
      ...GLOBAL_OPTIONS,
      "max-files": { type: "string" },
      force: { type: "boolean", default: false },
    },
  });

  const existing = values.force === true ? null : readSurface(options.root).surface;
  const maxFiles = typeof values["max-files"] === "string" ? Number(values["max-files"]) : undefined;

  const { surface, warnings } = await buildSurface({
    root: options.root,
    adapters: builtinAdapters,
    previous: existing,
    ...(maxFiles && Number.isFinite(maxFiles) ? { maxFiles } : {}),
  });

  const written = writeSurface(options.root, surface);

  if (options.json) {
    printJson({ written: SURFACE_FILE, warnings, surface });
    return 0;
  }

  print(heading(`Wrote ${SURFACE_FILE}`));
  print("");
  print(`  project      ${style.bold(surface.project.name)}`);
  print(`  stacks       ${surface.project.stacks.map((s) => s.id).join(", ") || style.dim("none detected")}`);
  print(`  packages     ${surface.project.packages.length}`);
  print(`  commands     ${surface.commands.length}`);
  print(`  capabilities ${surface.capabilities.length}`);
  print(`  constraints  ${surface.constraints.length}`);
  print(`  evidence     ${surface.evidence.length}`);
  print(`  risks        ${surface.risks.length}`);

  for (const stack of surface.project.stacks) {
    for (const note of stack.notes ?? []) print(`  ${style.dim(`${stack.id}: ${note}`)}`);
  }

  if (warnings.length > 0) {
    print("");
    print(heading("Warnings"));
    for (const w of warnings) print(bullet(style.yellow(w)));
  }

  const errors = surface.health.filter((h) => h.severity === "error").length;
  const warns = surface.health.filter((h) => h.severity === "warn").length;
  print("");
  print(
    `  ${style.dim("health")} ${errors} error, ${warns} warning, ${surface.health.length - errors - warns} info` +
      `  ${style.dim("- run")} surface doctor`
  );
  print("");
  print(style.dim(`  ${written}`));
  /* The session file is machine-local. The tool never edits .gitignore - that
     is a source file - so it says once when the pattern is missing. */
  if (isRepository(options.root) && !runGit(options.root, ["check-ignore", "-q", SESSION_FILE]).ok) {
    print(style.dim(`  Add .project/*.local.json to .gitignore: session state (${SESSION_FILE}) is machine-local.`));
  }
  print("");
  print(`Next: ${style.bold("surface brief")} for one screen of orientation, ${style.bold("surface inspect")} for everything.`);

  return 0;
}
