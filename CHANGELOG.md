# Changelog

All notable changes to this project are documented here. This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Sessions - fewer tokens, no loops.** A machine-local, append-only ledger at
  `.project/session.local.json` (already covered by the generated `.gitignore` pattern) records what the
  tool ran and what it served, keyed to a working-tree fingerprint - the commit plus the content hash of
  every path that differs from it. Three deterministic signals follow: `unchanged-rerun` (the last attempt
  of this command failed on byte-identical code; running it again cannot come out differently),
  `same-failure` (three attempts, the same failure signature, at least two different trees: the edits are
  not reaching it) and `flapping` (pass and fail on the same tree: not proof). `surface verify` prints them
  and `--if-changed` skips the pointless run with exit `0`; `surface_verify` over MCP declines it - `Not
  run.`, not an error - unless `force: true`. New `surface session [--reset]` and the `surface://session`
  resource. Core: `assessAttempt`, `assessHistory`, `failureSignature`, `workingTreeFingerprint`,
  `readLedger` / `writeLedger`. What is and is not recorded: [docs/sessions.md](docs/sessions.md).
- **Delta context packs.** `surface context --delta` and, by default, `surface_context` over MCP list a
  file already served in this session and unchanged since - path, role, trust, which pack served it -
  without repeating it or charging it to the budget; `repeated` and `savedTokens` make the saving visible.
  `mode: "full"` turns it off over MCP. The pack now also carries a change `key` per item.
- **Slices instead of drops.** A file that does not fit the remaining budget is served from the locator the
  document already holds (`L74`, `export:createCheckout`) to the next top-level declaration, at most 120
  lines, and the item says `partial` with its `range`; a file with no such locator is omitted as before.
  Core: `sliceAround`.
- **Relevant rules.** The pack's constraints are every active rule at error severity plus the ones whose
  check globs or sources cover a file in the pack; `constraintsOmitted` counts the rest, and
  `--all-constraints` / `allConstraints: true` lists them. Core: `relevantConstraints`.

- **`surface gate` - proof-carrying pull requests.** For every capability a change touches (`--since <ref>`,
  `--staged` or paths), the gate says what its evidence describes: `proven` (recorded at this commit),
  `carried` (an earlier run over byte-identical owner files), `stale`, `unproven` or `failing`; it lists
  violated and unchecked constraints, risks the change touches, and every contract document that did not
  change while capabilities it specifies did. Exit `2` unless every touched capability is proven or carried
  and no error-level rule is violated; `--strict` accepts only `proven` and blocks on warn-level violations
  and approval-required risks. `--verify` proves the missing capabilities first through the same path as
  `surface verify`; `--format markdown` is a deterministic receipt. Core: `gateChange`, `renderGateMarkdown`.
- **`surface_gate` over MCP** - the same verdicts, read-only, for an agent to check its own change before
  opening a pull request. Ten tools now; nine are read-only.
- **The GitHub Action posts the receipt.** New inputs `gate` (default on), `verify` (let the gate run the
  recorded commands so the receipt says proven at the pull request head) and `fail-on-gate`. The comment
  carries the semantic diff and the proof of change; this repository uses `verify: "true"` on its own pull
  requests.
- **`surface verify` selects by claim, not only by command id.** `--stale` runs exactly the commands that
  re-prove every capability whose owner files changed since it was verified, then reports how many are
  fresh again; nothing stale is a clean exit `0`, so CI can run it unconditionally. `--since <ref>`,
  `--staged` and explicit paths run what `surface impact` would list for that change set. The rule that
  maps a capability to the commands proving it lives once, in `commandsProving` / `commandsForStale`
  (`@project-surface/core`), and `STALE_CLAIM` now points at `verify --stale`.
- **`surface_verify` over MCP accepts `stale: true`** under the same two gates - it resolves only to
  command ids the document already binds to its stale claims. Served through `surface mcp`, the tool now
  rebuilds the document after the run (the CLI owns the adapters), so freshness is re-anchored in the
  same call; the standalone binary records the result and says `surface init` folds it in.
- **Every verification record names the commit it ran against** (`commit`, `dirty`), and `surface inspect`
  shows `Proven at <commit>` while `surface why` carries it on the evidence line. A tree whose only
  change is the regenerated `.project/surface.json` is not dirty.
