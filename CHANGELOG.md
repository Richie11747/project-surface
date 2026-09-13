# Changelog

All notable changes to this project are documented here. This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.0] - 2026-09-13

First release on npm: `npx project-surface init` works as written. The schema is unchanged apart from its
`$id`; every `0.1.0` document remains valid.

### Added

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
