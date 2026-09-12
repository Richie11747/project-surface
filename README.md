# project-surface

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

`0.1.0` is not on npm yet. Until it is, run it from a checkout:

```console
git clone https://github.com/richardadamik/project-surface
cd project-surface
npm install && npm run build
node packages/cli/dist/index.js --help       # or: npm run surface -- --help
```

Once published, every `npx project-surface …` line below works as written. Node 20.10 or newer, no
native modules, no other runtime.

## Sixty seconds

```console
$ npx project-surface init

Wrote .project/surface.json

  project      checkout-api
  stacks       typescript
  packages     1
  commands     3
  capabilities 7
  constraints  2
  evidence     2
  risks        1

  health 0 error, 3 warning, 8 info  - run surface doctor
```

Now ask it about one behaviour:

```console
$ surface inspect checkout.create

checkout.create
  POST /checkout
  HTTP endpoint registered in src/checkout/create.ts.

  Implemented by
    src/checkout/create.ts export:createCheckout
    src/checkout/create.ts L63

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

Eight tools are exposed: `surface_overview`, `surface_find_capability`, `surface_constraints`, `surface_health`, `surface_impact`, `surface_context`, `surface_diff`, and `surface_verify`.

Seven of them are strictly read-only. See [Trust and safety](#trust-and-safety) for the eighth, and
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
```

---

## Commands

| Command | What it does |
|---|---|
| `surface init` | Detect the stack and write `.project/surface.json` |
| `surface inspect [capability]` | What the project does, and what proves it |
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
- **Only one code path executes anything** - `evidence/runner.ts` - and it will only run a command that already exists in the surface document.
- **`surface_verify` over MCP is gated twice**: the operator must set `PROJECT_SURFACE_ALLOW_EXEC=1`, *and* the command must already be in the document. There is no parameter through which a caller can supply a shell string, only an id to look up. The worst an adversarial prompt can achieve is running a command the project already declares.
- **Secrets never enter the document.** Environment variable *names* are surfaced; values are never read. All captured output passes through one redaction funnel before it is stored.
- **No absolute paths.** The conformance suite fails any adapter that leaks a machine path.

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

---

## What this is not

Not a multi-agent swarm, a hosted vector database, a chat UI, or an automatic code modifier. It does not require an account. It will not tell you it is AGI for your repository.

It is a small, fast, inspectable artifact that is honest about what it does not know.

---

## Documentation

- [docs/concepts.md](docs/concepts.md) - what a surface is and why
- [docs/trust-model.md](docs/trust-model.md) - what a confidence number means
- [docs/cli.md](docs/cli.md) · [docs/mcp.md](docs/mcp.md) · [docs/declarations.md](docs/declarations.md) · [docs/adapters.md](docs/adapters.md)
- [spec/v1/SPEC.md](spec/v1/SPEC.md) - the normative format, with [validated examples](spec/v1/examples/)
- [examples/](examples/README.md) - a full declaration file and an MCP client config

## Status

`0.1.0`. The schema is versioned as `project-surface/v1`.

The comparative benchmark (50 golden questions, agent with and without a surface) is **not yet run**, and is deliberately not claimed. Shipping unmeasured numbers would violate the premise of the project. What ships instead is a fixture snapshot suite that runs in CI.

## License

Apache-2.0. See [LICENSE](LICENSE).
