/**
 * Task-scoped context packing.
 *
 * An agent asked to change something does not need the repository; it needs the
 * handful of files that own the behaviour, the contract that specifies it, the
 * test that proves it, and the rules it must not break. This module selects
 * that set against a token budget.
 *
 * Every included item carries the reason it was chosen, and everything dropped
 * for budget is listed explicitly. A context pack that silently truncates is
 * worse than no context pack, because the caller cannot tell what is missing.
 */

import type { Command, Constraint, Surface } from "../schema/types.js";

/** Rough but stable: about four characters per token for source text. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export const DEFAULT_BUDGET_TOKENS = 8000;

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "for", "with", "from", "into", "that", "this",
  "how", "what", "where", "when", "why", "which", "does", "did", "can", "should",
  "add", "fix", "make", "use", "using", "code", "file", "files", "project", "please",
  "implement", "change", "update", "support", "need", "want", "there", "then",
]);

export function keywords(task: string): string[] {
  const words = task
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w));
  return [...new Set(words)];
}

export type ContextRole = "owner" | "contract" | "evidence";

export interface ContextItem {
  path: string;
  role: ContextRole;
  capabilityId: string;
  reason: string;
  estimatedTokens: number;
  content?: string;
}

export interface ScoredCapability {
  id: string;
  title: string;
  confidence: number;
  score: number;
  reason: string;
}

export interface OmittedItem {
  path: string;
  reason: string;
}

export interface ContextPack {
  task: string;
  budgetTokens: number;
  usedTokens: number;
  capabilities: ScoredCapability[];
  items: ContextItem[];
  constraints: Constraint[];
  commands: Command[];
  omitted: OmittedItem[];
}

export interface PackOptions {
  budgetTokens?: number;
  maxCapabilities?: number;
  /** Include file contents. Off by default: most callers only need the paths. */
  includeContent?: boolean;
}

function scoreCapability(
  capability: Surface["capabilities"][number],
  terms: string[]
): { score: number; matched: string[] } {
  if (terms.length === 0) return { score: capability.confidence, matched: [] };

  const haystacks: Array<[string, number]> = [
    [capability.id, 3],
    [capability.title, 3],
    [capability.description ?? "", 1],
    [capability.tags.join(" "), 2],
    [capability.owners.map((o) => o.path).join(" "), 2],
  ];

  let score = 0;
  const matched: string[] = [];
  for (const term of terms) {
    for (const [text, weight] of haystacks) {
      if (text.toLowerCase().includes(term)) {
        score += weight;
        matched.push(term);
        break;
      }
    }
  }
  /* Confidence breaks ties: between two equally relevant capabilities, prefer
     the one we actually have evidence for. */
  return { score: score + capability.confidence, matched: [...new Set(matched)] };
}

export function packContext(
  surface: Surface,
  task: string,
  readFile: (relPath: string) => string | null,
  options: PackOptions = {}
): ContextPack {
  const budgetTokens = options.budgetTokens ?? DEFAULT_BUDGET_TOKENS;
  const maxCapabilities = options.maxCapabilities ?? 8;
  const terms = keywords(task);

  const ranked = surface.capabilities
    .map((capability) => {
      const { score, matched } = scoreCapability(capability, terms);
      return {
        capability,
        score,
        reason:
          matched.length > 0
            ? `Matches: ${matched.join(", ")}.`
            : "No keyword match; included by confidence ranking.",
      };
    })
    .filter((r) => terms.length === 0 || r.score > r.capability.confidence)
    .sort((a, b) => b.score - a.score || a.capability.id.localeCompare(b.capability.id))
    .slice(0, maxCapabilities);

  const evidenceById = new Map(surface.evidence.map((e) => [e.id, e]));
  const items: ContextItem[] = [];
  const omitted: OmittedItem[] = [];
  const seen = new Set<string>();
  let usedTokens = 0;

  const consider = (path: string, role: ContextRole, capabilityId: string, reason: string): void => {
    if (seen.has(path)) return;
    seen.add(path);
    const content = readFile(path);
    if (content === null) {
      omitted.push({ path, reason: "File is missing, unreadable, or not one the project lists." });
      return;
    }
    const estimatedTokens = estimateTokens(content);
    if (usedTokens + estimatedTokens > budgetTokens) {
      omitted.push({ path, reason: `Would exceed the ${budgetTokens} token budget.` });
      return;
    }
    usedTokens += estimatedTokens;
    items.push({
      path,
      role,
      capabilityId,
      reason,
      estimatedTokens,
      ...(options.includeContent ? { content } : {}),
    });
  };

  /* Owners first, then contracts, then tests: if the budget runs out, it runs
     out on the least essential material. */
  for (const { capability } of ranked) {
    for (const owner of capability.owners) consider(owner.path, "owner", capability.id, "Implements the capability.");
  }
  for (const { capability } of ranked) {
    for (const contract of capability.contracts) consider(contract.path, "contract", capability.id, "Specifies the capability.");
  }
  for (const { capability } of ranked) {
    for (const ref of capability.evidence) {
      const path = evidenceById.get(ref.id)?.path;
      if (path) consider(path, "evidence", capability.id, `Proves the capability (${ref.link}).`);
    }
  }

  const relevantPackages = new Set(
    ranked.map((r) => r.capability.packageId).filter((p): p is string => typeof p === "string")
  );

  return {
    task,
    budgetTokens,
    usedTokens,
    capabilities: ranked.map((r) => ({
      id: r.capability.id,
      title: r.capability.title,
      confidence: r.capability.confidence,
      score: Math.round(r.score * 100) / 100,
      reason: r.reason,
    })),
    items,
    constraints: surface.constraints.filter((c) => c.status === "active"),
    commands: surface.commands.filter(
      (c) =>
        c.kind === "test" &&
        (relevantPackages.size === 0 || !c.packageId || relevantPackages.has(c.packageId))
    ),
    omitted,
  };
}