- **The context pack labels every file with the trust of its claim.** Each capability and each item
  carries the provenance tier and freshness (`declared·fresh`, `inferred·stale`); an evidence item says how
  its test last went; between equally relevant claims a proven one outranks an unproven one, which
  outranks a stale one. `surface_context` over MCP shows the same.
- `docs/comparison.md` now covers sigmap and ripwire - where they win (retrieval, symbol granularity,
  languages, speed) and what a surface does that they do not attempt (executed evidence, checked rules,
  a commit-anchored freshness loop) - with a section on why project-surface is not a context engine.

### Changed

- The MCP server stats the document before every call and re-reads it only when its size or mtime changed;
  the guarded file allow-list behind `surface_context` is reused while the document is unchanged (30 s
  ceiling) instead of walking the tree on every call.
- `surface_context` wraps constraint text in `<repo-data>` and ends with the trust note, like every other
  tool that carries claims.
- `headState` and the working-tree fingerprint ignore `.project/*.local.json`, so a session file that is not
  gitignored does not make every verification record `dirty`.
- A context item larger than 2 MiB is reported as such rather than as "missing, unreadable, or not one the
  project lists".

- **`surface context` no longer reads file bodies unless `--content` is given.** The packer takes a
  `FileAccess` with a size probe and sizes files by `stat`; `createGuardedAccess` applies the same
  allow-list and credential-file refusal to sizes as to reads. A bare reader still works. Token estimates
  agree with the content-based ones on ASCII sources and err slightly high on multi-byte or CRLF files.

### Fixed

- **`--since <ref>` works in a shallow clone.** `changedSince` diffs from the merge base (`ref...HEAD`);
  when a CI checkout holds no merge base it now falls back to a direct tree diff, which over-reports and
  never under-reports - the safe direction for `verify`, `impact` and `gate`. Previously the gate on a
  default `actions/checkout` could not judge anything.

### Specification

- `verificationRecord` gains two optional fields, additive within `project-surface/v1`: `commit`
  (7-40 hex characters, the commit the working tree was at) and `dirty` (`true` when the tree had
  uncommitted changes, so the result describes the tree rather than the commit alone). Both are absent
  outside a git repository.

### Fixed

- **`npm run typecheck` was a no-op.** `tsc --build --dry` only reports which projects would be built; it
  read no source file when `dist/` was current. The script now runs `tsc --build --force`, and CI runs it
  as its own step. `tsconfig.base.json` additionally enables `noUnusedLocals` and `noUnusedParameters`.
- `@types/node` is pinned to the 20.x line the `engines` field promises, so code cannot compile against
  APIs that do not exist on the oldest supported runtime.
- Transitive advisories cleared via `npm audit fix`: `fast-uri` (through `ajv`), `hono` and `qs`
  (through `@modelcontextprotocol/sdk`). No direct dependency changed.
- `fixtures/rust-svc` no longer carries a committed `.project/surface.json`; no other fixture did, and the
  snapshot never referenced it.

### Changed

- CI: matrix jobs have a 20-minute timeout and a newer push to the same ref cancels the run in flight.
- `project-surface` (the CLI package) declares an `exports` map like every other workspace package.
### Security

- **Redaction ran in quadratic time on hostile output.** The `assignment` and `connection-string` patterns
  in `sanitizeOutput` had unbounded quantifiers around their keywords; a test log made of long dash-separated
  tokens or many `://` with no `@` took seconds per 40 KB and the runner captures up to 8 MiB, so
  `surface verify` could hang for hours. Every quantifier is now bounded, and redaction scans only the part
  of the output that can survive the length cap (plus 4 KiB of headroom so a credential straddling the cut
  is still caught whole). The truncation note still counts every dropped character.
- **`surface_context` / `surface context --content` could return any in-root file the document named.**
  Declarations are repository content, so a hostile `owners: [.env, .git/config]` handed those files - a
  gitignored `.env`, the `extraheader` token `actions/checkout` leaves in `.git/config` - straight back to
  the caller, unredacted. Both now read through `createGuardedReader`: only files the project lists
  (tracked or untracked-and-not-ignored), never `.git/`, dotenv (`.env.example` stays readable), `.npmrc`,
  `.netrc`, key or certificate files, and the content is redacted. Refused files appear under *Omitted*.
- **The runner scrubs exact environment values.** The child inherits the operator's environment; the value
  of any variable whose name looks like a credential (`looksSecretName`, length ≥ 6) is removed from the
  captured output before pattern matching, so `env` in a test script no longer leaks `PRIVATE_KEY=...` or
  `BASIC_AUTH=user:pass` into the committed summary. `private[_-]?key` joined the assignment keywords.
