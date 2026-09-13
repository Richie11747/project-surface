# Post drafts — project-surface 0.2.0

Three versions: GitHub Discussions (announcement), r/ClaudeAI, r/LocalLLaMA.
This file is not part of the project — delete it once the posts are up.

---

## 1. GitHub Discussions — Announcements

**Title:** `project-surface 0.2.0 — a committed model of your repository, where every claim carries its provenance`

---

Every AI coding tool re-derives the same facts about your repository on every task. What does this project do? Which command actually runs it? Which files own this behaviour? What must not be violated? Which tests prove it works?

That derivation is expensive, non-reproducible, invisible to you, and impossible to check. Every tool does it privately, and differently.

`project-surface` materializes that model into one small, stable, tool-readable artifact — `.project/surface.json` — that you commit. Claude Code, Cursor, your IDE, your CI and you all read the same document instead of guessing separately.

```console
npx project-surface init
```

Node 20.10+. No native modules, no account, no network — core makes zero network calls and never writes to your source files.

### The part that is actually new

"AI reads your code" already exists. What did not exist is **every claim carrying an owner, a contract, evidence, freshness, confidence and a provenance tier** — where an inferred fact is *labelled* inferred, and a stale fact is *labelled* stale.

| Tier | Meaning | Confidence floor |
|---|---|---|
| `declared` | A human asserted it in `.project/surface.declare.yaml` | 1.00 |
| `verified` | A command was executed and its result observed | 0.95 |
| `derived` | Read from structured config or a real parse tree | 0.70 |
| `inferred` | Heuristic guess from naming or layout | 0.40 |

Confidence is **computed, never authored**. An adapter reports *how* it learned something; core turns that into a number:

- Independent corroborating sources raise the score within the tier band.
- Passing evidence promotes a claim by **exactly one tier**. A green test on an `inferred` capability makes it `derived`, not `verified` — the test proves the code behaves, not that the thing we guessed was a capability really is one.
- A stale `verified` claim is demoted to `derived`. Execution proves what the code did at a point in time; once the owner files change, that proof no longer describes the current code.
- `declared` never decays. A human owns the statement, so a stale declaration is a health finding rather than a quiet discount.

Freshness is fingerprint-based, not a TTL. Each claim stores a hash of its owner files *as of verification*. Change a file and the claim goes stale; rescan and it **stays** stale, because the anchor does not move until something re-proves it.

### Rules that are checked, not recited

A `CLAUDE.md` says *do not*; an agent may comply. A constraint with a `check` is evaluated on every scan:

```yaml
constraints:
  - rule: Never call the payment provider from a request handler.
    severity: error
    check:
      kind: forbid-import
      from: [src/checkout/**]
      to: [src/payments/**, stripe, "@stripe/*"]
```

Three kinds exist today — `forbid-import`, `forbid-file`, `require-test`. A violation is reported with the file and the import, at the severity you chose, and `surface doctor` exits `2` so CI fails. A check no adapter can evaluate is reported as `unchecked`, never as passed.

### The repository is its own first user

That claim is cheap to make and easy to fake, so: `.project/surface.json` is committed, regenerated in CI, proven with `surface verify`, and gated with `surface doctor --strict`. A claim this project makes about itself cannot go stale without the build going red.

Inference saw 152 exported symbols. A maintainer declared 35 capabilities — one per thing a person would actually name — each with a contract and the test suite that proves it. The guesses were not discarded: 151 were folded into the declaration that owns their file, as corroboration and as an alias. The one leftover, `commands.run`, stays visibly `inferred` at 0.65 with no contract, rather than being hidden.

### What 0.2.0 adds

