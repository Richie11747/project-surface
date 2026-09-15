/**
 * Constraint checks.
 *
 * A constraint written as prose is advice: an agent reads "never call the
 * payment provider from a handler" and may or may not comply. A constraint
 * with a `check` is a fact the generator can establish on every scan. The
 * kinds cover what people actually write down:
 *
 *   forbid-import   files matching `from` must not import anything matching `to`
 *   forbid-file     no project file may match `paths`
 *   require-test    every capability owning a file under `paths` has evidence
 *   forbid-env      variables matching `names` are read only by files under `paths`
 *   max-owners      no capability (under `paths`) owns more than `limit` files
 *
 * Every outcome is explicit. A check whose inputs no adapter could supply -
 * `forbid-import` on a stack that reports no import graph, `forbid-env` when
 * only the fallback adapter ran - is `unchecked`, with a reason, never
 * silently `passed`.
 */

import { globFilter } from "../fs/glob.js";
import type {
  Capability,
  ConstraintCheck,
  ConstraintOutcome,
  DraftConstraint,
  DraftEnvironmentVariable,
  ImportEdge,
  RelPath,
} from "../schema/types.js";

export interface ConstraintViolation {
  constraintId: string;
  path: RelPath;
  detail: string;
}

export interface CheckInput {
  constraints: DraftConstraint[];
  capabilities: Capability[];
  files: ReadonlySet<string>;
  imports: ImportEdge[];
  /** Whether any adapter in this build is able to report imports at all. */
  importsAvailable: boolean;
  /** Environment variables with the files that read them, as merged by the pipeline. */
  environment: DraftEnvironmentVariable[];
  /**
   * Whether a language adapter scanned source for environment reads. The
   * fallback adapter only mirrors `.env.example`, which is a declaration of a
   * variable, not a read of it.
   */
  environmentAvailable: boolean;
}

export interface CheckResult {
  /** The same constraints, with `checked` filled in where a `check` exists. */
  constraints: DraftConstraint[];
  violations: ConstraintViolation[];
}

function checkForbidImport(id: string, check: ConstraintCheck, input: CheckInput): ConstraintViolation[] {
  const from = globFilter(check.from ?? []);
  const to = globFilter(check.to ?? []);
  const out: ConstraintViolation[] = [];
  for (const edge of input.imports) {
    if (!from(edge.from)) continue;
    const target = edge.to !== undefined && to(edge.to) ? edge.to : to(edge.specifier) ? edge.specifier : null;
    if (target === null) continue;
    out.push({ constraintId: id, path: edge.from, detail: `imports ${target}` });
  }
  return out;
}

function checkForbidFile(id: string, check: ConstraintCheck, input: CheckInput): ConstraintViolation[] {
  const match = globFilter(check.paths ?? []);
  return [...input.files]
    .filter(match)
    .sort()
    .map((path) => ({ constraintId: id, path, detail: "file exists" }));
}

function checkRequireTest(id: string, check: ConstraintCheck, input: CheckInput): ConstraintViolation[] {
  const match = globFilter(check.paths ?? []);
  const out: ConstraintViolation[] = [];
  for (const capability of input.capabilities) {
    const owned = capability.owners.map((o) => o.path).filter(match);
    if (owned.length === 0 || capability.evidence.length > 0) continue;
    out.push({
      constraintId: id,
      path: owned[0]!,
      detail: `capability ${capability.id} has no linked evidence`,
    });
  }
  return out;
}

/** A dotenv file lists a variable; it does not read it. */
function isDotenvFile(path: string): boolean {
  const base = path.slice(path.lastIndexOf("/") + 1);
  return base === ".env" || base.startsWith(".env.");
}

function checkForbidEnv(id: string, check: ConstraintCheck, input: CheckInput): ConstraintViolation[] {
  const named = globFilter(check.names ?? []);
  const allowed = check.paths ? globFilter(check.paths) : () => false;
  const out: ConstraintViolation[] = [];
  for (const variable of input.environment) {
    if (!named(variable.name)) continue;
    for (const ref of variable.usedBy) {
      if (isDotenvFile(ref.path) || allowed(ref.path)) continue;
      out.push({ constraintId: id, path: ref.path, detail: `reads ${variable.name}` });
    }
  }
  return out.sort((a, b) => a.path.localeCompare(b.path) || a.detail.localeCompare(b.detail));
}

function checkMaxOwners(id: string, check: ConstraintCheck, input: CheckInput): ConstraintViolation[] {
  const limit = check.limit ?? Number.POSITIVE_INFINITY;
  const inScope = check.paths ? globFilter(check.paths) : () => true;
  const out: ConstraintViolation[] = [];
  for (const capability of input.capabilities) {
    /* Distinct files: one file can appear twice as an owner, with different locators. */
    const owners = [...new Set(capability.owners.map((o) => o.path))].sort();
    if (owners.length <= limit || !owners.some(inScope)) continue;
    out.push({
      constraintId: id,
      path: owners[0]!,
      detail: `capability ${capability.id} has ${owners.length} owner files, limit ${limit}`,
    });
  }
  return out;
}

function outcome(status: ConstraintOutcome["status"], violations: number, reason?: string): ConstraintOutcome {
  return { status, violations, ...(reason ? { reason } : {}) };
}

export function evaluateConstraintChecks(input: CheckInput): CheckResult {
  const violations: ConstraintViolation[] = [];
  const constraints = input.constraints.map((constraint) => {
    const check = constraint.check;
    if (!check) return constraint;

    if (check.kind === "forbid-import" && !input.importsAvailable) {
      return {
        ...constraint,
        checked: outcome("unchecked", 0, "No adapter in this scan reports an import graph, so the rule could not be evaluated."),
      };
    }

    if (check.kind === "forbid-env" && !input.environmentAvailable) {
      return {
        ...constraint,
        checked: outcome("unchecked", 0, "No adapter in this scan reports environment reads, so the rule could not be evaluated."),
      };
    }

    const found =
      check.kind === "forbid-import"
        ? checkForbidImport(constraint.id, check, input)
        : check.kind === "forbid-file"
          ? checkForbidFile(constraint.id, check, input)
          : check.kind === "forbid-env"
            ? checkForbidEnv(constraint.id, check, input)
            : check.kind === "max-owners"
              ? checkMaxOwners(constraint.id, check, input)
              : checkRequireTest(constraint.id, check, input);

    const deduped = found.filter(
      (v, i) => found.findIndex((o) => o.path === v.path && o.detail === v.detail) === i
    );
    violations.push(...deduped);
    return {
      ...constraint,
      checked: outcome(deduped.length === 0 ? "passed" : "violated", deduped.length),
    };
  });
  return { constraints, violations };
}
