/**
 * Drift and health detection.
 *
 * These findings are the difference between a document that describes a project
 * and a document that describes a project *accurately*. Every check answers a
 * question a reviewer would otherwise have to ask by hand: is this claim still
 * true, is anything asserted without proof, does the documentation still match.
 *
 * Findings are advice, not failure. `surface doctor` decides which severities
 * are worth a non-zero exit code.
 */

import { confidenceLabel } from "../model/confidence.js";
import { ownerPaths } from "../model/freshness.js";
import type { ConstraintViolation } from "./constraints.js";
import type {
  Capability,
  Command,
  Constraint,
  EnvironmentVariable,
  EvidenceEntry,
  HealthFinding,
  Severity,
  StackInfo,
  Surface,
} from "../schema/types.js";

const SEVERITY_ORDER: Record<Severity, number> = { error: 0, warn: 1, info: 2 };

export interface HealthInput {
  capabilities: Capability[];
  commands: Command[];
  evidence: EvidenceEntry[];
  environment: EnvironmentVariable[];
  stacks: StackInfo[];
  /** Every known project file, for existence checks. */
  files: ReadonlySet<string>;
  declarationErrors: string[];
  fileScanTruncated: boolean;
  /**
   * Variable names documented in the project example env file, if one exists.
   * Supplied by the pipeline, which is where file reads happen.
   */
  envExample?: { path: string; names: ReadonlySet<string> } | null;
  /** Constraints after their checks ran, and what the checks found. */
  constraints?: Constraint[];
  constraintViolations?: ConstraintViolation[];
}

