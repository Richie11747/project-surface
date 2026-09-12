/**
 * `surface inspect` - the answer to "what does this project do, and what proves it".
 *
 * With no argument it summarises the project. With a capability id it prints
 * the single view this whole project exists to produce: owners, contract,
 * evidence, environment, the command that checks it, and how much to trust the
 * answer.
 */

import { confidenceLabel } from "@project-surface/core";
import type { Capability, Surface } from "@project-surface/core";
import { parseArgs } from "node:util";
import { GLOBAL_OPTIONS, requireSurface, CliError, type GlobalOptions } from "../context.js";
import { bullet, confidence, freshness, heading, print, printJson, style, table, tier } from "../output.js";

export async function run(args: string[], options: GlobalOptions): Promise<number> {
  const { positionals } = parseArgs({
    args,
    allowPositionals: true,
    strict: false,
    options: { ...GLOBAL_OPTIONS },
  });

  const surface = requireSurface(options);
  const target = positionals[0];

  if (target) {
    const capability = findCapability(surface, target);
    if (!capability) {
      const near = surface.capabilities
        .filter((c) => c.id.includes(target) || c.title.toLowerCase().includes(target.toLowerCase()))
        .slice(0, 5);
      throw new CliError(
        `No capability "${target}".` +
          (near.length > 0 ? `\nDid you mean: ${near.map((c) => c.id).join(", ")}` : "\nRun surface inspect to list them.")
      );
    }
    if (options.json) {
      printJson(detail(surface, capability));
      return 0;
    }
    printDetail(surface, capability);
    return 0;
  }

  if (options.json) {
    printJson(overview(surface));
    return 0;
  }
  printOverview(surface);
  return 0;
}

function findCapability(surface: Surface, id: string): Capability | undefined {
  return (
    surface.capabilities.find((c) => c.id === id) ??
    surface.capabilities.find((c) => c.aliases?.includes(id)) ??
    surface.capabilities.find((c) => c.id.endsWith(`.${id}`))
  );
}

function overview(surface: Surface): Record<string, unknown> {
  return {
    project: surface.project,
    generatedAt: surface.generatedAt,
    commands: surface.commands.map((c) => ({ id: c.id, run: c.run, kind: c.kind, confidence: c.confidence })),
    capabilities: surface.capabilities.map((c) => ({
      id: c.id,
      title: c.title,
      kind: c.kind,
      confidence: c.confidence,
      tier: c.provenance.tier,
      owners: c.owners.map((o) => o.path),
    })),
    constraints: surface.constraints.map((c) => ({ id: c.id, rule: c.rule, severity: c.severity })),
    environment: surface.environment.map((e) => ({ name: e.name, required: e.required, secret: e.secret })),
    risks: surface.risks,
    health: surface.health.length,
  };
}

function printOverview(surface: Surface): void {
  print(heading(surface.project.name));
  print(
    style.dim(
      `  ${surface.project.stacks.map((s) => s.id).join(", ") || "no stack detected"}` +
        ` - generated ${surface.generatedAt}`
    )
  );
  print("");

  if (surface.commands.length > 0) {
    print(heading("Commands"));
    print(
      table(
        surface.commands.map((c) => [
          `  ${style.bold(c.id)}`,
          style.dim(c.kind),
          c.run,
          c.verification ? verificationLabel(c.verification.status) : style.dim("unverified"),
        ])
      )
    );
    print("");
  }

  if (surface.capabilities.length > 0) {
    print(heading("Capabilities"));
    print(
      table(
        surface.capabilities.map((c) => [
          `  ${style.bold(c.id)}`,
          style.dim(c.kind),
          c.owners[0]?.path ?? "",
          `${c.evidence.length} evidence`,
          confidence(c.confidence),
        ])
      )
    );
    print("");
  }

  if (surface.constraints.length > 0) {
    print(heading("Constraints"));
    for (const c of surface.constraints) print(bullet(`${c.rule} ${style.dim(`(${c.provenance.sources[0]?.path ?? ""})`)}`));
    print("");
  }

  if (surface.environment.length > 0) {
    print(heading("Environment"));
    print(
      surface.environment
        .map((e) => `  ${e.secret ? style.yellow(e.name) : e.name}${e.required ? "" : style.dim(" (optional)")}`)
        .join("\n")
    );
    print("");
  }

  if (surface.risks.length > 0) {
    print(heading("Risks"));
    for (const r of surface.risks) {
      print(bullet(`${style.yellow(r.type)} ${style.dim(r.approval)} - ${r.reason}`));
      print(`      ${style.dim(r.paths.slice(0, 3).join(", "))}`);
    }
    print("");
  }

  const errors = surface.health.filter((h) => h.severity === "error").length;
  print(
    style.dim(
      `  ${surface.health.length} health findings (${errors} error) - run surface doctor`
    )
  );
}

