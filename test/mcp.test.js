// @ts-check
/**
 * The MCP server over the real protocol: a stdio client from the official SDK
 * performs the handshake, lists tools, and calls them against a fixture copy.
 * This is what "Give it to Claude" in the README actually exercises.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { appendFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { FIXTURES_DIR } from "../scripts/fixture-snapshot.mjs";

const CLI = fileURLToPath(new URL("../packages/cli/dist/index.js", import.meta.url));
const BIN = fileURLToPath(new URL("../packages/mcp-server/dist/bin.js", import.meta.url));

const EXPECTED_TOOLS = [
  "surface_overview",
  "surface_find_capability",
  "surface_why",
  "surface_constraints",
  "surface_health",
  "surface_impact",
  "surface_gate",
  "surface_context",
  "surface_diff",
  "surface_verify",
];

function preparedFixture() {
  const root = mkdtempSync(join(tmpdir(), "project-surface-mcp-"));
  cpSync(join(FIXTURES_DIR, "ts-api"), root, { recursive: true });
  rmSync(join(root, "expected.surface.json"), { force: true });
  const init = spawnSync(process.execPath, [CLI, "init", "--root", root], { encoding: "utf8" });
  assert.equal(init.status, 0, init.stderr);
  return root;
}

/**
 * `via: "cli"` starts the server through `surface mcp`, the documented way to
 * install it, which is also the one that owns the adapters and can rebuild the
 * document after a verification. The standalone binary cannot, and says so.
 */
async function connect(root, env = {}, via = "bin") {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: via === "cli" ? [CLI, "mcp", "--root", root] : [BIN, "--root", root],
    env: { ...process.env, ...env },
    stderr: "pipe",
  });
  const client = new Client({ name: "project-surface-test", version: "0.0.0" });
  await client.connect(transport);
  return client;
}

function textOf(result) {
  return result.content
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("\n");
}

