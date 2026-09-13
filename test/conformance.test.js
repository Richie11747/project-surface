// @ts-check
/**
 * Every built-in adapter must pass the same conformance suite that is asked of
 * third-party adapters. First-party code gets no exemption from honesty.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runConformance } from "@project-surface/adapter-sdk";
import { typescriptAdapter } from "@project-surface/adapter-typescript";
import { pythonAdapter } from "@project-surface/adapter-python";
import { goAdapter } from "@project-surface/adapter-go";
import { FIXTURES_DIR } from "../scripts/fixture-snapshot.mjs";

const BIN = fileURLToPath(new URL("../packages/adapter-sdk/dist/bin.js", import.meta.url));
const GO_ADAPTER = fileURLToPath(new URL("../packages/adapters/go/dist/index.js", import.meta.url));

function conform(...args) {
  const result = spawnSync(process.execPath, [BIN, ...args], { encoding: "utf8" });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

const CASES = [
  [typescriptAdapter, "ts-api"],
  [pythonAdapter, "py-api"],
  [goAdapter, "go-svc"],
];

for (const [adapter, fixture] of CASES) {
  test(`${adapter.id} adapter passes conformance on fixtures/${fixture}`, async () => {
    const result = await runConformance(adapter, join(FIXTURES_DIR, fixture));
    assert.ok(result.passed, `failed checks:\n  - ${result.failures.join("\n  - ")}`);
    assert.ok(result.checks.length >= 10, `only ${result.checks.length} checks ran`);
  });
}

test("an adapter that does not recognise a project fails detection, not extraction", async () => {
  const result = await runConformance(goAdapter, join(FIXTURES_DIR, "ts-api"));
  assert.equal(result.passed, false);
  assert.ok(
    result.failures.some((f) => f.startsWith("detect() matched the fixture")),
    result.failures.join("; ")
  );
});

/* The same suite as a command, so a third-party adapter can be checked without
   cloning this repository. The exit code is the contract: 0 conforms, 2 does
   not, 1 the module could not be used as an adapter at all. */

test("surface-conform exits 0 for a built-in adapter on its fixture", () => {
  const run = conform(GO_ADAPTER, join(FIXTURES_DIR, "go-svc"));
  assert.equal(run.code, 0, run.stdout + run.stderr);
  assert.match(run.stdout, /^go: conforms$/m);
  assert.doesNotMatch(run.stdout, /FAIL/);
});

test("surface-conform exits 2 and names the failed checks for a broken adapter", () => {
  const dir = mkdtempSync(join(tmpdir(), "project-surface-conform-"));
  try {
    /* Two deliberate violations: a test that was only found is reported as
       passed, and the output differs from one run to the next. (A counter
       rather than Date.now(), so the failure cannot hide behind a fast clock.) */
    const module = join(dir, "broken.mjs");
    writeFileSync(
      module,
      [
        "let runs = 0;",
        "export default {",
        '  id: "broken",',
        '  version: "0.0.0",',
        "  detect() { return true; },",
        "  extract(ctx) {",
        "    runs += 1;",
        "    return {",
        '      stack: { id: "broken", adapter: "broken", adapterVersion: "0.0.0", toolchainAvailable: true },',
        "      evidence: [{",
        '        id: "evidence:main_test.go",',
        '        kind: "test",',
        '        path: "main_test.go",',
        '        status: "passed",',
        "        summary: `run ${runs}`,",
        '        provenance: { tier: "derived", sources: [{ path: "main_test.go" }], adapter: "broken", observedAt: ctx.now },',
        "      }],",
        "    };",
        "  },",
        "};",
        "",
      ].join("\n")
    );

    const run = conform(module, join(FIXTURES_DIR, "go-svc"));
    assert.equal(run.code, 2, run.stdout + run.stderr);
    assert.match(run.stdout, /^FAIL {2}statically discovered evidence is not reported as passed$/m);
    assert.match(run.stdout, /^FAIL {2}two runs produce identical output$/m);
    assert.match(run.stdout, /^broken: 2 check\(s\) failed$/m);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("surface-conform exits 1 when the module is not an adapter", () => {
  const dir = mkdtempSync(join(tmpdir(), "project-surface-conform-"));
  try {
    const module = join(dir, "nothing.mjs");
    writeFileSync(module, "export const nothing = 1;\n");
    const run = conform(module, join(FIXTURES_DIR, "go-svc"));
    assert.equal(run.code, 1, run.stdout + run.stderr);
    assert.match(run.stderr, /exports nothing that looks like an adapter/);

    const missing = conform(join(dir, "does-not-exist.mjs"), join(FIXTURES_DIR, "go-svc"));
    assert.equal(missing.code, 1);
    assert.match(missing.stderr, /Could not load/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("surface-conform without arguments prints usage and exits 1", () => {
  const run = conform();
  assert.equal(run.code, 1);
  assert.match(run.stdout, /Usage: surface-conform/);
  assert.equal(conform("--help").code, 0);
});
