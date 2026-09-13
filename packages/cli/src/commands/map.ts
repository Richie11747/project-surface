/**
 * `surface map` - the ownership table.
 *
 * One row per capability: who implements it, what specifies it, what proves it.
 * Useful for spotting the gaps at a glance - a column of dashes under Evidence
 * is a more honest test-coverage summary than a percentage.
 */

import { parseArgs } from "node:util";
import { GLOBAL_OPTIONS, requireSurface, type GlobalOptions } from "../context.js";
import { confidence, freshness, heading, print, printJson, style, table, tier } from "../output.js";

export async function run(args: string[], options: GlobalOptions): Promise<number> {
  parseArgs({ args, strict: true, options: { ...GLOBAL_OPTIONS } });
  const surface = requireSurface(options);
  const evidenceById = new Map(surface.evidence.map((e) => [e.id, e]));

  const rows = surface.capabilities.map((c) => ({
    id: c.id,
    kind: c.kind,
    owners: c.owners.map((o) => o.path),
    contracts: c.contracts.map((o) => o.path),
    evidence: c.evidence.map((r) => evidenceById.get(r.id)?.path ?? r.id),
    tier: c.provenance.tier,
    confidence: c.confidence,
    freshness: c.freshness?.status ?? "unknown",
  }));

  if (options.json) {
    printJson({ project: surface.project.name, capabilities: rows });
    return 0;
  }

  print(heading(`Ownership map for ${surface.project.name}`));
  print("");
  print(
    table([
      [
        `  ${style.bold("CAPABILITY")}`,
        style.bold("OWNER"),
        style.bold("CONTRACT"),
        style.bold("EVIDENCE"),
        style.bold("TIER"),
        style.bold("CONFIDENCE"),
        style.bold("FRESHNESS"),
      ],
      ...rows.map((r) => [
        `  ${r.id}`,
        r.owners[0] ?? style.dim("-"),
        r.contracts[0] ?? style.dim("-"),
        r.evidence[0] ?? style.dim("-"),
        tier(r.tier),
        confidence(r.confidence),
        freshness(surface.capabilities.find((c) => c.id === r.id)?.freshness),
      ]),
    ])
  );
  print("");
  const unproven = rows.filter((r) => r.evidence.length === 0).length;
  const undocumented = rows.filter((r) => r.contracts.length === 0).length;
  const stale = rows.filter((r) => r.freshness === "stale").length;
  const fresh = rows.filter((r) => r.freshness === "fresh").length;
  print(
    style.dim(
      `  ${rows.length} capabilities - ${fresh} fresh, ${stale} stale, ${unproven} without evidence, ${undocumented} without a contract`
    )
  );
  return 0;
}
