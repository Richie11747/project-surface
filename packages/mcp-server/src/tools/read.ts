/**
 * Read-only tools: describe the project, find a behaviour, list the rules,
 * report the drift. None of these touch the filesystem beyond reading the
 * surface document.
 */

import { z } from "zod";
import { explainClaim } from "@project-surface/core";
import { describeCapability, json, loadSurface, repoData, text, trustNote } from "../support.js";
import type { ToolContext, ToolResult } from "../support.js";

export const overviewTool = {
  name: "surface_overview",
  title: "Project overview",
  description:
    "Understand the project as a whole: what it is, which stacks it uses, which commands actually run it, " +
    "what rules apply, and which environment variables it needs. Call this before exploring files.",
  inputSchema: { format: z.enum(["text", "json"]).optional() },
  handler(args: { format?: "text" | "json" }, ctx: ToolContext): ToolResult {
    const surface = loadSurface(ctx);
    if (args.format === "json") return json(surface);

    const lines = [
      `Project: ${surface.project.name}`,
      `Stacks: ${surface.project.stacks.map((s) => `${s.id}${s.toolchainAvailable ? "" : " (toolchain unavailable)"}`).join(", ") || "none detected"}`,
      `Packages: ${surface.project.packages.map((p) => `${p.id} at ${p.path}`).join(", ")}`,
      `Surface generated: ${surface.generatedAt}`,
      "",
      "Commands:",
      ...surface.commands.map(
        (c) =>
          `  ${c.id} - ${c.run}${c.cwd === "." ? "" : ` (in ${c.cwd})`} [${c.kind}]` +
          ` ${c.verification ? `last run: ${c.verification.status}` : "never run"}`
      ),
      "",
      "Capabilities:",
      ...surface.capabilities.map(
        (c) => `  ${c.id} - ${c.title} [${c.provenance.tier}, confidence ${c.confidence.toFixed(2)}]`
      ),
      "",
      "Constraints:",
      ...surface.constraints.map((c) => `  [${c.severity}] ${c.rule}`),
      "",
      "Environment variables required:",
      ...surface.environment.map((e) => `  ${e.name}${e.secret ? " (secret)" : ""}`),
      "",
      "Risks:",
      ...surface.risks.map((r) => `  ${r.type} (${r.approval}) - ${r.paths.slice(0, 3).join(", ")}`),
      "",
      `Health: ${surface.health.length} findings. Call surface_health for detail.`,
      "",
      trustNote(),
    ];
    return text(lines.filter((l) => l !== undefined).join("\n"));
  },
};

export const findCapabilityTool = {
  name: "surface_find_capability",
  title: "Find a capability",
  description:
    "Find where a behaviour is implemented, what specifies it, what proves it works, and what a change to it " +
    "would require. Use this instead of grepping when you want to know who owns a behaviour.",
  inputSchema: {
    query: z.string().describe("A capability id, route path, or plain description such as 'create checkout'."),
    limit: z.number().int().min(1).max(25).optional(),
  },
  handler(args: { query: string; limit?: number }, ctx: ToolContext): ToolResult {
    const surface = loadSurface(ctx);
    const needle = args.query.toLowerCase().trim();
    const limit = args.limit ?? 5;

    const scored = surface.capabilities
      .map((c) => {
        const haystack = `${c.id} ${c.title} ${c.description ?? ""} ${c.tags.join(" ")} ${c.owners.map((o) => o.path).join(" ")}`.toLowerCase();
        let score = 0;
        if (c.id === needle) score += 100;
        if (c.id.includes(needle)) score += 20;
        if (haystack.includes(needle)) score += 10;
        for (const word of needle.split(/\s+/).filter((w) => w.length > 2)) {
          if (haystack.includes(word)) score += 3;
        }
        return { c, score: score + c.confidence };
      })
      .filter((s) => s.score > 1)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    if (scored.length === 0) {
      return text(
        `No capability matches "${args.query}".\n` +
          `Known capabilities: ${surface.capabilities.map((c) => c.id).join(", ") || "none"}`
      );
    }

    const evidenceById = new Map(surface.evidence.map((e) => [e.id, e]));
    const blocks = scored.map(({ c }) => {
      const evidence = c.evidence
        .map((ref) => {
          const entry = evidenceById.get(ref.id);
          return `    ${entry?.path ?? ref.id} - status ${entry?.status ?? "unknown"}, linked by ${ref.link}`;
        })
        .join("\n");
      const commands = surface.commands
        .filter((cmd) => cmd.kind === "test" && (!c.packageId || !cmd.packageId || cmd.packageId === c.packageId))
        .map((cmd) => `    ${cmd.run}`)
        .join("\n");
      return (
        describeCapability(c) +
        (evidence ? `\n  evidence detail:\n${evidence}` : "") +
        (commands ? `\n  check it with:\n${commands}` : "")
      );
    });

    return text(`${blocks.join("\n\n")}\n\n${trustNote()}`);
  },
};

