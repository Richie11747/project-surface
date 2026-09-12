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
  promoteWithEvidence,
  CORROBORATION_BONUS,
  STALE_PENALTY,
  TIER_CEILING,
  TIER_FLOOR,
  type ConfidenceInput,
  type ConfidenceLabel,
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
  moduleNamespace,
  packageIdFromPath,
  riskId,
  slug,
  uniqueId,
} from "./model/ids.js";

// Building
export { buildSurface, nowIso, type BuildOptions, type BuildResult } from "./build/pipeline.js";
export { createAdapterContext, type CreateContextOptions } from "./build/context.js";
export { distinctSources, scoreClaim } from "./build/assemble.js";
export {
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

// Analysis
export { detectHealth, hasBlockingFindings, sortFindings, type HealthInput } from "./analysis/health.js";
export {
  analyzeImpact,
  type ImpactedCapability,
  type ImpactRelation,
  type ImpactReport,
} from "./analysis/impact.js";
export {
  diffSurfaces,
  type ChangedEntry,
  type EntryDiff,
  type FieldChange,
  type SurfaceDiff,
} from "./analysis/diff.js";
export {
  estimateTokens,
  keywords,
  packContext,
  DEFAULT_BUDGET_TOKENS,
  type ContextItem,
  type ContextPack,
  type ContextRole,
  type PackOptions,
  type ScoredCapability,
} from "./analysis/context.js";

// Declarations
export { loadDeclarations, type Declarations } from "./declarations/load.js";

// Filesystem and git
export {
  existsSafe,
  readFileSafe,
  readJsonSafe,
  toPosix,
  walkProject,
  DEFAULT_IGNORES,
  MAX_FILES,
  type WalkResult,
  type WalkSource,
} from "./fs/walk.js";
export {
  changedSince,
  hashObjects,
  isRepository,
  listFiles,
  readGitInfo,
  runGit,
  stagedPaths,
  toIsoUtc,
} from "./git/git.js";

// Safety
export {
  looksSecretName,
  patternNames,
  redactPaths,
  redactText,
  sanitizeOutput,
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
  CACHE_DIR,
  DECLARATIONS_FILE,
  GENERATOR_NAME,
  GENERATOR_VERSION,
  SPEC_VERSION,
  SURFACE_DIR,
  SURFACE_FILE,
} from "./version.js";
