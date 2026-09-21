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

import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  buildBrief,
  indexById,
  nowIso,
  readLedger,
  renderBrief,
  sessionSummary,
  GENERATOR_VERSION,
  SESSION_FILE,
  SURFACE_FILE,
} from "@project-surface/core";
import type { LoopSignal, SessionSummary } from "@project-surface/core";
import { SurfaceUnavailable, describeCapability, failure, loadSurface } from "./support.js";
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

  /* A prompt costs nothing per turn - it is not in the tool list - and a
     client that supports prompts can start a task with the brief already in
     context, which is the cheapest orientation the server can offer. */
  server.registerPrompt(
    "orient",
    {
      title: "Orient in this repository",
      description:
        "One screen of what the project is, which commands are proven, which rules fail the build and where things live - " +
        "then the call to make next. Pass a task to have it named.",
      argsSchema: { task: z.string().optional().describe("What you are about to do, if known.") },
    },
    (args: { task?: string }) => {
      let body: string;
      try {
        body = renderBrief(buildBrief(loadSurface(ctx)));
      } catch (error) {
        body = (error as Error).message;
      }
      const next = args.task
        ? `Now call surface_context with task: ${JSON.stringify(args.task)} before reading any file.`
        : "Before reading any file, call surface_context with the task in plain language.";
      return { messages: [{ role: "user" as const, content: { type: "text" as const, text: `${body}\n\n${next}` } }] };
    }
  );

  /* Also exposed as resources: some clients let a user open resources
     directly, which suits a document meant to be human-readable, and a
     single capability is small enough to attach whole. */
  server.registerResource(
    "capability",
    new ResourceTemplate("surface://capability/{id}", {
      list: () => {
        try {
          return {
            resources: loadSurface(ctx).capabilities.map((c) => ({
              uri: `surface://capability/${c.id}`,
              name: c.id,
              description: c.title,
              mimeType: "text/plain",
            })),
          };
        } catch {
          return { resources: [] };
        }
      },
    }),
    {
      title: "One capability",
      description: "Owners, contract, evidence and trust for a single capability id.",
      mimeType: "text/plain",
    },
    (uri: URL, variables: Record<string, string | string[]>) => {
      const id = String(variables["id"] ?? "");
      try {
        const surface = loadSurface(ctx);
        const capability = surface.capabilities.find((c) => c.id === id || c.aliases?.includes(id));
        if (!capability) {
          return { contents: [{ uri: uri.href, mimeType: "text/plain", text: `No capability with id ${id}.` }] };
        }
        const evidence = indexById(surface.evidence);
        const detail = capability.evidence
          .map((ref) => {
            const entry = evidence.get(ref.id);
            return `    ${entry?.path ?? ref.id} - status ${entry?.status ?? "unknown"}, linked by ${ref.link}`;
          })
          .join("\n");
        const text = describeCapability(capability) + (detail ? `\n  evidence detail:\n${detail}` : "");
        return { contents: [{ uri: uri.href, mimeType: "text/plain", text }] };
      } catch (error) {
        return { contents: [{ uri: uri.href, mimeType: "text/plain", text: (error as Error).message }] };
      }
    }
  );

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
