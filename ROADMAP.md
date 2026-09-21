# Roadmap

What is done, what is next, and - because the project is about not overclaiming - what is deliberately
not on the list. Items link to issues where one exists; a checked box means it is on `main` and tested.

## Done

- [x] `project-surface/v1` schema, published at a stable URL, with [conformance](spec/v1/CONFORMANCE.md) and [versioning](spec/VERSIONING.md) documents
- [x] Trust model: computed confidence, single-step promotion, fingerprint-anchored freshness that does not self-heal
- [x] Adapters: TypeScript/JavaScript, Python (full); Go, Rust (structural); generic fallback (manifest-only)
- [x] Rust workspaces: a member crate with a binary gets `cargo run -p <crate>` (`--bin` for named targets); `#[tokio::test]` and other runtime test attributes count as tests
- [x] Machine-checked constraints (`forbid-import`, `forbid-file`, `require-test`, `forbid-env`, `max-owners`) with `CONSTRAINT_VIOLATED`
- [x] `surface why` - the derivation behind every confidence number
- [x] `surface agents` - generated AGENTS.md / CLAUDE.md with a citation per line and a staleness check
- [x] GitHub Action that posts the semantic diff to the pull request
- [x] The repository describes itself and gates CI on its own `doctor --strict`
- [x] Benchmark harness, recorded with the model and scored offline; weekly corpus run over fourteen public repositories
- [x] Release pipeline with SBOM and a reviewer-gated npm publish
- [x] The loop closes: `verify --stale` re-proves exactly what `doctor` reported stale, `verify --since` what a change touched; every record names the commit it ran against
- [x] Context packs carry a trust label per file and are sized without reading bodies
- [x] `surface gate` - proof-carrying pull requests: per touched capability, proven at the commit under review or not; the GitHub Action posts the receipt and can fail on it

## Next

- [ ] **Record the benchmark** and put the number in the README - the single most important open item
- [ ] Reproducible demo GIF from a VHS tape, generated in CI (`docs/demo/`) - tape and workflow are in place; blocked on vhs writing no file on ubuntu-latest, see [#16](https://github.com/Richie11747/project-surface/issues/16)
- [ ] `check.kind: require-contract` (every owner glob has a contract doc) - a [good first issue](#good-first-issues)
- [ ] `surface diff` against the last *release* tag, not only a git ref
- [ ] Python: `unittest` discovery and `setup.cfg` entry points (today: `pyproject` and pytest only)
- [ ] Editor integration that reads the document rather than re-deriving it (VS Code hover on a capability id)
- [ ] A second generator in another language, to prove the format is a format

## Explicitly not claimed

These are out of scope by design, not by omission. See [docs/comparison.md](docs/comparison.md).

- **No semantic or embedding search, and no symbol index.** A surface is a model of the project, not an
  index of it. Ranking files or symbols for a query is what [ripwire](https://github.com/redhat-et/ripwire)
  and [sigmap](https://github.com/manojmallick/sigmap) do; a surface is what a retrieved file is checked
  against. `surface context` will stay a keyword match over capability names.
- **No call-graph blast radius.** `surface impact` follows declared owners, contracts, evidence and
  packages. A change that reaches a capability only through an import chain is not reported, and the
  comparison page says so.
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