export function detectHealth(input: HealthInput): HealthFinding[] {
  const findings: HealthFinding[] = [];

  for (const error of input.declarationErrors) {
    findings.push({
      code: "DECLARATION_INVALID",
      severity: "error",
      message: error,
      subject: { kind: "project", id: "declarations" },
      remediation: "Fix .project/surface.declare.yaml and re-run surface init.",
    });
  }

  /* A violated check is reported at the severity the maintainer chose for the
     rule. An unchecked one is worth a line too: the rule exists, and nothing
     in this scan was able to evaluate it. */
  for (const constraint of input.constraints ?? []) {
    if (!constraint.checked) continue;
    if (constraint.checked.status === "violated") {
      const hits = (input.constraintViolations ?? []).filter((v) => v.constraintId === constraint.id);
      findings.push({
        code: "CONSTRAINT_VIOLATED",
        severity: constraint.severity,
        message:
          `Constraint "${constraint.rule}" is violated in ${hits.length} place(s): ` +
          hits.slice(0, 5).map((h) => `${h.path} (${h.detail})`).join(", ") +
          (hits.length > 5 ? ", ..." : "") +
          ".",
        subject: { kind: "constraint", id: constraint.id },
        paths: [...new Set(hits.map((h) => h.path))].sort(),
        remediation: constraint.rationale
          ? `${constraint.rationale} Fix the listed files, or change the check in .project/surface.declare.yaml.`
          : "Fix the listed files, or change the check in .project/surface.declare.yaml.",
      });
    } else if (constraint.checked.status === "unchecked") {
      findings.push({
        code: "CONSTRAINT_UNCHECKED",
        severity: "info",
        message: `Constraint "${constraint.rule}" has a check that could not run. ${constraint.checked.reason ?? ""}`.trim(),
        subject: { kind: "constraint", id: constraint.id },
        remediation: "Use an adapter that reports the facts this check needs (imports, environment reads) for this stack, or express the rule as forbid-file / require-test / max-owners.",
      });
    }
  }

  const knownEvidence = new Set(input.evidence.map((e) => e.id));
  for (const capability of input.capabilities) {
    const missing = ownerPaths(capability.owners).filter((p) => !input.files.has(p));
    if (missing.length > 0) {
      findings.push({
        code: capability.provenance.tier === "declared" ? "DECLARATION_ORPHANED" : "MISSING_OWNER",
        severity: capability.provenance.tier === "declared" ? "error" : "warn",
        message: `Capability "${capability.id}" points at ${missing.length} file(s) that no longer exist.`,
        subject: { kind: "capability", id: capability.id },
        paths: missing,
        remediation: "Update the owner paths, or remove the capability if it was deleted.",
      });
    }

    if (capability.freshness?.status === "stale") {
      findings.push({
        code: "STALE_CLAIM",
        severity: "warn",
        message: `Capability "${capability.id}" was verified earlier but its files have changed since. ${capability.freshness.reason ?? ""}`.trim(),
        subject: { kind: "capability", id: capability.id },
        remediation: `Run: surface verify --stale (or --capability ${capability.id} for this one alone)`,
      });
    }

    /* A reference to evidence that no entry carries is not proof of anything -
       typically a declared `evidence:` path that is misspelt or was deleted.
       Left unreported, it silently satisfies every "has evidence" check. */
    const dangling = capability.evidence.filter((ref) => !knownEvidence.has(ref.id)).map((ref) => ref.id);
    if (dangling.length > 0) {
      findings.push({
        code: "DANGLING_EVIDENCE",
        severity: "warn",
        message: `Capability "${capability.id}" links evidence that does not exist: ${dangling.join(", ")}.`,
        subject: { kind: "capability", id: capability.id },
        remediation: "Fix the evidence path in .project/surface.declare.yaml, or remove the link.",
      });
    }

    if (capability.evidence.length === 0) {
      findings.push({
        code: "UNPROVEN_CAPABILITY",
        severity: "info",
        message: `Capability "${capability.id}" has no test or build output proving it works.`,
        subject: { kind: "capability", id: capability.id },
        remediation: "Add a test that imports the owner file, or declare existing evidence.",
      });
    }

    if (capability.contracts.length === 0) {
      findings.push({
        code: "UNDOCUMENTED_CAPABILITY",
        severity: "info",
        message: `Capability "${capability.id}" has no contract: no doc, schema, or API definition specifies it.`,
        subject: { kind: "capability", id: capability.id },
        remediation: "Link a document in .project/surface.declare.yaml under contracts.",
      });
    }
  }

  for (const command of input.commands) {
    if (!command.verification) {
      findings.push({
        code: "UNVERIFIED_COMMAND",
        severity: "info",
        message: `Command "${command.id}" (${command.run}) has never been run, so it is not known to work.`,
        subject: { kind: "command", id: command.id },
        remediation: `Run: surface verify --command ${command.id}`,
      });
      continue;
    }
    if (command.verification.status === "failed") {
      findings.push({
        code: "BROKEN_COMMAND",
        severity: "error",
        message: `Command "${command.id}" (${command.run}) failed the last time it ran.`,
        subject: { kind: "command", id: command.id },
        remediation: "Fix the command, or update it if the project moved on.",
      });
    }
  }

  const referenced = new Set(input.capabilities.flatMap((c) => c.evidence.map((e) => e.id)));
  for (const entry of input.evidence) {
    if (entry.kind === "test" && !referenced.has(entry.id)) {
      findings.push({
        code: "ORPHAN_TEST",
        severity: "info",
        message: `Test ${entry.path ?? entry.id} could not be linked to any capability.`,
        subject: { kind: "evidence", id: entry.id },
        ...(entry.path ? { paths: [entry.path] } : {}),
        remediation: "Import the implementation from the test, or declare the link explicitly.",
      });
    }
  }

  if (input.envExample) {
    const documented = input.envExample.names;
    for (const variable of input.environment) {
      if (variable.required && !documented.has(variable.name)) {
        findings.push({
          code: "MISSING_ENV_EXAMPLE",
          severity: "warn",
          message: `Required environment variable ${variable.name} is not listed in ${input.envExample.path}, so a new contributor will not know to set it.`,
          subject: { kind: "environment", id: variable.name },
          paths: [input.envExample.path],
          remediation: `Add ${variable.name}= to ${input.envExample.path}.`,
        });
      }
    }
  }

  for (const stack of input.stacks) {
    if (!stack.toolchainAvailable) {
      findings.push({
        code: "TOOLCHAIN_UNAVAILABLE",
        severity: "info",
        message: `The ${stack.id} toolchain is not installed here, so ${stack.id} claims are structural only and cannot be verified.`,
        subject: { kind: "project", id: stack.id },
        remediation: `Install the ${stack.id} toolchain to enable verification.`,
      });
    }
  }

  if (input.capabilities.length === 0) {
    findings.push({
      code: "NO_CAPABILITIES",
      severity: "warn",
      message: "No capabilities were discovered. The surface describes commands only.",
      subject: { kind: "project", id: "capabilities" },
      remediation: "Declare capabilities in .project/surface.declare.yaml, or install a matching adapter.",
    });
  } else {
    const lowConfidence = input.capabilities.filter((c) => confidenceLabel(c.confidence) === "low");
    if (lowConfidence.length * 2 > input.capabilities.length) {
      findings.push({
        code: "LOW_CONFIDENCE_MAJORITY",
        severity: "warn",
        message: `${lowConfidence.length} of ${input.capabilities.length} capabilities are low confidence: most of this surface is inference, not evidence.`,
        subject: { kind: "project", id: "capabilities" },
        remediation: "Run surface verify, or declare the important capabilities by hand.",
      });
    }
  }

  if (input.fileScanTruncated) {
    findings.push({
      code: "FILE_SCAN_TRUNCATED",
      severity: "warn",
      message: "The project has more files than the scan limit, so this surface is incomplete.",
      subject: { kind: "project", id: "files" },
      remediation: "Narrow the project root, or raise the limit with --max-files.",
    });
  }

  return sortFindings(findings);
}

export function sortFindings(findings: HealthFinding[]): HealthFinding[] {
  return [...findings].sort(
    (a, b) =>
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
      a.code.localeCompare(b.code) ||
      (a.subject?.id ?? "").localeCompare(b.subject?.id ?? "")
  );
}

/** Health findings that should make CI fail. */
export function hasBlockingFindings(surface: Surface): boolean {
  return surface.health.some((f) => f.severity === "error");
}
