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
 * Three things keep the pack small without hiding anything:
 *
 *   - A file the caller was already served in this session, and that has not
 *     changed since, is listed but not repeated (`repeat`). The tokens it would
 *     have cost are reported as saved, not spent.
 *   - A file that does not fit the remaining budget is sliced around the
 *     locator the document already holds for it (`L74`, `export:createCheckout`)
 *     rather than dropped; the item says so (`partial`, `range`).
 *   - Rules come filtered to the ones that can apply to the files in the pack,
 *     plus every rule at error severity; the count left out is reported.
 *
 * This is deliberately not a retrieval engine. A signature index or a call
 * graph ranks files better than keyword matching on capability titles, and
 * tools built for that exist. What they cannot say, and this pack does, is
 * whether the behaviour a file implements has been proven, when, and whether
 * that proof still holds: every item is labelled with the provenance tier and
 * freshness of the claim it belongs to.
 */

import type { FileAccess, FileReader } from "../fs/walk.js";
import { globFilter } from "../fs/glob.js";
import { indexById } from "../model/ids.js";
import { hashContent } from "../model/freshness.js";
import type { Capability, Command, Constraint, Freshness, ProvenanceTier, SourceRef, Surface } from "../schema/types.js";

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
/** A slice is never longer than this many lines, whatever the locator points at. */
export const SLICE_MAX_LINES = 120;

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

export interface ContextRange {
  /** 1-based, inclusive. */
  start: number;
  end: number;
}

export interface ContextItem {
  path: string;
  role: ContextRole;
  capabilityId: string;
  reason: string;
  estimatedTokens: number;
  trust: ContextTrust;
  /** A change key for the file as served - size and mtime, or a content hash - so a later pack can tell whether it moved. */
  key?: string;
  /** Present when the item is a slice of the file rather than the whole of it. */
  range?: ContextRange;
  partial?: boolean;
  /** Present when the file was served earlier in this session and has not changed: listed, not repeated. */
  repeat?: { since: number };
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
  /** Tokens the pack would have cost had it repeated files the session already served. */
  savedTokens: number;
  /** How many items are repeats. */
  repeated: number;
  capabilities: ScoredCapability[];
  items: ContextItem[];
  constraints: Constraint[];
  /** Active rules left out because nothing in the pack can trigger them; `allConstraints` includes them. */
  constraintsOmitted: number;
  commands: Command[];
  omitted: OmittedItem[];
}

/** What an earlier pack served: the change key it saw for a path, and which pack that was. */
export interface ServedEntry {
  key: string;
  seq: number;
}

export interface PackOptions {
  budgetTokens?: number;
  maxCapabilities?: number;
  /** Include file contents. Off by default: most callers only need the paths. */
  includeContent?: boolean;
  /** Files served earlier in the session; a file whose key is unchanged is listed, not repeated. */
  served?: ReadonlyMap<string, ServedEntry>;
  /** Every active rule, not only the ones that can apply to the pack. */
  allConstraints?: boolean;
}

/**
 * What the packer needs from the file system. `size` is enough to fit a file
 * into the budget; `read` is called only when content was asked for, so a
 * pack of paths costs one `stat` per candidate rather than one full read.
 * A bare reader still works; it just pays for the read to learn the size, and
 * its change key is a content hash rather than a stat.
 */
function toAccess(files: FileAccess | FileReader): FileAccess {
  if (typeof files === "function") {
    const cache = new Map<string, string | null>();
    const read = (p: string): string | null => {
      if (!cache.has(p)) cache.set(p, files(p));
      return cache.get(p) ?? null;
    };
    return {
      size: (p) => {
        const content = read(p);
        return content === null ? null : content.length;
      },
      read,
      stat: (p) => {
        const content = read(p);
        return content === null ? null : { size: content.length, key: `h:${hashContent(content)}` };
      },
    };
  }
  return files;
}

const FRESHNESS_ORDER: Record<Freshness["status"], number> = { fresh: 0, unknown: 1, stale: 2 };

