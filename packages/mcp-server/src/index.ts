/**
 * @project-surface/mcp-server
 *
 * Exposes a project surface to any MCP client. The tool set mirrors the CLI, so
 * an agent and a human see exactly the same model of the project - which is the
 * point of having a shared artifact in the first place.
 *
 * Everything is read-only except `surface_verify`, which is gated twice. See
 * tools/verify.ts for the reasoning.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { nowIso, readLedger, sessionSummary, GENERATOR_VERSION, SESSION_FILE, SURFACE_FILE } from "@project-surface/core";
import type { LoopSignal, SessionSummary } from "@project-surface/core";
import { SurfaceUnavailable, failure, loadSurface } from "./support.js";
import type { ToolContext, ToolResult } from "./support.js";
import { constraintsTool, findCapabilityTool, healthTool, overviewTool, whyTool } from "./tools/read.js";
import { contextTool, diffTool, gateTool, impactTool } from "./tools/analyze.js";
import { ALLOW_EXEC_ENV, verifyTool } from "./tools/verify.js";

interface ToolDefinition {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: never, ctx: ToolContext) => ToolResult | Promise<ToolResult>;
}

/** Registration order is also the order most clients display them in. */
export const TOOLS = [
  overviewTool,
  findCapabilityTool,
  whyTool,
  constraintsTool,
  healthTool,
  impactTool,
  gateTool,
  contextTool,
  diffTool,
  verifyTool,
] as unknown as ToolDefinition[];

export interface McpServerOptions {
  root: string;
  /** Defaults to the PROJECT_SURFACE_ALLOW_EXEC environment variable. */
  allowExec?: boolean;
  /** See ToolContext.rebuild. */
  rebuild?: ToolContext["rebuild"];
}

export function createMcpServer(options: McpServerOptions): McpServer {
  const ctx: ToolContext = {
    root: options.root,
    allowExec: options.allowExec ?? process.env[ALLOW_EXEC_ENV] === "1",
    ...(options.rebuild ? { rebuild: options.rebuild } : {}),
  };

  const server = new McpServer({ name: "project-surface", version: GENERATOR_VERSION });

  for (const tool of TOOLS) {
    const handler = async (args: never): Promise<ToolResult> => {
      try {
        return await tool.handler(args, ctx);
      } catch (error) {
        /* A missing surface is a normal state with a clear next action, so it
           is reported as tool content rather than as a protocol error. */
        if (error instanceof SurfaceUnavailable) return failure(error.message);
        return failure(`${tool.name} failed: ${(error as Error).message}`);
      }
    };

    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema as never,
      },
      handler as never
    );
  }

  server.registerResource(
    "session",
    "surface://session",
    {
      title: "This session",
      description: `What this machine has run and served (${SESSION_FILE}), and the loop signals that follow from it.`,
      mimeType: "text/plain",
    },
    (uri: URL) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "text/plain",
          text: renderSession(sessionSummary(readLedger(ctx.root, nowIso()))),
        },
      ],
    })
  );

  /* Also exposed as a resource: some clients let a user open resources
     directly, which suits a document meant to be human-readable. */
  server.registerResource(
    "surface",
    `file://${SURFACE_FILE}`,
    {
      title: "Project surface document",
      description: "The full project-surface/v1 document for this repository.",
      mimeType: "application/json",
    },
    (uri: URL) => {
      try {
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "application/json",
              text: JSON.stringify(loadSurface(ctx), null, 2),
            },
          ],
        };
      } catch (error) {
        return {
          contents: [{ uri: uri.href, mimeType: "text/plain", text: (error as Error).message }],
        };
      }
    }
  );

  return server;
}

function renderSession(summary: SessionSummary): string {
  const lines = [
    `Session started ${summary.startedAt}${summary.treeKnown ? "" : " (tree state unknown outside git)"}`,
    `Runs: ${summary.attempts} (${summary.failed} failed). Context packs: ${summary.packs}, ` +
      `~${summary.tokensServed} tokens served, ~${summary.tokensSaved} not repeated.`,
  ];
  if (summary.signals.length > 0) {
    lines.push("", "Signals:");
    for (const s of summary.signals) lines.push(signalLine(s));
  }
  if (summary.frequent.length > 0) {
    lines.push("", "Served most often:");
    for (const f of summary.frequent) lines.push(`  ${f.path} x${f.times}`);
  }
  return lines.join("\n");
}

function signalLine(s: LoopSignal): string {
  return `  [${s.severity}] ${s.kind} (${s.commandId}): ${s.message} ${s.advice}`;
}

export async function startMcpServer(options: McpServerOptions): Promise<void> {
  await createMcpServer(options).connect(new StdioServerTransport());
}

export { ALLOW_EXEC_ENV } from "./tools/verify.js";
export type { ToolContext, ToolResult } from "./support.js";
