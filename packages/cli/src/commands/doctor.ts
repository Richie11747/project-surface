/**
 * `surface doctor` - what is drifting, unproven, or stale.
 *
 * Exit code 2 on findings (rather than 1) so CI can distinguish "the project
 * has drift" from "the tool broke". `--strict` promotes warnings to failures.
 */

import { parseArgs } from "node:util";
import { GLOBAL_OPTIONS, requireSurface, type GlobalOptions } from "../context.js";
import { finding, heading, print, printJson, style } from "../output.js";

export async function run(args: string[], options: GlobalOptions): Promise<number> {
  const { values } = parseArgs({
    args,
    strict: false,
    options: {
      ...GLOBAL_OPTIONS,
      strict: { type: "boolean", default: false },
      severity: { type: "string" },
    },
  });

  const surface = requireSurface(options);
  const minimum = typeof values.severity === "string" ? values.severity : "info";
  const rank: Record<string, number> = { error: 0, warn: 1, info: 2 };
  const threshold = rank[minimum] ?? 2;
  const findings = surface.health.filter((f) => (rank[f.severity] ?? 2) <= threshold);

  if (options.json) {
    printJson({ findings, counts: counts(surface.health) });
    return exitCode(surface.health, values.strict === true);
  }

  const c = counts(surface.health);
  print(heading(`Health of ${surface.project.name}`));
  print("");

  if (findings.length === 0) {
    print(`  ${style.green("Nothing to report.")} Every claim is backed and current.`);
    return 0;
  }

  for (const f of findings) {
    print(finding(f));
    print("");
  }

  print(`  ${c.error} error, ${c.warn} warning, ${c.info} info`);
  if (c.error === 0 && values.strict !== true && c.warn > 0) {
    print(style.dim("  Use --strict to fail on warnings."));
  }

  return exitCode(surface.health, values.strict === true);
}

function counts(findings: { severity: string }[]): { error: number; warn: number; info: number } {
  return {
    error: findings.filter((f) => f.severity === "error").length,
    warn: findings.filter((f) => f.severity === "warn").length,
    info: findings.filter((f) => f.severity === "info").length,
  };
}

function exitCode(findings: { severity: string }[], strict: boolean): number {
  const c = counts(findings);
  if (c.error > 0) return 2;
  if (strict && c.warn > 0) return 2;
  return 0;
}
