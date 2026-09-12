# Changelog

All notable changes to this project are documented here. This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[0.1.0]: https://github.com/Richie11747/project-surface/releases/tag/v0.1.0
