/**
 * `surface why <id>` - show the derivation behind a confidence score.
 *
 * `inspect` tells you how much to trust a claim. `why` tells you why that
 * number and not another: the files it was read from, the tests that ran, the
 * promotion they earned or did not, the freshness anchor, and the arithmetic.
 * If re-deriving the score from the document does not reproduce the recorded
 * value, that is printed too - the point is to be checkable, not reassuring.
 */

import { explainClaim } from "@project-surface/core";
import type { ClaimExplanation } from "@project-surface/core";
import { parseArgs } from "node:util";
import { GLOBAL_OPTIONS, requireSurface, CliError, type GlobalOptions } from "../context.js";
import { confidence, freshness, heading, print, printJson, style, tier } from "../output.js";

export async function run(args: string[], options: GlobalOptions): Promise<number> {
  const { positionals } = parseArgs({
    args,
    allowPositionals: true,
    strict: true,
    options: { ...GLOBAL_OPTIONS },
  });

  const surface = requireSurface(options);
  const target = positionals[0];
  if (!target) {
    throw new CliError(
      "Pass a capability, command, constraint, risk id or environment variable name.\n" +
        "Example: surface why checkout.create"
    );
  }

  const explanation = explainClaim(surface, target);
  if (!explanation) {
    const near = surface.capabilities
      .filter((c) => c.id.includes(target) || c.aliases?.some((a) => a.includes(target)))
      .slice(0, 5)
      .map((c) => c.id);
    throw new CliError(
      `Nothing in the surface has the id "${target}".` +
        (near.length > 0 ? `\nDid you mean: ${near.join(", ")}` : "")
    );
  }

  if (options.json) {
    printJson(explanation);
    return 0;
  }
  printExplanation(explanation);
  return 0;
}

function printExplanation(e: ClaimExplanation): void {
  print(`${heading(e.id)}  ${style.dim(e.kind)}`);
  print(`  ${e.title}`);
  if (e.aliases.length > 0) print(style.dim(`  also answers to: ${e.aliases.join(", ")}`));
  print("");

  print(heading("  Read from"));
  print(
    `    ${tier(e.provenance.tier)} by the ${e.provenance.adapter} adapter at ${e.provenance.observedAt}` +
      `, ${e.provenance.distinctSources} distinct file(s):`
  );
  for (const s of e.provenance.sources) {
    print(`      ${s.path}${s.locator ? style.dim(`  ${s.locator}`) : ""}`);
  }
  print("");

  print(heading("  Proven by"));
  if (e.evidence.length === 0) {
    print(style.dim("    nothing - no evidence is linked to this claim"));
  }
  for (const ev of e.evidence) {
    const status = ev.status === "passed" ? style.green("passed") : ev.status === "failed" ? style.red("failed") : style.dim(ev.status);
    const via = [
      ev.link ? `linked by ${ev.link}` : null,
      ev.commandId ? `command ${ev.commandId}` : null,
      ev.observedAt ? `observed ${ev.observedAt}` : null,
      ev.commit ? `at ${ev.commit.slice(0, 7)}${ev.dirty ? " (dirty tree)" : ""}` : null,
    ]
      .filter(Boolean)
      .join(", ");
    print(`    ${status}  ${ev.path ?? ev.id}${via ? style.dim(`  (${via})`) : ""}`);
  }
  if (e.promotion) {
    const arrow = e.promotion.from === e.promotion.to ? `${tier(e.promotion.from)} stays` : `${tier(e.promotion.from)} -> ${tier(e.promotion.to)}`;
    print(`    ${arrow}: ${e.promotion.reason}`);
  }
  print("");

  print(heading("  Freshness"));
  if (!e.freshness) {
    print(style.dim("    not tracked for this kind of claim"));
  } else {
    print(`    ${freshness(e.freshness)}${e.freshness.reason ? style.dim(`  ${e.freshness.reason}`) : ""}`);
    if (e.freshness.verifiedAt) print(style.dim(`    verified ${e.freshness.verifiedAt}, stale after ${e.freshness.staleAfterDays} days without re-verification`));
    if (e.freshness.ownersFingerprint) print(style.dim(`    owner fingerprint ${e.freshness.ownersFingerprint}`));
  }
  print("");

  print(heading("  Score"));
  for (const step of e.trace.steps) {
    print(`    ${step.value.toFixed(2).padStart(5)}  ${style.dim(step.rule.padEnd(16))} ${step.detail}`);
  }
  print(`    ${"=".repeat(5)}`);
  print(`    ${confidence(e.trace.score)}`);
  print("");

  if (e.consistent) {
    print(style.dim(`  Recomputed from the document and matches the recorded ${e.recorded.toFixed(2)}.`));
  } else {
    print(style.yellow(`  Recomputed ${e.trace.score.toFixed(2)} but the document records ${e.recorded.toFixed(2)}.`));
    print(style.yellow("  The document was produced by a different version or edited by hand. Run surface init."));
  }
}
