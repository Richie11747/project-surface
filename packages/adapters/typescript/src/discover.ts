/**
 * Turning parsed files into claims.
 *
 * Two sources of capability, with different confidence characteristics:
 *
 *   routes    a registered HTTP path is an unambiguous statement of intent, and
 *             the id derived from it (`checkout.create`) is meaningful to a
 *             human. Tier `derived`.
 *   exports   an exported function is a plausible unit of behaviour, but export
 *             does not mean "capability" - plenty of exports are helpers. Tier
 *             `inferred`, so they rank below routes and below anything declared.
 */

import { findContracts, provenance, source } from "@project-surface/adapter-sdk";
import { capabilityIdFromRoute, capabilityIdFromSymbol, evidenceId, riskId, looksSecretName } from "@project-surface/core";
import type {
  AdapterContext,
  DraftCapability,
  DraftEnvironmentVariable,
  DraftEvidenceEntry,
  DraftRisk,
  PackageInfo,
} from "@project-surface/adapter-sdk";
import { ADAPTER_ID } from "./manifest.js";
import type { LinkedEvidence } from "./evidence-link.js";
import type { ParsedFile } from "./parse.js";

const RISK_RULES: Array<{
  pattern: RegExp;
  type: DraftRisk["type"];
  approval: DraftRisk["approval"];
  reason: string;
}> = [
  {
    pattern: /(^|\/)(db\/migrations|migrations|prisma\/migrations|drizzle)(\/|$)/,
    type: "migration",
    approval: "required",
    reason: "Database migrations are difficult to reverse once applied to a live database.",
  },
  {
    pattern: /(^|\/)(Dockerfile|docker-compose\.ya?ml|compose\.ya?ml)$/,
    type: "infra",
    approval: "advisory",
    reason: "Changes here alter how the service is built and run everywhere.",
  },
  {
    pattern: /(^|\/)(terraform|k8s|kubernetes|helm|charts)(\/|$)/,
    type: "infra",
    approval: "required",
    reason: "Infrastructure definitions affect deployed environments directly.",
  },
  {
    pattern: /(^|\/)\.github\/workflows\//,
    type: "infra",
    approval: "advisory",
    reason: "CI workflow changes affect every future build and may hold credentials.",
  },
];

/** The most specific package containing a file. */
export function packageFor(path: string, packages: PackageInfo[]): string | undefined {
  let best: PackageInfo | undefined;
  for (const pkg of packages) {
    if (pkg.path === ".") {
      best ??= pkg;
      continue;
    }
    if (path.startsWith(`${pkg.path}/`) && (!best || pkg.path.length > best.path.length)) best = pkg;
  }
  return best?.id;
}

export interface EvidenceInput {
  ctx: AdapterContext;
  testPaths: string[];
  packages: PackageInfo[];
  /** Test commands, so evidence knows which command would prove it. */
  testCommands: Array<{ id: string; packageId?: string }>;
}

/**
 * Bind each test file to the command that would actually run it. Without this
 * link `surface verify` has no way to turn a passing run into evidence for a
 * specific capability, and the promotion from `derived` to `verified` can never
 * happen.
 */
export function buildEvidence(input: EvidenceInput): DraftEvidenceEntry[] {
  const { ctx, testPaths, packages, testCommands } = input;

  /* A test belongs to its own package's test script, or to a root one. Another
     package's script would not run it, so it is not claimed as its command. */
  const commandForPath = (path: string): string | undefined => {
    const packageId = packageFor(path, packages);
    return (
      testCommands.find((c) => c.packageId !== undefined && c.packageId === packageId)?.id ??
      testCommands.find((c) => c.packageId === undefined || c.packageId === "root")?.id
    );
  };

  return testPaths.sort().map((path) => {
    const commandId = commandForPath(path);
    return {
      id: evidenceId(path),
      kind: "test" as const,
      path,
      ...(commandId ? { commandId } : {}),
      /* Discovering a test file says a test exists, not that it passes.
         `surface verify` is the only thing that may change this. */
      status: "unknown" as const,
      provenance: provenance({
        tier: "derived",
        adapter: ADAPTER_ID,
        now: ctx.now,
        sources: [source(path)],
      }),
    };
  });
}

export function buildEnvironment(
  ctx: AdapterContext,
  parsed: Map<string, ParsedFile>
): DraftEnvironmentVariable[] {
  const usage = new Map<string, string[]>();
  for (const [path, file] of parsed) {
    for (const name of file.envNames) {
      usage.set(name, [...(usage.get(name) ?? []), path]);
    }
  }

  return [...usage.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, paths]) => ({
      name,
      required: true,
      secret: looksSecretName(name),
      usedBy: paths.sort().map((p) => source(p)),
      provenance: provenance({
        tier: "derived",
        adapter: ADAPTER_ID,
        now: ctx.now,
        sources: paths.sort().map((p) => source(p)),
      }),
    }));
}

