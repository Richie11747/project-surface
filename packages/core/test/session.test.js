import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MAX_ATTEMPTS,
  appendAttempt,
  appendPack,
  assessAttempt,
  assessHistory,
  attemptFrom,
  emptyLedger,
  failureSignature,
  normaliseOutput,
  readLedger,
  renderSessionLine,
  resetLedger,
  servedIndex,
  sessionSummary,
  taskKey,
  writeLedger,
  SESSION_FILE,
} from "../dist/index.js";

/*
 * The session ledger says three things and nothing else: a failed run on an
 * unchanged tree cannot come out differently; the same failure across
 * different edits means the edits are not reaching it; pass and fail on the
 * same tree means the result is not about the code. Every rule is keyed to
 * the working-tree fingerprint, and skipped - not guessed - without one.
 */

const NOW = "2026-01-01T00:00:00Z";
const cmd = { id: "test", run: "npm test", cwd: "." };
const failed = (summary, exitCode = 1) => ({ status: "failed", exitCode, observedAt: NOW, summary, durationMs: 10 });
const passed = () => ({ status: "passed", exitCode: 0, observedAt: NOW, durationMs: 10 });

function ledgerWith(...attempts) {
  let ledger = emptyLedger(NOW);
  for (const [tree, record] of attempts) ledger = appendAttempt(ledger, attemptFrom("cli", cmd, tree, record), NOW).ledger;
  return ledger;
}

test("normalised output ignores what varies between identical runs", () => {
  const a = "FAIL src/x.test.ts:12:5 expected 1 got 2 (312 ms) at 2026-01-01T10:00:00Z commit deadbeef1234";
  const b = "FAIL src/x.test.ts:14:9 expected 1 got 2 (1.2 s) at 2026-03-04T11:22:33Z commit cafebabe9999";
  assert.equal(normaliseOutput(a), normaliseOutput(b));
  assert.equal(failureSignature(failed(a)), failureSignature(failed(b)));
  assert.notEqual(failureSignature(failed(a)), failureSignature(failed(a, 2)));
  assert.equal(failureSignature(passed()), null);
});

