# project-surface

[![CI](https://github.com/Richie11747/project-surface/actions/workflows/ci.yml/badge.svg)](https://github.com/Richie11747/project-surface/actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

**The missing semantic layer for AI-readable software projects.**

Ask any AI agent what your project can do, where it lives, what proves it, and what a change will affect.

---

## The problem

Every AI coding tool re-derives the same facts about your repository on every single task. What does this project do? Which command actually runs it? Which files own this behaviour? What must not be violated? Which tests prove it works?

That derivation is expensive, non-reproducible, invisible to you, and impossible to check. Every tool does it privately, and differently.

## The idea

A repository is not a folder of files. It is a graph of capabilities, contracts, workflows, evidence, dependencies and risks.

`project-surface` materializes that graph into one small, stable, tool-readable artifact: `.project/surface.json`. Claude Code, Cursor, Codex, your IDE, your CI and you all read the same verified model instead of guessing separately.

**The differentiator is honesty, not intelligence.** "AI reads your code" already exists. What does not exist is every claim carrying an owner, a contract, evidence, freshness, confidence and a provenance tier - where an inferred fact is *labelled* inferred, and a stale fact is *labelled* stale.

---

## Install

```console
npx project-surface init          # nothing to install; or: npm i -g project-surface
```

Node 20.10 or newer. No native modules, no other runtime, no account, no network - the tool never
leaves your machine.

From a source checkout, `git clone https://github.com/Richie11747/project-surface && cd project-surface &&
npm install && npm run build`, then `node packages/cli/dist/index.js` (or `npm run surface --`) wherever
the docs say `npx project-surface`.

## Sixty seconds

```console
$ npx project-surface init

Wrote .project/surface.json

  project      checkout-api
  stacks       typescript
  packages     1
  commands     3
  capabilities 9
  constraints  5
  evidence     2
  risks        1

  health 0 error, 5 warning, 10 info  - run surface doctor
```

Now ask it about one behaviour:

```console
$ surface inspect checkout.create

checkout.create
  POST /checkout
  HTTP endpoint registered in src/checkout/create.ts.

  Implemented by
    src/checkout/create.ts export:createCheckout
    src/checkout/create.ts L74

  Contract
    docs/contracts/checkout.md

  Evidence
    tests/checkout/create.test.ts (unknown, linked by import-graph)

  Requires environment
    DATABASE_URL

  Check it with
    npm run test

  Trust  0.70 medium | derived | unverified
         medium confidence from 2 source(s) via the typescript adapter
         Never verified.
```

Note `unverified`. Nothing has been run yet, so nothing claims to be proven. Run the test:

```console
$ surface verify --command test
running test  npm run test
  passed 936 ms

$ surface inspect checkout.create
  Trust  0.95 high | derived | fresh
```

Now change the implementation and rescan:

```console
$ surface doctor
  warn  STALE_CLAIM [checkout.create]
      Capability "checkout.create" was verified earlier but its files have changed since.
      Run: surface verify --capability checkout.create

$ surface inspect checkout.create
  Trust  0.56 low | derived | stale
         Owner files changed since verification.
```

That is the whole product. **A claim that was proven, and then stopped being proven, says so.** It stays stale across rescans until something actually re-verifies it.

---

## Give it to Claude

```console
claude mcp add project-surface -- npx -y project-surface mcp
```

Then ask, in a fresh session with no prior context:

> Where is checkout implemented, what tests prove it, and what changes if I add a status field?

Claude answers from structured data - owners, contract, linked tests, active constraints, and a bounded impact map - instead of grepping and guessing.

Or give it a file. `surface agents --write CLAUDE.md` renders the surface as agent instructions - the commands
that were actually run, the rules and whether each is machine-checked, where things live and what proves it -
with the provenance on every line and inferred guesses left out. The block carries a fingerprint, and
`surface doctor` reports it as stale the moment the surface changes underneath it. A hand-written CLAUDE.md
cannot do that. This repository's own [CLAUDE.md](CLAUDE.md) is generated this way and checked in CI.

Nine tools are exposed: `surface_overview`, `surface_find_capability`, `surface_why`, `surface_constraints`, `surface_health`, `surface_impact`, `surface_context`, `surface_diff`, and `surface_verify`.

Eight of them are strictly read-only. See [Trust and safety](#trust-and-safety) for the ninth, and
[docs/mcp.md](docs/mcp.md) for the full tool reference. A Claude Code plugin and a GitHub Action live in
[integrations/](integrations/README.md).

---

## The trust model

Every claim in the document carries a provenance tier. This is the spine of the whole project.

| Tier | Meaning | Confidence floor |
|---|---|---|
| `declared` | A human asserted it in `.project/surface.declare.yaml` | 1.00 |
| `verified` | A command was executed and its result observed | 0.95 |
| `derived` | Read from structured config or a real parse tree | 0.70 |
| `inferred` | Heuristic guess from naming or layout | 0.40 |

Confidence is **computed, never authored**. An adapter reports how it learned something; core turns that into a number:

- Independent corroborating sources raise the score within the tier band.
- A stale `verified` claim is demoted to `derived` - execution proves what the code did at a point in time, and once the owner files change that proof no longer describes the current code.
- Passing evidence promotes a claim by **exactly one tier**. A green test on an `inferred` capability makes it `derived`, not `verified`: the test proves the code behaves, not that the thing we guessed was a capability really is one.
- `declared` never decays. A human owns the statement, so a stale declaration is reported as a health finding rather than quietly discounted.

Freshness is fingerprint-based, not just a TTL. Each claim stores a hash of its owner files *as of verification*. Change a file and the claim goes stale; rescan and it stays stale, because the anchor does not move until something re-proves it.

When inference is wrong, override it once and every tool respects it:

```yaml
# .project/surface.declare.yaml
capabilities:
  - id: checkout.create
    title: Creates a checkout session
    owners: [src/checkout/create.ts]
    contracts: [docs/contracts/checkout.md]
    environment: [DATABASE_URL, STRIPE_SECRET_KEY]

constraints:
  - rule: Never call the payment provider from a request handler.
    severity: error
    check:
      kind: forbid-import
      from: [src/checkout/**]
      to: [src/payments/**, stripe, "@stripe/*"]
```

That last block is the difference between a rule and a hope. A `CLAUDE.md` says *do not*; an agent may
comply. A constraint with a `check` is evaluated on every scan, and when it is broken the document says so,
with the file and the import, at the severity you chose - so `surface doctor` exits `2` and CI fails:

```console
$ surface doctor

  warn             CONSTRAINT_VIOLATED [constraint:no-provider-in-handlers]
      Constraint "Never call the payment provider from a request handler." is violated in 1 place(s): src/checkout/create.ts (imports src/payments/provider.ts).
      Handlers must stay idempotent; provider calls go through the job queue. Fix the listed files, or change the check in .project/surface.declare.yaml.
```

Three kinds exist today - `forbid-import`, `forbid-file`, `require-test` - and a check that no adapter can
evaluate is reported as `unchecked`, never as passed. See [docs/declarations.md](docs/declarations.md).

---

## This repository, described by itself

The claim above is cheap to make and easy to fake, so the repository is its own first user. `.project/surface.json`
is committed, regenerated in CI, proven with `surface verify`, and gated with `surface doctor --strict`. A claim
this project makes about itself cannot go stale without the build going red.

```console
$ surface map

  CAPABILITY                  OWNER                                         CONTRACT              EVIDENCE                                 TIER      CONFIDENCE   FRESHNESS
  adapter.sdk                 packages/adapter-sdk/src/builders.ts          docs/adapters.md      test/conformance.test.js                 declared  1.00 high    fresh
  analysis.health             packages/core/src/analysis/health.ts          spec/v1/SPEC.md       test/cli.test.js                         declared  1.00 high    fresh
  cli.verify                  packages/cli/src/commands/verify.ts           docs/cli.md           test/cli.test.js                         declared  1.00 high    fresh
  commands.run                packages/cli/src/commands/context.ts          -                     -                                        inferred  0.65 medium  unverified
  evidence.runner             packages/core/src/evidence/runner.ts          docs/cli.md           packages/core/test/safety.test.js        declared  1.00 high    fresh
  mcp.verify-tool             packages/mcp-server/src/tools/verify.ts       docs/mcp.md           test/mcp.test.js                         declared  1.00 high    fresh
  safety.redaction            packages/core/src/redact.ts                   docs/trust-model.md   packages/core/test/redact.test.js        declared  1.00 high    fresh
  trust.freshness             packages/core/src/model/freshness.ts          docs/trust-model.md   packages/core/test/freshness.test.js     declared  1.00 high    fresh
  ...

  36 capabilities - 35 fresh, 0 stale, 1 without evidence, 1 without a contract
```

Three things are worth noticing.

- **Declared sets the granularity, evidence does the proving.** Inference saw 152 exported symbols. A maintainer
  declared 35 capabilities - one per thing a person would actually name - each with a contract and the test
  suite that proves it ([`.project/surface.declare.yaml`](.project/surface.declare.yaml)). The guesses were
  not discarded: 151 of them were folded into the declaration that owns their file, as corroboration and as
  an alias.
- **`fresh` is earned, not asserted.** It means the linked tests were executed and passed, and the owner files
  have the same fingerprint now as they had then. Edit `redact.ts` and `safety.redaction` reads `stale` until
  `surface verify` runs again.
- **The leftover is honest.** `commands.run` is the `run` export every CLI command file shares. No declaration
  covers all eleven files, so it stays `inferred` - visibly, at 0.65, with no contract - rather than being hidden.
- **The rules are checked, not recited.** Four of the repository's constraints carry a `check`, evaluated on
  every scan: no package other than `evidence/runner.ts` and `git/git.ts` imports `node:child_process`; core and
  the adapters import nothing that speaks HTTP; no `.env` or private key is committed; every capability in core
  has linked evidence. The last one caught a module without a test on the day it was added.

---

## Commands

| Command | What it does |
|---|---|
| `surface init` | Detect the stack and write `.project/surface.json` |
| `surface inspect [capability]` | What the project does, and what proves it |
| `surface why <id>` | How a confidence score was derived, step by step, recomputed from the document |
| `surface agents [--write file]` | Agent instructions generated from evidence, with provenance per line and a staleness fingerprint |
| `surface map` | Ownership table: owner, contract, evidence, confidence |
| `surface verify` | Run project commands and record the result as evidence |
| `surface impact <paths>` | What a change affects, and what to run |
| `surface context "<task>"` | Token-bounded context pack, with a reason per file |
| `surface diff --since <ref>` | What changed about the project surface |
| `surface doctor` | Drift, stale claims, unproven behaviour |
| `surface report` | Self-contained HTML report |
| `surface mcp` | Serve the surface to agents over MCP |

Every command supports `--json`. Exit code `2` means a check failed - error-level findings, or any warning
under `doctor --strict` - so CI can gate on it. Full reference: [docs/cli.md](docs/cli.md).

---

## Language support

| Stack | Depth |
|---|---|
| TypeScript / JavaScript | Full. Compiler-API parse: package manifests, scripts, workspaces, exports, routes (Express, Fastify, Hono, Next.js App Router), env usage, and **import-graph test linking**. |
| Python | Full. `pyproject.toml`, entry points, pytest config, public symbols, FastAPI/Flask route decorators, env usage, import-based test linking. |
| Go | Structural. `go.mod`, packages, exported declarations, router registrations, env usage. Line-based rather than AST-based, and it marks the stack unavailable when the Go toolchain is absent. |

Evidence linking is where this differs from a filename heuristic. If a test **imports** the implementation, that is a fact recorded in the source and is reported as `import-graph`. If two files merely have similar names, that is a guess and is reported as `path-proximity`.

---

## Trust and safety

- **Local-first and read-only by default.** Core makes zero network calls and never writes to your source files.
- **Only one code path runs a project command** - `evidence/runner.ts` - and it will only run a command that already exists in the surface document, from a working directory physically inside the project. The only other spawn site is `git/git.ts`, which invokes a fixed `git` binary with an argument array (no shell) for read-only queries, and refuses refs that look like options.
- **Symlinks are never followed.** A repository can commit a link to `~/.ssh/id_rsa`; the file reader refuses anything whose real path leaves the project root.
- **Adapters refuse to build command lines from suspicious names.** A `package.json` script key containing shell metacharacters is skipped rather than turned into a `run` string.
- **`surface_verify` over MCP is gated twice**: the operator must set `PROJECT_SURFACE_ALLOW_EXEC=1`, *and* the command must already be in the document. There is no parameter through which a caller can supply a shell string, only an id to look up. The worst an adversarial prompt can achieve is running a command the project already declares.
- **Secrets never enter the document by design; captured output is best-effort.** Environment variable *names* are surfaced; values are never read. All captured command output passes through one redaction funnel (key assignments, bearer headers, connection strings, well-known token prefixes, private-key blocks) before it is stored - a pattern blocklist, so treat it as defense in depth, not a guarantee, and keep secrets out of test output.
- **No absolute paths.** The conformance suite fails any adapter that leaks a machine path, and any absolute path in captured output is replaced before storage.

---

## Writing an adapter

Implement three things, and pass the conformance suite:

```ts
export const myAdapter: Adapter = {
  id: "elixir",
  version: "0.1.0",
  detect(ctx) { return ctx.exists("mix.exs"); },
  extract(ctx) { return { stack, commands, capabilities, evidence }; },
};
```

Adapters get read-only file access and **no exec capability** - they *propose* that `mix test` is the test command; only core may ever run it.

The conformance suite enforces what every consumer relies on: every claim has a source, every path is project-relative, statically discovered evidence is never reported as `passed`, and **two runs over the same project produce byte-identical output**. That last one is checked mechanically, because it is the property contributors break most often.

It runs as a command too, so an adapter does not have to live in this repository to be checked:

```
npx -p @project-surface/adapter-sdk surface-conform ./dist/index.js ./fixtures/elixir-app
```

What conforming means for a document, a generator in any language, a consumer, or an adapter is written down in [spec/v1/CONFORMANCE.md](spec/v1/CONFORMANCE.md), independently of this implementation.

---

## What this is not

Not a multi-agent swarm, a hosted vector database, a chat UI, or an automatic code modifier. It does not require an account. It will not tell you it is AGI for your repository.

It is a small, fast, inspectable artifact that is honest about what it does not know.

---

## Repository layout

```
spec/v1/          The normative format: SPEC.md, surface.schema.json, validated examples
packages/
  core/           Schema, trust model, pipeline, analyses; the only module that runs a command
  adapter-sdk/    Adapter contract and the conformance suite
  adapters/       typescript/, python/, go/
  cli/            The `surface` command (published as `project-surface`)
  mcp-server/     The MCP server behind `surface mcp`
fixtures/         Three small real projects with golden snapshots
test/             Integration suites: CLI, MCP over stdio, conformance, fixtures, spec examples
docs/             Concepts, trust model, CLI, MCP, declarations, adapters
integrations/     Claude Code plugin and GitHub Action
examples/         A full declaration file and an MCP client config
.project/         This repository's own surface: the declarations, and the generated document CI verifies
```

Development: `npm install && npm run build && npm test`. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Documentation

- [docs/concepts.md](docs/concepts.md) - what a surface is and why
- [docs/trust-model.md](docs/trust-model.md) - what a confidence number means
- [docs/cli.md](docs/cli.md) · [docs/mcp.md](docs/mcp.md) · [docs/declarations.md](docs/declarations.md) · [docs/adapters.md](docs/adapters.md)
- [spec/v1/SPEC.md](spec/v1/SPEC.md) - the normative format, with [validated examples](spec/v1/examples/)
- [spec/v1/CONFORMANCE.md](spec/v1/CONFORMANCE.md) - what a document, generator, consumer or adapter must satisfy · [spec/VERSIONING.md](spec/VERSIONING.md) - what may change within `v1`
- [examples/](examples/README.md) - a full declaration file and an MCP client config

## Status

`0.1.0`. The schema is versioned as `project-surface/v1` and published at a stable, versioned URL -
[`https://richie11747.github.io/project-surface/spec/v1/surface.schema.json`](https://richie11747.github.io/project-surface/spec/v1/surface.schema.json)
is its `$id`. A generator in any language can target it; [spec/v1/CONFORMANCE.md](spec/v1/CONFORMANCE.md)
says what that takes.

The comparative benchmark - 50 golden questions with mechanically checkable answers, asked with and without
a surface - is **built and reproducible** ([docs/benchmark.md](docs/benchmark.md)): recordings are committed
with model, commit, token usage and prompt hash, and the scorer runs offline in CI. Its current state is in
[bench/RESULTS.md](bench/RESULTS.md); if that file says *not recorded*, no number is claimed. Shipping
unmeasured numbers would violate the premise of the project.

"Works on real repositories" is measured the same way: a weekly [corpus run](bench/corpus/RESULTS.md) scans
twelve pinned public projects (hono, fastify, express, zod, got, fastapi, flask, httpx, requests, gin, chi,
cobra) and commits the table - capabilities found, how much is inference, health findings, time, crashes.

## License

Apache-2.0. See [LICENSE](LICENSE).
