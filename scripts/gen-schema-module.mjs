#!/usr/bin/env node
/**
 * Embed the normative JSON Schema into a TypeScript module.
 *
 * `spec/v1/surface.schema.json` is the single source of truth, but core must be
 * able to validate documents after being published to npm, with no filesystem
 * lookup and no bundler configuration. So the schema is compiled into a plain
 * TS module that is committed alongside the source.
 *
 *   node scripts/gen-schema-module.mjs           regenerate
 *   node scripts/gen-schema-module.mjs --check   fail if out of date (used in CI)
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const SPEC = join(repoRoot, "spec", "v1", "surface.schema.json");
const OUT = join(repoRoot, "packages", "core", "src", "schema", "schema.generated.ts");

const raw = readFileSync(SPEC, "utf8");
JSON.parse(raw);

const module = [
  "/**",
  " * GENERATED FILE - DO NOT EDIT BY HAND.",
  " *",
  " * Source:     spec/v1/surface.schema.json",
  " * Regenerate: node scripts/gen-schema-module.mjs",
  " *",
  " * CI runs this script with --check, so an edit here without a matching edit",
  " * to the spec fails the build.",
  " */",
  "",
  "export const SURFACE_SCHEMA: Readonly<Record<string, unknown>> = Object.freeze(",
  raw.trim(),
  ");",
  "",
].join("\n");

if (process.argv.includes("--check")) {
  let existing = "";
  try {
    existing = readFileSync(OUT, "utf8");
  } catch {
    console.error("schema module missing: run node scripts/gen-schema-module.mjs");
    process.exit(1);
  }
  if (existing !== module) {
    console.error("schema module is out of date with spec/v1/surface.schema.json");
    console.error("run: node scripts/gen-schema-module.mjs");
    process.exit(1);
  }
  console.log("schema module is in sync with the spec");
  process.exit(0);
}

writeFileSync(OUT, module, "utf8");
console.log(`wrote ${OUT}`);