- **Rust adapter** and a **generic fallback**, so no project comes back empty. An unrecognised project gets `NO_CAPABILITIES` and a pointer to declarations, never a silent empty document.
- **Machine-checked constraints** (above).
- **`surface why <id>`** — the full derivation behind a confidence number, recomputed from the document and compared against the recorded score.
- **`surface agents [--write CLAUDE.md|AGENTS.md]`** — agent instructions generated from evidence, with provenance per line and inferred guesses left out. The block sits between fingerprinted markers, hand-written text outside them is preserved, and `surface doctor` reports `AGENTS_MD_STALE` the moment the surface changes underneath it. This repository's own `CLAUDE.md` is generated this way and checked in CI.
- **MCP server** — nine tools, eight of them strictly read-only. `surface_verify` is gated twice: the operator must set `PROJECT_SURFACE_ALLOW_EXEC=1`, *and* the command must already exist in the document. There is no parameter through which a caller can supply a shell string.
- **The spec as a standard** — `project-surface/v1` published at a stable, versioned `$id`, with `CONFORMANCE.md` (what a document, a generator in any language, a consumer or an adapter must satisfy) and `VERSIONING.md`.
- **GitHub Action** that posts the semantic diff to the pull request.
- **Release pipeline** with SBOM and a reviewer-gated npm publish.

### What is deliberately not claimed

- **The benchmark is built, not recorded.** 50 golden questions with mechanically checkable answers, asked with and without a surface, recorded with model / commit / token usage / prompt hash, scored offline in CI. `bench/RESULTS.md` currently says *not recorded* — so **no claim is made about better agent output**. Shipping an unmeasured number would violate the premise of the project. Recording it is the top item on the roadmap.
- No semantic or embedding search. A surface is a model of the project, not an index of it.
- No cross-repository view. One document per repository.
- No code modification. Only the evidence runner executes, and only commands already in the document.
- Go and Rust are structural (line-based), not AST-based, and their inferred claims are labelled inferred.

`docs/comparison.md` has a section called *Where project-surface loses*, comparing it honestly against CLAUDE.md, Cursor rules, repomix, aider's repo-map, Cody and Continue — including where each of them is better.

### Where feedback helps most

1. **Run `npx project-surface init` on a repository I have never seen** and tell me what it got wrong — especially a stack that lands on the generic fallback.
2. **Is the trust model the right shape?** Single-step promotion and non-self-healing staleness are the two decisions I am least sure survive contact with real repositories.
3. **Adapters.** The contract is three functions plus a conformance suite that runs as a standalone command, so an adapter does not have to live in this repository.

There are eight **good first issues** in `ROADMAP.md`, each self-contained, each with a fixture to test against and a pattern already in the tree.

Apache-2.0. Thanks for reading.

---

## 2. r/ClaudeAI

**Title:** `My CLAUDE.md kept quietly going out of date, so I made the factual half generated and machine-checked`

**Flair:** Built with Claude / Productivity (whichever the sub offers)

---

A hand-written `CLAUDE.md` has two problems I could not solve by writing it better.

**It ages silently.** I wrote "the test command is `npm run test:unit`" months ago. It stopped being true. Nothing told me — not the file, not Claude, not CI. Claude confidently followed a stale instruction, and the only signal was the wasted turn.

**Its rules are hopes.** "Never call the payment provider from a request handler" is prose. The agent may comply. Nothing checks.

