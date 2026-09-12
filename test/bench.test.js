// @ts-check
/**
 * The benchmark's offline half: questions are well-formed, prompts build for
 * every question, the grader is fair, and the scorer is deterministic.
 * Nothing here touches the network.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildPrompt, grade, loadQuestions, listFixtureFiles, CONDITIONS } from "../bench/lib.mjs";

const SCORE = fileURLToPath(new URL("../bench/score.mjs", import.meta.url));

test("every question names a real fixture, a kind, and checkable ground truth inside that fixture", () => {
  const questions = loadQuestions();
  assert.equal(questions.length, 50);
  assert.equal(new Set(questions.map((q) => q.id)).size, 50, "ids are unique");
  for (const q of questions) {
    const files = new Set(listFixtureFiles(q.fixture));
    assert.ok(files.size > 0, `${q.id}: fixture ${q.fixture} has files`);
    assert.ok(typeof q.kind === "string" && q.kind.length > 0, `${q.id}: kind`);
    const kinds = Object.keys(q.expect);
    assert.ok(kinds.length > 0, `${q.id}: expects something`);
    for (const f of q.expect.files ?? []) assert.ok(files.has(f), `${q.id}: expected file ${f} exists in ${q.fixture}`);
    for (const e of q.expect.env ?? []) assert.match(e, /^[A-Z][A-Z0-9_]+$/, `${q.id}: env name ${e}`);
  }
});

test("both prompts build for every question and neither leaks an absolute path", async () => {
  for (const q of loadQuestions()) {
    for (const condition of CONDITIONS) {
      const prompt = await buildPrompt(condition, q.fixture, q.question);
      assert.ok(prompt.includes(q.question), `${condition}/${q.id} carries the question`);
      assert.doesNotMatch(prompt, /[A-Za-z]:\|\/Users\/|\/home\//, `${condition}/${q.id} leaks a machine path`);
    }
  }
});

test("grading is a set comparison, and an empty expectation rewards an empty answer", () => {
  const q = { expect: { files: ["a.ts", "b.ts"] } };
  assert.deepEqual(grade(q, { files: ["a.ts", "b.ts"] }).exact, true);
  const half = grade(q, { files: ["a.ts", "zzz.ts"] });
  assert.equal(half.exact, false);
  assert.equal(half.precision, 0.5);
  assert.equal(half.recall, 0.5);
  assert.equal(grade(q, { files: ["./a.ts", "b.ts"] }).exact, true, "path normalisation");

  const none = { expect: { files: [] } };
  assert.equal(grade(none, { files: [] }).exact, true);
  assert.equal(grade(none, { files: ["a.ts"] }).exact, false);

  const cmd = { expect: { commands: ["npm run test", "npm test"] } };
  assert.equal(grade(cmd, { commands: ["npm test"] }).exact, true);
  assert.equal(grade(cmd, { commands: ["cd api && npm run test"] }).exact, true);
  assert.equal(grade(cmd, { commands: ["yarn test"] }).exact, false);
});

test("the scorer is deterministic and --check agrees with the committed RESULTS.md", () => {
  const check = spawnSync(process.execPath, [SCORE, "--check"], { encoding: "utf8" });
  assert.equal(check.status, 0, `${check.stdout}${check.stderr}`);
  const before = readFileSync(fileURLToPath(new URL("../bench/RESULTS.md", import.meta.url)), "utf8");
  assert.equal(spawnSync(process.execPath, [SCORE], { encoding: "utf8" }).status, 0);
  const after = readFileSync(fileURLToPath(new URL("../bench/RESULTS.md", import.meta.url)), "utf8");
  assert.equal(after, before);
});
