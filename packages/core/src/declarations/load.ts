/**
 * Human declarations.
 *
 * Inference is wrong sometimes. When it is, a developer needs a way to state
 * the truth once and have every tool respect it. That is this file.
 *
 * Declarations are loaded last and merged over everything an adapter produced,
 * at tier `declared`. They are the only claims a human authors directly, and
 * the only ones that never decay - a stale declaration is reported as a health
 * finding so a person can fix it, rather than being quietly downgraded.
 */

import { parse } from "yaml";
import { readFileSafe } from "../fs/walk.js";
import { commandId, constraintId, riskId, slug } from "../model/ids.js";
import { looksSecretName } from "../redact.js";
import { DECLARATIONS_FILE } from "../version.js";
import type {
  DraftCapability,
  DraftCommand,
  DraftConstraint,
  DraftEnvironmentVariable,
  DraftRisk,
  Provenance,
  SourceRef,
  Timestamp,
} from "../schema/types.js";

const ADAPTER = "declarations";

export interface Declarations {
  projectName?: string;
  capabilities: DraftCapability[];
  commands: DraftCommand[];
  constraints: DraftConstraint[];
  risks: DraftRisk[];
  environment: DraftEnvironmentVariable[];
  /** Problems with the declaration file itself, surfaced as health findings. */
  errors: string[];
  present: boolean;
}

function empty(): Declarations {
  return {
    capabilities: [],
    commands: [],
    constraints: [],
    risks: [],
    environment: [],
    errors: [],
    present: false,
  };
}

function provenance(locator: string, now: Timestamp): Provenance {
  return {
    tier: "declared",
    sources: [{ path: DECLARATIONS_FILE, locator }],
    adapter: ADAPTER,
    observedAt: now,
  };
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asStringArray(value: unknown): string[] {
  return asArray(value).filter((v): v is string => typeof v === "string");
}

function toSourceRefs(value: unknown): SourceRef[] {
  return asStringArray(value).map((path) => ({ path }));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Parse `.project/surface.declare.yaml`. Every failure is collected rather than
 * thrown: one malformed entry must not discard the rest of a developer's work.
 */
export function loadDeclarations(root: string, now: Timestamp): Declarations {
  const raw = readFileSafe(root, DECLARATIONS_FILE);
  if (raw === null) return empty();

  const out = empty();
  out.present = true;

  let doc: unknown;
  try {
    doc = parse(raw);
  } catch (e) {
    out.errors.push(`Could not parse ${DECLARATIONS_FILE}: ${(e as Error).message}`);
    return out;
  }
  if (!isRecord(doc)) {
    out.errors.push(`${DECLARATIONS_FILE} must contain a YAML mapping at the top level.`);
    return out;
  }

  if (isRecord(doc.project) && typeof doc.project.name === "string") {
    out.projectName = doc.project.name;
  }

  asArray(doc.capabilities).forEach((entry, i) => {
    const at = `capabilities[${i}]`;
    if (!isRecord(entry)) return void out.errors.push(`${at} must be a mapping.`);
    const owners = toSourceRefs(entry.owners);
    if (owners.length === 0) return void out.errors.push(`${at} needs at least one owner path.`);
    const id = typeof entry.id === "string" ? slug(entry.id) : slug(String(owners[0]?.path));
    out.capabilities.push({
      id,
      title: typeof entry.title === "string" ? entry.title : id,
      ...(typeof entry.description === "string" ? { description: entry.description } : {}),
      kind: "module",
      owners,
      contracts: toSourceRefs(entry.contracts),
      evidence: asStringArray(entry.evidence).map((p) => ({ id: `evidence:${slug(p)}`, link: "declared" as const })),
      environment: asStringArray(entry.environment),
      tags: asStringArray(entry.tags),
      provenance: provenance(at, now),
    });
  });

  asArray(doc.commands).forEach((entry, i) => {
    const at = `commands[${i}]`;
    if (!isRecord(entry)) return void out.errors.push(`${at} must be a mapping.`);
    if (typeof entry.run !== "string") return void out.errors.push(`${at} needs a run string.`);
    const name = typeof entry.id === "string" ? entry.id : entry.run;
    out.commands.push({
      id: commandId(name),
      run: entry.run,
      cwd: typeof entry.cwd === "string" ? entry.cwd : ".",
      kind: isCommandKind(entry.kind) ? entry.kind : "other",
      ...(typeof entry.description === "string" ? { description: entry.description } : {}),
      provenance: provenance(at, now),
    });
  });

  asArray(doc.constraints).forEach((entry, i) => {
    const at = `constraints[${i}]`;
    if (!isRecord(entry)) return void out.errors.push(`${at} must be a mapping.`);
    if (typeof entry.rule !== "string") return void out.errors.push(`${at} needs a rule string.`);
    out.constraints.push({
      id: constraintId(typeof entry.id === "string" ? entry.id : entry.rule.slice(0, 60)),
      rule: entry.rule,
      ...(typeof entry.rationale === "string" ? { rationale: entry.rationale } : {}),
      severity: entry.severity === "error" || entry.severity === "info" ? entry.severity : "warn",
      status: "active",
      provenance: provenance(at, now),
    });
  });

  asArray(doc.risks).forEach((entry, i) => {
    const at = `risks[${i}]`;
    if (!isRecord(entry)) return void out.errors.push(`${at} must be a mapping.`);
    const paths = asStringArray(entry.paths);
    if (paths.length === 0) return void out.errors.push(`${at} needs at least one path.`);
    const type = isRiskType(entry.type) ? entry.type : "infra";
    out.risks.push({
      id: riskId(type, paths[0] ?? "unknown"),
      type,
      paths,
      approval: entry.approval === "advisory" ? "advisory" : "required",
      reason: typeof entry.reason === "string" ? entry.reason : "Declared as risky by a maintainer.",
      provenance: provenance(at, now),
    });
  });

  asArray(doc.environment).forEach((entry, i) => {
    const at = `environment[${i}]`;
    const name = typeof entry === "string" ? entry : isRecord(entry) && typeof entry.name === "string" ? entry.name : null;
    if (name === null) return void out.errors.push(`${at} must be a name or a mapping with a name.`);
    const required = isRecord(entry) && typeof entry.required === "boolean" ? entry.required : true;
    out.environment.push({
      name,
      required,
      secret: isRecord(entry) && typeof entry.secret === "boolean" ? entry.secret : looksSecretName(name),
      usedBy: isRecord(entry) ? toSourceRefs(entry.usedBy) : [],
      provenance: provenance(at, now),
    });
  });

  return out;
}

const COMMAND_KINDS = new Set([
  "test", "build", "dev", "lint", "typecheck", "format", "start", "migrate", "other",
]);

function isCommandKind(v: unknown): v is DraftCommand["kind"] {
  return typeof v === "string" && COMMAND_KINDS.has(v);
}

const RISK_TYPES = new Set(["migration", "secret", "infra", "generated", "external-service"]);

function isRiskType(v: unknown): v is DraftRisk["type"] {
  return typeof v === "string" && RISK_TYPES.has(v);
}