- **`surface agents --write` accepted `docs/../../AGENTS.md`.** The containment check looked only at the
  leading segment; `surface report --out` had no check at all. Both now resolve the target first, compare
  it with the root lexically and physically (real path of the nearest existing ancestor), and refuse with
  `Refusing to write outside the project root`. Shared as `resolveWriteTarget` in the CLI.
- **Declared paths are validated everywhere.** `owners`, `contracts`, `evidence`, `usedBy` and `risks.paths`
  go through the same check as `ignore`: backslashes are folded to `/` first (so `..\x` cannot pass a check
  that splits on `/`), `~`, absolute and `..` paths are rejected as a declaration error next to the entry
  that wrote them, instead of aborting the whole build at schema validation.
- `git hash-object` no longer receives an owner path that does not resolve to a regular file inside the
  root, so a committed symlink cannot make git read outside the tree for a fingerprint - and one absent
  owner no longer fails a whole batch.
- `readFileSafe` refuses files larger than 2 MiB (`MAX_FILE_BYTES`); adjacent `**` in a glob fold to one
  and a pattern with more than eight doublestars matches nothing, so a declaration cannot make matching
  polynomial over a 20 000-file tree.
- MCP: `surface_constraints` and `surface_health` wrap repository-authored text in `<repo-data>` and the
  trust note says what that means; `surface_verify` warns when a *declared* command contains shell
  metacharacters (`; | & $ \` < >`). Execution is not blocked - `SECURITY.md` and `docs/mcp.md` describe
  the boundary.
- **A non-ASCII filename in recent history aborted the build.** `git log --name-only` C-quotes such names
  (`"caf\303\251.ts"`) and the quotes then failed the schema's `relPath` rule. Every path-listing git
  query (`recentChanges`, `changedSince`, `stagedPaths`) now uses `-z`, and `--relative`, so a package
  scanned inside a monorepo gets paths relative to itself rather than to the repository top level.
- **Verifying a declared command lowered its confidence and let it decay.** A passing run rewrote the
  tier to `verified` (floor 0.95), after which the 14-day TTL applied - a `declared` command dropped to
  0.56 with no human involved, contradicting "declared never decays". The run now only ever raises a tier
  (`strongerTier`), in the pipeline and in `surface why`.
- `git hash-object` retries a batch path by path when one entry fails, so an absent owner no longer pushes
  its eighty neighbours into a different hash space - which made `ownersFingerprint` depend on how many
  capabilities existed, and produced `STALE_CLAIM` with no edit to the files.
- `AGENTS_MD_STALE` is reported for every stale file: a current `AGENTS.md` no longer hides a stale
  `CLAUDE.md`. A block written with `--max-capabilities N` records `max=N` in its marker and is compared
  against a render with the same cap, instead of being stale on every scan.
- `surface impact` normalises the paths it is given (backslashes, `./`, trailing `/`) and matches owners,
  evidence, contracts, packages and risks with one directory-aware rule in both directions - `docs` now
  touches `docs/cli.md`, and `db/migrations/002.sql` touches a `db/migrations` risk.
- A plain directory in `owners:` expands to the files under it, as `glob.ts` always documented; before,
  only globs were expanded and `owners: [src/model]` was an orphan.
- `mergeEnvironment` takes `required` from the stronger tier, so a maintainer's `required: false` is not
  overridden by an adapter that assumed every read is mandatory. `secret` stays sticky.
- Identifiers are capped at the schema's 200 characters: a slug longer than 180 keeps its head and gains
  an 8-character content hash, composite ids (`pkg:cmd`, `risk:type:path`) are bounded as a whole. A deep
  test path used to yield an id that failed validation and aborted the build.
- A carried verification is discarded when the command's `cwd` changed, not only its `run`. An adapter
  that throws a non-`Error` value is reported with its string, not `undefined`.
- The runner distinguishes a command that printed more than the 8 MiB capture buffer (`ENOBUFS`) from one
  that could not be started. Known limitation, now stated in the code: on Windows the timeout stops the
  shell, not necessarily every process it spawned.

### Added

- Health finding `DANGLING_EVIDENCE` (warn): a capability links an evidence id that no entry carries -
  typically a misspelt or deleted `evidence:` path. Such a link used to satisfy `require-test` silently;
  the check now counts only references that resolve.
