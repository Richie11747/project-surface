/**
 * The extraction pipeline.
 *
 * Detect the stacks, let each adapter describe what it sees, merge the claims,
 * let human declarations override them, then score the result for trust and
 * check it for drift. Adapters supply facts and provenance; everything about
 * how much to believe those facts is decided here, in one place.
 *
 * The whole build runs against a single fixed `now`, and every collection is
 * sorted before it is emitted. Those two properties are what make two runs over
 * an unchanged project produce byte-identical output.
 */

import type { Adapter, AdapterResult } from "../adapter.js";
import { expandDeclaredOwners, loadDeclarations } from "../declarations/load.js";
import { globFilter } from "../fs/glob.js";
import { walkProject, MAX_FILES } from "../fs/walk.js";
import { readGitInfo } from "../git/git.js";
import { computeConfidence, promoteWithEvidence } from "../model/confidence.js";
import { evaluateFreshness } from "../model/freshness.js";
import { evaluateConstraintChecks } from "../analysis/constraints.js";
import { detectAgentsDrift } from "../analysis/agents.js";
import { detectHealth, sortFindings } from "../analysis/health.js";
import { assertValidSurface } from "../schema/validate.js";
import { GENERATOR_NAME, GENERATOR_VERSION, SPEC_VERSION } from "../version.js";
import { createAdapterContext } from "./context.js";
import {
  buildFingerprints,
  collectPackages,
  distinctSources,
  readEnvExample,
  resolveProjectName,
  scoreClaim,
} from "./assemble.js";
import {
  absorbInferred,
  mergeCapabilities,
  mergeCommands,
  mergeConstraints,
  mergeEnvironment,
  mergeEvidence,
  mergeRisks,
  strongerTier,
} from "./merge.js";
import type { Capability, Command, EvidenceEntry, StackInfo, Surface, Timestamp } from "../schema/types.js";

/** Second precision. Milliseconds add churn to diffs without adding meaning. */
export function nowIso(date: Date = new Date()): Timestamp {
  return `${date.toISOString().slice(0, 19)}Z`;
}

export interface BuildOptions {
  root: string;
  adapters: Adapter[];
  /** Fixed timestamp for the build. Supplied by tests to force determinism. */
  now?: Timestamp;
  /** Prior document, used to carry forward verification results and freshness. */
  previous?: Surface | null;
  maxFiles?: number;
  log?: (message: string) => void;
}

export interface BuildResult {
  surface: Surface;
  /** Adapter failures and other non-fatal problems worth telling the user about. */
  warnings: string[];
}

