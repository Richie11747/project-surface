import { test } from "node:test";
import assert from "node:assert/strict";
import { packContext, rankCapabilities, relevantConstraints, sliceAround } from "../dist/index.js";

/**
 * The context pack is sized without opening files unless content was asked
 * for, carries the trust of the claim behind every item, and prefers a proven
 * claim over an unproven one when relevance ties.
 */

const prov = (tier) => ({ tier, sources: [{ path: "x" }], adapter: "t", observedAt: "2026-01-01T00:00:00Z" });
const cap = (id, tier, freshness, extra = {}) => ({
  id, title: `${id} handler`, owners: [{ path: `src/${id}.ts` }], contracts: [], evidence: [], environment: [], tags: [],
  provenance: prov(tier), confidence: 0.7, ...(freshness ? { freshness: { status: freshness } } : {}), ...extra,
});

function surface() {
  return {
    commands: [{ id: "test", run: "npm test", cwd: ".", kind: "test", provenance: prov("derived"), confidence: 0.7 }],
    evidence: [{ id: "ev:a", kind: "test", status: "passed", path: "tests/a.test.ts", commandId: "test", provenance: prov("derived"), confidence: 0.7 }],
    capabilities: [
      cap("a", "declared", "fresh", { evidence: [{ id: "ev:a", link: "declared" }], contracts: [{ path: "docs/a.md" }] }),
      cap("b", "inferred", "stale"),
      cap("c", "derived", undefined),
    ],
    constraints: [],
  };
}

function access(sizes, log) {
  return {
    size: (p) => (log.push(`size ${p}`), sizes[p] ?? null),
    read: (p) => (log.push(`read ${p}`), p in sizes ? "x".repeat(sizes[p]) : null),
  };
}

test("a pack of paths costs a size probe per file and never a read", () => {
  const log = [];
  const pack = packContext(surface(), "handler", access({ "src/a.ts": 400, "docs/a.md": 80, "tests/a.test.ts": 120, "src/b.ts": 40, "src/c.ts": 40 }, log));
  assert.ok(log.every((l) => l.startsWith("size ")), log.join(", "));
  assert.equal(pack.usedTokens, 100 + 20 + 30 + 10 + 10);
  assert.ok(pack.items.every((i) => i.content === undefined));
});

test("with content, the body is read once and its length is the estimate", () => {
  const log = [];
  const pack = packContext(surface(), "handler", access({ "src/a.ts": 400, "docs/a.md": 80, "tests/a.test.ts": 120, "src/b.ts": 40, "src/c.ts": 40 }, log), { includeContent: true });
  assert.ok(log.every((l) => l.startsWith("read ")), log.join(", "));
  assert.equal(log.filter((l) => l === "read src/a.ts").length, 1);
  assert.equal(pack.items.find((i) => i.path === "src/a.ts").content.length, 400);
});

test("every item carries the tier and freshness of its claim, and a proven claim outranks an unproven tie", () => {
  const pack = packContext(surface(), "handler", access({ "src/a.ts": 4, "docs/a.md": 4, "tests/a.test.ts": 4, "src/b.ts": 4, "src/c.ts": 4 }, []));
  /* All three match "handler" equally and share a confidence: fresh, then never verified, then stale. */
  assert.deepEqual(pack.capabilities.map((c) => [c.id, c.tier, c.freshness]), [
    ["a", "declared", "fresh"],
    ["c", "derived", "unknown"],
    ["b", "inferred", "stale"],
  ]);
  assert.deepEqual(pack.items.find((i) => i.path === "src/b.ts").trust, { tier: "inferred", freshness: "stale" });
  assert.deepEqual(pack.items.find((i) => i.path === "tests/a.test.ts").trust, { tier: "declared", freshness: "fresh" });
  assert.match(pack.items.find((i) => i.path === "tests/a.test.ts").reason, /last passed/);
});

test("a file that cannot be served is omitted with a reason, and a bare reader still works", () => {
  const pack = packContext(surface(), "handler", (p) => (p === "src/a.ts" ? "abcd" : null));
  assert.deepEqual(pack.items.map((i) => i.path), ["src/a.ts"]);
  assert.equal(pack.items[0].estimatedTokens, 1);
  assert.ok(pack.omitted.some((o) => o.path === "docs/a.md" && /missing|unreadable/.test(o.reason)));
});

/* ---- Sessions, slices, rules and ranking -------------------------------- */

function statAccess(files, log = []) {
  return {
    size: (p) => (log.push(`size ${p}`), p in files ? files[p].length : null),
    read: (p) => (log.push(`read ${p}`), files[p] ?? null),
    stat: (p) => (p in files ? { size: files[p].length, key: `${files[p].length}:1` } : null),
  };
}

