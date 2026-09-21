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
 *
 * This is deliberately not a retrieval engine. A signature index or a call
 * graph ranks files better than keyword matching on capability titles, and
 * tools built for that exist. What they cannot say, and this pack does, is
 * whether the behaviour a file implements has been proven, when, and whether
 * that proof still holds: every item is labelled with the provenance tier and
 * freshness of the claim it belongs to.
 */

import type { FileAccess, FileReader } from "../fs/walk.js";
import { indexById } from "../model/ids.js";
import type { Command, Constraint, Freshness, ProvenanceTier, Surface } from "../schema/types.js";

/** Rough but stable: about four characters per token for source text. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * The same estimate from a byte count, so a pack can be sized without reading
 * a single file body. Identical for ASCII; a little high for multi-byte text
 * and for CRLF files (the reader folds `\r\n` to `\n`), which errs on the side
 * of leaving budget unused rather than overrunning it.
 */
export function estimateTokensFromBytes(bytes: number): number {
  return Math.ceil(bytes / 4);
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

/** What is known about the claim an item belongs to - carried on every item so the reader need not join. */
export interface ContextTrust {
  tier: ProvenanceTier;
  freshness: Freshness["status"];
}

export interface ContextItem {
  path: string;
  role: ContextRole;
  capabilityId: string;
  reason: string;
  estimatedTokens: number;
  trust: ContextTrust;
  content?: string;
}

export interface ScoredCapability {
  id: string;
  title: string;
  confidence: number;
  tier: ProvenanceTier;
  freshness: Freshness["status"];
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

/**
 * What the packer needs from the file system. `size` is enough to fit a file
 * into the budget; `read` is called only when content was asked for, so a
 * pack of paths costs one `stat` per candidate rather than one full read.
 * A bare reader still works; it just pays for the read to learn the size.
 */
function toAccess(files: FileAccess | FileReader): FileAccess {
  if (typeof files === "function") {
    return {
      size: (p) => {
        const content = files(p);
        return content === null ? null : content.length;
      },
      read: files,
    };
  }
  return files;
}

const FRESHNESS_ORDER: Record<Freshness["status"], number> = { fresh: 0, unknown: 1, stale: 2 };

function scoreCapability(
  capability: Surface["capabilities"][number],
  terms: string[]
): { score: number; matched: string[] } {
  if (terms.length === 0) return { score: capability.confidence, matched: [] };

  /* Lower-cased once here, not once per term per field. */
  const haystacks: Array<[string, number]> = [
    [capability.id.toLowerCase(), 3],
    [capability.title.toLowerCase(), 3],
    [(capability.description ?? "").toLowerCase(), 1],
    [capability.tags.join(" ").toLowerCase(), 2],
    [capability.owners.map((o) => o.path).join(" ").toLowerCase(), 2],
  ];

  let score = 0;
  const matched: string[] = [];
  for (const term of terms) {
    for (const [text, weight] of haystacks) {
      if (text.includes(term)) {
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
  files: FileAccess | FileReader,
  options: PackOptions = {}
): ContextPack {
  const access = toAccess(files);
  const budgetTokens = options.budgetTokens ?? DEFAULT_BUDGET_TOKENS;
  const maxCapabilities = options.maxCapabilities ?? 8;
  const terms = keywords(task);
  const freshnessOf = (c: Surface["capabilities"][number]): Freshness["status"] => c.freshness?.status ?? "unknown";

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
    /* Equal relevance and equal confidence: a claim whose proof still holds
       beats one that was never proven, which beats one whose proof went stale. */
    .sort(
      (a, b) =>
        b.score - a.score ||
        FRESHNESS_ORDER[freshnessOf(a.capability)] - FRESHNESS_ORDER[freshnessOf(b.capability)] ||
        a.capability.id.localeCompare(b.capability.id)
    )
    .slice(0, maxCapabilities);

  const evidenceById = indexById(surface.evidence);
  const items: ContextItem[] = [];
  const omitted: OmittedItem[] = [];
  const seen = new Set<string>();
  let usedTokens = 0;

  const consider = (
    path: string,
    role: ContextRole,
    capability: Surface["capabilities"][number],
    reason: string
  ): void => {
    if (seen.has(path)) return;
    seen.add(path);
    const trust: ContextTrust = { tier: capability.provenance.tier, freshness: freshnessOf(capability) };
    /* With content requested the body is needed anyway and its length is the
       better estimate; without it, a stat is all this costs. */
    let content: string | null = null;
    let estimatedTokens: number;
    if (options.includeContent) {
      content = access.read(path);
      if (content === null) {
        omitted.push({ path, reason: "File is missing, unreadable, or not one the project lists." });
        return;
      }
      estimatedTokens = estimateTokens(content);
    } else {
      const bytes = access.size(path);
      if (bytes === null) {
        omitted.push({ path, reason: "File is missing, unreadable, or not one the project lists." });
        return;
      }
      estimatedTokens = estimateTokensFromBytes(bytes);
    }
    if (usedTokens + estimatedTokens > budgetTokens) {
      omitted.push({ path, reason: `Would exceed the ${budgetTokens} token budget.` });
      return;
    }
    usedTokens += estimatedTokens;
    items.push({
      path,
      role,
      capabilityId: capability.id,
      reason,
      estimatedTokens,
      trust,
      ...(content !== null ? { content } : {}),
    });
  };

  /* Owners first, then contracts, then tests: if the budget runs out, it runs
     out on the least essential material. */
  for (const { capability } of ranked) {
    for (const owner of capability.owners) consider(owner.path, "owner", capability, "Implements the capability.");
  }
  for (const { capability } of ranked) {
    for (const contract of capability.contracts) consider(contract.path, "contract", capability, "Specifies the capability.");
  }
  for (const { capability } of ranked) {
    for (const ref of capability.evidence) {
      const entry = evidenceById.get(ref.id);
      if (!entry?.path) continue;
      const status = entry.status === "passed" || entry.status === "failed" ? `, last ${entry.status}` : "";
      consider(entry.path, "evidence", capability, `Proves the capability (${ref.link}${status}).`);
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
      tier: r.capability.provenance.tier,
      freshness: freshnessOf(r.capability),
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
