# @project-surface/core

Schema, trust model, extraction pipeline and analysis engine for [project-surface](https://github.com/Richie11747/project-surface).

Everything else in the monorepo depends on this package. It owns:

| Area | Directory | What lives there |
|---|---|---|
| Schema | `src/schema/` | TypeScript types for `project-surface/v1`, the embedded JSON schema and the validator. |
| Trust model | `src/model/` | Confidence scoring, fingerprint-based freshness, stable claim ids. |
| Pipeline | `src/build/` | Runs adapters over a project, merges declarations, assembles the document. |
| Analyses | `src/analysis/` | Health findings, impact maps, context packs and surface diffs. |
| Evidence | `src/evidence/runner.ts` | The **only** place a project command is ever executed. |
| Declarations | `src/declarations/` | Loads and validates `.project/surface.declare.yaml`. |
| Git | `src/git/` | Read-only queries against a fixed `git` binary, no shell. |

Core makes no network calls and never writes to source files. Adapters receive read-only file access and no exec capability; core alone decides what runs.

```ts
import { buildSurface, detectHealth, validateSurface } from "@project-surface/core";
```

See [`docs/trust-model.md`](../../docs/trust-model.md) for what the numbers mean and [`spec/v1/SPEC.md`](../../spec/v1/SPEC.md) for the document format.