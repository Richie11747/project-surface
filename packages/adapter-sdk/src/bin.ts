#!/usr/bin/env node
/**
 * `surface-conform <adapter-module> <fixture-dir>` - run the conformance suite
 * against any adapter, first-party or not, without cloning this repository.
 *
 * The module must export the adapter as `default` or as a named export whose
 * value has `id`, `detect` and `extract`. Exit code 0 when every check passes,
 * 2 when one fails, 1 when the adapter could not be loaded.
 */

import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { runConformance } from "./conformance.js";
import type { Adapter } from "@project-surface/core";

function isAdapter(value: unknown): value is Adapter {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Adapter).id === "string" &&
    typeof (value as Adapter).detect === "function" &&
    typeof (value as Adapter).extract === "function"
  );
}

async function main(argv: string[]): Promise<number> {
  const [modulePath, fixture] = argv;
  if (!modulePath || !fixture || argv.includes("--help")) {
    process.stdout.write(
      "Usage: surface-conform <adapter-module.js> <fixture-dir>\n\n" +
        "Runs the project-surface adapter conformance suite: provenance on every claim, relative POSIX paths,\n" +
        "no leaked absolute root, honest evidence status, byte-identical determinism. Exit 0 = conforms.\n"
    );
    return argv.includes("--help") ? 0 : 1;
  }

  let loaded: Record<string, unknown>;
  try {
    loaded = (await import(pathToFileURL(resolve(modulePath)).href)) as Record<string, unknown>;
  } catch (e) {
    process.stderr.write(`Could not load ${modulePath}: ${(e as Error).message}\n`);
    return 1;
  }
  const adapter = [loaded.default, ...Object.values(loaded)].find(isAdapter);
  if (!adapter) {
    process.stderr.write(`${modulePath} exports nothing that looks like an adapter (id, detect, extract).\n`);
    return 1;
  }

  const result = await runConformance(adapter, resolve(fixture));
  for (const check of result.checks) {
    process.stdout.write(`${check.passed ? "pass" : "FAIL"}  ${check.name}${check.detail && !check.passed ? `\n      ${check.detail}` : ""}\n`);
  }
  process.stdout.write(`\n${result.adapter}: ${result.passed ? "conforms" : `${result.failures.length} check(s) failed`}\n`);
  return result.passed ? 0 : 2;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (e) => {
    process.stderr.write(`${(e as Error).stack ?? e}\n`);
    process.exit(1);
  }
);
