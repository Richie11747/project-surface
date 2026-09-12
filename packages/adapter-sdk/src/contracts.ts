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

/** Documents that plausibly specify a capability in the given namespace. */
export function findContracts(ctx: AdapterContext, namespace: string): SourceRef[] {
  if (namespace.length < 3) return [];
  const needle = namespace.toLowerCase();
  return ctx.files
    .filter((f) => CONTRACT_DIRS.test(f) && CONTRACT_EXTENSIONS.test(f))
    .filter((f) => (f.split("/").pop() ?? "").toLowerCase().includes(needle))
    .slice(0, MAX_CONTRACTS)
    .map((path) => ({ path }));
}