test("the server completes the handshake and exposes exactly the documented tools", async () => {
  const root = preparedFixture();
  const client = await connect(root);
  try {
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((t) => t.name).sort(), [...EXPECTED_TOOLS].sort());
    for (const tool of tools) assert.ok(tool.description.length > 40, `${tool.name} needs a description`);
  } finally {
    await client.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("read-only tools answer from the document", async () => {
  const root = preparedFixture();
  const client = await connect(root);
  try {
    const overview = textOf(await client.callTool({ name: "surface_overview", arguments: {} }));
    assert.match(overview, /checkout-api/);
    assert.match(overview, /typescript/);
    /* Brief by default: one screen, areas rather than every claim. */
    assert.match(overview, /Where things live/);
    assert.doesNotMatch(overview, /Capabilities:\n/);
    const full = textOf(await client.callTool({ name: "surface_overview", arguments: { detail: "full" } }));
    assert.match(full, /Capabilities:\n/);
    assert.match(full, /checkout\.get/);
    const briefJson = JSON.parse(textOf(await client.callTool({ name: "surface_overview", arguments: { format: "json" } })));
    assert.ok(Array.isArray(briefJson.areas));

    const found = textOf(await client.callTool({ name: "surface_find_capability", arguments: { query: "create checkout" } }));
    assert.match(found, /checkout\.create/);
    assert.match(found, /src\/checkout\/create\.ts/);
    assert.match(found, /tests\/checkout\/create\.test\.ts/);

    const impact = textOf(await client.callTool({ name: "surface_impact", arguments: { paths: ["src/checkout/create.ts"] } }));
    assert.match(impact, /checkout\.create/);
    assert.match(impact, /npm run test/);

    const context = textOf(await client.callTool({ name: "surface_context", arguments: { task: "add a status field to checkout" } }));
    assert.match(context, /src\/checkout\/create\.ts/);
    assert.match(context, /docs\/contracts\/checkout\.md/);

    const health = textOf(await client.callTool({ name: "surface_health", arguments: { severity: "warn" } }));
    assert.match(health, /MISSING_ENV_EXAMPLE/);

    const why = textOf(await client.callTool({ name: "surface_why", arguments: { id: "checkout.create" } }));
    assert.match(why, /Read from: derived/);
    assert.match(why, /Score:/);
    assert.match(why, /matches the recorded/);
    const whyJson = JSON.parse(textOf(await client.callTool({ name: "surface_why", arguments: { id: "checkout.create", format: "json" } })));
    assert.equal(whyJson.consistent, true);
    const missing = textOf(await client.callTool({ name: "surface_why", arguments: { id: "nope" } }));
    assert.match(missing, /Nothing in the surface/);

    const constraints = textOf(await client.callTool({ name: "surface_constraints", arguments: {} }));
    assert.ok(constraints.length > 0);
  } finally {
    await client.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("surface_gate judges from the document without running anything", async () => {
  const root = preparedFixture();
  const client = await connect(root);
  try {
    const result = await client.callTool({ name: "surface_gate", arguments: { paths: ["src/checkout/create.ts"] } });
    assert.notEqual(result.isError, true, textOf(result));
    assert.match(textOf(result), /DOES NOT PASS/);
    assert.match(textOf(result), /unproven +checkout\.create \[owner\]/);
    assert.match(textOf(result), /docs\/contracts\/checkout\.md did not change/);
    const doc = JSON.parse(readFileSync(join(root, ".project", "surface.json"), "utf8"));
    assert.ok(doc.commands.every((c) => !c.verification), "the gate must not execute or record anything");
  } finally {
    await client.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("surface_verify is refused unless the operator enabled execution", async () => {
  const root = preparedFixture();
  const client = await connect(root);
  try {
    const result = await client.callTool({ name: "surface_verify", arguments: { commandId: "test" } });
    assert.match(textOf(result), /PROJECT_SURFACE_ALLOW_EXEC/);
    assert.doesNotMatch(textOf(result), /passed/);
  } finally {
    await client.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("surface_verify with execution enabled runs only a recorded command id", async () => {
  const root = preparedFixture();
  const client = await connect(root, { PROJECT_SURFACE_ALLOW_EXEC: "1" });
  try {
    const refused = await client.callTool({ name: "surface_verify", arguments: { commandId: "echo pwned" } });
    assert.match(textOf(refused), /not present in the surface document/);

    const ran = await client.callTool({ name: "surface_verify", arguments: { commandId: "test", timeoutSeconds: 120 } });
    assert.match(textOf(ran), /passed/);
  } finally {
    await client.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("surface_verify with stale: true re-proves stale claims and, through the CLI, re-anchors freshness", async () => {
  const root = preparedFixture();
  const verified = spawnSync(process.execPath, [CLI, "verify", "--root", root, "--command", "test"], { encoding: "utf8" });
  assert.equal(verified.status, 0, verified.stderr);
  const client = await connect(root, { PROJECT_SURFACE_ALLOW_EXEC: "1" }, "cli");
  try {
    const quiet = await client.callTool({ name: "surface_verify", arguments: { stale: true } });
    assert.match(textOf(quiet), /Nothing is stale/);

    /* Neither selector: refused with guidance, nothing run. */
    const neither = await client.callTool({ name: "surface_verify", arguments: {} });
    assert.equal(neither.isError, true);
    assert.match(textOf(neither), /commandId .* or stale: true/);

    const owner = join(root, "src", "checkout", "create.ts");
    writeFileSync(owner, `${readFileSync(owner, "utf8")}\n// touched\n`);
    const rescan = spawnSync(process.execPath, [CLI, "init", "--root", root], { encoding: "utf8" });
    assert.equal(rescan.status, 0, rescan.stderr);
    const before = JSON.parse(readFileSync(join(root, ".project", "surface.json"), "utf8"));
    assert.equal(before.capabilities.find((c) => c.id === "checkout.create").freshness.status, "stale");

    const ran = await client.callTool({ name: "surface_verify", arguments: { stale: true, timeoutSeconds: 120 } });
    assert.notEqual(ran.isError, true, textOf(ran));
    assert.match(textOf(ran), /Command: test/);
    assert.match(textOf(ran), /Stale capabilities re-proved: .*checkout\.create/);
    assert.match(textOf(ran), /The surface was rebuilt/);
    const after = JSON.parse(readFileSync(join(root, ".project", "surface.json"), "utf8"));
    assert.equal(after.capabilities.find((c) => c.id === "checkout.create").freshness.status, "fresh");
  } finally {
    await client.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("surface_context never returns a credential file, whatever the document names as an owner", async () => {
  /* The document is repository-authored. A hostile declaration can list `.env`
     or `.git/config` as an owner; that must produce an omission, not content. */
  const root = mkdtempSync(join(tmpdir(), "project-surface-mcp-guard-"));
  cpSync(join(FIXTURES_DIR, "ts-api"), root, { recursive: true });
  rmSync(join(root, "expected.surface.json"), { force: true });
  const planted = "planted-secret-" + Date.now();
  writeFileSync(join(root, ".env"), `LEAK_TOKEN=${planted}\n`);
  mkdirSync(join(root, ".git"), { recursive: true });
  writeFileSync(join(root, ".git", "config"), `[http]\n\textraheader = AUTHORIZATION: basic ${planted}\n`);
  appendFileSync(
    join(root, ".project", "surface.declare.yaml"),
    "\ncapabilities:\n  - id: planted.owner\n    title: Planted owner list\n    owners: [.env, .git/config, README.md]\n"
  );
  const init = spawnSync(process.execPath, [CLI, "init", "--root", root], { encoding: "utf8" });
  assert.equal(init.status, 0, init.stderr);

  const client = await connect(root);
  try {
    const out = textOf(
      await client.callTool({ name: "surface_context", arguments: { task: "planted owner list", includeContent: true } })
    );
    assert.ok(!out.includes(planted), out);
    assert.match(out, /--- README\.md ---/);
    assert.match(out, /\.env - File is missing, unreadable, or not one the project lists\./);
  } finally {
    await client.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("a missing document is reported as guidance, not a protocol error", async () => {
  const root = mkdtempSync(join(tmpdir(), "project-surface-mcp-empty-"));
  const client = await connect(root);
  try {
    const result = await client.callTool({ name: "surface_overview", arguments: {} });
    assert.match(textOf(result), /surface init/);
  } finally {
    await client.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("the tool listing stays small: every turn pays for it", async () => {
  const root = preparedFixture();
  const client = await connect(root);
  try {
    const { tools } = await client.listTools();
    const chars = JSON.stringify(tools).length;
    assert.ok(chars / 4 < 2200, `tool listing is ~${Math.ceil(chars / 4)} tokens`);
  } finally {
    await client.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("the orient prompt and the capability and session resources are served without a tool call", async () => {
  const root = preparedFixture();
  const client = await connect(root);
  try {
    const { prompts } = await client.listPrompts();
    assert.deepEqual(prompts.map((p) => p.name), ["orient"]);
    const prompt = await client.getPrompt({ name: "orient", arguments: { task: "add a status field" } });
    const text = prompt.messages.map((m) => m.content.text).join("\n");
    assert.match(text, /Where things live/);
    assert.match(text, /surface_context with task: "add a status field"/);

    const { resourceTemplates } = await client.listResourceTemplates();
    assert.ok(resourceTemplates.some((r) => r.uriTemplate === "surface://capability/{id}"));
    const capability = await client.readResource({ uri: "surface://capability/checkout.create" });
    assert.match(capability.contents[0].text, /src\/checkout\/create\.ts/);
    const missing = await client.readResource({ uri: "surface://capability/nope" });
    assert.match(missing.contents[0].text, /No capability/);

    const session = await client.readResource({ uri: "surface://session" });
    assert.match(session.contents[0].text, /Runs: 0/);
  } finally {
    await client.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("surface_context serves a file once per session and says so the second time", async () => {
  const root = preparedFixture();
  const client = await connect(root);
  try {
    const first = textOf(await client.callTool({ name: "surface_context", arguments: { task: "checkout" } }));
    assert.match(first, /src\/checkout\/create\.ts \[owner/);
    assert.match(first, /Session: 0 runs, 1 context pack/);
    const second = textOf(await client.callTool({ name: "surface_context", arguments: { task: "checkout status" } }));
    assert.match(second, /src\/checkout\/create\.ts \[already served/);
    assert.match(second, /tokens not repeated/);
    const full = textOf(await client.callTool({ name: "surface_context", arguments: { task: "checkout", mode: "full" } }));
    assert.match(full, /src\/checkout\/create\.ts \[owner/);
    assert.match(full, /<repo-data>/);
  } finally {
    await client.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("surface_verify declines to repeat a failed run on an unchanged tree unless forced", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "project-surface-mcp-loop-"));
  cpSync(join(FIXTURES_DIR, "ts-api"), root, { recursive: true });
  rmSync(join(root, "expected.surface.json"), { force: true });
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  manifest.scripts.test = 'node -e "console.error(\'expected 1 got 2\'); process.exit(1)"';
  writeFileSync(join(root, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  const git = (...args) =>
    spawnSync("git", ["-c", "user.email=t@example.com", "-c", "user.name=t", ...args], { cwd: root, encoding: "utf8", windowsHide: true });
  if (git("init", "-q", "-b", "main").error) {
    rmSync(root, { recursive: true, force: true });
    return t.skip("git is not installed");
  }
  git("add", ".");
  git("commit", "-q", "-m", "one");
  spawnSync(process.execPath, [CLI, "init", "--root", root], { encoding: "utf8" });
  const client = await connect(root, { PROJECT_SURFACE_ALLOW_EXEC: "1" });
  try {
    const first = textOf(await client.callTool({ name: "surface_verify", arguments: { commandId: "test", timeoutSeconds: 120 } }));
    assert.match(first, /Result: failed/);
    assert.match(first, /Session: 1 run, 1 failed/);

    const declined = await client.callTool({ name: "surface_verify", arguments: { commandId: "test" } });
    assert.notEqual(declined.isError, true);
    assert.match(textOf(declined), /^Not run\./);
    assert.match(textOf(declined), /nothing in the working tree has changed/);

    const forced = textOf(await client.callTool({ name: "surface_verify", arguments: { commandId: "test", force: true, timeoutSeconds: 120 } }));
    assert.match(forced, /Result: failed/);
    assert.match(forced, /Session: 2 runs, 2 failed/);

    const session = await client.readResource({ uri: "surface://session" });
    assert.match(session.contents[0].text, /unchanged-rerun/);
  } finally {
    await client.close();
    rmSync(root, { recursive: true, force: true });
  }
});
