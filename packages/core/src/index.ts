/**
 * @project-surface/core
 *
 * The schema, the trust model, the extraction pipeline, and the analyses that
 * read the result. Deliberately free of any adapter or transport dependency:
 * core knows how to model a project, not how to parse TypeScript or speak MCP.
 */

// The document
export * from "./schema/types.js";
export { SURFACE_SCHEMA } from "./schema/schema.generated.js";
export {
  assertValidSurface,
  SurfaceValidationError,
  validateSurface,
  type ValidationResult,
} from "./schema/validate.js";

// The adapter contract
export { emptyResult, type Adapter, type AdapterContext, type AdapterResult } from "./adapter.js";

// The trust model
export {
  computeConfidence,
  confidenceLabel,
  effectiveTier,
  explainConfidence,
  promoteWithEvidence,
  CORROBORATION_BONUS,
  STALE_PENALTY,
  TIER_CEILING,
  TIER_FLOOR,
  type ConfidenceInput,
  type ConfidenceLabel,
  type ConfidenceStep,
  type ConfidenceTrace,
} from "./model/confidence.js";
export {
  daysBetween,
  evaluateFreshness,
  fingerprintFiles,
  hashContent,
  ownerPaths,
  DEFAULT_STALE_AFTER_DAYS,
  type FileFingerprint,
  type FreshnessInput,
} from "./model/freshness.js";
export {
  camelToKebab,
  capabilityIdFromRoute,
  capabilityIdFromSymbol,
  commandId,
  constraintId,
  evidenceId,
  indexById,
  moduleNamespace,
  packageIdFromPath,
  riskId,
  slug,
} from "./model/ids.js";

// Building
export { buildSurface, nowIso, type BuildOptions, type BuildResult } from "./build/pipeline.js";
export { createAdapterContext, type CreateContextOptions } from "./build/context.js";
export { distinctSources, scoreClaim } from "./build/assemble.js";
export {
  absorbInferred,
  mergeCapabilities,
  mergeCommands,
  mergeConstraints,
  mergeEnvironment,
  mergeEvidence,
  mergeProvenance,
  mergeRisks,
  strongerTier,
} from "./build/merge.js";

// Evidence
export {
  runCommand,
  resolveAllowedCommand,
  skipped,
  CommandNotAllowedError,
  UnsafeWorkingDirectoryError,
  DEFAULT_TIMEOUT_MS,
  type RunOptions,
} from "./evidence/runner.js";
export {
  commandsForStale,
  commandsProving,
  packageTestCommands,
  staleCapabilities,
  type CommandSelection,
  type SelectedCapability,
} from "./evidence/select.js";

// Analysis
export { detectHealth, hasBlockingFindings, sortFindings, type HealthInput } from "./analysis/health.js";
export {
  analyzeImpact,
  type ImpactedCapability,
  type ImpactRelation,
  type ImpactReport,
} from "./analysis/impact.js";
export {
  gateChange,
  renderGateMarkdown,
  GATE_COMMENT_MARKER,
  type GateOptions,
  type GateProof,
  type GateReport,
  type GateVerdict,
  type GatedCapability,
} from "./analysis/gate.js";
export {
  diffSurfaces,
  renderDiffMarkdown,
  DIFF_COMMENT_MARKER,
  type ChangedEntry,
  type EntryDiff,
  type FieldChange,
  type SurfaceDiff,
} from "./analysis/diff.js";
export {
  estimateTokens,
  estimateTokensFromBytes,
  keywords,
  packContext,
  DEFAULT_BUDGET_TOKENS,
  type ContextItem,
  type ContextPack,
  type ContextRole,
  type ContextTrust,
  type PackOptions,
  type ScoredCapability,
} from "./analysis/context.js";

export {
  agentsFingerprint,
  detectAgentsDrift,
  findAgentsBlock,
  renderAgentsBlock,
  renderAgentsBody,
  upsertAgentsBlock,
  AGENTS_BEGIN,
  AGENTS_END,
  AGENTS_FILES,
  type AgentsMarker,
  type AgentsOptions,
} from "./analysis/agents.js";
export {
  evaluateConstraintChecks,
  type CheckInput,
  type CheckResult,
  type ConstraintViolation,
} from "./analysis/constraints.js";
export {
  explainClaim,
  type ClaimExplanation,
  type ExplainedEvidence,
  type ExplainedKind,
} from "./analysis/why.js";

// Declarations
export {
  expandDeclaredOwners,
  isRelativePath,
  loadDeclarations,
  normalizeDeclaredPath,
  type Declarations,
} from "./declarations/load.js";

// Filesystem and git
export { expandGlob, globFilter, globToRegExp, isGlob, matchesGlob } from "./fs/glob.js";
export { parseYamlSafe } from "./fs/yaml.js";
export {
  existsSafe,
  createGuardedAccess,
  createGuardedReader,
  fileSizeSafe,
  readFileSafe,
  readJsonSafe,
  toPosix,
  walkProject,
  DEFAULT_IGNORES,
  MAX_FILES,
  MAX_FILE_BYTES,
  type FileAccess,
  type FileReader,
  type WalkResult,
  type WalkSource,
} from "./fs/walk.js";
export {
  changedSince,
  hashObjects,
  headState,
  type HeadState,
  isRepository,
  isSafeRef,
  listFiles,
  readGitInfo,
  runGit,
  showFileAtRef,
  stagedPaths,
  toIsoUtc,
} from "./git/git.js";

// Safety
export {
  looksSecretName,
  patternNames,
  redactPaths,
  redactText,
  redactValues,
  sanitizeOutput,
  secretEnvValues,
  truncate,
  MAX_SUMMARY_LENGTH,
  REDACTION,
  type SanitizeOptions,
} from "./redact.js";

// Reading and writing
export {
  readSurface,
  serializeSurface,
  surfacePath,
  writeSurface,
  type ReadSurfaceResult,
} from "./io.js";
export {
  DECLARATIONS_FILE,
  GENERATOR_NAME,
  GENERATOR_VERSION,
  SPEC_VERSION,
  SURFACE_DIR,
  SURFACE_FILE,
} from "./version.js";
