/**
 * Stable identifier derivation.
 *
 * Identifiers must be deterministic and must not change between runs for an
 * unchanged project. If they churn, `surface diff` reports noise instead of
 * signal and every consumer that stored an id breaks. Everything here is a pure
 * function of the inputs - no counters, no timestamps, no filesystem order.
 *
 * All output matches the spec identifier pattern: ^[a-z0-9][a-z0-9._:/-]*$
 */

const ALLOWED = /[^a-z0-9._:/-]+/g;
const COLLAPSE = /-{2,}/g;
const TRIM = /^[^a-z0-9]+|[^a-z0-9]+$/g;

/** Normalize arbitrary text into an identifier-safe segment. */
export function slug(input: string): string {
  const out = input
    .trim()
    .toLowerCase()
    .replace(ALLOWED, "-")
    .replace(COLLAPSE, "-")
    .replace(TRIM, "");
  return out.length > 0 ? out : "unnamed";
}

/**
 * `createCheckout` -> `create-checkout`, `list_orders` -> `list-orders`.
 * Normalizes both camelCase and snake_case so ids look the same regardless of
 * which language the symbol came from.
 */
export function camelToKebab(input: string): string {
  return input
    .replace(/_/g, "-")
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2")
    .toLowerCase();
}

/** HTTP method plus path shape decides the verb. */
function routeVerb(method: string, path: string): string {
  const m = method.toUpperCase();
  const hasParam = /[:{*]/.test(path.split("/").pop() ?? "");
  switch (m) {
    case "GET":
      return hasParam ? "get" : "list";
    case "HEAD":
      return "head";
    case "POST":
      return "create";
    case "PUT":
      return "replace";
    case "PATCH":
      return "update";
    case "DELETE":
      return "delete";
    default:
      return slug(m);
  }
}

/**
 * `POST /checkout` -> `checkout.create`
 * `GET  /checkout/:id` -> `checkout.get`
 * `GET  /v1/orders/:id/items` -> `orders.items.list`
 *
 * Path parameters are dropped from the resource name: they identify an
 * instance, not a capability.
 */
export function capabilityIdFromRoute(method: string, path: string): string {
  const segments = path
    .split("/")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .filter((s) => !/^[:{*]/.test(s))
    .filter((s) => !/^v[0-9]+$/i.test(s))
    .filter((s) => s.toLowerCase() !== "api")
    .map(slug);

  const resource = segments.length > 0 ? segments.join(".") : "root";
  return `${resource}.${routeVerb(method, path)}`;
}

/** Path segments that describe layout, not domain, and make poor namespaces. */
const GENERIC_SEGMENTS = new Set([
  "index", "__init__", "main", "mod",
  "src", "lib", "app", "pkg", "internal", "cmd", "pages", "routes", "handlers",
]);

/**
 * Namespace for a symbol-derived id.
 *
 * Prefers the containing directory over the filename: `src/checkout/create.ts`
 * describes the `checkout` area of the system, while `create` is a verb the
 * symbol name already carries. Generic layout directories are skipped.
 */
export function moduleNamespace(modulePath: string): string {
  const parts = modulePath.split("/").filter((p) => p.length > 0);
  const file = parts[parts.length - 1] ?? modulePath;
  const base = file.replace(/[.](ts|tsx|mts|cts|js|jsx|mjs|cjs|py|go|rs)$/i, "");
  const dir = parts.length >= 2 ? parts[parts.length - 2] : undefined;

  if (dir && !GENERIC_SEGMENTS.has(dir.toLowerCase())) return slug(dir);
  if (!GENERIC_SEGMENTS.has(base.toLowerCase())) return slug(base);
  return dir ? slug(dir) : slug(base);
}

/**
 * `src/checkout/create.ts` + `createCheckout` -> `checkout.create`.
 *
 * Tokens in the symbol that merely repeat the namespace are dropped, so ids
 * read as `area.action` instead of stuttering.
 */
export function capabilityIdFromSymbol(modulePath: string, symbol: string): string {
  const namespace = moduleNamespace(modulePath);
  const tokens = camelToKebab(symbol).split("-").filter((t) => t.length > 0);
  const trimmed = tokens.filter((t) => t !== namespace);
  const name = (trimmed.length > 0 ? trimmed : tokens).join("-");
  return `${namespace}.${slug(name)}`;
}

export function packageIdFromPath(path: string): string {
  if (path === "." || path === "") return "root";
  return slug(path.replace(/\//g, "-"));
}

export function commandId(name: string, packageId?: string): string {
  const base = slug(name);
  return packageId && packageId !== "root" ? `${packageId}:${base}` : base;
}

export function evidenceId(path: string): string {
  return `evidence:${slug(path)}`;
}

export function constraintId(key: string): string {
  return `constraint:${slug(key)}`;
}

export function riskId(type: string, path: string): string {
  return `risk:${slug(type)}:${slug(path)}`;
}

/**
 * Resolve a collision deterministically by suffixing an ordinal. Mutates the
 * `taken` set so repeated calls stay consistent within one build.
 */
export function uniqueId(base: string, taken: Set<string>): string {
  if (!taken.has(base)) {
    taken.add(base);
    return base;
  }
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) {
      taken.add(candidate);
      return candidate;
    }
  }
}
