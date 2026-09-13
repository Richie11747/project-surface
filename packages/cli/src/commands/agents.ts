/**
 * `surface agents` - agent instructions generated from evidence.
 *
 * Prints (or writes into AGENTS.md / CLAUDE.md) a block that says what the
 * project can do, which commands actually run, which rules are checked, and
 * where things live - each line with its provenance. Hand-written text outside
 * the markers is preserved. Once written, `surface doctor` reports the block
 * as stale whenever the surface changes underneath it.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { isAbsolute, join, relative } from "node:path";
import { renderAgentsBlock, upsertAgentsBlock } from "@project-surface/core";
import { GLOBAL_OPTIONS, requireSurface, CliError, type GlobalOptions } from "../context.js";
import { print, printJson, style } from "../output.js";

export async function run(args: string[], options: GlobalOptions): Promise<number> {
  const { values } = parseArgs({
    args,
    strict: true,
    options: {
      ...GLOBAL_OPTIONS,
      write: { type: "string" },
      "include-inferred": { type: "boolean", default: false },
      "max-capabilities": { type: "string" },
    },
  });

  const surface = requireSurface(options);
  const max = typeof values["max-capabilities"] === "string" ? Number(values["max-capabilities"]) : undefined;
  const block = renderAgentsBlock(surface, {
    includeInferred: values["include-inferred"] === true,
    ...(max && Number.isFinite(max) && max > 0 ? { maxCapabilities: max } : {}),
  });

  const target = typeof values.write === "string" ? values.write : undefined;
  if (!target) {
    if (options.json) {
      printJson({ block, includeInferred: values["include-inferred"] === true });
      return 0;
    }
    print(block);
    return 0;
  }

  /* The file must stay inside the project: this command writes, and the one
     place it may write is the repository it describes. */
  const rel = isAbsolute(target) ? relative(options.root, target) : target;
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new CliError(`Refusing to write outside the project root: ${target}`);
  }
  const full = join(options.root, rel);
  const existing = existsSync(full) ? readFileSync(full, "utf8") : null;
  const updated = upsertAgentsBlock(existing, block);
  const changed = updated !== existing;
  if (changed) writeFileSync(full, updated);

  if (options.json) {
    printJson({ path: rel.replace(/\\/g, "/"), changed, created: existing === null });
    return 0;
  }
  print(
    changed
      ? `${existing === null ? "Wrote" : "Updated"} ${style.bold(rel)} ${style.dim("- hand-written text outside the markers was kept")}`
      : `${style.bold(rel)} ${style.dim("already matches the surface")}`
  );
  return 0;
}