- **A UTF-8 byte-order mark or CRLF line endings broke every line-based parser.** `readFileSafe` now
  drops a leading BOM and normalises CRLF to LF, once, for every reader: a BOM-prefixed `package.json`
  was silently skipped (`JSON.parse` threw), the first line of `go.mod`, `Cargo.toml` and a Makefile was
  invisible, and in a CRLF Rust file everything after a `#[cfg(test)] mod tests {` block vanished because
  its closing brace read as `"}\r"`.
- **Rust:** two `.route("/a", get(a)).route("/b", post(b))` registrations on one line no longer share
  methods; `[[ bin ]]` with spaces is a binary target; a section header the parser does not read (a quoted
  key such as `[target.'cfg(unix)'.dependencies]`) closes the previous section instead of leaving its keys
  credited to `[package]`; a `#` inside a TOML string and a `//` inside a Rust string are not comments.
- **Go:** Go 1.22 `ServeMux` patterns (`"GET /items/{id}"`) are routes, with the method taken from the
  pattern; members of a `type ( ... )` group are declarations; block comments and `//` inside string
  literals no longer produce or hide routes.
- **Python:** the `test` command's source is the file that actually configures pytest (`pytest.ini`,
  `pyproject.toml [tool.pytest]`, `tox.ini [pytest]`, `setup.cfg [tool:pytest]`), not the first manifest
  that exists; `from . import reserve` resolves to `reserve.py`, not `__init__.py`; absolute imports are
  also tried under `src/`, so a `src/` layout links its tests; `conftest.py` is neither behaviour nor a
  test; `pdm.lock` and `Pipfile.lock` name their managers; a `pyproject.toml` that does not parse is
  reported in the stack notes instead of vanishing.
- **TypeScript:** when the root `package.json` declares `workspaces`, only those directories are packages -
  an `examples/` or `docs/` manifest no longer contributes commands; a risk id names the directory of its
  matches (`risk:migration:db/migrations`), so adding a second migration does not rename the risk; a test
  file in a package without a `test` script is no longer attributed to an arbitrary other package's test
  command; `const { DATABASE_URL } = process.env` counts as reading `DATABASE_URL`.
- **Generic:** `FOO ::= x` is an assignment, not a target; `install uninstall: deps` names two targets;
  `clean::` is one; Taskfiles are parsed as YAML, so four-space indentation, quoted keys and trailing
  comments work; `.env.example` names follow the same rule as core's health check, so a lowercase name
  is not "documented" yet absent from the environment.
- `findContracts` computes its candidate list once per scan instead of twice per capability.

### Added

- `@project-surface/adapter-sdk`: `matchAll(pattern, text)` and `stripLineComment(line, marker?, quotes?)`,
  the two helpers every line-based parser had reimplemented. `@project-surface/core`: `parseYamlSafe`.
- Unit tests for the Go, Python, TypeScript and generic parsers, which previously had only fixture
  snapshots.
### Changed

- A declared `ignore:` is applied inside the file walk, before the 20 000-file cap, so an ignored tree
  no longer spends the budget the project's own files then run out of (`walkProject` takes an optional
  `exclude` predicate). The fallback walk skips the built-in ignore names only when they are directories;
  a file called `build` or `env` is a file.
- Fewer syscalls and spawns per scan: the root's real path is resolved once rather than once per file
  read; `AdapterContext.readJson` parses each manifest once (the TypeScript adapter asked for the root
  `package.json` once per package); `git rev-parse` answers `HEAD` and the branch in one spawn; constraint
  violations are de-duplicated in one pass instead of quadratically; context-pack keyword matching
  lower-cases each field once. `AdapterContext.match` also strips a sticky `y` flag, which made a filter
  stateful just as `g` did.
- `surface diff` distinguishes `DECLARATION_INVALID` findings by message, so fixing one declaration error
  while introducing another no longer reads as "no change".
- One helper instead of six copies: `indexById` (core) replaces the hand-built evidence maps in `agents`,
  `context`, `impact`, `why`, `diff` and the MCP read tools; `ownerPaths` is reused where owner paths were
  de-duplicated inline; declared evidence ids go through `evidenceId`.

### Removed

- Dead exports, none referenced inside the repository or documented: `matchesAny`, `uniqueId`,
  `CACHE_DIR` (core), `extractEnvNames`, `firstOnPath` (adapter-sdk), the internal `SCHEMA_ID`,
  `Declarations.present`, `crateOf` (Rust adapter) and the `uniqueRefs` alias of `dedupeSources`.

