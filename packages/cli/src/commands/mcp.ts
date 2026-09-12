/**
 * `surface mcp` - serve the surface to agents over MCP on stdio.
 *
 * Bundled into the CLI so a single install gives both the human interface and
 * the agent interface, and so an MCP client can be configured with the binary
 * the user already has.
 */

import { startMcpServer } from "@project-surface/mcp-server";
import type { GlobalOptions } from "../context.js";

export async function run(_args: string[], options: GlobalOptions): Promise<number> {
  /* stdout is the MCP transport, so nothing may be printed to it here. */
  await startMcpServer({ root: options.root });
  return 0;
}
