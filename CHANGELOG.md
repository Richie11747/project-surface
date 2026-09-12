# Changelog

All notable changes to this project are documented here. This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Declarations set scope and granularity.** `ignore:` removes globs from the scan before any adapter runs;
  `owners:` accept globs, expanded to concrete files at scan time; an `inferred` capability whose owner
  files all lie within a declared capability is absorbed into it (sources union, evidence and environment
  merged, id kept as an alias). `derived` claims are never absorbed.
- `surface map` shows a `FRESHNESS` column and counts fresh/stale rows.
- **`surface why <id>`** and the MCP tool **`surface_why`**: the derivation behind a confidence score -
  sources, evidence and its outcome, the promotion earned or withheld, the freshness anchor, and every
  arithmetic step. The score is recomputed from the document and compared with the recorded value.
  `explainConfidence()` in core returns the same trace programmatically; `computeConfidence()` is unchanged.
- The repository describes itself: `.project/surface.declare.yaml` declares 32 capabilities with contracts
  and evidence; CI runs `surface verify` and gates on `surface doctor --strict`.

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

[Unreleased]: https://github.com/Richie11747/project-surface/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/Richie11747/project-surface/releases/tag/v0.1.0
