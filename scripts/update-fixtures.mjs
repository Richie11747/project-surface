#!/usr/bin/env node
/**
 * Regenerate the golden snapshot of every fixture.
 *
 *   npm run fixtures:update
 *
 * A changed snapshot is a changed promise to users: review the diff before
 * committing it. `test/fixtures.test.js` fails until the snapshot matches.
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { EXPECTED_FILE, buildFixtureSnapshot, listFixtures } from "./fixture-snapshot.mjs";

for (const name of listFixtures()) {
  const { root, surface, warnings, text } = await buildFixtureSnapshot(name);
  const target = join(root, EXPECTED_FILE);
  writeFileSync(target, text, "utf8");
  console.log(
    `${name.padEnd(8)} ${surface.capabilities.length} capabilities, ${surface.commands.length} commands, ` +
      `${surface.evidence.length} evidence -> fixtures/${name}/${EXPECTED_FILE}`
  );
  for (const w of warnings) console.log(`  warning: ${w}`);
}
