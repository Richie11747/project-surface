/**
 * Contract discovery.
 *
 * Shared by every adapter so that "which document specifies this behaviour" is
 * answered the same way regardless of language. The match is on the namespace
 * appearing in a document filename under a docs-like directory - a guess about
 * intent, and treated as one: a contract found this way is offered as a link
 * but never raises the tier of the capability it is attached to.
 */

import type { AdapterContext, SourceRef } from "@project-surface/core";

const CONTRACT_DIRS = /(^|\/)(docs?|contracts?|api|spec|openapi|adr|rfcs?)\//i;
const CONTRACT_EXTENSIONS = /\.(md|mdx|ya?ml|json)$/i;
const MAX_CONTRACTS = 3;

/**
 * The candidate documents of a project do not change between capabilities,
 * and adapters call this once per capability. Computed once per context, so
 * a 20 000-file tree with 4 000 capabilities is two regex passes over the
 * files, not eighty million.
 */
const CANDIDATES = new WeakMap<AdapterContext, Array<{ path: string; name: string }>>();

function candidates(ctx: AdapterContext): Array<{ path: string; name: string }> {
  let cached = CANDIDATES.get(ctx);
  if (!cached) {
    cached = ctx.files
      .filter((f) => CONTRACT_DIRS.test(f) && CONTRACT_EXTENSIONS.test(f))
      .map((path) => ({ path, name: (path.split("/").pop() ?? "").toLowerCase() }));
    CANDIDATES.set(ctx, cached);
  }
  return cached;
}

/** Documents that plausibly specify a capability in the given namespace. */
export function findContracts(ctx: AdapterContext, namespace: string): SourceRef[] {
  if (namespace.length < 3) return [];
  const needle = namespace.toLowerCase();
  const out: SourceRef[] = [];
  for (const c of candidates(ctx)) {
    if (!c.name.includes(needle)) continue;
    out.push({ path: c.path });
    if (out.length === MAX_CONTRACTS) break;
  }
  return out;
}