export interface CapabilityInput {
  ctx: AdapterContext;
  parsed: Map<string, ParsedFile>;
  packages: PackageInfo[];
  links: LinkedEvidence[];
}

export function buildCapabilities(input: CapabilityInput): DraftCapability[] {
  const { ctx, parsed, packages, links } = input;
  const capabilities: DraftCapability[] = [];

  const evidenceByOwner = new Map<string, LinkedEvidence[]>();
  for (const link of links) {
    evidenceByOwner.set(link.ownerPath, [...(evidenceByOwner.get(link.ownerPath) ?? []), link]);
  }
  const evidenceRefs = (ownerPath: string): DraftCapability["evidence"] =>
    (evidenceByOwner.get(ownerPath) ?? []).map((l) => ({ id: evidenceId(l.testPath), link: l.link }));

  for (const path of [...parsed.keys()].sort()) {
    const file = parsed.get(path);
    if (!file) continue;
    const pkg = packageFor(path, packages);

    for (const route of file.routes) {
      const id = capabilityIdFromRoute(route.method, route.path);
      capabilities.push({
        id,
        title: `${route.method} ${route.path}`,
        description: `HTTP endpoint registered in ${path}.`,
        kind: "route",
        ...(pkg ? { packageId: pkg } : {}),
        owners: [source(path, `L${route.line}`)],
        contracts: findContracts(ctx, id.split(".")[0] ?? ""),
        evidence: evidenceRefs(path),
        environment: file.envNames,
        tags: ["http", route.method.toLowerCase()],
        route: { method: route.method, path: route.path },
        provenance: provenance({
          tier: "derived",
          adapter: ADAPTER_ID,
          now: ctx.now,
          sources: [source(path, `L${route.line}`)],
        }),
      });
    }

    /* Exports are emitted even for a file that also registers routes. When a
       symbol and a route derive the same id - `createCheckout` in
       checkout/create.ts and `POST /checkout` both yield `checkout.create` -
       the merge layer folds them into one capability with both owners and the
       stronger provenance. Suppressing exports here would instead discard real
       behaviour that happens to live beside a route. */
    for (const symbol of file.exports) {
      const id = capabilityIdFromSymbol(path, symbol.name);
      capabilities.push({
        id,
        title: symbol.name,
        description: `Exported ${symbol.kind} in ${path}.`,
        kind: "export",
        ...(pkg ? { packageId: pkg } : {}),
        owners: [source(path, `export:${symbol.name}`)],
        contracts: findContracts(ctx, id.split(".")[0] ?? ""),
        evidence: evidenceRefs(path),
        environment: file.envNames,
        tags: [symbol.kind],
        provenance: provenance({
          tier: "inferred",
          adapter: ADAPTER_ID,
          now: ctx.now,
          sources: [source(path, `L${symbol.line}`)],
        }),
      });
    }
  }

  return capabilities;
}

function commonPrefix(paths: string[]): string {
  const first = paths[0] ?? "";
  const segments = first.split("/");
  let depth = segments.length;
  for (const path of paths) {
    const parts = path.split("/");
    let i = 0;
    while (i < depth && i < parts.length && parts[i] === segments[i]) i++;
    depth = i;
  }
  return depth > 0 ? segments.slice(0, depth).join("/") : first;
}

/**
 * The place a risk lives, for its id. The common prefix of the matches when
 * that is a directory; the directory of the file when it is a file. Naming
 * the file would make the id change as soon as a second migration or
 * workflow appeared, which is exactly the churn stable ids exist to prevent.
 */
function riskLocation(matches: string[]): string {
  const prefix = commonPrefix(matches);
  if (!matches.includes(prefix)) return prefix;
  const slash = prefix.lastIndexOf("/");
  return slash === -1 ? "root" : prefix.slice(0, slash);
}

export function buildRisks(ctx: AdapterContext): DraftRisk[] {
  const risks: DraftRisk[] = [];
  for (const rule of RISK_RULES) {
    const matches = ctx.files.filter((f) => rule.pattern.test(f)).sort();
    if (matches.length === 0) continue;
    risks.push({
      id: riskId(rule.type, riskLocation(matches)),
      type: rule.type,
      paths: matches.slice(0, 20),
      approval: rule.approval,
      reason: rule.reason,
      provenance: provenance({
        tier: "derived",
        adapter: ADAPTER_ID,
        now: ctx.now,
        sources: matches.slice(0, 5).map((m) => source(m)),
      }),
    });
  }
  return risks.sort((a, b) => a.id.localeCompare(b.id));
}