## [0.2.0] - 2026-09-15

First release on npm: `npx project-surface init` works as written. The schema is unchanged apart from its
`$id`; every `0.1.0` document remains valid.

### Added

- **Two new constraint checks.** `forbid-env` - variables matching `names` may be read only by files under
  `paths` (or by nobody, when `paths` is omitted); a dotenv file that lists the name is a declaration, not a
  read. `max-owners` - no capability (under `paths`, or any) owns more than `limit` distinct files. Both are
  evaluated on every scan like the existing kinds; `forbid-env` is `unchecked` with a reason when only the
  generic fallback saw the project. The repository now applies both to itself (`model-keys-in-bench`,
  `core-capability-size`), and `fixtures/ts-api` carries one of each.
- **Rust adapter**: fully-qualified route attributes such as `#[rocket::get("/path")]` and
  `#[actix_web::get("/path")]` are recognised alongside the bare `#[get("/path")]` form. Covered by
  `fixtures/rust-svc` and a parser test. (#18, thanks @mamicicekel)
- **Rust workspaces**: a member crate with a binary gets its own `start` command - `cargo run -p <crate>`,
  or `cargo run -p <crate> --bin <name>` per `[[bin]]` target - sourced from the member manifest and run
  from the workspace root. Any `#[<runtime>::test]` attribute (`tokio`, `async_std`, `sqlx`, `actix_web`)
  now marks a file as a test host, not only `#[tokio::test]`. New fixture `fixtures/rust-workspace`.
- **Rust adapter** (`@project-surface/adapter-rust`): `Cargo.toml` (workspace members, binaries,
  `rust-version`), public items, axum / actix-web / rocket routes, env usage, `cargo test|build|check|run`.
  Integration tests under `tests/` are linked to the files their `use` lines name (`import-graph`); inline
  `#[cfg(test)]` modules are linked to their own file as `path-proximity`. Structural, and marks the stack
  unavailable without `cargo`. Fixture `fixtures/rust-svc`.
- **Generic fallback adapter** (`@project-surface/adapter-generic`): `Makefile`, `justfile` and `Taskfile`
  targets become commands, `.env.example` names become environment. It runs beside a language adapter when a
  build file exists, and *always* when no adapter recognised the project - so a scan never returns an empty
  document without saying why. It claims no capabilities. Fixture `fixtures/plain-make`.
- `Adapter.fallback` (optional) in the adapter contract; the pipeline runs fallback adapters after the
  language adapters, forced when nothing else matched.
- The corpus gains two Rust repositories (axum, ripgrep).
- **Declarations set scope and granularity.** `ignore:` removes globs from the scan before any adapter runs;
  `owners:` accept globs, expanded to concrete files at scan time; an `inferred` capability whose owner
  files all lie within a declared capability is absorbed into it (sources union, evidence and environment
  merged, id kept as an alias). `derived` claims are never absorbed.
- **Machine-checked constraints.** A declared constraint may carry a `check` (`forbid-import`, `forbid-file`,
  `require-test`). It is evaluated on every scan; the outcome is recorded on the constraint (`checked`) and a
  violation is a `CONSTRAINT_VIOLATED` health finding at the constraint's severity with the offending paths.
  A check no adapter can evaluate is `unchecked` with a reason (`CONSTRAINT_UNCHECKED`), never silently
  passed. Adapters may report `imports` (TypeScript and Python do); the schema gains `constraintCheck`,
  `constraintOutcome` and `globPattern`, all optional and backward-compatible.
- **`surface agents [--write AGENTS.md|CLAUDE.md]`**: agent instructions generated from the surface -
  commands that were run, rules and their check status, risky paths, owners with contract and evidence,
  environment names - each line with its provenance, inferred guesses omitted by default. The block sits
  between fingerprinted markers; hand-written text outside them is preserved, and `surface doctor` reports
  `AGENTS_MD_STALE` when the surface changes underneath it. This repository's `CLAUDE.md` is generated this way.
- `surface diff --format markdown` renders the semantic diff as a pull-request comment, and the GitHub Action
  gains `comment: true` to post it - one comment per pull request, updated in place - plus a `run` input for
  source checkouts.
- **Benchmark harness** (`bench/`): 50 golden questions over the fixtures with mechanically checkable
  answers, asked under `raw` (all files) and `surface` (overview + context pack) conditions. Recording
  calls the Claude API and commits answers with model, commit, usage and prompt hash; scoring is offline,
  deterministic, checked in CI, and reports prompt drift. `bench/RESULTS.md` says *not recorded* until
  someone runs it.
- **Corpus run** (`bench/corpus-run.mjs`, weekly workflow): `surface init` over fourteen pinned public
  repositories across four stacks, results committed to `bench/corpus/RESULTS.md`.
- `surface map` shows a `FRESHNESS` column and counts fresh/stale rows.
- **`surface why <id>`** and the MCP tool **`surface_why`**: the derivation behind a confidence score -
  sources, evidence and its outcome, the promotion earned or withheld, the freshness anchor, and every
  arithmetic step. The score is recomputed from the document and compared with the recorded value.
  `explainConfidence()` in core returns the same trace programmatically; `computeConfidence()` is unchanged.
- The repository describes itself: `.project/surface.declare.yaml` declares 35 capabilities with contracts
  and evidence; CI runs `surface verify` and gates on `surface doctor --strict`.
- **The spec as a standard.** `spec/v1/CONFORMANCE.md` states what a document, a generator in any
  language, a consumer and an adapter must satisfy, independently of this implementation;
  `spec/VERSIONING.md` states what may change within `v1`, what requires `v2`, and how package versions
  relate to the format version. `@project-surface/adapter-sdk` gains the `surface-conform` command
  (`npx -p @project-surface/adapter-sdk surface-conform <adapter-module.js> <fixture-dir>`), the
  conformance suite for adapters that live outside this repository: exit `0` conforms, `2` a check failed,
  `1` not an adapter.

### Specification

- `check.kind` gains `forbid-env` and `max-owners`; `check` gains the optional fields `names` (variable name
  patterns) and `limit` (integer ≥ 1). Additive under [VERSIONING.md](spec/VERSIONING.md): a consumer that
  does not know a kind treats it as `unchecked`. First emitted by 0.2.0.
- The schema `$id` is now the stable, versioned URL
  `https://richie11747.github.io/project-surface/spec/v1/surface.schema.json`, served from `spec/` by a
  Pages workflow. The path carries the version; `v1` at that URL only ever changes additively. Nothing
  else in the schema changed.

### Fixed

- The CLI rejects an unknown option or a stray positional argument with exit 1 and a pointer to `--help`, instead of silently folding it into the task text; `--no-color` now works on a TTY and `NO_COLOR` is honoured.

## [0.1.0] - 2026-09-12

First release. Establishes the `project-surface/v1` schema.

### Added

- **Specification** - `spec/v1/surface.schema.json` plus prose, describing capabilities, commands, constraints, environment, risks, evidence and health, each carrying provenance, confidence and freshness.
- **Trust model** - computed confidence with tier floors and ceilings, corroboration bonuses, single-step promotion from passing evidence, and fingerprint-anchored freshness that does not self-heal.
- **Adapters** - TypeScript/JavaScript (compiler API, import-graph test linking), Python (pyproject, route decorators, import linking), Go (structural, honest about a missing toolchain).
- **Adapter SDK** - contract plus a conformance suite enforcing provenance, path portability, honest evidence status, and byte-identical determinism.
- **CLI** - `init`, `inspect`, `map`, `verify`, `impact`, `context`, `diff`, `doctor`, `report`, `mcp`. All support `--json`; exit code 2 signals drift.
- **MCP server** - eight tools, seven read-only, with double-gated execution.
- **Fixtures** - three small real projects with golden snapshots (`fixtures/*/expected.surface.json`), regenerated with `npm run fixtures:update`.
- **Tests** - unit suites for the trust model and redaction, golden snapshots, the adapter conformance suite run against every built-in adapter, a CLI end-to-end walkthrough, and validation of the spec examples.
- **Docs** - `spec/v1/SPEC.md` (normative prose), `docs/` (concepts, trust model, CLI, MCP, declarations, adapters), `examples/`.
- **Integrations** - a Claude Code plugin and a composite GitHub Action under `integrations/`.
- `surface verify` rebuilds the document after recording results, so capability confidence and freshness update immediately instead of on the next `init`.

[Unreleased]: https://github.com/Richie11747/project-surface/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/Richie11747/project-surface/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/Richie11747/project-surface/releases/tag/v0.1.0
