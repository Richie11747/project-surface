/**
 * Analysis tools. These read files but never write and never execute.
 */

import { z } from "zod";
import {
  analyzeImpact,
  changedSince,
  diffSurfaces,
  createGuardedAccess,
  packContext,
  showFileAtRef,
  stagedPaths,
  validateSurface,
  SURFACE_FILE,
} from "@project-surface/core";
import type { Surface } from "@project-surface/core";
import { loadSurface, text, trustNote } from "../support.js";
import type { ToolContext, ToolResult } from "../support.js";

export const impactTool = {
  name: "surface_impact",
  title: "Change impact",
  description:
    "Given files you are about to change, report which capabilities depend on them, which tests cover them, " +
    "which project rules apply, and whether the change touches anything that needs approval. " +
    "Call this before editing, not after.",
  inputSchema: {
    paths: z.array(z.string()).optional().describe("Repository-relative paths. Omit to use the staged set."),
    since: z.string().optional().describe("A git ref; everything changed since it is analysed."),
  },
  handler(args: { paths?: string[]; since?: string }, ctx: ToolContext): ToolResult {
    const surface = loadSurface(ctx);

    let paths = args.paths ?? [];
    if (paths.length === 0 && args.since) paths = changedSince(ctx.root, args.since) ?? [];
    if (paths.length === 0) paths = stagedPaths(ctx.root);
    if (paths.length === 0) {
      return text("No changed paths were given and nothing is staged, so there is nothing to analyse.");
    }

    const report = analyzeImpact(surface, paths);
    const lines = [`Changed paths (${paths.length}): ${paths.slice(0, 20).join(", ")}`, ""];

    if (report.capabilities.length === 0) {
      lines.push("No capability is known to depend on these files.");
    } else {
      lines.push("Affected capabilities:");
      for (const i of report.capabilities) {
        lines.push(
          `  ${i.capability.id} [${i.relation}] - ${i.reason}` +
            ` (confidence ${i.capability.confidence.toFixed(2)}, ${i.capability.provenance.tier})`
        );
      }
    }

    if (report.risks.length > 0) {
      lines.push("", "Risk:");
      for (const r of report.risks) lines.push(`  ${r.type} - approval ${r.approval} - ${r.reason}`);
    }
    if (report.commands.length > 0) {
      lines.push("", "Run these to check the change:");
      for (const c of report.commands) lines.push(`  ${c.run}${c.cwd === "." ? "" : ` (in ${c.cwd})`}`);
    }
    if (report.constraints.length > 0) {
      lines.push("", "Constraints that still apply:");
      for (const c of report.constraints) lines.push(`  [${c.severity}] ${c.rule}`);
    }

    lines.push("", trustNote());
    return text(lines.join("\n"));
  },
};

export const contextTool = {
  name: "surface_context",
  title: "Task context pack",
  description:
    "Select the smallest set of files worth reading for a task, within a token budget, with a stated reason " +
    "for every inclusion and an explicit list of what was left out. Use this instead of reading the tree.",
  inputSchema: {
    task: z.string().describe("What you are about to do, in plain language."),
    budgetTokens: z.number().int().min(500).max(200_000).optional(),
    includeContent: z.boolean().optional().describe("Return file contents as well as paths."),
  },
  handler(
    args: { task: string; budgetTokens?: number; includeContent?: boolean },
    ctx: ToolContext
  ): ToolResult {
    const surface = loadSurface(ctx);
    const pack = packContext(surface, args.task, createGuardedAccess(ctx.root), {
      ...(args.budgetTokens ? { budgetTokens: args.budgetTokens } : {}),
      includeContent: args.includeContent === true,
    });

    const lines = [
      `Context for: ${pack.task}`,
      `Budget: ${pack.usedTokens} of ${pack.budgetTokens} tokens`,
      "",
    ];

    if (pack.capabilities.length === 0) {
      lines.push("No capability matched that description. Call surface_overview to see what exists.");
      return text(lines.join("\n"));
    }

    lines.push("Relevant capabilities:");
    for (const c of pack.capabilities) lines.push(`  ${c.id} - ${c.title} [${c.tier}/${c.freshness}] (${c.reason})`);

    lines.push("", "Files to read:");
    for (const i of pack.items) {
      lines.push(`  ${i.path} [${i.role}, ${i.trust.tier}/${i.trust.freshness}, ~${i.estimatedTokens} tokens] - ${i.reason}`);
    }

    if (pack.constraints.length > 0) {
      lines.push("", "Constraints:");
      for (const c of pack.constraints) lines.push(`  [${c.severity}] ${c.rule}`);
    }
    if (pack.commands.length > 0) {
      lines.push("", "Verify with:");
      for (const c of pack.commands) lines.push(`  ${c.run}`);
    }
    if (pack.omitted.length > 0) {
      lines.push("", "Omitted:");
      for (const o of pack.omitted) lines.push(`  ${o.path} - ${o.reason}`);
    }

    if (args.includeContent === true) {
      lines.push("", "Contents:");
      for (const i of pack.items) {
        if (i.content === undefined) continue;
        lines.push("", `--- ${i.path} ---`, i.content);
      }
    }

    return text(lines.join("\n"));
  },
};

export const diffTool = {
  name: "surface_diff",
  title: "Surface diff",
  description:
    "What changed about the project between a git ref and now: capabilities added or removed, commands " +
    "altered, claims gone stale, health findings appearing or resolving.",
  inputSchema: { since: z.string().optional().describe("Git ref to compare against. Defaults to HEAD.") },
  handler(args: { since?: string }, ctx: ToolContext): ToolResult {
    const current = loadSurface(ctx);
    const ref = args.since ?? "HEAD";
    const before = surfaceAtRef(ctx.root, ref);
    if (!before) {
      return text(
        `No committed ${SURFACE_FILE} at ref "${ref}", so there is no baseline to compare against. ` +
          `Commit the surface document to enable this.`
      );
    }

    const result = diffSurfaces(before, current);
    if (result.empty) return text(`Nothing about the project surface changed since ${ref}.`);

    const lines: string[] = [`Surface changes since ${ref}:`, ""];
    const section = (title: string, d: typeof result.capabilities): void => {
      if (d.added.length === 0 && d.removed.length === 0 && d.changed.length === 0) return;
      lines.push(`${title}:`);
      for (const id of d.added) lines.push(`  added   ${id}`);
      for (const id of d.removed) lines.push(`  removed ${id}`);
      for (const e of d.changed) {
        lines.push(`  changed ${e.id}`);
        for (const c of e.changes) lines.push(`    ${c.field}: ${c.before || "(none)"} -> ${c.after || "(none)"}`);
      }
      lines.push("");
    };
    section("Capabilities", result.capabilities);
    section("Commands", result.commands);
    section("Constraints", result.constraints);

    if (result.health.appeared.length > 0) {
      lines.push("New health findings:");
      for (const f of result.health.appeared) lines.push(`  ${f.code} - ${f.message}`);
      lines.push("");
    }
    if (result.health.resolved.length > 0) {
      lines.push("Resolved:");
      for (const f of result.health.resolved) lines.push(`  ${f.code} - ${f.message}`);
    }

    return text(lines.join("\n"));
  },
};

function surfaceAtRef(root: string, ref: string): Surface | null {
  const raw = showFileAtRef(root, ref, SURFACE_FILE);
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return validateSurface(parsed).valid ? (parsed as Surface) : null;
  } catch {
    return null;
  }
}
