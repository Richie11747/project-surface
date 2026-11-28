import { test } from "node:test";
import assert from "node:assert/strict";
import { canonicalRun, matchShellCommand, normaliseCwd, parseShellRun } from "../dist/index.js";

/*
 * The shell hook may only act on a line it can say, without guessing, runs
 * one documented command. Everything here errs towards "not matched": an
 * unmatched line is never blocked and never recorded.
 */

test("parseShellRun accepts one command, a leading cd and an output-trimming tail", () => {
  assert.deepEqual(parseShellRun("npm test"), { run: "npm test" });
  assert.deepEqual(parseShellRun("  npm run test  "), { run: "npm run test" });
  assert.deepEqual(parseShellRun("cd bench && npm run score"), { cd: "bench", run: "npm run score" });
  assert.deepEqual(parseShellRun('cd "my dir" && npm test'), { cd: "my dir", run: "npm test" });
  assert.deepEqual(parseShellRun("npm test 2>&1 | tail -20"), { run: "npm test" });
  assert.deepEqual(parseShellRun("npm test | head -n 40"), { run: "npm test" });
  assert.deepEqual(parseShellRun("npm test 2>&1"), { run: "npm test" });
});

test("parseShellRun refuses anything that chains, substitutes or redirects", () => {
  for (const line of [
    "",
    "npm test; rm -rf dist",
    "npm run build && npm test",
    "npm test || true",
    "npm test > out.txt",
    "npm test < in.txt",
    "echo $(npm test)",
    "echo `npm test`",
    "npm test &",
    "npm test\nnpm test",
    "npm test | grep fail",
    "cd a && cd b && npm test",
  ]) {
    assert.equal(parseShellRun(line), undefined, JSON.stringify(line));
  }
});

test("canonicalRun gives every spelling of a script one form", () => {
  assert.equal(canonicalRun("npm test"), "npm run test");
  assert.equal(canonicalRun("npm t"), "npm run test");
  assert.equal(canonicalRun("npm run test"), "npm run test");
  assert.equal(canonicalRun("npm run-script test"), "npm run test");
  assert.equal(canonicalRun("npm  run   typecheck"), "npm run typecheck");
  assert.equal(canonicalRun("yarn test"), "yarn run test");
  /* `pnpm build` may be a built-in, not the script: left alone. */
  assert.equal(canonicalRun("pnpm build"), "pnpm build");
  assert.equal(canonicalRun("cargo test"), "cargo test");
  assert.equal(canonicalRun("npm test -- --watch"), "npm run test -- --watch");
});

test("normaliseCwd treats every spelling of a directory alike", () => {
  assert.equal(normaliseCwd("."), ".");
  assert.equal(normaliseCwd(""), ".");
  assert.equal(normaliseCwd("./bench/"), "bench");
  assert.equal(normaliseCwd("bench/."), "bench");
  assert.equal(normaliseCwd("packages\\core"), "packages/core");
});

test("matchShellCommand matches by canonical run and directory, first in document order", () => {
  const commands = [
    { id: "test", run: "npm run test", cwd: "." },
    { id: "test-alias", run: "npm test", cwd: "." },
    { id: "score", run: "npm run score", cwd: "bench" },
  ];
  assert.equal(matchShellCommand(commands, "npm t", ".")?.id, "test");
  assert.equal(matchShellCommand(commands, "npm run score", "./bench")?.id, "score");
  assert.equal(matchShellCommand(commands, "npm run score", "."), undefined);
  assert.equal(matchShellCommand(commands, "npm test", "bench"), undefined);
  assert.equal(matchShellCommand(commands, "npm run lint", "."), undefined);
});