So I built [project-surface](https://github.com/Richie11747/project-surface): a CLI that scans a repository and writes one committed artifact, `.project/surface.json` — capabilities, commands, contracts, constraints, evidence, risks — where **every single claim carries how it was learned**:

- `declared` — a human wrote it down (confidence 1.00)
- `verified` — a command was actually executed and its result observed (0.95)
- `derived` — read from a real parse tree or structured config (0.70)
- `inferred` — a heuristic guess from naming or layout (0.40)

Confidence is computed, never authored. And freshness is anchored to a fingerprint of the owner files at the moment of verification — so when you edit the implementation, the claim goes `stale`, and **it stays stale across rescans** until something actually re-proves it. That last property is the whole point: a claim that was proven and then stopped being proven says so, instead of silently ageing.

### What that gives Claude specifically

**An MCP server.**

```console
claude mcp add project-surface -- npx -y project-surface mcp
```

Then, in a fresh session with no prior context:

> Where is checkout implemented, what tests prove it, and what changes if I add a status field?

Claude answers from structured data — owners, contract, linked tests, active constraints, a bounded impact map — instead of grepping and guessing. Nine tools (`surface_overview`, `surface_find_capability`, `surface_why`, `surface_constraints`, `surface_health`, `surface_impact`, `surface_context`, `surface_diff`, `surface_verify`). Eight are strictly read-only; `surface_verify` is gated twice — you must set `PROJECT_SURFACE_ALLOW_EXEC=1`, *and* the command has to already be in the document. There is no parameter through which a prompt can supply a shell string, only an id to look up. The worst an adversarial prompt achieves is running a command your project already declares.

**A generated CLAUDE.md.**

```console
surface agents --write CLAUDE.md
```

renders the surface as agent instructions — the commands that were actually run, the rules and whether each is machine-checked, where things live and what proves it — with provenance on every line and inferred guesses left out. The block sits between fingerprinted markers, your hand-written text outside them is preserved, and `surface doctor` reports it stale the moment the surface changes underneath it.

That is the division of labour I ended up with: **CLAUDE.md keeps the judgement** (style, what not to touch, how the team works) and **generates the facts**. The hand-written part gets to stay short, and the generated part cannot quietly rot.

**Rules the agent cannot ignore.** Declare a constraint with a `check` (`forbid-import`, `forbid-file`, `require-test`) and it is evaluated on every scan. A violation lands in `surface doctor` with the file and the import, and `doctor` exits `2`, so CI fails. The rule stops depending on whether the model felt like obeying it.

### What I am not claiming

I built a benchmark — 50 golden questions with mechanically checkable answers, asked with and without a surface, recordings committed with model / commit / token usage / prompt hash, scorer runs offline in CI — and **I have not recorded it yet**. `bench/RESULTS.md` says *not recorded*, and until it doesn't, I am claiming **no improvement in agent output quality**. Recording it is the single most important open item. Posting an unmeasured number would contradict the entire premise of the project.

What I *can* point at: the repository describes itself, and CI gates on its own `surface doctor --strict`. 35 declared capabilities, each with a contract and the tests that prove it. A weekly corpus run scans pinned public repos (hono, fastify, express, zod, got, fastapi, flask, httpx, requests, gin, chi, cobra, axum, ripgrep) and commits the table — capabilities found, how much of it is inference, health findings, time, crashes. Last committed run: 12 repos, no crashes.

TypeScript/JavaScript and Python are full (real parse trees, import-graph test linking). Go and Rust are structural — line-based, and their claims are labelled `inferred` because of it. Anything else gets a manifest-only fallback rather than an empty document.

`npx project-surface init`, Node 20.10+, Apache-2.0, no account, no network, nothing leaves your machine.

Two things I would genuinely like feedback on: **(1)** run it on a repo I have never seen and tell me what it got wrong, and **(2)** is single-step promotion the right call? A passing test on an `inferred` capability promotes it to `derived`, not `verified`, on the argument that the test proves the code behaves and not that my guess about what the capability *is* was correct. I keep going back and forth on whether that is principled or just pedantic.

---

## 3. r/LocalLLaMA

**Title:** `Instead of stuffing the repo into context, I commit a ~few-KB model of it — provenance per claim, runs fully offline, any MCP client`

---

Context is the scarcest thing I have when running a local model against a codebase. The usual answers are "pack the whole repo into one file" or "build an embedding index", and both felt wrong for the same reason: they hand the model *material* and hope it derives the right facts, every single time, from scratch.

So I built the other thing: [project-surface](https://github.com/Richie11747/project-surface) derives the facts **once**, commits them, and lets every tool read the same document.

`npx project-surface init` writes `.project/surface.json` — capabilities, commands, contracts, constraints, evidence, env vars, risks. Small, stable, diffable. **Zero network calls, no account, nothing leaves the machine** — which is presumably why you are here rather than on a hosted context product.

### The design decision that matters

Every claim carries a provenance tier: `declared` (a human wrote it, 1.00) / `verified` (a command was executed and observed, 0.95) / `derived` (real parse tree or structured config, 0.70) / `inferred` (heuristic guess from naming, 0.40). Confidence is **computed by core from what the adapter reports**, never authored.

Passing evidence promotes a claim by exactly one tier — a green test on an `inferred` capability makes it `derived`, not `verified`, because the test proves the code behaves, not that the thing I guessed was a capability really is one. And freshness is anchored to a fingerprint of the owner files at verification time: edit the implementation and the claim goes `stale`, and **stays** stale across rescans until something actually re-proves it.

Practical consequence for anyone feeding this to a model: a small model will happily assert whatever you put in its context. When the context itself says `inferred, 0.40, unverified`, the hallucination has a label on it before it reaches the model.

### For an agent loop

MCP server over stdio, nine tools — overview, find capability, why (the full derivation of a confidence score), constraints, health, impact, context, diff, verify. Any MCP client, not just Claude:

```console
surface mcp        # stdio, project root as cwd, or --root
```

Eight tools are strictly read-only. The ninth (`surface_verify`) can spawn a process, so it is gated twice: an env var the *operator* sets (`PROJECT_SURFACE_ALLOW_EXEC=1`) plus the constraint that the command must already exist in the document. There is no parameter through which a prompt can pass a shell string — only an id to look up. Relevant if you point a small, easily-jailbroken local model at your own source tree.

`surface context "<task>"` gives a **token-bounded** context pack with a reason per file, which is the bit that actually composes with a 8k–32k local context. It does not replace a packer like repomix — pack the files `surface context` selects.

Other properties that took real work: output is **byte-identical across two runs over the same tree**, mechanically checked in the conformance suite (it is the property contributors break most often); symlinks are never followed (a repo can commit a link to `~/.ssh/id_rsa`); env variable *names* are surfaced and values never read; captured command output goes through one redaction funnel before storage; no absolute paths ever enter the document.

### Coverage, honestly

TS/JS and Python full (compiler API / real parsing, import-graph test linking — if a test *imports* the implementation that is a fact, if two files merely have similar names that is a guess and is labelled `path-proximity`). Go and Rust structural, line-based, marked unavailable without their toolchain. Anything else: `Makefile` / `justfile` / `Taskfile` targets become commands, `.env.example` names become environment, and **no capability is guessed** — an unrecognised project gets `NO_CAPABILITIES` and a pointer to declarations rather than an empty document.

Weekly corpus run over pinned public repos (hono, fastify, express, zod, got, fastapi, flask, httpx, requests, gin, chi, cobra, axum, ripgrep) commits a table of what was extracted, how much was inference, and how long it took. Last committed run: 12 repos, no crashes. Several rows carry `LOW_CONFIDENCE_MAJORITY` — an undeclared repo is mostly inference, and the tool says so instead of pretending.

### What I have not measured

There is a benchmark — 50 golden questions, mechanically checkable answers, asked with and without a surface, recordings committed with model/commit/tokens/prompt hash, offline deterministic scorer in CI — and **it has not been recorded**. So I am claiming **nothing** about answer quality or token savings. `bench/RESULTS.md` says *not recorded* and that is the only place a number may ever come from.

The schema is `project-surface/v1`, published at a stable versioned URL with a conformance spec, so a generator in another language can target it. Nothing else consumes the format today — that is the honest status.

Node 20.10+, Apache-2.0, no native modules. Would particularly like to hear from anyone running this with a local model rather than a frontier one: `surface context` budgets were tuned by feel, not by measurement, and I suspect they are wrong for a 7B.
