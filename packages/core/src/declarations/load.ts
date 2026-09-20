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
import { expandGlob, isGlob } from "../fs/glob.js";
import { readFileSafe } from "../fs/walk.js";
import { commandId, constraintId, riskId, slug } from "../model/ids.js";
import { looksSecretName } from "../redact.js";
import { DECLARATIONS_FILE } from "../version.js";
import type {
  ConstraintCheck,
  ConstraintCheckKind,
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
  /**
   * Globs for files the scan should not see at all - vendored examples, test
   * fixtures that are projects in their own right. Applied before adapters run.
   */
  ignore: string[];
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
    ignore: [],
    errors: [],
    present: false,
  };
}

/**
 * A path a declaration may name: inside the project, expressed with forward
 * slashes. Backslashes are folded first so `..\\x` cannot slip past a check
 * that only splits on `/`; `~` is refused because the shell would expand it
 * and nothing here does.
 */
export function normalizeDeclaredPath(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\.\/+/, "");
}

export function isRelativePath(p: string): boolean {
  const n = normalizeDeclaredPath(p);
  return (
    n.length > 0 &&
    !n.startsWith("/") &&
    !n.startsWith("~") &&
    !/^[A-Za-z]:/.test(n) &&
    !n.split("/").includes("..")
  );
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

/**
 * The strings in a path list that are usable, normalised. Each rejected entry
 * becomes a declaration error at `at`, so a stray `../` or an absolute path is
 * reported next to the line that wrote it instead of failing schema validation
 * of the whole document at the end of the build.
 */
function declaredPaths(value: unknown, at: string, errors: string[]): string[] {
  const out: string[] = [];
  for (const raw of asStringArray(value)) {
    if (!isRelativePath(raw)) {
      errors.push(`${at} must be project-relative: ${raw}`);
      continue;
    }
    out.push(normalizeDeclaredPath(raw));
  }
  return out;
}

function toSourceRefs(value: unknown, at: string, errors: string[]): SourceRef[] {
  return declaredPaths(value, at, errors).map((path) => ({ path }));
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

  asArray(doc.ignore).forEach((entry, i) => {
    const at = `ignore[${i}]`;
    if (typeof entry !== "string" || entry.trim() === "") return void out.errors.push(`${at} must be a path or glob.`);
    if (!isRelativePath(entry)) return void out.errors.push(`${at} must be project-relative: ${entry}`);
    out.ignore.push(normalizeDeclaredPath(entry));
  });

  asArray(doc.capabilities).forEach((entry, i) => {
    const at = `capabilities[${i}]`;
    if (!isRecord(entry)) return void out.errors.push(`${at} must be a mapping.`);
    const owners = toSourceRefs(entry.owners, `${at}.owners`, out.errors);
    if (owners.length === 0) return void out.errors.push(`${at} needs at least one owner path.`);
    const id = typeof entry.id === "string" ? slug(entry.id) : slug(String(owners[0]?.path));
    out.capabilities.push({
      id,
      title: typeof entry.title === "string" ? entry.title : id,
      ...(typeof entry.description === "string" ? { description: entry.description } : {}),
      kind: "module",
      owners,
      contracts: toSourceRefs(entry.contracts, `${at}.contracts`, out.errors),
      evidence: declaredPaths(entry.evidence, `${at}.evidence`, out.errors).map((p) => ({ id: `evidence:${slug(p)}`, link: "declared" as const })),
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
    const check = entry.check === undefined ? undefined : parseCheck(entry.check, at, out.errors);
    if (entry.check !== undefined && check === undefined) return;
    out.constraints.push({
      id: constraintId(typeof entry.id === "string" ? entry.id : entry.rule.slice(0, 60)),
      rule: entry.rule,
      ...(typeof entry.rationale === "string" ? { rationale: entry.rationale } : {}),
      severity: entry.severity === "error" || entry.severity === "info" ? entry.severity : "warn",
      status: "active",
      ...(check ? { check } : {}),
      provenance: provenance(at, now),
    });
  });

  asArray(doc.risks).forEach((entry, i) => {
    const at = `risks[${i}]`;
    if (!isRecord(entry)) return void out.errors.push(`${at} must be a mapping.`);
    const paths = declaredPaths(entry.paths, `${at}.paths`, out.errors);
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
      usedBy: isRecord(entry) ? toSourceRefs(entry.usedBy, `${at}.usedBy`, out.errors) : [],
      provenance: provenance(at, now),
    });
  });

  return out;
}

/**
 * Resolve glob owners against the project file list, in place.
 *
 * A declaration may say `owners: [packages/core/src/model/**]` rather than
 * listing every file. The glob is expanded here, once the walk has produced
 * the file list, so that everything downstream - fingerprints, missing-owner
 * checks, impact - only ever sees concrete paths. A glob that matches nothing
 * is an error: a claim about no files is not a claim.
 */
export function expandDeclaredOwners(declarations: Declarations, files: readonly string[]): void {
  const fileSet = new Set(files);
  declarations.capabilities.forEach((capability, i) => {
    const expanded: SourceRef[] = [];
    for (const owner of capability.owners) {
      if (!isGlob(owner.path)) {
        /* A plain path names a file or a tree (see glob.ts). A file is kept as
           written; a directory expands to the files under it, like a glob would.
           A path that matches nothing is kept too, so the orphan is reported
           against the name the maintainer wrote. */
        const tree = fileSet.has(owner.path) ? [] : expandGlob(owner.path, files);
        if (tree.length > 0) expanded.push(...tree.map((path) => ({ path })));
        else expanded.push(owner);
        continue;
      }
      const matched = expandGlob(owner.path, files);
      if (matched.length === 0) {
        declarations.errors.push(`capabilities[${i}] owner glob "${owner.path}" matches no files.`);
        continue;
      }
      expanded.push(...matched.map((path) => ({ path })));
    }
    capability.owners = expanded;
  });
  /* The error above already explains the removal; an ownerless claim must not reach the document. */
  declarations.capabilities = declarations.capabilities.filter((c) => c.owners.length > 0);
}

const CHECK_KINDS = new Set(["forbid-import", "forbid-file", "require-test", "forbid-env", "max-owners"]);

/** An environment variable name pattern: the characters a name may contain, plus `*` and `?`. */
const ENV_NAME_PATTERN = /^[A-Za-z0-9_*?]+$/;

function nameList(value: unknown, at: string, errors: string[]): string[] | null {
  const list = asStringArray(value).filter((v) => v.trim() !== "");
  if (list.length === 0) {
    errors.push(`${at}.check.names needs at least one environment variable name.`);
    return null;
  }
  const bad = list.find((v) => !ENV_NAME_PATTERN.test(v));
  if (bad !== undefined) {
    errors.push(`${at}.check.names must be variable names (letters, digits, _, * and ?): ${bad}`);
    return null;
  }
  return list;
}

/** `paths` where the field is optional: absent is fine, present-but-empty or escaping is not. */
function optionalGlobList(value: unknown, at: string, errors: string[]): string[] | null | undefined {
  return value === undefined ? undefined : globList(value, at, "paths", errors);
}

/** Globs for a check. Every entry must be project-relative, like every other path here. */
function globList(value: unknown, at: string, field: string, errors: string[]): string[] | null {
  const list = asStringArray(value).filter((v) => v.trim() !== "");
  if (list.length === 0) {
    errors.push(`${at}.check.${field} needs at least one path or glob.`);
    return null;
  }
  const bad = list.find((v) => !isRelativePath(v));
  if (bad !== undefined) {
    errors.push(`${at}.check.${field} must be project-relative: ${bad}`);
    return null;
  }
  return list;
}

/**
 * A malformed check is an error, not a silently-unchecked rule: a maintainer
 * who wrote one expects it to run.
 */
function parseCheck(value: unknown, at: string, errors: string[]): ConstraintCheck | undefined {
  if (!isRecord(value) || typeof value.kind !== "string" || !CHECK_KINDS.has(value.kind)) {
    errors.push(`${at}.check.kind must be one of ${[...CHECK_KINDS].join(", ")}.`);
    return undefined;
  }
  const kind = value.kind as ConstraintCheckKind;
  if (kind === "forbid-import") {
    const from = globList(value.from, at, "from", errors);
    const to = globList(value.to, at, "to", errors);
    return from && to ? { kind, from, to } : undefined;
  }
  if (kind === "forbid-env") {
    const names = nameList(value.names, at, errors);
    const paths = optionalGlobList(value.paths, at, errors);
    return names && paths !== null ? { kind, names, ...(paths ? { paths } : {}) } : undefined;
  }
  if (kind === "max-owners") {
    const limit = value.limit;
    if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1) {
      errors.push(`${at}.check.limit must be a whole number of at least 1.`);
      return undefined;
    }
    const paths = optionalGlobList(value.paths, at, errors);
    return paths !== null ? { kind, limit, ...(paths ? { paths } : {}) } : undefined;
  }
  const paths = globList(value.paths, at, "paths", errors);
  return paths ? { kind, paths } : undefined;
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