test("a failed run on an unchanged tree is flagged before it runs; a changed tree is not", () => {
  const ledger = ledgerWith(["tree-1", failed("boom")]);
  const same = assessAttempt(ledger, attemptFrom("cli", cmd, "tree-1"));
  assert.deepEqual(same.map((s) => s.kind), ["unchanged-rerun"]);
  assert.match(same[0].message, /attempt #1/);
  assert.deepEqual(assessAttempt(ledger, attemptFrom("cli", cmd, "tree-2")), []);
  /* A passing run on the same tree is not a loop. */
  assert.deepEqual(assessAttempt(ledgerWith(["tree-1", passed()]), attemptFrom("cli", cmd, "tree-1")), []);
});

test("outside git there is no tree, so the unchanged-rerun rule is skipped rather than guessed", () => {
  const ledger = ledgerWith([null, failed("boom")]);
  assert.deepEqual(assessAttempt(ledger, attemptFrom("cli", cmd, null)), []);
  assert.equal(sessionSummary(ledger).treeKnown, false);
});

test("the same failure across three different trees says the edits are not reaching it", () => {
  const ledger = ledgerWith(["t1", failed("boom")], ["t2", failed("boom")], ["t3", failed("boom")]);
  const signals = assessHistory(ledger, attemptFrom("cli", cmd, "t3"));
  assert.deepEqual(signals.map((s) => s.kind), ["same-failure"]);
  assert.deepEqual(signals[0].attempts, [1, 2, 3]);
  /* Three runs on one tree is the unchanged-rerun case, not this one. */
  const oneTree = ledgerWith(["t1", failed("boom")], ["t1", failed("boom")], ["t1", failed("boom")]);
  assert.deepEqual(assessHistory(oneTree, attemptFrom("cli", cmd, "t1")).map((s) => s.kind), []);
  /* A different failure breaks the run. */
  const mixed = ledgerWith(["t1", failed("boom")], ["t2", failed("other")], ["t3", failed("boom")]);
  assert.deepEqual(assessHistory(mixed, attemptFrom("cli", cmd, "t3")), []);
});

test("pass and fail on an identical tree is flapping, reported as information", () => {
  const ledger = ledgerWith(["t1", failed("boom")], ["t1", passed()]);
  const signals = assessHistory(ledger, attemptFrom("cli", cmd, "t1"));
  assert.deepEqual(signals.map((s) => [s.kind, s.severity]), [["flapping", "info"]]);
});

test("commands are keyed by id, run and cwd, so two stacks' `test` do not share a history", () => {
  const ledger = ledgerWith(["t1", failed("boom")]);
  const other = { id: "test", run: "cargo test", cwd: "crates/x" };
  assert.deepEqual(assessAttempt(ledger, attemptFrom("cli", other, "t1")), []);
});

test("the ledger rotates at its cap and numbers attempts and packs from one sequence", () => {
  let ledger = emptyLedger(NOW);
  for (let i = 0; i < MAX_ATTEMPTS + 5; i += 1) {
    ledger = appendAttempt(ledger, attemptFrom("cli", cmd, "t", passed()), NOW).ledger;
  }
  assert.equal(ledger.attempts.length, MAX_ATTEMPTS);
  assert.equal(ledger.attempts[0].seq, 6);
  const { pack } = appendPack(
    ledger,
    { source: "mcp", task: "x", taskKey: "x", tree: "t", files: [], usedTokens: 0, savedTokens: 0 },
    NOW
  );
  assert.equal(pack.seq, MAX_ATTEMPTS + 6);
});

test("served index keeps the latest key per path, and task keys ignore word order and stopwords", () => {
  let ledger = emptyLedger(NOW);
  const packOf = (task, files) => ({ source: "cli", task, taskKey: task, tree: null, files, usedTokens: 0, savedTokens: 0 });
  ledger = appendPack(ledger, { ...packOf("a", [{ path: "src/a.ts", key: "1:1", tokens: 5 }]), usedTokens: 5 }, NOW).ledger;
  ledger = appendPack(
    ledger,
    {
      ...packOf("b", [
        { path: "src/a.ts", key: "2:2", tokens: 5 },
        { path: "src/b.ts", key: "3:3", tokens: 7 },
      ]),
      usedTokens: 12,
    },
    NOW
  ).ledger;
  const index = servedIndex(ledger);
  assert.deepEqual(index.get("src/a.ts"), { key: "2:2", seq: 2 });
  assert.deepEqual(index.get("src/b.ts"), { key: "3:3", seq: 2 });
  assert.equal(taskKey("Add the checkout status field"), taskKey("status field for checkout"));
  const summary = sessionSummary(ledger);
  assert.equal(summary.tokensServed, 17);
  assert.deepEqual(summary.frequent[0], { path: "src/a.ts", times: 2 });
  assert.match(renderSessionLine(summary), /0 runs, 2 context packs/);
});

test("the store round-trips, treats a missing or corrupt file as an empty session, and forgets on reset", () => {
  const root = mkdtempSync(join(tmpdir(), "project-surface-session-"));
  try {
    assert.deepEqual(readLedger(root, NOW), emptyLedger(NOW));
    const ledger = ledgerWith(["t1", failed("boom")]);
    writeLedger(root, ledger);
    assert.ok(existsSync(join(root, SESSION_FILE)));
    assert.deepEqual(readLedger(root, NOW), ledger);
    assert.ok(readFileSync(join(root, SESSION_FILE), "utf8").endsWith("\n"));

    writeFileSync(join(root, SESSION_FILE), "{ not json");
    assert.deepEqual(readLedger(root, NOW), emptyLedger(NOW));
    writeFileSync(join(root, SESSION_FILE), JSON.stringify({ version: 2 }));
    assert.deepEqual(readLedger(root, NOW), emptyLedger(NOW));

    assert.equal(resetLedger(root), true);
    assert.equal(resetLedger(root), false);
    assert.ok(!existsSync(join(root, SESSION_FILE)));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
