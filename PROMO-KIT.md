# Promo kit — project-surface

*This file covers project-surface only. Sparke is a separate product with its own kit: `SPARKE-LAUNCH-KIT.md` in the SYBEI folder.*

Companion to `POSTS-DRAFT.md`. Both files are drafts, not part of the project — delete when done.

> **Verify before posting.** Reddit blocks automated rule-fetching, so the stances below are from
> experience, not a live read of each sidebar. Open the sub, read rule 1 and the pinned mod post, and
> check whether a required flair exists. A removed post costs you nothing; a ban costs you the sub.

---

# Part 1 — Repo descriptions

## project-surface — GitHub "About" field

Pick one. GitHub truncates around 350 characters; all three fit well under.

**A. Plain (recommended for GitHub):**
> A committed, tool-readable model of your repository — capabilities, commands, rules and evidence, where every claim carries its provenance, confidence and freshness. Feeds agents and CI over MCP. Local-first, no account.

**B. Sharper hook:**
> Stop letting every AI tool re-derive your repo from scratch. `npx project-surface init` writes one committed document — what the project does, what proves it, what must not break — with an inferred fact labelled inferred and a stale fact labelled stale.

**C. Shortest:**
> The missing semantic layer for AI-readable software projects. One committed artifact, provenance on every claim, machine-checked rules, MCP server. Local-first, Apache-2.0.

**GitHub topics** (add all — this is free discovery):
`ai` `mcp` `model-context-protocol` `claude` `developer-tools` `static-analysis` `code-intelligence`
`llm` `ai-agents` `typescript` `cli` `repository-analysis` `claude-code` `agents` `codegen`

Also set: website → the schema URL or docs page, and check "Releases" + "Packages" are shown in the sidebar.

---

# Part 2 — Where to post what

## Tier A — built for this. Self-promotion is the point.

| Sub | Stance | What to post | Use |
|---|---|---|---|
| **r/SideProject** | Self-promo welcome | Short, personal, "I built this, here's why" | New draft A1 |
| **r/coolgithubprojects** | Purpose-built for repo links | Link post + language flair (required) | Draft A2 |
| **r/opensource** | Own OSS allowed, no hard selling | Governance/spec/licence angle, ask for contributors | Draft A3 |
| **r/devtools** | Promo-friendly, small but on-target | Straight tool pitch | Draft A4 |
| **r/AI_Agents** | Promo allowed, often a weekly thread | MCP + agent-context angle — reuse the r/ClaudeAI draft | `POSTS-DRAFT.md` §2 |
| **r/indiehackers** / **r/SaaS** | Promo-friendly | Only if you monetise. Skip for an Apache-2.0 CLI | — |

## Tier B — topical. Promo tolerated when the content stands on its own.

| Sub | Stance | Use |
|---|---|---|
| **r/ClaudeAI** | Project shares fine, marketing tone punished | `POSTS-DRAFT.md` §2 |
| **r/LocalLLaMA** | Shares welcome, hype heavily punished | `POSTS-DRAFT.md` §3 |
| **r/ChatGPTCoding** | Tool shares common | Adapt §2, drop Claude-specific framing |
| **r/cursor** | Tolerant, keep it useful | Adapt §2 around Cursor rules |
| **r/mcp** | Directly on-topic | Adapt §2, lead with the nine tools |

## Tier C — strict. The post must be worth reading with the link removed.

| Sub | Stance | Use |
|---|---|---|
| **r/programming** | Blog-post-quality only. Link to a *write-up*, not the repo | Write the trust-model essay first |
| **r/ExperiencedDevs** | No promo. Only as a comment when relevant | — |
| **r/rust** | "Show r/rust" is fine, Rust content must be real | Draft A5 — the Rust adapter, honestly labelled structural |
| **r/Python** | Showcase flair / monthly thread — check the sidebar | Adapt A5 for the Python adapter |
| **r/javascript**, **r/webdev** | Showoff Saturday threads only | Reuse A1 |

## Tier D — not Reddit, higher ceiling

