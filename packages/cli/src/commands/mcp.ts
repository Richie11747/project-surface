/**
 * `surface mcp` - serve the surface to agents over MCP on stdio.
 *
 * Bundled into the CLI so a single install gives both the human interface and
 * the agent interface, and so an MCP client can be configured with the binary
 * the user already has.
 */

import { buildSurface } from "@project-surface/core";
import { startMcpServer } from "@project-surface/mcp-server";
import { builtinAdapters } from "../adapters.js";
import type { GlobalOptions } from "../context.js";

export async function run(_args: string[], options: GlobalOptions): Promise<number> {
  /* stdout is the MCP transport, so nothing may be printed to it here. The
     CLI owns the adapters, so it is the one that can let `surface_verify`
     rebuild the document after a run - the same pipeline `surface verify` uses. */
  await startMcpServer({
    root: options.root,
    rebuild: async (previous, now) =>
      (await buildSurface({ root: options.root, adapters: builtinAdapters, previous, now })).surface,
  });
  return 0;
}