function verificationLabel(status: string): string {
  if (status === "passed") return style.green("passed");
  if (status === "failed") return style.red("failed");
  return style.dim(status);
}

function detail(surface: Surface, c: Capability): Record<string, unknown> {
  return {
    capability: c,
    evidence: surface.evidence.filter((e) => c.evidence.some((r) => r.id === e.id)),
    commands: surface.commands.filter((cmd) => cmd.kind === "test" && (!c.packageId || !cmd.packageId || cmd.packageId === c.packageId)),
    constraints: surface.constraints.filter((x) => x.status === "active"),
    risks: surface.risks,
  };
}

function printDetail(surface: Surface, c: Capability): void {
  print(heading(c.id));
  print(`  ${c.title}`);
  if (c.description) print(style.dim(`  ${c.description}`));
  print("");

  print(`  ${style.bold("Implemented by")}`);
  for (const owner of c.owners) print(`    ${owner.path}${owner.locator ? style.dim(` ${owner.locator}`) : ""}`);

  print("");
  print(`  ${style.bold("Contract")}`);
  if (c.contracts.length === 0) print(`    ${style.dim("none - nothing specifies this behaviour")}`);
  for (const contract of c.contracts) print(`    ${contract.path}`);

  print("");
  print(`  ${style.bold("Evidence")}`);
  const evidence = surface.evidence.filter((e) => c.evidence.some((r) => r.id === e.id));
  if (evidence.length === 0) print(`    ${style.dim("none - nothing proves this works")}`);
  for (const e of evidence) {
    const link = c.evidence.find((r) => r.id === e.id)?.link ?? "";
    print(`    ${e.path ?? e.id} ${style.dim(`(${e.status}, linked by ${link})`)}`);
  }

  if (c.environment.length > 0) {
    print("");
    print(`  ${style.bold("Requires environment")}`);
    print(`    ${c.environment.join(", ")}`);
  }

  const testCommands = surface.commands.filter(
    (cmd) => cmd.kind === "test" && (!c.packageId || !cmd.packageId || cmd.packageId === c.packageId)
  );
  if (testCommands.length > 0) {
    print("");
    print(`  ${style.bold("Check it with")}`);
    for (const cmd of testCommands) print(`    ${cmd.run}${cmd.cwd === "." ? "" : style.dim(` (in ${cmd.cwd})`)}`);
  }

  const relatedRisks = surface.risks.filter((r) =>
    r.paths.some((p) => c.owners.some((o) => o.path.startsWith(p)))
  );
  if (relatedRisks.length > 0) {
    print("");
    print(`  ${style.bold("Risk")}`);
    for (const r of relatedRisks) print(`    ${style.yellow(r.type)} - ${r.reason}`);
  }

  print("");
  print(
    `  ${style.bold("Trust")}  ${confidence(c.confidence)} ${style.dim("|")} ${tier(c.provenance.tier)} ${style.dim("|")} ${freshness(c.freshness)}`
  );
  print(
    style.dim(
      `         ${confidenceLabel(c.confidence)} confidence from ${c.provenance.sources.length} source(s) via the ${c.provenance.adapter} adapter`
    )
  );
  if (c.freshness?.reason) print(style.dim(`         ${c.freshness.reason}`));
}
