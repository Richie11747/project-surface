/**
 * project-surface/v1 document types.
 *
 * This file is the TypeScript mirror of `spec/v1/surface.schema.json`.
 * The JSON Schema is the normative source of truth; these types exist so the
 * implementation cannot drift from it silently. `schema/validate.ts` checks
 * every emitted document against the schema, so a mismatch fails loudly.
 */

export const SCHEMA_ID = "project-surface/v1";

/** ISO-8601 UTC, always Z-suffixed. */
export type Timestamp = string;

/** POSIX-separated path relative to the project root. Never absolute. */
export type RelPath = string;

/**
 * How a claim came to be known.
 *
 * The tier ordering is the spine of the whole project: it is what lets a
 * consumer tell "a human told us this" apart from "we guessed from a filename".
 */
export type ProvenanceTier =
  /** A human asserted it in `.project/surface.declare.yaml`. */
  | "declared"
  /** A command was actually executed and its result observed. */
  | "verified"
  /** Read out of structured configuration or a parsed syntax tree. */
  | "derived"
  /** Heuristic guess from naming or layout. Treat with suspicion. */
  | "inferred";

export interface SourceRef {
  path: RelPath;
  /** Where inside the file, e.g. `scripts.test`, `L12-L40`, `export:createCheckout`. */
  locator?: string;
}

export interface Provenance {
  tier: ProvenanceTier;
  /** At least one. A claim with no source is not a claim. */
  sources: SourceRef[];
  adapter: string;
  observedAt: Timestamp;
}

export type FreshnessStatus = "fresh" | "stale" | "unknown";

export interface Freshness {
  status: FreshnessStatus;
  verifiedAt?: Timestamp;
  /** Hash over the owner files; changing it invalidates the claim. */
  ownersFingerprint?: string;
  staleAfterDays?: number;
  reason?: string;
}

/** Fields every claim in the document carries. */
export interface Claim {
  provenance: Provenance;
  /** Computed by `model/confidence.ts`. Never authored by hand. */
  confidence: number;
  freshness?: Freshness;
}

export interface StackInfo {
  id: string;
  adapter: string;
  adapterVersion: string;
  /**
   * False when the language toolchain is absent from this machine. Evidence for
   * such a stack must be reported as `unknown` - never as `passed`.
   */
  toolchainAvailable: boolean;
  notes?: string[];
}

export interface PackageInfo {
  id: string;
  path: RelPath;
  name?: string;
  manager?: string;
  private?: boolean;
}

export type CommandKind =
  | "test"
  | "build"
  | "dev"
  | "lint"
  | "typecheck"
  | "format"
  | "start"
  | "migrate"
  | "other";

export type VerificationStatus = "passed" | "failed" | "unknown" | "skipped";

export interface VerificationRecord {
  status: VerificationStatus;
  exitCode?: number | null;
  durationMs?: number;
  observedAt: Timestamp;
  /** Redacted and truncated command output. */
  summary?: string;
  /** Why the status is `unknown` or `skipped`. */
  reason?: string;
}

export interface Command extends Claim {
  id: string;
  run: string;
  /** Relative to the project root; a single dot for the root itself. */
  cwd: string;
  kind: CommandKind;
  packageId?: string;
  description?: string;
  verification?: VerificationRecord;
}

export type EvidenceKind = "test" | "build" | "typecheck" | "lint" | "runtime";

/** How a piece of evidence was tied to a capability. */
export type EvidenceLink =
  /** The test file imports the owner file. Strong. */
  | "import-graph"
  /** Filenames or directories merely look related. A guess. */
  | "path-proximity"
  /** A human said so. */
  | "declared"
  /** A config file maps them explicitly. */
  | "config";

export interface EvidenceRef {
  id: string;
  link: EvidenceLink;
}

export type CapabilityKind = "route" | "export" | "command" | "job" | "module";

export interface RouteInfo {
  method: string;
  path: string;
}

export interface Capability extends Claim {
  id: string;
  title: string;
  description?: string;
  kind: CapabilityKind;
  packageId?: string;
  /** The files or symbols that implement this capability. At least one. */
  owners: SourceRef[];
  /** Docs, schemas, or API definitions that specify it. */
  contracts: SourceRef[];
  evidence: EvidenceRef[];
  /** Environment variable NAMES only. Values are never recorded. */
  environment: string[];
  tags: string[];
  route?: RouteInfo;
  /** Previous ids, so renames do not break consumers. */
  aliases?: string[];
}

export type Severity = "error" | "warn" | "info";

export type ConstraintCheckKind = "forbid-import" | "forbid-file" | "require-test" | "forbid-env" | "max-owners";

