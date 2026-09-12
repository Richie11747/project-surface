# project-surface/v1 — specification

Status: **stable**. Schema identifier `project-surface/v1`. Normative machine-readable form:
[`surface.schema.json`](surface.schema.json). Where this prose and the JSON Schema disagree, the schema wins.

Examples: [`examples/minimal.surface.json`](examples/minimal.surface.json),
[`examples/full.surface.json`](examples/full.surface.json). Both are validated in CI.

The key words MUST, MUST NOT, SHOULD and MAY are to be read as in RFC 2119.

---

## 1. Purpose

A *surface* is a single JSON document, `.project/surface.json`, that describes what a software project
can do, where each behaviour lives, what proves it works, and what a change would affect - with every
statement carrying its own provenance, confidence and freshness.

It is meant to be committed to the repository, diffed in pull requests, and read by humans, CI and AI
agents alike, so that all of them work from the same model instead of each re-deriving one.

The document is descriptive, not prescriptive. It never instructs a consumer to do anything; it records
what was observed and how reliably.

## 2. Vocabulary

| Term | Meaning |
|---|---|
| **claim** | Any entry in `commands`, `capabilities`, `constraints`, `environment`, `risks` or `evidence`. Every claim carries `provenance` and `confidence`. |
| **provenance** | How a claim came to be known: a tier, the source files it was read from, the adapter that produced it, and when. |
| **tier** | One of `declared`, `verified`, `derived`, `inferred`, in decreasing order of trust. |
| **adapter** | A component that recognises a stack (TypeScript, Python, ...) and proposes claims. Adapters never execute anything. |
| **evidence** | A test, build, type-check, lint or runtime artefact that can prove a capability. Discovering it and running it are different events, and the document keeps them apart. |
| **freshness** | Whether a claim still describes the current code, anchored to a fingerprint of its owner files. |
| **drift** | A claim whose freshness is `stale`, or a command that failed when last run. |

## 3. Document structure

Top-level object. All keys are REQUIRED; empty arrays are valid.

| Key | Type | Description |
|---|---|---|
| `schema` | `"project-surface/v1"` | Exact string. Consumers MUST reject any other value. |
| `generatedAt` | timestamp | When the document was generated. |
| `generator` | `{ name, version }` | The tool that wrote it. |
| `project` | object | §4 |
| `commands` | `Command[]` | §5 |
| `capabilities` | `Capability[]` | §6 |
| `constraints` | `Constraint[]` | §7 |
| `environment` | `EnvironmentVariable[]` | §8 |
| `risks` | `Risk[]` | §9 |
| `evidence` | `EvidenceEntry[]` | §10 |
| `health` | `HealthFinding[]` | §11 |
| `git` | `GitInfo` | §12 |

### 3.1 Scalars