- **Hacker News** — `Show HN`. Draft A6. Post Tue–Thu, 08:00–10:00 ET. One shot; don't ask for upvotes.
- **Lobste.rs** — needs an invite, but the audience is exactly right for a spec + trust model.
- **X / Bluesky** — draft A7 thread.
- **dev.to / Hashnode** — long-form version of the trust model; becomes the r/programming link.
- **Product Hunt** — only if you ever ship a hosted product. Not for a CLI.

## Sequencing — do not blast everything in one day

Cross-posting the same text to ten subs in an hour is the single fastest way to get filtered as spam.

1. **Day 1** — r/SideProject + r/coolgithubprojects. Low risk, gets the first stars and the first bug reports.
2. **Day 2–3** — fix whatever day 1 exposed, then r/ClaudeAI + r/mcp.
3. **Day 5** — r/LocalLLaMA (needs the day-1 feedback baked in; this crowd tests claims).
4. **Week 2** — Show HN, once the README survives contact with strangers.
5. **Week 2–3** — r/rust, r/Python, r/opensource, r/devtools.
6. **Anytime** — GitHub Discussions announcement, as the permanent home thread everything links to.

Reply to every comment in the first three hours. That, not the post, is what decides the thread.

---

# Part 3 — More posts for project-surface

## A1 — r/SideProject

**Title:** `I spent months building a tool that tells AI agents what my repo actually does — and labels every guess as a guess`

Every AI coding tool re-derives the same facts about your repository on every single task. What does this project do? Which command runs it? Which files own this behaviour? Which tests prove it?

That work is expensive, invisible, and impossible to check. Every tool does it privately, and differently.

So I built **project-surface**. One command:

```
npx project-surface init
```

and you get `.project/surface.json` — a committed document describing what your project does, what proves it, and what must not break. Your agent, your CI and you all read the same thing instead of guessing separately.

The part I actually care about: **every claim says how it was learned.** A fact read from a real parse tree is `derived`. A guess from a filename is `inferred`, and it says so, at 0.40 confidence. A claim proven by running the tests is `verified` — and the moment you edit the implementation, it goes `stale` and *stays* stale until something re-proves it.

That last bit is the whole product. A claim that was proven, and then stopped being proven, says so. Your `CLAUDE.md` can't do that; it just quietly ages until it's lying to your agent.

Also: rules you can actually enforce. "Never import the payment provider from a request handler" stops being prose an agent may ignore and becomes a check that fails CI.

Local-first, no account, no network, Apache-2.0, Node 20.10+. TypeScript/JS and Python fully supported, Go and Rust structurally, everything else gets a fallback rather than an empty file.

Honest status: I built a 50-question benchmark to measure whether this actually improves agent answers — and I haven't recorded it yet, so I'm claiming nothing about output quality until I do.

Would love for someone to run it on a repo I've never seen and tell me what it got wrong.

