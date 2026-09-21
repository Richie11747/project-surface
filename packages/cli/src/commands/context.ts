/**
 * `surface context` - a bounded context pack for one task.
 *
 * The point is not to find every relevant file; it is to find the few that
 * matter and to say why each one is there. Anything dropped for budget is
 * listed, so the caller can raise the budget deliberately instead of wondering
 * what it did not see.
 */

import { parseArgs } from "node:util";
import { createGuardedAccess, packContext } from "@project-surface/core";
import { GLOBAL_OPTIONS, requireSurface, CliError, type GlobalOptions } from "../context.js";
import { bullet, heading, print, printJson, style, table, tier } from "../output.js";

export async function run(args: string[], options: GlobalOptions): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    strict: true,
    options: {
      ...GLOBAL_OPTIONS,
      budget: { type: "string" },
      "max-capabilities": { type: "string" },
      content: { type: "boolean", default: false },
    },
  });

  const task = positionals.join(" ").trim();
  if (task.length === 0) {
    throw new CliError('Describe the task, for example: surface context "add passkey login"');
  }

  const surface = requireSurface(options);
  const budget = typeof values.budget === "string" ? Number(values.budget) : undefined;
  const maxCapabilities =
    typeof values["max-capabilities"] === "string" ? Number(values["max-capabilities"]) : undefined;

  const pack = packContext(surface, task, createGuardedAccess(options.root), {
    ...(budget && Number.isFinite(budget) ? { budgetTokens: budget } : {}),
    ...(maxCapabilities && Number.isFinite(maxCapabilities) ? { maxCapabilities } : {}),
    includeContent: values.content === true,
  });

  if (options.json) {
    printJson(pack);
    return 0;
  }

  print(heading(`Context for: ${task}`));
  print(style.dim(`  ${pack.usedTokens} of ${pack.budgetTokens} tokens used`));
  print("");

  if (pack.capabilities.length === 0) {
    print(`  ${style.dim("No capability matched that description.")}`);
    print(style.dim("  Try different words, or run surface inspect to see what exists."));
    return 0;
  }

  print(heading("Relevant capabilities"));
  print(
    table(
      pack.capabilities.map((c) => [`  ${style.bold(c.id)}`, c.title, trust(c.tier, c.freshness), style.dim(c.reason)])
    )
  );
  print("");

  print(heading("Files"));
  print(
    table(
      pack.items.map((i) => [
        `  ${i.path}`,
        style.dim(i.role),
        style.dim(`${i.estimatedTokens} tok`),
        trust(i.trust.tier, i.trust.freshness),
        style.dim(i.reason),
      ])
    )
  );

  if (pack.constraints.length > 0) {
    print("");
    print(heading("Constraints that apply"));
    for (const c of pack.constraints) print(bullet(c.rule));
  }

  if (pack.commands.length > 0) {
    print("");
    print(heading("Verify with"));
    for (const c of pack.commands) print(bullet(c.run));
  }

  if (pack.omitted.length > 0) {
    print("");
    print(heading("Omitted"));
    for (const o of pack.omitted) print(bullet(`${o.path} ${style.dim(`- ${o.reason}`)}`));
  }

  return 0;
}

/** `declared·fresh`, `inferred·unknown`: the two words that say whether a file comes with proof. */
function trust(tierValue: Parameters<typeof tier>[0], freshness: string): string {
  const mark = freshness === "fresh" ? style.green(freshness) : freshness === "stale" ? style.red(freshness) : style.dim(freshness);
  return `${tier(tierValue)}${style.dim("·")}${mark}`;
}