- **timestamp** — ISO-8601 in UTC with a `Z` suffix and second precision, e.g. `2026-01-01T00:00:00Z`. Millisecond precision is permitted but discouraged: it adds diff noise without adding meaning.
- **path** — POSIX-separated, relative to the project root. MUST NOT be absolute, MUST NOT start with `~`, MUST NOT contain `\`, MUST NOT contain a `..` segment. The root itself is written as `.`.
- **identifier** — matches `^[a-z0-9][a-z0-9._:/-]*$`. Used for every `id` and for `packageId`. Environment variable names are exempt (they follow the platform's convention).
- **confidence** — a number in `[0, 1]` with at most two decimals. Computed, never authored (§14).

### 3.2 Common claim fields

```jsonc
{
  "provenance": {
    "tier": "derived",                                                   // §13
    "sources": [{ "path": "package.json", "locator": "scripts.test" }],  // at least one
    "adapter": "typescript",
    "observedAt": "2026-01-01T00:00:00Z"
  },
  "confidence": 0.7,                                                     // §14
  "freshness": { ... }                                                   // optional, §15
}
```

A claim with an empty `sources` array is invalid. `locator` is free-form and adapter-defined; conventional
forms are `L12`, `L12-L40`, `scripts.test`, `export:createCheckout`, `constraints[0]`.

## 4. `project`

| Field | Type | Notes |
|---|---|---|
| `name` | string | From the declaration file, else the root manifest, else the directory name. |
| `root` | `"."` | Always the literal dot. The document never records where the project lives on disk. |
| `stacks` | `StackInfo[]` | One per adapter that recognised the project. |
| `packages` | `PackageInfo[]` | Workspaces / sub-packages. A single-package project has one entry with `path: "."`. |

`StackInfo.toolchainAvailable` is `false` when the language toolchain is absent on the generating machine.
Evidence for such a stack MUST be reported with status `unknown`, never `passed`.

## 5. `Command`

A thing the project can run: `npm run test`, `pytest`, `go build ./...`.

| Field | Type | Notes |
|---|---|---|
| `id` | identifier | Stable across runs. |
| `run` | string | The exact command line. |
| `cwd` | path | Where to run it. |
| `kind` | `test` `build` `dev` `lint` `typecheck` `format` `start` `migrate` `other` | |
| `packageId` | identifier | optional |
| `description` | string | optional |
| `verification` | `VerificationRecord` | optional; present only after the command was actually executed. |

`VerificationRecord`: `status` (`passed` `failed` `unknown` `skipped`), `exitCode`, `durationMs`,
`observedAt`, `summary` (redacted, truncated output), `reason`.

A verification result describes the command line that produced it. If `run` changes, the old result
MUST be discarded rather than carried forward.

## 6. `Capability`

Something the project does: an HTTP route, an exported function, a CLI command, a background job, a module.

| Field | Type | Notes |
|---|---|---|
| `id` | identifier | Stable across runs; see §16. |
| `title` | string | Human label, e.g. `POST /checkout`. |
| `description` | string | optional |
| `kind` | `route` `export` `command` `job` `module` | |
| `packageId` | identifier | optional |
| `owners` | `SourceRef[]` | The files/symbols that implement it. At least one. |
| `contracts` | `SourceRef[]` | Docs, schemas or API definitions that specify it. May be empty. |
| `evidence` | `{ id, link }[]` | References into `evidence` (§10). `link` says *how* they were tied together. |
| `environment` | string[] | Environment variable **names** it reads. Values are never recorded. |
| `tags` | string[] | Free-form. |
| `route` | `{ method, path }` | optional; for `kind: route`. |
| `aliases` | string[] | optional; previous ids, so renames do not break consumers. |

`EvidenceLink` values, from strongest to weakest: `declared` (a human said so), `config` (a config file
maps them), `import-graph` (the test imports the owner file - a fact read from source), `path-proximity`
(names merely look related - a guess). Consumers SHOULD weight `path-proximity` links as inferred.

## 7. `Constraint`

A rule the project must not violate. Constraints come from declarations (`declared`) or from structured
configuration (`derived`, e.g. an `engines` field). Adapters SHOULD NOT invent constraints.

Fields: `id`, `rule` (string), `rationale` (optional), `severity` (`error` `warn` `info`),
`status` (`active` `stale`), and optionally `check` and `checked`.

### 7.1 `check` - a machine-checkable form of the rule

Prose tells a reader what not to do. A `check` lets the generator establish, on every scan, whether it was
done anyway. `check.kind` is one of:

| Kind | Fields | Violated when |
|---|---|---|
| `forbid-import` | `from[]`, `to[]` | A file matching `from` imports a project file matching `to`, or a bare module specifier matching `to` (`stripe`, `@stripe/*`). |
| `forbid-file` | `paths[]` | Any project file matches `paths`. |
| `require-test` | `paths[]` | A capability with an owner matching `paths` has no linked evidence. |

Patterns are project-relative globs: `**` crosses directory boundaries, `*` and `?` do not, and a bare
path names a file or a whole tree. The same restrictions apply as to `relPath`.

### 7.2 `checked` - what the generator found

When a constraint has a `check`, the generator MUST set `checked` on every scan:
`{ status: "passed" | "violated" | "unchecked", violations: n, reason? }`. A `violated` outcome MUST also
be reported as a `CONSTRAINT_VIOLATED` health finding (§14) at the constraint's severity, listing the
offending paths. A check the generator cannot evaluate - `forbid-import` when no adapter in the scan reports
an import graph - MUST be `unchecked` with a `reason`, never `passed`. Silence is not compliance.

## 8. `EnvironmentVariable`

Fields: `name`, `required` (boolean), `secret` (boolean - whether the **name** looks secret-bearing),
`usedBy` (`SourceRef[]`).

The value of an environment variable MUST NOT appear anywhere in the document. Generators MUST pass any
captured command output through a redaction step before storing it in a `summary` (§17).

## 9. `Risk`

A path or area where a change deserves a second look.

Fields: `id`, `type` (`migration` `secret` `infra` `generated` `external-service`), `paths` (path[]),
`approval` (`required` `advisory`), `reason`.

## 10. `EvidenceEntry`

A test, build, type-check, lint or runtime artefact.

| Field | Type | Notes |
|---|---|---|
| `id` | identifier | Conventionally `evidence:<path>`. |
| `kind` | `test` `build` `typecheck` `lint` `runtime` | |
| `path` | path | optional |
| `commandId` | identifier | The command that exercises it, if known. |
| `status` | `passed` `failed` `unknown` `stale` | |
| `observedAt` | timestamp | optional; when the status was observed. |
| `summary` | string | optional; redacted output. |

**Honesty rule.** `passed` and `failed` REQUIRE an observed execution. Statically discovering a test file
yields `unknown`: finding a test is not the same as running it. This is enforced by the adapter
conformance suite and is the single most important invariant in the format.

## 11. `HealthFinding`

The generator's own assessment of the document. Findings are advisory to consumers and are the input to
`surface doctor`.

| Field | Type |
|---|---|
| `code` | SCREAMING_SNAKE string |
| `severity` | `error` `warn` `info` |
| `message` | string |
| `subject` | `{ kind, id }` optional; `kind` is one of `capability` `command` `constraint` `evidence` `environment` `risk` `package` `project` |
| `paths` | path[] optional |
| `remediation` | string optional |

Codes emitted by the reference implementation:

| Code | Severity | Meaning |
|---|---|---|
| `DECLARATION_INVALID` | error | `.project/surface.declare.yaml` could not be parsed or has an invalid entry. |
| `BROKEN_COMMAND` | error | A command failed the last time it was run. |
| `CONSTRAINT_VIOLATED` | *the constraint's* | A constraint's `check` found one or more violations; `paths` lists them. |
| `STALE_CLAIM` | warn | A capability was verified earlier but its owner files changed since. |
| `MISSING_ENV_EXAMPLE` | warn | A required variable is not listed in `.env.example`. |
| `NO_CAPABILITIES` | warn | A stack was detected but nothing was extracted from it. |
| `LOW_CONFIDENCE_MAJORITY` | warn | Most claims are `inferred`; declarations would help. |
| `FILE_SCAN_TRUNCATED` | warn | The file walk hit its limit; the document may be incomplete. |
| `UNPROVEN_CAPABILITY` | info | No evidence is linked to the capability. |
| `UNDOCUMENTED_CAPABILITY` | info | No contract is linked to the capability. |
| `UNVERIFIED_COMMAND` | info | The command has never been run. |
| `ORPHAN_TEST` | info | A test file could not be linked to any capability. |
| `TOOLCHAIN_UNAVAILABLE` | info | A stack's toolchain is absent on this machine. |
| `CONSTRAINT_UNCHECKED` | info | A constraint has a `check` that no adapter in this scan could evaluate. |

Other generators MAY add codes. Consumers MUST tolerate unknown codes.

## 12. `GitInfo`

`available` (boolean); when true, optionally `head`, `branch`, `dirty`, and `recentChanges`
(`{ path, commits, lastTouched }[]`). This section is informational and is expected to change between
runs; consumers comparing documents SHOULD ignore it.

## 13. Provenance tiers

| Tier | Meaning | Floor | Ceiling |
|---|---|---|---|
| `declared` | A human asserted it in the declaration file. | 1.00 | 1.00 |
| `verified` | A command was executed and its result observed. | 0.95 | 0.99 |
| `derived` | Read from structured configuration or a real parse tree. | 0.70 | 0.90 |
| `inferred` | Heuristic guess from naming or layout. | 0.40 | 0.65 |

Adapters report the tier honestly: `derived` means it was read from structure, `inferred` means it was
guessed. Marking a guess as `derived` to make output look better is a conformance failure in spirit and,
where detectable, in fact.

## 14. Confidence

Confidence is computed by the generator from provenance and freshness. Adapters MUST NOT supply it. The
reference algorithm:

```
tier'   = (tier == verified && freshness == stale) ? derived : tier      // stale proof is demoted
score   = min(ceiling[tier'], floor[tier'] + 0.05 × (distinctSources − 1))
if freshness == stale && tier != declared: score ×= 0.8
confidence = round(clamp(score, 0, 1), 2)
```

Consequences a consumer can rely on:

- A guess never outranks an observation, however many files agree with it.
- `declared` never decays. A stale declaration is a health finding for a human, not a discount.
- Passing evidence promotes a capability by **exactly one tier**: `inferred → derived`, `derived → verified`.
  A green test proves the code behaves; it does not prove the guessed capability is real.

Human-facing labels: `high` ≥ 0.85, `medium` ≥ 0.60, otherwise `low`. Machines SHOULD read the number.

## 15. Freshness

```jsonc
"freshness": {
  "status": "fresh" | "stale" | "unknown",
  "verifiedAt": timestamp,          // absent when never verified
  "ownersFingerprint": string,      // hash over the owner files at verification time
  "staleAfterDays": 14,
  "reason": string                  // human explanation when stale or unknown
}
```

- `unknown` is a real answer: the claim was never verified. It is neither fresh nor stale.
- The fingerprint is an order-independent hash over `(path, hash)` pairs of the owner files. Inside a git
  repository the per-file hash is the git blob SHA; outside one it is a content hash. Either way the
  fingerprint only compares against itself.
- **The anchor does not move on rescan.** `ownersFingerprint` records the owner files *as of verification*.
  If the files change, the claim goes `stale` and stays stale across rescans until something re-verifies
  it. A generator that silently re-anchored on every scan would make staleness undetectable.
- `staleAfterDays` is a backstop TTL for claims whose truth can drift without the owner files changing.

## 16. Identifier stability

Ids MUST be a pure function of the project content so that two documents can be diffed. The reference
derivation:

- Route → `{resource}.{verb}`: `POST /checkout` → `checkout.create`, `GET /checkout/:id` → `checkout.get`,
  `GET /checkout` → `checkout.list`, `DELETE /checkout/:id` → `checkout.delete`. Version and `api` prefixes
  are dropped; parameters are not part of the resource.
- Exported symbol → `{namespace}.{symbol-kebab}`, where the namespace is the nearest meaningful directory
  (`src`, `lib`, `app`, `internal` and similar layout directories are skipped) and the symbol does not
  repeat the namespace: `src/checkout/create.ts#createCheckout` → `checkout.create`.
- Collisions are resolved deterministically with a numeric suffix (`a.b`, `a.b-2`, `a.b-3`).
- Declarations MAY rename a capability; the previous id SHOULD be kept in `aliases`.

## 17. Safety requirements

1. **No secrets.** Environment variable values MUST NOT be stored. Captured command output MUST be
   redacted for secret-shaped strings (key assignments, bearer tokens, connection strings with
   credentials, well-known token prefixes) and truncated to a bounded size before storage.
2. **No machine identity.** Absolute paths, home directories and hostnames MUST NOT appear anywhere in the
   document.
3. **Read-only extraction.** Adapters receive read-only file access. Only the evidence runner of the
   generator executes anything, and only commands already present in `commands`.
4. **Determinism.** Given the same project content and the same `generatedAt`, a generator MUST produce a
   byte-identical document. Practically: fixed clock per build, every collection sorted before emission,
   no random ids.

## 18. Conformance

A document conforms when it validates against `surface.schema.json` **and** satisfies §3.1 (paths, ids),
§10 (honesty rule), §14 (computed confidence) and §17.

An adapter conforms when, over a fixture project, it: declares an id and version; returns a boolean from
`detect`; produces a stack whose `id` matches its own; attaches at least one source to every claim; emits
only relative POSIX paths; never leaks the absolute project root; never reports statically discovered
evidence as `passed`; and produces identical output on two consecutive runs. The reference implementation
ships this as `runConformance` in `@project-surface/adapter-sdk`.

## 19. Versioning

The `schema` string is the version. Within `v1`, fields MAY be added (consumers MUST ignore unknown
fields) and enumerations MAY gain values (consumers SHOULD tolerate unknown values). Removing a field,
changing a type, or changing the meaning of a tier requires `v2`.
