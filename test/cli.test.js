// @ts-check
/**
 * End-to-end: the CLI on a throwaway copy of the TypeScript fixture.
 *
 * This is the README walkthrough, run for real. In particular it pins the exit
 * code contract - `doctor` exits 2 on drift, which is what lets CI gate on it.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { FIXTURES_DIR } from "../scripts/fixture-snapshot.mjs";

const CLI = fileURLToPath(new URL("../packages/cli/dist/index.js", import.meta.url));

function surface(root, command, ...args) {
  const result = spawnSync(process.execPath, [CLI, command, "--root", root, ...args], {
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" },
  });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

function freshCopy() {
  const dir = mkdtempSync(join(tmpdir(), "project-surface-cli-"));
  cpSync(join(FIXTURES_DIR, "ts-api"), dir, { recursive: true });
  rmSync(join(dir, "expected.surface.json"), { force: true });
  return dir;
}

test("init writes a valid document and inspect reads it back", () => {
  const root = freshCopy();
  try {
    const init = surface(root, "init");
    assert.equal(init.code, 0, init.stderr);
    assert.ok(existsSync(join(root, ".project", "surface.json")));
    assert.match(init.stdout, /capabilities\s+9/);

    const inspect = surface(root, "inspect", "checkout.create", "--json");
    assert.equal(inspect.code, 0, inspect.stderr);
    const doc = JSON.parse(inspect.stdout);
    assert.match(JSON.stringify(doc), /src\/checkout\/create\.ts/);

    const doctor = surface(root, "doctor");
    assert.equal(doctor.code, 0, `doctor should be clean on a fresh scan:\n${doctor.stdout}${doctor.stderr}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a verified claim goes stale when its owner file changes, and doctor --strict exits 2", () => {
  const root = freshCopy();
  try {
    assert.equal(surface(root, "init").code, 0);

    /* Simulate verification without running anything: stamp the claim as
       verified against the current fingerprint, exactly as `verify` would. */
    const file = join(root, ".project", "surface.json");
    const doc = JSON.parse(readFileSync(file, "utf8"));
    const claim = doc.capabilities.find((c) => c.id === "checkout.create");
    assert.ok(claim, "fixture must expose checkout.create");
    claim.freshness = { ...claim.freshness, status: "fresh", verifiedAt: doc.generatedAt };
    writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`);

    const owner = join(root, "src", "checkout", "create.ts");
    writeFileSync(owner, `${readFileSync(owner, "utf8")}\n// touched\n`);

    assert.equal(surface(root, "init").code, 0);

    /* A stale claim is a warning: reported always, fatal only under --strict.
       That split is what lets CI choose between "inform" and "gate". */
    const doctor = surface(root, "doctor");
    assert.equal(doctor.code, 0, `${doctor.stdout}${doctor.stderr}`);
    assert.match(doctor.stdout, /STALE_CLAIM \[checkout\.create\]/);

    const strict = surface(root, "doctor", "--strict");
    assert.equal(strict.code, 2, `expected drift exit code 2 under --strict:\n${strict.stdout}${strict.stderr}`);

    const json = surface(root, "doctor", "--json");
    const report = JSON.parse(json.stdout);
    assert.ok(report.findings.some((f) => f.code === "STALE_CLAIM" && f.subject.id === "checkout.create"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("verify runs a recorded command and promotes the capability it proves", () => {
  const root = freshCopy();
  try {
    assert.equal(surface(root, "init").code, 0);

    const verify = surface(root, "verify", "--command", "test", "--json");
    assert.equal(verify.code, 0, verify.stderr);
    const report = JSON.parse(verify.stdout);
    assert.equal(report.results[0].id, "test");
    assert.equal(report.results[0].status, "passed");
    assert.deepEqual(report.warnings, []);

    /* No second init: verify rebuilds the document itself. */
    const inspect = surface(root, "inspect", "checkout.create", "--json");
    const doc = JSON.parse(inspect.stdout);
    const claim = doc.capability ?? doc;
    assert.equal(claim.freshness.status, "fresh");
    assert.ok(claim.confidence >= 0.95, `confidence ${claim.confidence}`);

    const evidence = JSON.parse(readFileSync(join(root, ".project", "surface.json"), "utf8")).evidence;
    assert.ok(evidence.some((e) => e.status === "passed"), "evidence should record the observed pass");

    /* `why` must reproduce the recorded number from the document alone, and
       name the promotion the passing test earned. */
    const why = surface(root, "why", "checkout.create", "--json");
    assert.equal(why.code, 0, why.stderr);
    const explanation = JSON.parse(why.stdout);
    assert.equal(explanation.consistent, true, JSON.stringify(explanation.trace));
    assert.equal(explanation.trace.score, claim.confidence);
    assert.equal(explanation.promotion?.from, "derived");
    assert.equal(explanation.promotion?.to, "verified");
    assert.ok(explanation.evidence.some((e) => e.status === "passed"));
    assert.ok(explanation.trace.steps.some((s) => s.rule === "tier-floor"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("verify --stale re-proves exactly the stale claims, and is a no-op when nothing is stale", () => {
  const root = freshCopy();
  try {
    assert.equal(surface(root, "init").code, 0);
    assert.equal(surface(root, "verify", "--command", "test").code, 0);

    /* Nothing is stale yet: a clean result, exit 0, nothing run. CI runs this
       unconditionally and must not fail on a quiet day. */
    const quiet = surface(root, "verify", "--stale", "--json");
    assert.equal(quiet.code, 0, quiet.stderr);
    assert.deepEqual(JSON.parse(quiet.stdout).results, []);

    const owner = join(root, "src", "checkout", "create.ts");
    writeFileSync(owner, `${readFileSync(owner, "utf8")}\n// touched\n`);
    assert.equal(surface(root, "init").code, 0);
    const doctor = JSON.parse(surface(root, "doctor", "--json").stdout);
    const stale = doctor.findings.filter((f) => f.code === "STALE_CLAIM").map((f) => f.subject.id);
    assert.ok(stale.includes("checkout.create"), stale.join(", "));
    assert.match(doctor.findings.find((f) => f.code === "STALE_CLAIM").remediation, /verify --stale/);

    const verify = surface(root, "verify", "--stale", "--json");
    assert.equal(verify.code, 0, verify.stderr);
    const report = JSON.parse(verify.stdout);
    assert.equal(report.selection.mode, "stale");
    /* Every stale claim is named, they all resolve to the one test command,
       and none falls back to a package guess: the fixture binds its evidence. */
    assert.deepEqual(report.selection.capabilities.map((c) => c.id).sort(), stale.sort());
    assert.ok(report.selection.capabilities.every((c) => c.commandIds.length === 1 && c.fallback === false));
    assert.deepEqual(report.selection.commandIds, ["test"]);
    assert.equal(report.results.length, 1);
    assert.deepEqual(report.refreshed.sort(), stale.sort());
    assert.deepEqual(report.stillStale, []);

    const inspect = JSON.parse(surface(root, "inspect", "checkout.create", "--json").stdout);
    assert.equal((inspect.capability ?? inspect).freshness.status, "fresh");
    const after = JSON.parse(surface(root, "doctor", "--json").stdout);
    assert.ok(!after.findings.some((f) => f.code === "STALE_CLAIM"), "no claim should remain stale");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("verify by change set runs what impact would, and the record names the commit it ran against", () => {
  const root = freshCopy();
  const git = (...args) => {
    const r = spawnSync("git", ["-c", "user.email=t@example.com", "-c", "user.name=t", ...args], {
      cwd: root,
      encoding: "utf8",
      windowsHide: true,
    });
    return r.error ? null : r.status;
  };
  try {
    if (git("init", "-q", "-b", "main") === null) {
      /* No git on this machine: the selection still works from explicit paths,
         but there is no commit to anchor to, and the record must say nothing
         rather than something made up. */
      assert.equal(surface(root, "init").code, 0);
      const report = JSON.parse(surface(root, "verify", "src/auth/verifyToken.ts", "--json").stdout);
      assert.equal(report.results[0].commit, undefined);
      return;
    }
    assert.equal(git("add", "."), 0);
    assert.equal(git("commit", "-q", "-m", "one"), 0);
    assert.equal(surface(root, "init").code, 0);

    /* Explicit paths: only the capability owning them, only its command. The
       tree is clean apart from the regenerated document, which does not count. */
    const byPath = surface(root, "verify", "src/auth/verifyToken.ts", "--json");
    assert.equal(byPath.code, 0, byPath.stderr);
    const report = JSON.parse(byPath.stdout);
    assert.equal(report.selection.mode, "change");
    assert.deepEqual(report.selection.paths, ["src/auth/verifyToken.ts"]);
    assert.deepEqual(report.selection.capabilities.map((c) => c.id), ["auth.verify-token"]);
    assert.match(report.results[0].commit, /^[0-9a-f]{40}$/);
    assert.equal(report.results[0].dirty, false);
    assert.deepEqual(report.refreshed, ["auth.verify-token"]);

    const stored = JSON.parse(readFileSync(join(root, ".project", "surface.json"), "utf8"));
    assert.equal(stored.commands.find((c) => c.id === "test").verification.commit, report.results[0].commit);
    const why = JSON.parse(surface(root, "why", "auth.verify-token", "--json").stdout);
    assert.equal(why.evidence.find((e) => e.status === "passed").commit, report.results[0].commit);

    /* A commit later, `--since` finds the committed change and the uncommitted
       one alike - everything that differs from the ref - and the uncommitted
       edit marks the tree dirty. */
    const owner = join(root, "src", "checkout", "create.ts");
    writeFileSync(owner, `${readFileSync(owner, "utf8")}\n// touched\n`);
    assert.equal(git("commit", "-q", "-am", "two"), 0);
    writeFileSync(join(root, "README.md"), "scratch\n");
    const since = JSON.parse(surface(root, "verify", "--since", "HEAD~1", "--json").stdout);
    assert.deepEqual(since.selection.paths, ["README.md", "src/checkout/create.ts"]);
    assert.ok(since.selection.capabilities.some((c) => c.id === "checkout.create"));
    assert.equal(since.results[0].dirty, true);

    const bad = surface(root, "verify", "--since", "no-such-ref-zzz");
    assert.equal(bad.code, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("context labels every file with the trust of its claim, and does not read bodies unless asked", () => {
  const root = freshCopy();
  try {
    assert.equal(surface(root, "init").code, 0);
    const paths = surface(root, "context", "add a status field to checkout", "--json");
    assert.equal(paths.code, 0, paths.stderr);
    const pack = JSON.parse(paths.stdout);
    assert.ok(pack.items.length > 0);
    for (const item of pack.items) {
      assert.match(item.trust.tier, /^(declared|verified|derived|inferred)$/);
      assert.match(item.trust.freshness, /^(fresh|stale|unknown)$/);
      assert.equal(item.content, undefined);
    }
    for (const c of pack.capabilities) assert.equal(typeof c.tier, "string");

    /* The byte-based estimate agrees with the content-based one on ASCII sources. */
    const bodies = JSON.parse(surface(root, "context", "add a status field to checkout", "--json", "--content").stdout);
    for (const item of bodies.items) {
      const twin = pack.items.find((i) => i.path === item.path);
      assert.ok(twin, item.path);
      assert.ok(Math.abs(twin.estimatedTokens - item.estimatedTokens) <= 1, `${item.path}: ${twin.estimatedTokens} vs ${item.estimatedTokens}`);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("gate judges a change by proof at the commit under review, proves it on demand, and tightens under --strict", (t) => {
  const root = freshCopy();
  const git = (...args) => {
    const r = spawnSync("git", ["-c", "user.email=t@example.com", "-c", "user.name=t", ...args], {
      cwd: root,
      encoding: "utf8",
      windowsHide: true,
    });
    return r.error ? null : r.status;
  };
  try {
    if (git("init", "-q", "-b", "main") === null) return t.skip("git is not installed");
    assert.equal(git("add", "."), 0);
    assert.equal(git("commit", "-q", "-m", "base"), 0);
    assert.equal(git("checkout", "-q", "-b", "feature"), 0);
    const owner = join(root, "src", "checkout", "create.ts");
    writeFileSync(owner, `${readFileSync(owner, "utf8")}\n// status field\n`);
    assert.equal(git("commit", "-q", "-am", "checkout: status field"), 0);
    assert.equal(surface(root, "init").code, 0);

    /* Nothing has ever run: every touched capability is unproven and the gate says no. */
    const before = surface(root, "gate", "--since", "main", "--json");
    assert.equal(before.code, 2, before.stderr);
    const first = JSON.parse(before.stdout);
    assert.equal(first.pass, false);
    assert.match(first.head, /^[0-9a-f]{40}$/);
    assert.ok(first.capabilities.length >= 1);
    assert.ok(first.capabilities.every((g) => g.verdict === "unproven"), JSON.stringify(first.capabilities.map((g) => [g.id, g.verdict])));
    assert.ok(first.capabilities.some((g) => g.id === "checkout.create" && g.relation === "owner"));
    assert.ok(first.notes.some((n) => /docs\/contracts\/checkout\.md did not change/.test(n)));

    /* --verify proves exactly the touched capabilities at this commit and judges again. */
    const proved = surface(root, "gate", "--since", "main", "--verify", "--json");
    assert.equal(proved.code, 0, proved.stderr);
    const second = JSON.parse(proved.stdout);
    assert.equal(second.pass, true);
    assert.deepEqual(second.ran, ["test"]);
    assert.ok(second.capabilities.every((g) => g.verdict === "proven"));
    assert.match(second.capabilities[0].reasons.at(-1), /this commit/);
    assert.equal(second.capabilities[0].proofs[0].commit, second.head);

    /* The fixture ships one violated warn-level rule: a note by default, a block under --strict. */
    assert.ok(second.notes.some((n) => /is violated/.test(n)));
    const strict = surface(root, "gate", "--since", "main", "--strict", "--json");
    assert.equal(strict.code, 2);
    assert.ok(JSON.parse(strict.stdout).blocking.some((b) => /is violated/.test(b)));

    const md = surface(root, "gate", "--since", "main", "--format", "markdown");
    assert.equal(md.code, 0, md.stderr);
    assert.ok(md.stdout.startsWith("<!-- project-surface:gate -->"));
    assert.match(md.stdout, /\*\*Passes\.\*\*/);
    assert.match(md.stdout, /`checkout\.create` \| owner \| ✅ proven/);

    /* One commit later that touches no owner, the proof carries: the owner
       files are byte-identical to what the run saw. Strict wants it re-run. */
    assert.equal(git("commit", "-q", "--allow-empty", "-m", "unrelated"), 0);
    const carried = JSON.parse(surface(root, "gate", "--since", "main", "--json").stdout);
    assert.equal(carried.pass, true);
    assert.ok(carried.capabilities.every((g) => g.verdict === "carried"), JSON.stringify(carried.counts));
    const strictCarried = surface(root, "gate", "--since", "main", "--strict", "--json");
    assert.equal(strictCarried.code, 2);
    assert.ok(JSON.parse(strictCarried.stdout).blocking.some((b) => /is carried/.test(b)));

    /* A change outside the surface has nothing to judge and passes. */
    writeFileSync(join(root, "README.md"), "scratch\n");
    const outside = JSON.parse(surface(root, "gate", "README.md", "--json").stdout);
    assert.deepEqual(outside.capabilities, []);
    assert.equal(outside.pass, true);

    const bad = surface(root, "gate", "--since", "no-such-ref-zzz");
    assert.equal(bad.code, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("why explains every kind of claim and reproduces the recorded score", () => {
  const root = freshCopy();
  try {
    assert.equal(surface(root, "init").code, 0);
    const doc = JSON.parse(readFileSync(join(root, ".project", "surface.json"), "utf8"));
    const ids = [
      ...doc.capabilities.map((c) => c.id),
      ...doc.commands.map((c) => c.id),
      ...doc.constraints.map((c) => c.id),
      ...doc.risks.map((r) => r.id),
      ...doc.environment.map((e) => e.name),
    ];
    assert.ok(ids.length > 5);
    for (const id of ids) {
      const why = surface(root, "why", id, "--json");
      assert.equal(why.code, 0, `${id}: ${why.stderr}`);
      const e = JSON.parse(why.stdout);
      assert.equal(e.consistent, true, `${id}: recomputed ${e.trace.score}, recorded ${e.recorded}`);
    }
    const text = surface(root, "why", "checkout.create");
    assert.match(text.stdout, /Read from/);
    assert.match(text.stdout, /Score/);
    assert.match(text.stdout, /matches the recorded/);

    assert.equal(surface(root, "why", "no.such.thing").code, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a declared constraint check is evaluated on every scan and reported with the offending file", () => {
  const root = freshCopy();
  try {
    assert.equal(surface(root, "init").code, 0);
    const doc = JSON.parse(readFileSync(join(root, ".project", "surface.json"), "utf8"));

    const violated = doc.constraints.find((c) => c.id === "constraint:no-provider-in-handlers");
    assert.equal(violated.checked.status, "violated");
    assert.equal(violated.checked.violations, 1);
    for (const id of ["constraint:no-committed-env", "constraint:handlers-need-tests"]) {
      assert.equal(doc.constraints.find((c) => c.id === id).checked.status, "passed", id);
    }

    const report = JSON.parse(surface(root, "doctor", "--json").stdout);
    const finding = report.findings.find((f) => f.code === "CONSTRAINT_VIOLATED");
    assert.ok(finding, "expected a CONSTRAINT_VIOLATED finding");
    assert.equal(finding.severity, "warn");
    assert.deepEqual(finding.paths, ["src/checkout/create.ts"]);
    assert.match(finding.message, /imports src\/payments\/provider\.ts/);

    /* Fix the violation and the finding goes away on the next scan - and a
       new forbidden file is caught the same way, at the severity declared. */
    const handler = join(root, "src", "checkout", "create.ts");
    const stripped = readFileSync(handler, "utf8")
      .replace(/import \{ charge \} from "\.\.\/payments\/provider\.ts";\r?\n/, "")
      .replace("charge(session.total, session.currency);", "/* queued */");
    writeFileSync(handler, stripped);
    writeFileSync(join(root, ".env"), "DATABASE_URL=postgres://user:hunter2@db/app\n");
    assert.equal(surface(root, "init").code, 0);
    const after = JSON.parse(surface(root, "doctor", "--json").stdout);
    const codes = after.findings.filter((f) => f.code === "CONSTRAINT_VIOLATED");
    assert.equal(codes.length, 1, JSON.stringify(codes));
    assert.equal(codes[0].subject.id, "constraint:no-committed-env");
    assert.equal(codes[0].severity, "error");
    assert.deepEqual(codes[0].paths, [".env"]);
    assert.equal(surface(root, "doctor").code, 2, "an error-level violation must fail doctor without --strict");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("agents renders evidence-backed instructions, preserves hand-written text, and goes stale honestly", () => {
  const root = freshCopy();
  try {
    assert.equal(surface(root, "init").code, 0);

    const printed = surface(root, "agents");
    assert.equal(printed.code, 0, printed.stderr);
    assert.match(printed.stdout, /<!-- project-surface:begin fingerprint=[0-9a-f]{16} -->/);
    assert.match(printed.stdout, /## Rules/);
    assert.match(printed.stdout, /currently violated in 1 place/);
    assert.match(printed.stdout, /checkout\.create/);
    assert.doesNotMatch(printed.stdout, /payments\.charge/, "inferred guesses are omitted by default");
    assert.match(surface(root, "agents", "--include-inferred").stdout, /payments\.charge/);

    const file = join(root, "AGENTS.md");
    writeFileSync(file, ["# Hand-written intro", "", "Keep me.", ""].join("\n"));
    const first = JSON.parse(surface(root, "agents", "--write", "AGENTS.md", "--json").stdout);
    assert.deepEqual(first, { path: "AGENTS.md", changed: true, created: false });
    const written = readFileSync(file, "utf8");
    assert.ok(written.startsWith(["# Hand-written intro", "", "Keep me.", ""].join("\n")), written.slice(0, 80));
    assert.ok(written.endsWith("project-surface:end -->\n"), written.slice(-60));

    const second = JSON.parse(surface(root, "agents", "--write", "AGENTS.md", "--json").stdout);
    assert.equal(second.changed, false, "a second write with an unchanged surface is a no-op");
    assert.equal(surface(root, "doctor", "--json").stdout.includes("AGENTS_MD_STALE"), false);

    /* Change the surface underneath the file: the block is now a stale claim. */
    writeFileSync(join(root, ".env"), "DATABASE_URL=postgres://user:hunter2@db/app\n");
    assert.equal(surface(root, "init").code, 0);
    const report = JSON.parse(surface(root, "doctor", "--json").stdout);
    const stale = report.findings.find((f) => f.code === "AGENTS_MD_STALE");
    assert.ok(stale, "expected AGENTS_MD_STALE after the surface changed");
    assert.deepEqual(stale.paths, ["AGENTS.md"]);

    const third = JSON.parse(surface(root, "agents", "--write", "AGENTS.md", "--json").stdout);
    assert.equal(third.changed, true);
    assert.match(readFileSync(file, "utf8"), /^# Hand-written intro/);
    assert.equal(surface(root, "init").code, 0);
    assert.equal(JSON.parse(surface(root, "doctor", "--json").stdout).findings.some((f) => f.code === "AGENTS_MD_STALE"), false);

    assert.equal(surface(root, "agents", "--write", "../outside.md").code, 1);
    /* A `..` in the middle used to pass a check that only looked at the first segment. */
    const sneaky = surface(root, "agents", "--write", "docs/../../outside.md");
    assert.equal(sneaky.code, 1);
    assert.match(sneaky.stderr, /outside the project root/);
    assert.equal(existsSync(join(root, "..", "outside.md")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("report --out stays inside the project like every other write", () => {
  const root = freshCopy();
  try {
    assert.equal(surface(root, "init").code, 0);
    for (const out of ["../escaped.html", "docs/../../escaped.html", join(root, "..", "escaped.html")]) {
      const result = surface(root, "report", "--out", out);
      assert.equal(result.code, 1, out);
      assert.match(result.stderr, /outside the project root/);
    }
    assert.equal(existsSync(join(root, "..", "escaped.html")), false);
    const ok = JSON.parse(surface(root, "report", "--out", "docs/../build/report.html", "--json").stdout);
    assert.equal(ok.written, "build/report.html");
    assert.equal(existsSync(join(root, "build", "report.html")), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("verify refuses a command that is not in the document", () => {
  const root = freshCopy();
  try {
    assert.equal(surface(root, "init").code, 0);
    const result = surface(root, "verify", "--command", "rm -rf /");
    assert.equal(result.code, 1);
    assert.match(result.stderr, /not present in the surface document/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("every command answers --help and unknown commands fail", () => {
  for (const cmd of ["init", "inspect", "why", "map", "agents", "verify", "impact", "gate", "context", "session", "diff", "doctor", "report", "mcp"]) {
    const help = surface(".", cmd, "--help");
    assert.equal(help.code, 0, `${cmd} --help exited ${help.code}`);
    assert.ok(help.stdout.length > 20, `${cmd} --help printed nothing`);
  }
  assert.equal(surface(".", "bogus").code, 1);
});

/* A mistyped flag must not be swallowed: `context "x" --budget-tokens 5` used
   to run with the default budget and the task "x 5". */
test("an unknown option or a stray positional fails with exit 1 and names the command", () => {
  const root = freshCopy();
  try {
    assert.equal(surface(root, "init").code, 0);
    const unknown = surface(root, "context", "add a field", "--budget-tokens", "5");
    assert.equal(unknown.code, 1);
    assert.match(unknown.stderr, /Unknown option '--budget-tokens'/);
    assert.match(unknown.stderr, /surface context --help/);

    const stray = surface(root, "doctor", "extra");
    assert.equal(stray.code, 1);
    assert.match(stray.stderr, /Unexpected argument 'extra'/);

    /* --no-color is documented and must be accepted by every command. */
    assert.equal(surface(root, "doctor", "--no-color").code, 0);
    assert.equal(surface(root, "map", "--no-color").code, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("map JSON rows stay in parity with the text table", () => {
  const root = freshCopy();
  try {
    assert.equal(surface(root, "init").code, 0);

    const jsonResult = surface(root, "map", "--json");
    assert.equal(jsonResult.code, 0);

    const rows = JSON.parse(jsonResult.stdout).capabilities;
    assert.equal(rows.length, 9);

    for (const row of rows) {
      for (const field of [
        "id",
        "owners",
        "contracts",
        "evidence",
        "tier",
        "confidence",
        "freshness",
      ]) {
        assert.ok(field in row, `${row.id} is missing ${field}`);
      }
    }

    const textResult = surface(root, "map", "--no-color");
    assert.equal(textResult.code, 0);

    assert.match(
      textResult.stdout,
      /CAPABILITY\s+OWNER\s+CONTRACT\s+EVIDENCE\s+TIER\s+CONFIDENCE\s+FRESHNESS/
    );

    for (const row of rows) {
      assert.match(textResult.stdout, new RegExp(`^\\s*${row.id}\\s`, "m"));
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a declared command stays declared when verified, and does not decay with age", () => {
  const root = freshCopy();
  const file = join(root, ".project", "surface.json");
  try {
    writeFileSync(
      join(root, ".project", "surface.declare.yaml"),
      `${readFileSync(join(root, ".project", "surface.declare.yaml"), "utf8")}\ncommands:\n  - id: hello\n    run: echo hello\n    kind: other\n`
    );
    assert.equal(surface(root, "init").code, 0);
    const verify = surface(root, "verify", "--command", "hello", "--json");
    assert.equal(verify.code, 0, verify.stderr);
    assert.equal(JSON.parse(verify.stdout).results[0].status, "passed");

    const after = JSON.parse(readFileSync(file, "utf8")).commands.find((c) => c.id === "hello");
    assert.equal(after.provenance.tier, "declared");
    assert.equal(after.verification.status, "passed");
    assert.equal(after.confidence, 1, "a human statement is not lowered by agreeing with it");

    const why = JSON.parse(surface(root, "why", "hello", "--json").stdout);
    assert.equal(why.consistent, true, JSON.stringify(why.trace));
    assert.equal(why.promotion, null);

    /* Age the verification past the TTL. The claim goes stale - a health
       finding - but its confidence is untouched: declared never decays. */
    const doc = JSON.parse(readFileSync(file, "utf8"));
    const cmd = doc.commands.find((c) => c.id === "hello");
    cmd.verification.observedAt = "2020-01-01T00:00:00Z";
    writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`);
    assert.equal(surface(root, "init").code, 0);
    const aged = JSON.parse(readFileSync(file, "utf8")).commands.find((c) => c.id === "hello");
    assert.equal(aged.freshness.status, "stale");
    assert.equal(aged.confidence, 1);
    assert.equal(JSON.parse(surface(root, "why", "hello", "--json").stdout).consistent, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("agents blocks remember their options and every stale file is reported, not only the first", () => {
  const root = freshCopy();
  try {
    assert.equal(surface(root, "init").code, 0);
    /* The option changes the body; without it in the marker the block was
       reported stale on every scan because the check re-rendered with 40. */
    assert.equal(surface(root, "agents", "--write", "AGENTS.md", "--max-capabilities", "2").code, 0);
    assert.match(readFileSync(join(root, "AGENTS.md"), "utf8"), /max=2 -->/);
    assert.equal(surface(root, "agents", "--write", "CLAUDE.md").code, 0);
    assert.equal(surface(root, "init").code, 0);
    let findings = JSON.parse(surface(root, "doctor", "--json").stdout).findings;
    assert.deepEqual(findings.filter((f) => f.code === "AGENTS_MD_STALE"), []);

    writeFileSync(
      join(root, ".project", "surface.declare.yaml"),
      `${readFileSync(join(root, ".project", "surface.declare.yaml"), "utf8")}\ncommands:\n  - id: hello\n    run: echo hello\n    kind: other\n`
    );
    assert.equal(surface(root, "init").code, 0);
    findings = JSON.parse(surface(root, "doctor", "--json").stdout).findings;
    const stale = findings.filter((f) => f.code === "AGENTS_MD_STALE").map((f) => f.subject.id).sort();
    assert.deepEqual(stale, ["AGENTS.md", "CLAUDE.md"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

/* ---- Sessions: brief, verify loop signals, delta context, session ------- */

/** A fixture copy whose `test` script fails the same way every time, committed so the tree has a fingerprint. */
function failingFixture() {
  const root = freshCopy();
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  manifest.scripts.test = 'node -e "console.error(\'expected 1 got 2\'); process.exit(1)"';
  writeFileSync(join(root, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  const git = (...args) => {
    const r = spawnSync("git", ["-c", "user.email=t@example.com", "-c", "user.name=t", ...args], { cwd: root, encoding: "utf8", windowsHide: true });
    return r.error ? null : r.status;
  };
  if (git("init", "-q", "-b", "main") === null) return { root, git: false };
  git("add", ".");
  git("commit", "-q", "-m", "one");
  return { root, git: true };
}

test("verify warns before repeating a failed run on an unchanged tree, --if-changed skips it, and session shows both", (t) => {
  const { root, git } = failingFixture();
  try {
    if (!git) return t.skip("git is not installed");
    assert.equal(surface(root, "init").code, 0);

    const first = surface(root, "verify", "--command", "test");
    assert.equal(first.code, 2, first.stderr);
    assert.doesNotMatch(first.stdout, /unchanged-rerun/);

    const second = surface(root, "verify", "--command", "test", "--json");
    assert.equal(second.code, 2, second.stderr);
    const report = JSON.parse(second.stdout);
    assert.deepEqual(report.signals.map((s) => s.kind), ["unchanged-rerun"]);
    assert.equal(report.results.length, 1);

    const skipped = surface(root, "verify", "--command", "test", "--if-changed");
    assert.equal(skipped.code, 0, skipped.stderr);
    assert.match(skipped.stdout, /unchanged-rerun/);
    assert.match(skipped.stdout, /Not run/);
    const skippedJson = JSON.parse(surface(root, "verify", "--command", "test", "--if-changed", "--json").stdout);
    assert.equal(skippedJson.results.length, 0);
    assert.equal(skippedJson.skipped[0].id, "test");

    /* An edit changes the tree, so the run is allowed again. */
    writeFileSync(join(root, "src", "server.ts"), `${readFileSync(join(root, "src", "server.ts"), "utf8")}\n// edit\n`);
    const third = surface(root, "verify", "--command", "test", "--if-changed", "--json");
    assert.equal(JSON.parse(third.stdout).results.length, 1);

    const session = surface(root, "session");
    assert.equal(session.code, 0, session.stderr);
    assert.match(session.stdout, /#1\s+test\s+failed/);
    assert.match(session.stdout, /#3\s+test\s+failed/);
    assert.match(session.stdout, /unchanged-rerun/);
    const sessionJson = JSON.parse(surface(root, "session", "--json").stdout);
    assert.equal(sessionJson.attempts.length, 3);
    assert.equal(sessionJson.failed, 3);

    assert.match(surface(root, "session", "--reset").stdout, /Forgot the session/);
    assert.match(surface(root, "session").stdout, /Nothing recorded yet/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