[github.com/Richie11747/project-surface](https://github.com/Richie11747/project-surface)

---

## A2 — r/coolgithubprojects

Link post to the repo. Language flair: **TypeScript** (required — the bot removes unflaired posts).

**Title:** `project-surface — a committed, provenance-carrying model of your repo that AI agents read over MCP instead of grepping`

First comment (post it yourself, immediately):

> Author here. The idea: instead of every AI tool re-deriving what your repository does, derive it once, commit it, and let everything read the same document.
>
> Every claim carries a tier — `declared` / `verified` / `derived` / `inferred` — and confidence is computed from how the fact was learned, never authored. Verified claims are anchored to a fingerprint of their owner files, so editing the code marks the claim stale and it stays stale until re-verified.
>
> `npx project-surface init`, Node 20.10+, Apache-2.0, zero network calls. Happy to answer anything.

---

## A3 — r/opensource

**Title:** `I wrote a spec, a conformance suite and a reference implementation for "what does this repository do" — looking for a second implementation`

Most tooling that describes a repository to an AI produces something private and unversioned: an index, a repo-map, a packed file. I wanted the opposite — a **format**, so more than one tool can produce and consume it.

So `project-surface` ships three separable things:

1. **A spec.** `project-surface/v1`, a JSON schema published at a stable versioned `$id`, plus `CONFORMANCE.md` — what a document, a generator in any language, a consumer, or an adapter must satisfy — and `VERSIONING.md` for what may change within v1.
2. **A conformance suite** that runs as a standalone command, so an adapter doesn't have to live in my repository to be checked. It enforces the properties consumers depend on: every claim has a source, every path is project-relative, statically discovered evidence is never reported as passed, and two runs over the same tree produce byte-identical output.
3. **A reference implementation** — a CLI and an MCP server, Apache-2.0.

What makes the document worth standardising is that every claim carries provenance: `declared` (a human said so), `verified` (a command ran and was observed), `derived` (real parse tree), `inferred` (heuristic guess). Confidence is computed from that, and verified claims go stale — and stay stale — when their owner files change.

**What I want from this sub:** the format has exactly one implementation, which means it is not yet a format. A generator in Go, Python or Rust targeting the same schema is the thing that would prove it. `CONFORMANCE.md` exists precisely so that can happen without me.

There are also eight good first issues in the roadmap, each with a fixture to test against and a pattern already in the tree.

[github.com/Richie11747/project-surface](https://github.com/Richie11747/project-surface)

---

## A4 — r/devtools

**Title:** `Your CLAUDE.md is lying to your agent and nothing tells you — so I made the factual half generated and fingerprinted`

Two failure modes I couldn't fix by writing the file better:

**It ages silently.** You write "the test command is `npm run test:unit`". Six months later it isn't. Nothing tells you — not the file, not the agent, not CI. The agent confidently follows a stale instruction and you eat the wasted turn.

**Its rules are hopes.** "Never call the payment provider from a request handler" is prose. The model may comply. Nothing checks.

`project-surface` scans the repo into one committed document where every claim carries provenance (`declared` / `verified` / `derived` / `inferred`) and computed confidence, then:

- `surface agents --write CLAUDE.md` generates the factual half from evidence — commands actually run, rules and whether each is machine-checked, owners and what proves them — with a citation per line. The block sits between fingerprinted markers, your hand-written text is preserved, and `surface doctor` flags it stale the moment the surface changes underneath it.
- Constraints with a `check` (`forbid-import`, `forbid-file`, `require-test`) are evaluated on every scan. A violation exits `2`, so CI fails. The rule stops depending on the model's mood.
- An MCP server exposes nine tools; eight are strictly read-only, and the ninth needs an operator-set env var *and* a command already present in the document. No parameter accepts a shell string.

`npx project-surface init`. Node 20.10+, Apache-2.0, no account, zero network calls.

Not claiming it makes agents smarter — I built the benchmark for that and haven't recorded it yet, and `bench/RESULTS.md` says so.

---

## A5 — r/rust (adapt for r/Python)

**Title:** `Show r/rust: a tool that extracts a structural model of a Cargo workspace for AI agents — and is explicit that a line scan is a guess`

I've been building a tool that writes a committed, machine-readable model of a repository so AI agents stop re-deriving it every session. The Rust adapter shipped in 0.2.0 and I'd like this sub to tell me where it's wrong.

**What it reads:** `Cargo.toml` — workspace members, binaries, `rust-version` — plus public items, axum / actix-web / rocket route attributes, and env usage. Integration tests under `tests/` are linked to the implementation through their `use` lines; inline `#[cfg(test)]` modules link to their own file.

**What it refuses to pretend:** it's a line scan, not an AST parse. So every capability it finds is labelled `inferred` at 0.40 confidence rather than presented as fact, `use`-line linking is reported as `import-graph` while filename similarity is reported as `path-proximity`, and without `cargo` on the machine the stack is marked unavailable instead of silently producing less. The whole project is built on the idea that a guess must be visibly a guess.

You can override any of it once in a declaration file and every consumer respects it.

It runs weekly over pinned public repos including axum and ripgrep, and commits what it extracted and how much was inference.

Known gaps I already want to fix: workspace-level `[[bin]]` in member crates, `#[tokio::test]` in `tests/`, and fully-qualified `#[rocket::get]` / `#[actix_web::get]` attribute forms. A real AST adapter via `syn` is the obvious right answer and I'd take that PR happily.

[github.com/Richie11747/project-surface](https://github.com/Richie11747/project-surface)

---

## A6 — Show HN

**Title:** `Show HN: Project-surface – a committed model of your repo where every claim carries provenance`

(HN titles: no emoji, no exclamation, under ~80 chars.)

**Text:**

Every AI coding tool re-derives the same facts about a repository on every task — what it does, which command runs it, which files own a behaviour, which tests prove it. That derivation is expensive, non-reproducible, invisible, and impossible to check. Every tool does it privately and differently.

project-surface derives it once into `.project/surface.json`, which you commit. The differentiator is not intelligence, it's honesty: every claim carries a provenance tier — `declared` (a human asserted it), `verified` (a command was executed and observed), `derived` (real parse tree or structured config), `inferred` (heuristic guess) — and confidence is computed by the core from what the adapter reports, never authored.

Two consequences I think are the interesting part:

Passing evidence promotes a claim by exactly one tier. A green test on an `inferred` capability makes it `derived`, not `verified` — the test proves the code behaves, not that the thing I guessed was a capability really is one.

Freshness is anchored to a fingerprint of the owner files at verification time. Edit the implementation and the claim goes stale, and it stays stale across rescans, because the anchor doesn't move until something re-proves it. A claim that was proven and then stopped being proven says so.

The repository is its own first user: its surface is committed, regenerated in CI, and gated on `surface doctor --strict`, so a claim it makes about itself can't go stale without the build going red.

Deliberately not claimed: I built a 50-question benchmark (recorded with model, commit, token usage and prompt hash; scored offline in CI) and have not recorded it. `bench/RESULTS.md` says "not recorded", and until it doesn't, I claim no improvement in agent output quality. Shipping an unmeasured number would contradict the premise.

`npx project-surface init`, Node 20.10+, Apache-2.0, zero network calls, nothing leaves the machine.

---

## A7 — X / Bluesky thread

**1/**
Every AI coding tool re-derives the same facts about your repo on every task.

What does it do. Which command runs it. Which files own this. Which tests prove it.

Expensive, invisible, unverifiable — and every tool does it privately, differently.

So I derived it once and committed it. 🧵

**2/**
`npx project-surface init`

One file: `.project/surface.json`. Capabilities, commands, contracts, constraints, evidence, risks.

Your agent, your CI and you read the same document instead of guessing separately.

**3/**
The part that's actually new isn't "AI reads your code". That exists.

It's that every claim says *how it was learned*:

declared 1.00 — a human said so
verified 0.95 — a command ran and was observed
derived 0.70 — a real parse tree
inferred 0.40 — a guess from a filename

**4/**
Confidence is computed, never authored.

A passing test promotes a claim by exactly ONE tier. A green test on an inferred capability makes it derived, not verified — the test proves the code behaves, not that my guess about what it *is* was right.

**5/**
And freshness is fingerprint-anchored.

Verify a claim, then edit the implementation → the claim goes stale.

Rescan → it's STILL stale. The anchor doesn't move until something actually re-proves it.

A claim that was proven and then stopped being proven says so.

**6/**
Your CLAUDE.md can't do that. It just quietly ages until it's lying to your agent.

So: `surface agents --write CLAUDE.md` generates the factual half from evidence, one citation per line, between fingerprinted markers. Your prose is preserved. Staleness is reported.

**7/**
Rules become checks, not hopes.

"Never import the payment provider from a request handler" → a `forbid-import` constraint, evaluated every scan, reported with the offending file and import, exit code 2, CI fails.

Prose an agent may ignore → a gate it cannot.

**8/**
What I'm NOT claiming:

I built a 50-question benchmark to measure whether this improves agent answers. I haven't recorded it. bench/RESULTS.md literally says "not recorded".

So I claim nothing about output quality. Shipping an unmeasured number would break the whole premise.

**9/**
Local-first. Zero network calls. No account. Nothing leaves your machine. Apache-2.0.

TS/JS + Python full, Go + Rust structural, everything else gets a fallback instead of an empty file.

github.com/Richie11747/project-surface

---

## A8 — organic comment drop (use sparingly, only where genuinely relevant)

> Ran into exactly this. The thing that finally helped was keeping the factual half of my agent instructions *generated* rather than hand-written — commands, owners, which tests prove what — with a fingerprint so it's flagged stale when the code moves underneath it. I ended up building it (project-surface, Apache-2.0) because I couldn't find it, but the general idea works even if you script it yourself: derive the facts once, commit them, and label anything you guessed as a guess.

Rule: never drop this in a thread you didn't already want to reply to.

---