export interface RankedCapability {
  capability: Capability;
  score: number;
  matched: string[];
  reason: string;
}

/**
 * How well one term matches one field. A whole word beats a prefix beats a
 * substring, so "auth" prefers `auth.verify-token` over `author`.
 */
function termScore(term: string, text: string): number {
  if (text.length === 0) return 0;
  const words = text.split(/[^a-z0-9]+/);
  if (words.includes(term)) return 3;
  if (words.some((w) => w.startsWith(term))) return 2;
  return text.includes(term) ? 1 : 0;
}

function scoreCapability(capability: Capability, terms: string[]): { score: number; matched: string[] } {
  if (terms.length === 0) return { score: capability.confidence, matched: [] };

  /* Lower-cased once here, not once per term per field. Each field has a
     weight; a term takes the best-scoring field only, so one word does not
     count five times for appearing in id, title and path. */
  const route = capability.route ? `${capability.route.method ?? ""} ${capability.route.path}` : "";
  const haystacks: Array<[string, number]> = [
    [capability.id.toLowerCase(), 1],
    [capability.title.toLowerCase(), 1],
    [(capability.aliases ?? []).join(" ").toLowerCase(), 1],
    [route.toLowerCase(), 1],
    [capability.tags.join(" ").toLowerCase(), 0.75],
    [capability.owners.map((o) => o.path).join(" ").toLowerCase(), 0.75],
    [(capability.description ?? "").toLowerCase(), 0.5],
  ];

  let score = 0;
  const matched: string[] = [];
  for (const term of terms) {
    let best = 0;
    for (const [text, weight] of haystacks) best = Math.max(best, termScore(term, text) * weight);
    if (best > 0) {
      score += best;
      matched.push(term);
    }
  }
  /* Confidence breaks ties: between two equally relevant capabilities, prefer
     the one we actually have evidence for. */
  return { score: score + capability.confidence, matched: [...new Set(matched)] };
}

/**
 * The one ranking every tool uses for "which capabilities does this text
 * name": the context pack, `find_capability`, and anything else that takes a
 * query. Keyword matching over the document, by design - see the header.
 */