test("a file served earlier and unchanged is listed, not charged, and its tokens are reported as saved", () => {
  const files = { "src/a.ts": "x".repeat(400), "docs/a.md": "y".repeat(80), "tests/a.test.ts": "z".repeat(120), "src/b.ts": "b".repeat(40), "src/c.ts": "c".repeat(40) };
  const served = new Map([["src/a.ts", { key: "400:1", seq: 3 }], ["src/b.ts", { key: "stale-key", seq: 2 }]]);
  const pack = packContext(surface(), "handler", statAccess(files), { served, includeContent: true });
  const a = pack.items.find((i) => i.path === "src/a.ts");
  assert.deepEqual(a.repeat, { since: 3 });
  assert.equal(a.content, undefined);
  assert.match(a.reason, /pack #3/);
  /* b's key moved, so it is served again in full. */
  assert.equal(pack.items.find((i) => i.path === "src/b.ts").repeat, undefined);
  assert.equal(pack.repeated, 1);
  assert.equal(pack.savedTokens, 100);
  assert.equal(pack.usedTokens, 20 + 30 + 10 + 10);
  assert.ok(pack.items.every((i) => typeof i.key === "string"));
});

test("a file that does not fit is sliced around its locator instead of dropped; one without a locator is dropped", () => {
  const body = ["import x from 'y';", "", "export function other() {", "  return 1;", "}", "", "export function target() {", "  return 2;", "}", "", "export const tail = 3;"].join("\n");
  const s = surface();
  s.capabilities = [
    cap("a", "declared", "fresh", { owners: [{ path: "src/a.ts", locator: "export:target" }] }),
    cap("b", "derived", undefined, { owners: [{ path: "src/b.ts" }] }),
  ];
  const files = { "src/a.ts": body, "src/b.ts": "b".repeat(400) };
  const pack = packContext(s, "handler", statAccess(files), { budgetTokens: 30 });
  const a = pack.items.find((i) => i.path === "src/a.ts");
  assert.equal(a.partial, true);
  assert.deepEqual(a.range, { start: 7, end: 10 });
  assert.match(a.reason, /Sliced around export:target \(L7-L10\)/);
  assert.deepEqual(pack.omitted.map((o) => o.path), ["src/b.ts"]);
  assert.ok(pack.usedTokens <= 30);
});

test("sliceAround understands line and export locators and nothing else", () => {
  const lines = Array.from({ length: 300 }, (_, i) => `line ${i + 1}`).join("\n");
  assert.deepEqual(sliceAround(lines, "L5").range, { start: 5, end: 124 });
  assert.deepEqual(sliceAround(lines, "L5-L9").range, { start: 5, end: 9 });
  assert.equal(sliceAround(lines, "L999"), null);
  assert.equal(sliceAround(lines, "capabilities[3]"), null);
  assert.equal(sliceAround(lines, "scripts.test"), null);
  assert.equal(sliceAround("def other():\n  pass\n", "export:missing"), null);
  const py = "import os\n\ndef handler(req):\n    return 1\n\nclass Other:\n    pass\n";
  assert.deepEqual(sliceAround(py, "export:handler"), { text: "def handler(req):\n    return 1\n", range: { start: 3, end: 5 } });
});

test("rules: error severity always; a scoped check only when it covers a pack path; the rest counted", () => {
  const prov = { tier: "declared", sources: [{ path: ".project/surface.declare.yaml" }], adapter: "t", observedAt: "2026-01-01T00:00:00Z" };
  const s = surface();
  s.constraints = [
    { id: "c:err", rule: "err", severity: "error", status: "active", provenance: prov, confidence: 1 },
    { id: "c:pay", rule: "pay", severity: "warn", status: "active", provenance: prov, confidence: 1, check: { kind: "forbid-import", from: ["src/payments/**"], to: ["stripe"] } },
    { id: "c:src", rule: "src", severity: "warn", status: "active", provenance: prov, confidence: 1, check: { kind: "require-test", paths: ["src/**"] } },
    { id: "c:prose", rule: "prose", severity: "info", status: "active", provenance: { ...prov, sources: [{ path: "docs/a.md" }] }, confidence: 1 },
    { id: "c:old", rule: "old", severity: "error", status: "stale", provenance: prov, confidence: 1 },
  ];
  const { constraints, omitted } = relevantConstraints(s, ["src/a.ts", "docs/a.md"]);
  assert.deepEqual(constraints.map((c) => c.id), ["c:err", "c:src", "c:prose"]);
  assert.equal(omitted, 1);
  const pack = packContext(s, "handler", statAccess({ "src/a.ts": "x", "docs/a.md": "y", "tests/a.test.ts": "z", "src/b.ts": "b", "src/c.ts": "c" }));
  assert.equal(pack.constraintsOmitted, 1);
  const all = packContext(s, "handler", statAccess({ "src/a.ts": "x" }), { allConstraints: true });
  assert.equal(all.constraints.length, 4);
  assert.equal(all.constraintsOmitted, 0);
});

test("ranking: a whole word beats a prefix beats a substring; aliases and routes count; stopwords do not", () => {
  const s = surface();
  s.capabilities = [
    cap("author.list", "derived", undefined),
    cap("auth.verify", "derived", undefined, { title: "Verify a token" }),
    cap("authentication", "derived", undefined, { aliases: ["login"] }),
    cap("checkout.create", "derived", undefined, { route: { method: "POST", path: "/checkout" } }),
  ];
  assert.deepEqual(rankCapabilities(s, "auth").map((r) => r.capability.id), ["auth.verify", "authentication", "author.list"]);
  assert.deepEqual(rankCapabilities(s, "login").map((r) => r.capability.id), ["authentication"]);
  assert.deepEqual(rankCapabilities(s, "POST /checkout").map((r) => r.capability.id), ["checkout.create"]);
  assert.deepEqual(rankCapabilities(s, "the a an").map((r) => r.capability.id).length, 4);
  assert.deepEqual(rankCapabilities(s, "nothing-here"), []);
});
