#!/usr/bin/env node
/**
 * Collect every test file and hand the explicit list to `node --test`.
 *
 * `node --test` accepts glob patterns only from Node 21 onwards; this repo
 * supports Node 20, and explicit paths behave the same on every version and
 * platform. Test files live in `test/` (integration, at the root) and in each
 * package's `test/` directory.
 */

import { spawnSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const TEST_DIRS = ["test", "packages"];
const SKIP = new Set(["node_modules", "dist", "fixtures"]);

function collect(dir, out) {
  for (const name of readdirSync(dir).sort()) {
    if (SKIP.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) collect(full, out);
    else if (/\.test\.(js|mjs)$/.test(name)) out.push(relative(root, full));
  }
  return out;
}

const files = TEST_DIRS.flatMap((d) => collect(join(root, d), []));
if (files.length === 0) {
  console.error("no test files found");
  process.exit(1);
}

const extra = process.argv.slice(2);
const result = spawnSync(process.execPath, ["--test", "--test-reporter=spec", ...extra, ...files], {
  cwd: root,
  stdio: "inherit",
});
process.exit(result.status ?? 1);
