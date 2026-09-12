/**
 * Constraint checks.
 *
 * A constraint written as prose is advice: an agent reads "never call the
 * payment provider from a handler" and may or may not comply. A constraint
 * with a `check` is a fact the generator can establish on every scan. The
 * three kinds cover what people actually write down:
 *
 *   forbid-import   files matching `from` must not import anything matching `to`
 *   forbid-file     no project file may match `paths`
 *   require-test    every capability owning a file under `paths` has evidence
 *
 * Every outcome is explicit. A check whose inputs no adapter could supply -
 * `forbid-import` on a stack that reports no import graph - is `unchecked`,
 * with a reason, never silently `passed`.
 */

import { globFilter } from "../fs/glob.js";
import type {
  Capability,
  ConstraintCheck,
  ConstraintOutcome,
  DraftConstraint,
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

    const found =
      check.kind === "forbid-import"
        ? checkForbidImport(constraint.id, check, input)
        : check.kind === "forbid-file"
          ? checkForbidFile(constraint.id, check, input)
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
