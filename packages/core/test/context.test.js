import { test } from "node:test";
import assert from "node:assert/strict";
import { packContext } from "../dist/index.js";

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
