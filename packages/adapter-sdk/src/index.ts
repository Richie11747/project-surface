/**
 * @project-surface/adapter-sdk
 *
 * Everything needed to write an adapter: the contract (re-exported from core so
 * an adapter has one import), a few builders, and the conformance suite that
 * decides whether the adapter is fit to ship.
 */

export type {
  Adapter,
  AdapterContext,
  AdapterResult,
  CommandKind,
  DraftCapability,
  DraftCommand,
  DraftConstraint,
  DraftEnvironmentVariable,
  DraftEvidenceEntry,
  DraftRisk,
  EvidenceLink,
  ImportEdge,
  PackageInfo,
  Provenance,
  ProvenanceTier,
  SourceRef,
  StackInfo,
  Timestamp,
} from "@project-surface/core";

export { emptyResult } from "@project-surface/core";

export {
  classifyCommand,
  extractEnvNames,
  isSafeCommandToken,
  provenance,
  source,
  type ProvenanceInput,
} from "./builders.js";

export { findContracts } from "./contracts.js";
export { firstOnPath, isOnPath } from "./toolchain.js";

export {
  assertConformance,
  runConformance,
  CONFORMANCE_NOW,
  type ConformanceCheck,
  type ConformanceResult,
} from "./conformance.js";
