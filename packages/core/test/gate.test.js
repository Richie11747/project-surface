import { test } from "node:test";
import assert from "node:assert/strict";
import { gateChange, renderGateMarkdown, GATE_COMMENT_MARKER } from "../dist/index.js";

/**
 * The gate judges from the document alone. Each verdict has one deciding
 * fact; these fixtures set exactly that fact and nothing else.
 */

const HEAD = "a".repeat(40);
const OLD = "b".repeat(40);
const prov = { tier: "derived", sources: [{ path: "x" }], adapter: "t", observedAt: "2026-01-01T00:00:00Z" };
const cmd = (id, verification) => ({ id, run: `npm run ${id}`, cwd: ".", kind: "test", provenance: prov, confidence: 0.7, ...(verification ? { verification } : {}) });
const ev = (id, status, commandId) => ({ id, kind: "test", status, path: `tests/${id}.test.ts`, ...(commandId ? { commandId } : {}), provenance: prov, confidence: 0.7 });
const cap = (id, evidence, freshness, extra = {}) => ({
  id, title: id, owners: [{ path: `src/${id}.ts` }], contracts: [{ path: "docs/spec.md" }], evidence, environment: [], tags: [],
  provenance: prov, confidence: 0.7, ...(freshness ? { freshness: { status: freshness, reason: freshness === "stale" ? "Owner files changed since verification." : undefined } } : {}), ...extra,
});

function surface() {
  return {
    project: { packages: [] },
    commands: [
      cmd("test", { status: "passed", observedAt: "2026-01-01T00:00:00Z", commit: HEAD, dirty: false }),
      cmd("test:old", { status: "passed", observedAt: "2026-01-01T00:00:00Z", commit: OLD, dirty: false }),
      cmd("test:dirty", { status: "passed", observedAt: "2026-01-01T00:00:00Z", commit: HEAD, dirty: true }),
      cmd("test:bad", { status: "failed", observedAt: "2026-01-01T00:00:00Z", commit: HEAD, dirty: false }),
      cmd("test:legacy", { status: "passed", observedAt: "2026-01-01T00:00:00Z" }),
    ],
    evidence: [
      ev("here", "passed", "test"),
      ev("old", "passed", "test:old"),
      ev("dirty", "passed", "test:dirty"),
      ev("bad", "failed", "test:bad"),
      ev("legacy", "passed", "test:legacy"),
      ev("found", "unknown", "test"),
      ev("static", "unknown"),
    ],
    capabilities: [
      cap("proven", [{ id: "here", link: "import-graph" }], "fresh"),
      cap("carried", [{ id: "old", link: "import-graph" }], "fresh"),
      cap("stale", [{ id: "here", link: "import-graph" }], "stale"),
      cap("dirty", [{ id: "dirty", link: "import-graph" }], "fresh"),
      cap("legacy", [{ id: "legacy", link: "import-graph" }], "unknown"),
      cap("failing", [{ id: "bad", link: "import-graph" }], "fresh"),
      cap("found", [{ id: "found", link: "path-proximity" }], undefined),
      cap("static", [{ id: "static", link: "path-proximity" }], undefined),
      cap("nothing", [], undefined),
      cap("bystander", [{ id: "here", link: "import-graph" }], "fresh", { owners: [{ path: "src/elsewhere.ts" }], packageId: "api" }),
      cap("guess", [], undefined, { provenance: { ...prov, tier: "inferred" } }),
    ],
    constraints: [
      { id: "k:err", rule: "no provider in handlers", severity: "error", status: "active", checked: { status: "violated", violations: 1 }, provenance: prov, confidence: 1 },
      { id: "k:warn", rule: "small handlers", severity: "warn", status: "active", checked: { status: "violated", violations: 2 }, provenance: prov, confidence: 1 },
      { id: "k:ok", rule: "tests import", severity: "error", status: "active", checked: { status: "passed", violations: 0 }, provenance: prov, confidence: 1 },
    ],
    risks: [{ id: "r:mig", type: "migration", paths: ["db/migrations"], approval: "required", reason: "Schema changes are one-way.", provenance: prov, confidence: 1 }],
  };
}

const all = ["src/proven.ts", "src/carried.ts", "src/stale.ts", "src/dirty.ts", "src/legacy.ts", "src/failing.ts", "src/found.ts", "src/static.ts", "src/nothing.ts"];

test("each verdict follows from one fact about the proof", () => {
  const report = gateChange(surface(), all, "main", { head: HEAD, dirty: false });
  const verdicts = Object.fromEntries(report.capabilities.map((g) => [g.id, g.verdict]));
  assert.deepEqual(verdicts, {
    proven: "proven",
    carried: "carried",
    stale: "stale",
    dirty: "stale",
    legacy: "stale",
    failing: "failing",
    found: "unproven",
    static: "unproven",
    nothing: "unproven",
  });
  /* Worst first, so a reviewer reads the problem before the reassurance. */
  assert.deepEqual(report.capabilities.map((g) => g.verdict).slice(0, 2), ["failing", "unproven"]);
  assert.equal(report.capabilities.at(-1).verdict, "proven");
  assert.match(report.capabilities.find((g) => g.id === "carried").reasons.at(-1), /byte-identical/);
  assert.match(report.capabilities.find((g) => g.id === "dirty").reasons.at(-1), /dirty tree/);
  assert.match(report.capabilities.find((g) => g.id === "legacy").reasons[0], /no commit/);
});