export async function buildSurface(options: BuildOptions): Promise<BuildResult> {
  const { root } = options;
  const now = options.now ?? nowIso();
  const warnings: string[] = [];

  const git = readGitInfo(root);

  /* Declarations come first because they can narrow what the adapters see:
     a vendored example or a fixture project is not part of this project's
     surface, and the only party who can say so is the human. The ignore list
     is applied inside the walk, before the file cap, so what is ignored does
     not count against what is kept. */
  const declarations = loadDeclarations(root, now);
  const ignored = declarations.ignore.length > 0 ? globFilter(declarations.ignore) : () => false;
  const walk = walkProject(root, options.maxFiles ?? MAX_FILES, ignored);
  const files = walk.files;
  expandDeclaredOwners(declarations, files);

  const fileSet = new Set(files);
  const ctx = createAdapterContext({
    root,
    files,
    git,
    now,
    ...(options.log ? { log: options.log } : {}),
  });

  /* Language adapters first; a fallback adapter runs afterwards - always when
     nothing else recognised the project, otherwise only if it detects
     something of its own (a Makefile beside a Go module, say). */
  const results: AdapterResult[] = [];
  /* A language adapter that reports `environment` scanned source for reads.
     The fallback only mirrors .env.example, so it does not count. */
  let environmentAvailable = false;
  const run = async (adapter: Adapter, force: boolean): Promise<void> => {
    try {
      if (!force && !(await adapter.detect(ctx))) return;
      const result = await adapter.extract(ctx);
      results.push(result);
      if (!adapter.fallback && result.environment !== undefined) environmentAvailable = true;
    } catch (e) {
      warnings.push(`Adapter "${adapter.id}" failed and was skipped: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  for (const adapter of options.adapters) if (!adapter.fallback) await run(adapter, false);
  const nothingRecognised = results.length === 0;
  for (const adapter of options.adapters) if (adapter.fallback) await run(adapter, nothingRecognised);

  const commands = mergeCommands([
    ...results.flatMap((r) => r.commands ?? []),
    ...declarations.commands,
  ]);
  const capabilities = absorbInferred(
    mergeCapabilities([
      ...results.flatMap((r) => r.capabilities ?? []),
      ...declarations.capabilities,
    ])
  );
  const constraints = mergeConstraints([
    ...results.flatMap((r) => r.constraints ?? []),
    ...declarations.constraints,
  ]);
  const risks = mergeRisks([...results.flatMap((r) => r.risks ?? []), ...declarations.risks]);
  const environment = mergeEnvironment([
    ...results.flatMap((r) => r.environment ?? []),
    ...declarations.environment,
  ]);
  const evidenceDrafts = mergeEvidence(results.flatMap((r) => r.evidence ?? []));

  const previousCommands = new Map((options.previous?.commands ?? []).map((c) => [c.id, c]));
  const previousCapabilities = new Map((options.previous?.capabilities ?? []).map((c) => [c.id, c]));
  const previousEvidence = new Map((options.previous?.evidence ?? []).map((e) => [e.id, e]));

  const fingerprints = buildFingerprints(root, git.available, capabilities, ctx.readFile);

  const finalEvidence: EvidenceEntry[] = evidenceDrafts.map((draft) => {
    const previous = previousEvidence.get(draft.id);
    const observed = previous?.status === "passed" || previous?.status === "failed";
    const status = observed ? previous.status : draft.status;
    return {
      ...draft,
      status,
      ...(previous?.observedAt ? { observedAt: previous.observedAt } : {}),
      ...(previous?.summary ? { summary: previous.summary } : {}),
      confidence: computeConfidence({
        tier: observed ? "verified" : draft.provenance.tier,
        sourceCount: distinctSources(draft.provenance.sources),
      }),
    };
  });
  const passingEvidence = new Set(
    finalEvidence.filter((e) => e.status === "passed").map((e) => e.id)
  );

  const finalCommands: Command[] = commands.map((draft) => {
    const previous = previousCommands.get(draft.id);
    /* A recorded result only describes the command that produced it. If the
       command line or its working directory changed, the old verdict is
       discarded rather than reused. */
    const carried =
      previous && previous.run === draft.run && previous.cwd === draft.cwd ? previous.verification : undefined;
    const verification = draft.verification ?? carried;
    const freshness = evaluateFreshness({
      now,
      ...(verification?.observedAt ? { verifiedAt: verification.observedAt } : {}),
    });
    return {
      ...draft,
      ...(verification ? { verification } : {}),
      freshness,
      /* A passing run raises a derived command to verified. It never lowers a
         declared one: a human owns that statement, and declared does not decay. */
      confidence: computeConfidence({
        tier: verification?.status === "passed" ? strongerTier(draft.provenance.tier, "verified") : draft.provenance.tier,
        sourceCount: distinctSources(draft.provenance.sources),
        freshness: freshness.status,
      }),
    };
  });

  const evidenceById = new Map(finalEvidence.map((e) => [e.id, e]));

  const finalCapabilities: Capability[] = capabilities.map((draft) => {
    const previous = previousCapabilities.get(draft.id);
    const currentFingerprint = fingerprints.get(draft.id);

    /* A capability whose linked test actually passed has been observed to work,
       so it is promoted to `verified`. This is the only automatic promotion in
       the system, and it requires a real execution to have happened. */
    const proven = draft.evidence.some((e) => passingEvidence.has(e.id));

    /* When a run is newer than the recorded verification, re-anchor both the
       timestamp and the fingerprint to now. Otherwise keep the old anchor, so a
       claim that went stale stays stale until something re-proves it. */
    const provenAt = draft.evidence
      .map((ref) => evidenceById.get(ref.id))
      .filter((e) => e?.status === "passed")
      .map((e) => e?.observedAt)
      .filter((t): t is string => typeof t === "string")
      .sort()
      .pop();
    const storedVerifiedAt = previous?.freshness?.verifiedAt;
    const reanchor = provenAt !== undefined && (storedVerifiedAt === undefined || provenAt > storedVerifiedAt);

    const verifiedAt = reanchor ? provenAt : storedVerifiedAt;
    const anchorFingerprint = reanchor ? currentFingerprint : previous?.freshness?.ownersFingerprint;

    const freshness = evaluateFreshness({
      now,
      ...(currentFingerprint ? { currentFingerprint } : {}),
      ...(anchorFingerprint ? { previousFingerprint: anchorFingerprint } : {}),
      ...(verifiedAt ? { verifiedAt } : {}),
    });
    return {
      ...draft,
      freshness,
      confidence: computeConfidence({
        tier:
          proven && freshness.status !== "stale"
            ? promoteWithEvidence(draft.provenance.tier)
            : draft.provenance.tier,
        sourceCount: distinctSources(draft.provenance.sources),
        freshness: freshness.status,
      }),
    };
  });

  /* Checks run once the capabilities are final, because `require-test` reads
     their evidence links and `max-owners` counts their owners. Imports are a
     build-time fact and are not stored; environment reads are, as `usedBy`. */
  const importsAvailable = results.some((r) => r.imports !== undefined);
  const checked = evaluateConstraintChecks({
    constraints,
    capabilities: finalCapabilities,
    evidence: finalEvidence,
    files: fileSet,
    imports: results.flatMap((r) => r.imports ?? []),
    importsAvailable,
    environment,
    environmentAvailable,
  });
  const finalConstraints = checked.constraints.map(scoreClaim);
  const finalRisks = risks.map(scoreClaim);
  const finalEnvironment = environment.map(scoreClaim);

  const stacks: StackInfo[] = results.map((r) => r.stack).sort((a, b) => a.id.localeCompare(b.id));
  const packages = collectPackages(results);

  const health = detectHealth({
    capabilities: finalCapabilities,
    commands: finalCommands,
    evidence: finalEvidence,
    environment: finalEnvironment,
    stacks,
    files: fileSet,
    declarationErrors: declarations.errors,
    fileScanTruncated: walk.truncated,
    envExample: readEnvExample(fileSet, ctx.readFile),
    constraints: finalConstraints,
    constraintViolations: checked.violations,
  });

  const surface: Surface = {
    schema: SPEC_VERSION as Surface["schema"],
    generatedAt: now,
    generator: { name: GENERATOR_NAME, version: GENERATOR_VERSION },
    project: {
      name: resolveProjectName(root, declarations.projectName, ctx.readJson.bind(ctx), packages),
      root: ".",
      stacks,
      packages,
    },
    commands: finalCommands,
    capabilities: finalCapabilities,
    constraints: finalConstraints,
    environment: finalEnvironment,
    risks: finalRisks,
    evidence: finalEvidence,
    health,
    git,
  };

  /* The generated agent instructions, if committed, are a claim about the
     surface too, and go stale like any other. */
  const agentsDrift = detectAgentsDrift(fileSet, ctx.readFile, surface);
  if (agentsDrift.length > 0) surface.health = sortFindings([...surface.health, ...agentsDrift]);

  assertValidSurface(surface);
  return { surface, warnings };
}
