import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateFreshness, fingerprintFiles, hashContent } from "../dist/index.js";

const NOW = "2026-08-22T12:00:00Z";

test("a claim that was never verified is unknown, not fresh and not stale", () => {
  const f = evaluateFreshness({ now: NOW, currentFingerprint: "abc" });
  assert.equal(f.status, "unknown");
  assert.match(f.reason ?? "", /Never verified/);
});

test("an unchanged fingerprint keeps a claim fresh", () => {
  const f = evaluateFreshness({
    now: NOW,
    verifiedAt: "2026-08-22T11:00:00Z",
    previousFingerprint: "abc",
    currentFingerprint: "abc",
  });
  assert.equal(f.status, "fresh");
});

test("a changed owner file makes the claim stale", () => {
  const f = evaluateFreshness({
    now: NOW,
    verifiedAt: "2026-08-22T11:00:00Z",
    previousFingerprint: "abc",
    currentFingerprint: "xyz",
  });
  assert.equal(f.status, "stale");
  assert.match(f.reason ?? "", /changed since verification/);
});

test("the stored fingerprint is the verification anchor, so staleness cannot self-heal", () => {
  const stale = evaluateFreshness({
    now: NOW,
    verifiedAt: "2026-08-22T11:00:00Z",
    previousFingerprint: "anchor",
    currentFingerprint: "changed",
  });
  assert.equal(stale.status, "stale");
  /* The anchor must survive, or the next scan would compare "changed" against
     itself and silently declare the claim fresh again. */
  assert.equal(stale.ownersFingerprint, "anchor");

  const rescan = evaluateFreshness({
    now: NOW,
    verifiedAt: "2026-08-22T11:00:00Z",
    previousFingerprint: stale.ownersFingerprint,
    currentFingerprint: "changed",
  });
  assert.equal(rescan.status, "stale");
});

test("verification expires on its own after the TTL", () => {
  const f = evaluateFreshness({
    now: NOW,
    verifiedAt: "2026-01-01T00:00:00Z",
    previousFingerprint: "abc",
    currentFingerprint: "abc",
    staleAfterDays: 14,
  });
  assert.equal(f.status, "stale");
  assert.match(f.reason ?? "", /days old/);
});

test("fingerprints ignore file order", () => {
  const a = fingerprintFiles([
    { path: "b.ts", hash: "2" },
    { path: "a.ts", hash: "1" },
  ]);
  const b = fingerprintFiles([
    { path: "a.ts", hash: "1" },
    { path: "b.ts", hash: "2" },
  ]);
  assert.equal(a, b);
});

test("fingerprints change when any owner changes", () => {
  const before = fingerprintFiles([{ path: "a.ts", hash: hashContent("one") }]);
  const after = fingerprintFiles([{ path: "a.ts", hash: hashContent("two") }]);
  assert.notEqual(before, after);
});
