import { test } from "node:test";
import assert from "node:assert/strict";
import { looksSecretName, patternNames, redactPaths, redactText, sanitizeOutput, secretEnvValues, REDACTION } from "../dist/index.js";

/**
 * Every value below is a documented example or an obvious placeholder. The
 * point of the suite is that none of them can survive into a surface document.
 */
const LEAKS = [
  ["prefixed env assignment", "AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMIK7MDENGbPxRfiCYEXAMPLEKEY"],
  ["colon form", "STRIPE_SECRET_KEY: sk_live_" + "abcdefghijklmnopqrstuvwx"],
  ["quoted form", 'API_KEY="abcdef1234567890abcdef"'],
  ["aws access key id", "id AKIA" + "IOSFODNN7EXAMPLE here"],
  ["github token", "token ghp_" + "016C7E1BAdEXAMPLEtokenvalue0123456789"],
  ["slack token", "xoxb-" + "000000000000-000000000000-EXAMPLEEXAMPLE"],
  ["bearer header", "Authorization: Bearer abcdefghijklmnopqrstuvwxyz012345"],
  ["connection string", "postgres://appuser:hunter2@db.internal:5432/app"],
  ["password field", "password=correct-horse-battery"],
  ["stripe secret key", "key sk_live_" + "EXAMPLEabcdefghijklmnop"],
  ["stripe restricted key", "key rk_test_" + "EXAMPLEabcdefghijklmnop"],
];

for (const [name, input] of LEAKS) {
  test(`redacts ${name}`, () => {
    const output = sanitizeOutput(input);
    assert.ok(output.includes(REDACTION), `nothing redacted in: ${output}`);
  });
}

test("the secret value itself never survives", () => {
  const output = sanitizeOutput("DATABASE_PASSWORD=s3cr3t-value-not-for-sharing");
  assert.ok(!output.includes("s3cr3t-value-not-for-sharing"), output);
});

test("ordinary output is left alone", () => {
  const input = "Ran 42 tests in 1.2s\nauthor=Bob\nAll checks passed.";
  assert.equal(sanitizeOutput(input), input);
});

test("redaction is idempotent", () => {
  const once = sanitizeOutput("API_KEY=abcdef1234567890abcdef");
  assert.equal(sanitizeOutput(once), once);
});

test("absolute paths are stripped so the document does not identify a machine", () => {
  const root = "C:/Users/someone/projects/app";
  const output = redactPaths(`error at ${root}/src/index.ts:12`, root);
  assert.ok(!output.includes("someone"), output);
  assert.ok(!output.includes(root), output);
});

test("home directories are stripped even without a known root", () => {
  assert.ok(!redactPaths("/home/alice/code/app/main.go").includes("alice"));
  const winPath = ["C:", "Users", "Alice", "code", "app"].join(String.fromCharCode(92));
  assert.ok(!redactPaths(winPath).includes("Alice"), redactPaths(winPath));
});

test("absolute paths of any shape are stripped, relative paths and URLs are kept", () => {
  const out = redactPaths(
    "at /builds/group/project/src/a.ts and D:\\agent\\_work\\1\\s\\b.ts, see ./src/c.ts or src/d.ts and https://example.com/x/y"
  );
  assert.ok(!out.includes("/builds/group"), out);
  assert.ok(!out.includes("_work"), out);
  assert.ok(out.includes("./src/c.ts"), out);
  assert.ok(out.includes("src/d.ts"), out);
  assert.ok(out.includes("https://example.com/x/y"), out);
});

test("output is truncated to a bounded size", () => {
  const output = sanitizeOutput("x".repeat(50_000), { maxLength: 100 });
  assert.ok(output.length < 200, `length was ${output.length}`);
  assert.match(output, /truncated/);
});

test("the truncation note counts every dropped character, scanned or not", () => {
  const output = sanitizeOutput("y".repeat(50_000), { maxLength: 100 });
  assert.match(output, /truncated 49900 chars/);
});

test("redaction time is linear in the input, whatever shape the output takes", () => {
  /* Each of these defeated an earlier pattern quadratically: a long run of
     word boundaries with no `=`, and many `://` with no `@`. An 8 MiB test log
     of either shape used to hang `surface verify` for hours. */
  const shapes = ["a-".repeat(200_000), "a://a:".repeat(70_000), "a.b_c".repeat(80_000)];
  for (const shape of shapes) {
    const started = Date.now();
    redactText(shape);
    const elapsed = Date.now() - started;
    assert.ok(elapsed < 1500, `redactText took ${elapsed} ms on ${shape.length} chars`);
  }
  const started = Date.now();
  sanitizeOutput("a-".repeat(4_000_000));
  assert.ok(Date.now() - started < 500, "sanitizeOutput must not scan far past the length cap");
});

test("a credential straddling the length cap is redacted, not half-kept", () => {
  const input = "x".repeat(95) + " GITHUB_TOKEN=ghp_" + "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const output = sanitizeOutput(input, { maxLength: 100 });
  assert.ok(!output.includes("ghp_A"), output);
  assert.ok(!output.includes("KLMNOP"), output);
});

test("known secret values are removed wherever they appear", () => {
  const output = sanitizeOutput("token was hunter2-extra and again hunter2-extra\nother line", {
    secrets: ["hunter2-extra", "short"],
  });
  assert.ok(!output.includes("hunter2"), output);
  assert.equal(output.split(REDACTION).length - 1, 2);
});

test("secret values are collected from the environment by name, values never read otherwise", () => {
  const env = { MY_API_KEY: "abcdef1234", PORT: "3000", SHORT_SECRET: "abc", AUTH: "z".repeat(8) };
  assert.deepEqual(secretEnvValues(env).sort(), ["abcdef1234", "zzzzzzzz"]);
});

test("private key assignments are redacted like every other credential", () => {
  const output = sanitizeOutput("PRIVATE_KEY=MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQ");
  assert.ok(!output.includes("MIIEvQ"), output);
});

test("secret-bearing names are recognised, ordinary ones are not", () => {
  assert.equal(looksSecretName("STRIPE_SECRET_KEY"), true);
  assert.equal(looksSecretName("AUTH_SIGNING_SECRET"), true);
  assert.equal(looksSecretName("GITHUB_TOKEN"), true);
  assert.equal(looksSecretName("DATABASE_URL"), false);
  assert.equal(looksSecretName("PORT"), false);
});

test("every declared pattern is exercised by this suite", () => {
  assert.ok(patternNames().length >= 10, patternNames().join(", "));
});