test("a dirty-tree proof at this commit still counts while the tree is dirty, and the document itself is not a change", () => {
  const report = gateChange(surface(), ["src/dirty.ts", ".project/surface.json"], "main", { head: HEAD, dirty: true });
  assert.deepEqual(report.changedPaths, ["src/dirty.ts"]);
  assert.equal(report.capabilities[0].verdict, "proven");
  assert.match(report.capabilities[0].reasons.at(-1), /dirty tree/);
});

test("outside a repository the fingerprint is the anchor", () => {
  const report = gateChange(surface(), ["src/carried.ts", "src/legacy.ts"], "paths", {});
  const verdicts = Object.fromEntries(report.capabilities.map((g) => [g.id, g.verdict]));
  assert.deepEqual(verdicts, { carried: "proven", legacy: "stale" });
  assert.equal(report.head, undefined);
});

test("pass and strict: carried passes by default, error violations always block, warnings and approvals only under strict", () => {
  const s = surface();
  const lenient = gateChange(s, ["src/proven.ts", "src/carried.ts", "db/migrations/001.sql"], "main", { head: HEAD, dirty: false });
  assert.equal(lenient.pass, false, "an error-level violation blocks regardless of the change");
  assert.deepEqual(lenient.blocking, ['Constraint "no provider in handlers" is violated in 1 place(s).']);
  assert.ok(lenient.notes.some((n) => /^Approval required - migration/.test(n)));
  assert.ok(lenient.notes.some((n) => /small handlers/.test(n)));

  s.constraints = s.constraints.filter((k) => k.id !== "k:err");
  const passing = gateChange(s, ["src/proven.ts", "src/carried.ts"], "main", { head: HEAD, dirty: false });
  assert.equal(passing.pass, true);
  assert.deepEqual(passing.counts, { proven: 1, carried: 1, stale: 0, unproven: 0, failing: 0 });

  const strict = gateChange(s, ["src/proven.ts", "src/carried.ts", "db/migrations/001.sql"], "main", { head: HEAD, dirty: false, strict: true });
  assert.equal(strict.pass, false);
  assert.ok(strict.blocking.some((b) => b.startsWith("carried is carried")));
  assert.ok(strict.blocking.some((b) => /small handlers/.test(b)));
  assert.ok(strict.blocking.some((b) => /^Approval required - migration/.test(b)));
});

test("a contract that did not move while its capabilities did is one note per document, and package neighbours are context only", () => {
  const report = gateChange(surface(), ["src/proven.ts", "src/carried.ts"], "main", { head: HEAD, dirty: false });
  const contractNotes = report.notes.filter((n) => n.startsWith("docs/spec.md"));
  assert.equal(contractNotes.length, 1);
  assert.match(contractNotes[0], /2 capabilities it specifies did \(carried, proven\)/);
  assert.deepEqual(report.nearby, []);

  const touched = gateChange(surface(), ["src/proven.ts", "docs/spec.md"], "main", { head: HEAD, dirty: false });
  assert.ok(!touched.notes.some((n) => n.startsWith("docs/spec.md")), "a changed contract is not a note");

  const nothing = gateChange(surface(), ["README.md"], "main", { head: HEAD, dirty: false });
  assert.deepEqual(nothing.capabilities, []);
  assert.ok(nothing.notes.some((n) => /outside the surface/.test(n)));
});

test("an inferred capability is reported, never gated: a guess does not block a change", () => {
  const report = gateChange(surface(), ["src/guess.ts"], "main", { head: HEAD, dirty: false, strict: true });
  assert.deepEqual(report.capabilities, []);
  assert.deepEqual(report.inferred, ["guess"]);
  assert.ok(report.notes.some((n) => /1 inferred capability was touched and not gated \(guess\)/.test(n)));
  assert.ok(!report.notes.some((n) => /outside the surface/.test(n)));
  assert.ok(!report.blocking.some((b) => /guess/.test(b)));
});

test("the markdown receipt carries the marker, one row per capability, and is deterministic", () => {
  const s = surface();
  s.constraints = [];
  const report = gateChange(s, ["src/proven.ts", "src/failing.ts"], "main", { head: HEAD, dirty: false });
  const md = renderGateMarkdown(report);
  assert.ok(md.startsWith(GATE_COMMENT_MARKER));
  assert.match(md, /\*\*Does not pass\.\*\* 1 thing to do/);
  assert.match(md, /\| `failing` \| owner \| ❌ failing \|/);
  assert.match(md, /\| `proven` \| owner \| ✅ proven \|/);
  assert.equal(md, renderGateMarkdown(gateChange(s, ["src/failing.ts", "src/proven.ts"], "main", { head: HEAD, dirty: false })));
});
