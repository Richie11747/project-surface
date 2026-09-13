/**
 * `surface impact` - what does this change touch.
 *
 * Accepts explicit paths, the staged set, or everything since a git ref, so it
 * works the same way in an editor, a pre-commit hook, and CI.
 */

import { parseArgs } from "node:util";
import { analyzeImpact, changedSince, stagedPaths } from "@project-surface/core";
import { GLOBAL_OPTIONS, requireSurface, CliError, type GlobalOptions } from "../context.js";
import { bullet, confidence, heading, print, printJson, style, table } from "../output.js";

export async function run(args: string[], options: GlobalOptions): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    strict: true,
    options: {
      ...GLOBAL_OPTIONS,
      staged: { type: "boolean", default: false },
      since: { type: "string" },
    },
  });

  const surface = requireSurface(options);
  const paths = resolvePaths(options.root, values, positionals);
  if (paths.length === 0) {
    throw new CliError(
      "No changed paths. Pass paths explicitly, or use --staged or --since <ref>."
    );
  }

  const report = analyzeImpact(surface, paths);

  if (options.json) {
    printJson(report);
    return 0;
  }

  print(heading(`Impact of ${paths.length} changed path(s)`));
  print(style.dim(`  ${paths.slice(0, 8).join(", ")}${paths.length > 8 ? ", ..." : ""}`));
  print("");

  if (report.capabilities.length === 0) {
    print(`  ${style.dim("No capability is known to depend on these files.")}`);
  } else {
    print(heading("Affected capabilities"));
    print(
      table(
        report.capabilities.map((i) => [
          `  ${style.bold(i.capability.id)}`,
          style.dim(i.relation),
          i.reason,
          confidence(i.capability.confidence),
        ])
      )
    );
  }

  if (report.risks.length > 0) {
    print("");
    print(heading("Risk"));
    for (const r of report.risks) {
      const marker = r.approval === "required" ? style.red("approval required") : style.yellow("advisory");
      print(bullet(`${marker} ${r.type} - ${r.reason}`));
    }
  }

  if (report.commands.length > 0) {
    print("");
    print(heading("Run these"));
    for (const c of report.commands) print(bullet(`${c.run}${c.cwd === "." ? "" : style.dim(` (in ${c.cwd})`)}`));
  }

  if (report.constraints.length > 0) {
    print("");
    print(heading("Do not violate"));
    for (const c of report.constraints) print(bullet(c.rule));
  }

  return 0;
}

function resolvePaths(root: string, values: Record<string, unknown>, positionals: string[]): string[] {
  if (values.staged === true) return stagedPaths(root);
  if (typeof values.since === "string") {
    const changed = changedSince(root, values.since);
    if (changed === null) throw new CliError(`Could not diff against "${values.since}". Is it a valid git ref?`);
    return changed;
  }
  return positionals;
}