export function rankCapabilities(
  surface: Surface,
  query: string,
  options: { limit?: number } = {}
): RankedCapability[] {
  const terms = keywords(query);
  const freshnessOf = (c: Capability): Freshness["status"] => c.freshness?.status ?? "unknown";
  const ranked = surface.capabilities
    .map((capability) => {
      const { score, matched } = scoreCapability(capability, terms);
      return {
        capability,
        score,
        matched,
        reason:
          matched.length > 0 ? `Matches: ${matched.join(", ")}.` : "No keyword match; included by confidence ranking.",
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
    );
  return options.limit === undefined ? ranked : ranked.slice(0, options.limit);
}

/* ---- Slicing ------------------------------------------------------------ */

const LINE_LOCATOR = /^L(\d+)(?:-L?(\d+))?$/;
const EXPORT_LOCATOR = /^export:([A-Za-z_$][\w$]*)$/;
/** A line that starts a top-level declaration in the languages the adapters read. */
const DECLARATION_START =
  /^(?:export\b|function\b|async\s+function\b|class\b|const\b|let\b|var\b|interface\b|type\b|enum\b|def\b|async\s+def\b|func\b|pub\b|fn\b|impl\b|struct\b|mod\b|@\w|#\[)/;

function declarationLine(lines: readonly string[], name: string): number {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(
      `^\\s*export\\s+(?:default\\s+)?(?:async\\s+)?(?:function\\*?|class|const|let|var|interface|type|enum)\\s+${escaped}\\b`
    ),
    new RegExp(`^(?:async\\s+)?(?:def|class)\\s+${escaped}\\b`),
    new RegExp(`^func\\s+(?:\\([^)]*\\)\\s*)?${escaped}\\b`),
    new RegExp(`^\\s*pub(?:\\([^)]*\\))?\\s+(?:async\\s+)?(?:fn|struct|enum|trait|type)\\s+${escaped}\\b`),
  ];
  return lines.findIndex((line) => patterns.some((re) => re.test(line)));
}

/**
 * The part of a file a locator points at: from that line to the next
 * top-level declaration, capped. Null when the locator is not one that names
 * a line or an export - a declaration index or a manifest key does not.
 */
export function sliceAround(content: string, locator: string): { text: string; range: ContextRange } | null {
  const lines = content.split("\n");
  let start: number;
  let end: number | undefined;
  const byLine = LINE_LOCATOR.exec(locator);
  const byExport = EXPORT_LOCATOR.exec(locator);
  if (byLine) {
    start = Number(byLine[1]) - 1;
    if (byLine[2]) end = Number(byLine[2]);
  } else if (byExport?.[1]) {
    start = declarationLine(lines, byExport[1]);
  } else {
    return null;
  }
  if (start < 0 || start >= lines.length) return null;
  if (end === undefined) {
    end = start + 1;
    while (end < lines.length && end - start < SLICE_MAX_LINES && !DECLARATION_START.test(lines[end] ?? "")) end += 1;
  }
  end = Math.min(end, lines.length, start + SLICE_MAX_LINES);
  return { text: lines.slice(start, end).join("\n"), range: { start: start + 1, end } };
}

/* ---- Constraints --------------------------------------------------------- */

/**
 * Which active rules can apply to a set of paths. A rule at error severity
 * always can - it fails the build wherever it fires. Any other rule applies
 * when a glob of its check, or a source it was read from, covers one of the
 * paths; a rule scoped to `src/payments/**` is noise in a pack about docs.
 */
export function relevantConstraints(
  surface: Surface,
  paths: readonly string[]
): { constraints: Constraint[]; omitted: number } {
  const active = surface.constraints.filter((c) => c.status === "active");
  const covers = (globs: readonly string[] | undefined): boolean => {
    if (!globs || globs.length === 0) return false;
    const match = globFilter(globs);
    return paths.some((p) => match(p));
  };
  const kept = active.filter((c) => {
    if (c.severity === "error") return true;
    if (c.check && (covers(c.check.from) || covers(c.check.paths))) return true;
    /* A rule with no scoped check applies wherever it was written about. */
    if (!c.check?.from && !c.check?.paths) {
      return c.provenance.sources.some((s) => paths.some((p) => p === s.path || p.startsWith(`${s.path}/`)));
    }
    return false;
  });
  return { constraints: kept, omitted: active.length - kept.length };
}

/* ---- The pack ------------------------------------------------------------ */

export function packContext(
  surface: Surface,
  task: string,
  files: FileAccess | FileReader,
  options: PackOptions = {}
): ContextPack {
  const access = toAccess(files);
  const budgetTokens = options.budgetTokens ?? DEFAULT_BUDGET_TOKENS;
  const maxCapabilities = options.maxCapabilities ?? 8;
  const freshnessOf = (c: Capability): Freshness["status"] => c.freshness?.status ?? "unknown";
  const ranked = rankCapabilities(surface, task, { limit: maxCapabilities });

  const evidenceById = indexById(surface.evidence);
  const items: ContextItem[] = [];
  const omitted: OmittedItem[] = [];
  const seen = new Set<string>();
  let usedTokens = 0;
  let savedTokens = 0;

  const consider = (ref: SourceRef, role: ContextRole, capability: Capability, reason: string): void => {
    const path = ref.path;
    if (seen.has(path)) return;
    seen.add(path);
    const trust: ContextTrust = { tier: capability.provenance.tier, freshness: freshnessOf(capability) };
    const stat = access.stat?.(path) ?? null;
    const key = stat?.key;

    /* Already in the caller's hands and unchanged since: say so, charge nothing. */
    const served = key ? options.served?.get(path) : undefined;
    if (served && served.key === key) {
      const estimatedTokens = estimateTokensFromBytes(stat?.size ?? 0);
      savedTokens += estimatedTokens;
      items.push({
        path,
        role,
        capabilityId: capability.id,
        reason: `${reason} Served in pack #${served.seq}; unchanged since, not repeated.`,
        estimatedTokens,
        trust,
        key,
        repeat: { since: served.seq },
      });
      return;
    }

    /* With content requested the body is needed anyway and its length is the
       better estimate; without it, a stat is all this costs. */
    let content: string | null = null;
    let estimatedTokens: number;
    if (options.includeContent) {
      content = access.read(path);
      if (content === null) {
        omitted.push({ path, reason: unreadableReason(stat) });
        return;
      }
      estimatedTokens = estimateTokens(content);
    } else {
      const bytes = access.size(path);
      if (bytes === null) {
        omitted.push({ path, reason: unreadableReason(stat) });
        return;
      }
      estimatedTokens = estimateTokensFromBytes(bytes);
    }

    if (usedTokens + estimatedTokens > budgetTokens) {
      /* Too big whole; the locator may still name the part that matters. */
      const body = content ?? (ref.locator ? access.read(path) : null);
      const slice = body !== null && ref.locator ? sliceAround(body, ref.locator) : null;
      const sliceTokens = slice ? estimateTokens(slice.text) : Number.POSITIVE_INFINITY;
      if (slice && usedTokens + sliceTokens <= budgetTokens) {
        usedTokens += sliceTokens;
        items.push({
          path,
          role,
          capabilityId: capability.id,
          reason:
            `${reason} Sliced around ${ref.locator} (L${slice.range.start}-L${slice.range.end}): ` +
            `the whole file (~${estimatedTokens} tokens) does not fit the remaining budget.`,
          estimatedTokens: sliceTokens,
          trust,
          ...(key ? { key } : {}),
          range: slice.range,
          partial: true,
          ...(options.includeContent ? { content: slice.text } : {}),
        });
        return;
      }
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
      ...(key ? { key } : {}),
      ...(content !== null ? { content } : {}),
    });
  };

  /* Owners first, then contracts, then tests: if the budget runs out, it runs
     out on the least essential material. */
  for (const { capability } of ranked) {
    for (const owner of capability.owners) consider(owner, "owner", capability, "Implements the capability.");
  }
  for (const { capability } of ranked) {
    for (const contract of capability.contracts) consider(contract, "contract", capability, "Specifies the capability.");
  }
  for (const { capability } of ranked) {
    for (const ref of capability.evidence) {
      const entry = evidenceById.get(ref.id);
      if (!entry?.path) continue;
      const status = entry.status === "passed" || entry.status === "failed" ? `, last ${entry.status}` : "";
      consider({ path: entry.path }, "evidence", capability, `Proves the capability (${ref.link}${status}).`);
    }
  }

  const relevantPackages = new Set(
    ranked.map((r) => r.capability.packageId).filter((p): p is string => typeof p === "string")
  );
  const packPaths = [...items.map((i) => i.path), ...ranked.flatMap((r) => r.capability.owners.map((o) => o.path))];
  const rules = options.allConstraints
    ? { constraints: surface.constraints.filter((c) => c.status === "active"), omitted: 0 }
    : relevantConstraints(surface, packPaths);

  return {
    task,
    budgetTokens,
    usedTokens,
    savedTokens,
    repeated: items.filter((i) => i.repeat).length,
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
    constraints: rules.constraints,
    constraintsOmitted: rules.omitted,
    commands: surface.commands.filter(
      (c) =>
        c.kind === "test" &&
        (relevantPackages.size === 0 || !c.packageId || relevantPackages.has(c.packageId))
    ),
    omitted,
  };
}

function unreadableReason(stat: { size: number } | null): string {
  if (stat && stat.size > 2 * 1024 * 1024) return "File is larger than 2 MiB; the reader does not serve files that size.";
  return "File is missing, unreadable, or not one the project lists.";
}