/**
 * A machine-checkable form of a rule. Prose tells an agent what not to do;
 * a check lets the generator notice when it was done anyway.
 */
export interface ConstraintCheck {
  kind: ConstraintCheckKind;
  /** `forbid-import`: globs for the importing files. */
  from?: string[];
  /** `forbid-import`: globs for project files, or bare module specifiers, that must not be imported. */
  to?: string[];
  /**
   * `forbid-file`: globs no file may match. `require-test`: globs whose owners must have evidence.
   * `forbid-env`: the only files that may read the variables (absent: nobody may).
   * `max-owners`: globs selecting the capabilities to measure (absent: every capability).
   */
  paths?: string[];
  /** `forbid-env`: environment variable names; `*` and `?` are wildcards over the whole name. */
  names?: string[];
  /** `max-owners`: the most owner files a capability may have. */
  limit?: number;
}

export interface ConstraintOutcome {
  status: "passed" | "violated" | "unchecked";
  violations: number;
  /** Why the check was `unchecked`: no adapter supplied the facts it needs. */
  reason?: string;
}

export interface Constraint extends Claim {
  id: string;
  rule: string;
  rationale?: string;
  severity: Severity;
  status: "active" | "stale";
  check?: ConstraintCheck;
  checked?: ConstraintOutcome;
}

/** One import edge, reported by an adapter so core can evaluate `forbid-import` checks. */
export interface ImportEdge {
  /** The importing file. */
  from: RelPath;
  /** The specifier as written: `./create.js`, `stripe`, `app.models`. */
  specifier: string;
  /** The project file it resolves to, when it is project code. */
  to?: RelPath;
}

export interface EnvironmentVariable extends Claim {
  name: string;
  required: boolean;
  /** Whether the NAME looks secret-bearing. The value is never stored regardless. */
  secret: boolean;
  usedBy: SourceRef[];
}

export type RiskType =
  | "migration"
  | "secret"
  | "infra"
  | "generated"
  | "external-service";

export interface Risk extends Claim {
  id: string;
  type: RiskType;
  paths: RelPath[];
  approval: "required" | "advisory";
  reason: string;
}

export type EvidenceStatus = "passed" | "failed" | "unknown" | "stale";

export interface EvidenceEntry extends Claim {
  id: string;
  kind: EvidenceKind;
  path?: RelPath;
  commandId?: string;
  /**
   * `passed` requires an actual observed execution. Statically discovering a
   * test file yields `unknown` - finding a test is not the same as running it.
   */
  status: EvidenceStatus;
  observedAt?: Timestamp;
  summary?: string;
}

export type HealthSubjectKind =
  | "capability"
  | "command"
  | "constraint"
  | "evidence"
  | "environment"
  | "risk"
  | "package"
  | "project";

export interface HealthFinding {
  /** SCREAMING_SNAKE code, e.g. `STALE_CLAIM`. See `analysis/health.ts`. */
  code: string;
  severity: Severity;
  message: string;
  subject?: { kind: HealthSubjectKind; id: string };
  paths?: RelPath[];
  remediation?: string;
}

export interface GitRecentChange {
  path: RelPath;
  commits: number;
  lastTouched?: Timestamp;
}

export interface GitInfo {
  available: boolean;
  head?: string;
  branch?: string;
  dirty?: boolean;
  recentChanges?: GitRecentChange[];
}

export interface ProjectInfo {
  name: string;
  root: ".";
  stacks: StackInfo[];
  packages: PackageInfo[];
}

/** The document written to `.project/surface.json`. */
export interface Surface {
  schema: "project-surface/v1";
  generatedAt: Timestamp;
  generator: { name: string; version: string };
  project: ProjectInfo;
  commands: Command[];
  capabilities: Capability[];
  constraints: Constraint[];
  environment: EnvironmentVariable[];
  risks: Risk[];
  evidence: EvidenceEntry[];
  health: HealthFinding[];
  git: GitInfo;
}

/**
 * What adapters return. Confidence and freshness are deliberately absent:
 * adapters supply provenance, core computes trust. An adapter cannot inflate
 * its own confidence score.
 */
export type Draft<T extends Claim> = Omit<T, "confidence" | "freshness">;

export type DraftCommand = Draft<Command>;
export type DraftCapability = Draft<Capability>;
export type DraftConstraint = Draft<Constraint>;
export type DraftEnvironmentVariable = Draft<EnvironmentVariable>;
export type DraftRisk = Draft<Risk>;
export type DraftEvidenceEntry = Draft<EvidenceEntry>;
