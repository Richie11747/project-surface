/**
 * Help text.
 *
 * Kept in one file so `surface --help` and the README cannot drift apart, and
 * so adding a command means adding exactly one entry.
 */

import { GENERATOR_VERSION } from "@project-surface/core";
import { style } from "./output.js";

export interface CommandSummary {
  name: string;
  usage: string;
  summary: string;
}

export const COMMAND_SUMMARIES: CommandSummary[] = [
  { name: "init", usage: "surface init", summary: "Detect the stack and write .project/surface.json." },
  { name: "inspect", usage: "surface inspect [capability]", summary: "Show what the project can do, and what proves it." },
  { name: "why", usage: "surface why <id>", summary: "Show how a confidence score was derived, step by step." },
  { name: "map", usage: "surface map", summary: "Table of capability owners, contracts, and evidence." },
  { name: "verify", usage: "surface verify [--command id] [--stale] [--since <ref>] [--all] [--if-changed]", summary: "Run project commands and record the result as evidence." },
  { name: "impact", usage: "surface impact <paths...> | --staged | --since <ref>", summary: "Predict what a change affects." },
  { name: "gate", usage: "surface gate [--since <ref>] [--verify] [--strict] [--format markdown]", summary: "Does this change carry proof? Per touched capability: proven at this commit, or not." },
  { name: "context", usage: "surface context <task> [--budget n] [--delta] [--all-constraints]", summary: "Token-bounded context pack for a task; --delta skips files this session already served." },
  { name: "session", usage: "surface session [--reset]", summary: "What this machine ran and served, and the loop signals that follow from it." },
  { name: "agents", usage: "surface agents [--write AGENTS.md] [--include-inferred]", summary: "Agent instructions generated from evidence, with provenance per line." },
  { name: "diff", usage: "surface diff [--since <ref>]", summary: "What changed about the project surface." },
  { name: "doctor", usage: "surface doctor [--strict]", summary: "Report drift, stale claims, and unproven behaviour." },
  { name: "report", usage: "surface report [--out path]", summary: "Render a self-contained HTML report." },
  { name: "mcp", usage: "surface mcp", summary: "Serve the surface to AI agents over MCP (stdio)." },
];

export function mainHelp(): string {
  const rows = COMMAND_SUMMARIES.map((c) => `  ${style.bold(c.name.padEnd(9))} ${c.summary}`).join("\n");
  return [
    `${style.bold("surface")} - the missing semantic layer for AI-readable projects.`,
    "",
    style.bold("USAGE"),
    "  surface <command> [options]",
    "",
    style.bold("COMMANDS"),
    rows,
    "",
    style.bold("GLOBAL OPTIONS"),
    "  --root <dir>    Project root. Defaults to the working directory.",
    "  --json          Machine-readable output. Every command supports it.",
    "  --no-color      Disable colour. Also disabled automatically when piped.",
    "  --version       Print the version.",
    "  --help          Print this, or help for a command.",
    "",
    style.bold("EXIT CODES"),
    "  0  success",
    "  1  error",
    "  2  drift or a failing check (use this to gate CI)",
    "",
    `${style.dim("version")} ${GENERATOR_VERSION}`,
  ].join("\n");
}

export function commandHelp(name: string): string | null {
  const command = COMMAND_SUMMARIES.find((c) => c.name === name);
  if (!command) return null;
  return [style.bold("USAGE"), `  ${command.usage}`, "", command.summary].join("\n");
}
