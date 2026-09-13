# Roadmap

What is done, what is next, and - because the project is about not overclaiming - what is deliberately
not on the list. Items link to issues where one exists; a checked box means it is on `main` and tested.

## Done

- [x] `project-surface/v1` schema, published at a stable URL, with [conformance](spec/v1/CONFORMANCE.md) and [versioning](spec/VERSIONING.md) documents
- [x] Trust model: computed confidence, single-step promotion, fingerprint-anchored freshness that does not self-heal
- [x] Adapters: TypeScript/JavaScript, Python (full); Go, Rust (structural); generic fallback (manifest-only)
- [x] Machine-checked constraints (`forbid-import`, `forbid-file`, `require-test`) with `CONSTRAINT_VIOLATED`
- [x] `surface why` - the derivation behind every confidence number
- [x] `surface agents` - generated AGENTS.md / CLAUDE.md with a citation per line and a staleness check
- [x] GitHub Action that posts the semantic diff to the pull request
- [x] The repository describes itself and gates CI on its own `doctor --strict`
- [x] Benchmark harness, recorded with the model and scored offline; weekly corpus run over fourteen public repositories
- [x] Release pipeline with SBOM and a reviewer-gated npm publish

## Next

- [ ] **Record the benchmark** and put the number in the README - the single most important open item
- [ ] Reproducible demo GIF from a VHS tape, generated in CI (`docs/demo/`) - tape and workflow are in place; blocked on vhs writing no file on ubuntu-latest, see [#16](https://github.com/Richie11747/project-surface/issues/16)
- [ ] More `check.kind`s: `require-contract` (every owner glob has a contract doc), `forbid-env` (a variable name must not be read outside a path), `max-owners`
- [ ] `surface diff` against the last *release* tag, not only a git ref
- [ ] Python: `unittest` discovery and `setup.cfg` entry points (today: `pyproject` and pytest only)
- [ ] Go: `//go:generate` and `Makefile` awareness through the generic adapter
- [ ] Rust: workspace-level `[[bin]]` in member crates; `#[tokio::test]` in `tests/`
- [ ] Editor integration that reads the document rather than re-deriving it (VS Code hover on a capability id)
- [ ] A second generator in another language, to prove the format is a format

## Explicitly not claimed

These are out of scope by design, not by omission. See [docs/comparison.md](docs/comparison.md).

- **No semantic or embedding search.** A surface is a model of the project, not an index of it.
- **No cross-repository view.** One document per repository.
- **No code modification.** The tool reads; only the evidence runner executes, and only commands already in the document.
- **No claim of better agent output until the benchmark says so.** `bench/RESULTS.md` is the only place that number may come from.
- **Go and Rust are structural**, not AST-based, and their inferred claims are labelled inferred.
- **The benchmark measures the fixtures**, not the world. The corpus run measures extraction, not verification.

## Good first issues

Each of these is self-contained, has a fixture to test against, and follows a pattern already in the tree.

1. A new `check.kind: require-contract` - mirror `require-test` in `packages/core/src/analysis/constraints.ts`, add a case to `packages/core/test/constraints.test.js` and a row to `docs/declarations.md`.
2. Taskfile `includes:` support in `packages/adapters/generic` - today only top-level `tasks:` are read.
3. `justfile` recipes with parameters (`build target:`) - the recipe name is currently read, the parameters are not recorded anywhere; decide whether they belong in `description`.
4. Rust: `#[rocket::get("/path")]` and `#[actix_web::get("/path")]` fully-qualified attribute forms in `packages/adapters/rust/src/parse.ts`.
5. Python: Django `urls.py` `path("...", view)` routes, following the FastAPI/Flask pattern in `packages/adapters/python/src/parse.ts`.
6. A corpus repository for a stack that produces `NO_CAPABILITIES` on purpose (a pure-Makefile C project), so the fallback path is measured weekly too.
7. `surface map --json` column parity: the text table shows `FRESHNESS`; make sure the JSON has the same fields and a test asserts it.
8. Spec example `examples/constraint-checked.surface.json` showing `check` and `checked` together, validated by `test/spec-examples.test.js`.

Open one, say you are taking it, and read [CONTRIBUTING.md](CONTRIBUTING.md) first.
