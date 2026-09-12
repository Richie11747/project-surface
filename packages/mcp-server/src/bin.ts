#!/usr/bin/env node
/**
 * Standalone MCP entry point, for clients configured with a command rather than
 * with the `surface` CLI. Identical behaviour to `surface mcp`.
 */

import { startMcpServer } from "./index.js";

const flag = process.argv.indexOf("--root");
const root = flag >= 0 ? (process.argv[flag + 1] ?? process.cwd()) : process.cwd();

startMcpServer({ root }).catch((error: unknown) => {
  process.stderr.write(`project-surface mcp failed to start: ${(error as Error).message}\n`);
  process.exitCode = 1;
});
