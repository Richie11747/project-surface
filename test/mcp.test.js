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