export const constraintsTool = {
  name: "surface_constraints",
  title: "Project constraints",
  description:
    "The rules this project expects you to follow, with the file each rule came from, whether the rule is " +
    "machine-checked, and whether the last scan found it violated. Check this before changing build, " +
    "dependency, or tooling configuration.",
  inputSchema: { includeStale: z.boolean().optional() },
  handler(args: { includeStale?: boolean }, ctx: ToolContext): ToolResult {
    const surface = loadSurface(ctx);
    const constraints = surface.constraints.filter(
      (c) => args.includeStale === true || c.status === "active"
    );
    if (constraints.length === 0) return text("No constraints were discovered or declared for this project.");

    const body = constraints
      .map(
        (c) =>
          `[${c.severity}] ${c.rule}\n` +
          `  source     ${c.provenance.sources.map((s) => `${s.path}${s.locator ? `#${s.locator}` : ""}`).join(", ")}\n` +
          `  provenance ${c.provenance.tier}, confidence ${c.confidence.toFixed(2)}` +
          (c.rationale ? `\n  why        ${c.rationale}` : "") +
          (c.check
            ? `\n  checked    ${c.check.kind}: ${c.checked?.status ?? "unchecked"}` +
              (c.checked?.status === "violated" ? ` in ${c.checked.violations} place(s) - see surface_health` : "") +
              (c.checked?.reason ? ` (${c.checked.reason})` : "")
            : `\n  checked    no - prose only; nothing verifies compliance`)
      )
      .join("\n");
    return text([repoData(body), "", trustNote()].join("\n"));
  },
};

export const healthTool = {
  name: "surface_health",
  title: "Surface health",
  description:
    "Where the recorded model of this project has drifted from reality: stale claims, commands that no longer " +
    "work, behaviour with no test, documentation that points at deleted files.",
  inputSchema: { severity: z.enum(["error", "warn", "info"]).optional() },
  handler(args: { severity?: "error" | "warn" | "info" }, ctx: ToolContext): ToolResult {
    const surface = loadSurface(ctx);
    const rank = { error: 0, warn: 1, info: 2 } as const;
    const threshold = rank[args.severity ?? "info"];
    const findings = surface.health.filter((f) => rank[f.severity] <= threshold);

    if (findings.length === 0) return text("No health findings. Every claim is backed and current.");

    const body = findings
      .map(
        (f) =>
          `[${f.severity}] ${f.code}${f.subject ? ` (${f.subject.kind} ${f.subject.id})` : ""}\n` +
          `  ${f.message}` +
          (f.remediation ? `\n  fix: ${f.remediation}` : "")
      )
      .join("\n\n");
    return text([repoData(body), "", trustNote()].join("\n"));
  },
};

export const whyTool = {
  name: "surface_why",
  title: "Why a claim has its confidence",
  description:
    "Explain how a confidence score was derived: which files the claim was read from, which tests ran against it " +
    "and what they said, whether that earned a promotion, whether the owner files changed since, and the arithmetic. " +
    "Use it before relying on a number, or when two claims disagree.",
  inputSchema: {
    id: z.string().describe("A capability id (or alias), command id, constraint id, risk id, or environment variable name."),
    format: z.enum(["text", "json"]).optional(),
  },
  handler(args: { id: string; format?: "text" | "json" }, ctx: ToolContext): ToolResult {
    const surface = loadSurface(ctx);
    const e = explainClaim(surface, args.id);
    if (!e) return text(`Nothing in the surface has the id "${args.id}". Call surface_find_capability to search.`);
    if (args.format === "json") return json(e);

    const lines = [
      `${e.id} (${e.kind}) - ${e.title}`,
      e.aliases.length > 0 ? `Also answers to: ${e.aliases.join(", ")}` : undefined,
      "",
      `Read from: ${e.provenance.tier} by the ${e.provenance.adapter} adapter at ${e.provenance.observedAt}, ${e.provenance.distinctSources} distinct file(s)`,
      ...e.provenance.sources.map((s) => `  ${s.path}${s.locator ? ` (${s.locator})` : ""}`),
      "",
      "Proven by:",
      ...(e.evidence.length === 0 ? ["  nothing - no evidence is linked"] : []),
      ...e.evidence.map(
        (ev) =>
          `  ${ev.status}  ${ev.path ?? ev.id}` +
          [ev.link ? ` linked by ${ev.link}` : "", ev.commandId ? ` via command ${ev.commandId}` : "", ev.observedAt ? ` observed ${ev.observedAt}` : ""].join("")
      ),
      e.promotion ? `  ${e.promotion.from} -> ${e.promotion.to}: ${e.promotion.reason}` : undefined,
      "",
      `Freshness: ${e.freshness ? `${e.freshness.status}${e.freshness.reason ? ` - ${e.freshness.reason}` : ""}` : "not tracked for this kind of claim"}`,
      e.freshness?.verifiedAt ? `  verified ${e.freshness.verifiedAt}; stale after ${e.freshness.staleAfterDays} days` : undefined,
      "",
      "Score:",
      ...e.trace.steps.map((s) => `  ${s.value.toFixed(2)}  ${s.rule}: ${s.detail}`),
      `  = ${e.trace.score.toFixed(2)}`,
      "",
      e.consistent
        ? `Recomputed from the document; matches the recorded ${e.recorded.toFixed(2)}.`
        : `Recomputed ${e.trace.score.toFixed(2)} but the document records ${e.recorded.toFixed(2)} - regenerate with surface init.`,
    ];
    return text(lines.filter((l) => l !== undefined).join("\n"));
  },
};
