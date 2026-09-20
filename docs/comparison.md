# How this compares

Every tool below is good at what it was built for, and several are better than project-surface at things
this project does not attempt. The table is about *what kind of thing each one produces*, not about which
is best. Claims about other tools link to their own documentation; if one is out of date, open an issue.

| | project-surface | [sigmap](https://github.com/manojmallick/sigmap) | [ripwire](https://github.com/redhat-et/ripwire) | [CLAUDE.md](https://docs.anthropic.com/en/docs/claude-code/memory) / [AGENTS.md](https://agents.md) | [Cursor rules](https://docs.cursor.com/context/rules) | [repomix](https://github.com/yamadashy/repomix) | [aider repo-map](https://aider.chat/docs/repomap.html) | [Cody context](https://sourcegraph.com/docs/cody/core-concepts/context) | [Continue](https://docs.continue.dev/customize/context-providers) |
|---|---|---|---|---|---|---|---|---|---|
| What it produces | A committed JSON document: capabilities, commands, rules, risks, evidence, each with provenance, confidence, freshness | A signature index and context files (`.context/`, generated CLAUDE.md, an Evidence Pack JSON of ranked files with line anchors) | A ranked, minified XML map of symbols for a query, streamed to stdout, plus quality panels | Hand-written instructions | Hand-written rules, scoped by glob | The repository packed into one LLM-friendly file | A ranked symbol map, rebuilt per chat | Search results and snippets from an index | Snippets from context providers (codebase index, docs, ...) |
| **Provenance per claim** | Yes - `declared` / `verified` / `derived` / `inferred`, with source file and locator | Line anchors per symbol; an extraction tier per language (AST / anchored regex / pattern) | Parse health per file, uncertain edges labelled, counts marked as floors | No - prose | No - prose | No - raw source | No - symbols, ranked | No | No |
| **Evidence linking** | Yes - test ↔ implementation via import graph; `path-proximity` is labelled as a guess | Test conventions extracted; tests to run implied | `--test-gate` names tests to run | No | No | No | Indirect - references count toward rank | No | No |
| **Proof bound to the commit under review** | Yes - `surface gate` judges every touched capability as proven at HEAD, carried, stale, unproven or failing, and CI recomputes the receipt | No - `review-pr` audits the diff for scope and missing tests | No - `--pr-context` and `--edit-check` describe the diff | No | No | No | No | No | No |
| **Evidence executed** | Yes - `surface verify` runs the test and records pass/fail, duration, output and the commit it ran against | No | No | n/a | n/a | n/a | No | No | No |
| **Symbol index / retrieval ranking** | **No** - `surface context` matches task words against capability names | Yes - TF-IDF over signatures; 78.6% hit@5 on its own benchmark | Yes - four evidence lanes; 58.3% strict file@10 on LocBench per its own evals | No | No | No | Yes - ranked symbol map | Yes - index | Yes - codebase index |
| **Call-graph blast radius** | **No** - `surface impact` follows declared owners, contracts, evidence and packages, not calls | Yes - per symbol and per file | Yes - `--impact`, `--affected`, `--blast-radius` | No | No | No | No | No | No |
| **Speed on a mid-sized repository** | 1-4 s per scan ([corpus run](../bench/corpus/RESULTS.md)) | Milliseconds per query once indexed | 0.25-0.45 s to index, per its README | n/a | n/a | Seconds | Seconds per chat | Hosted index | Depends on providers |
| **Staleness detection** | Yes - fingerprint-anchored; a verified claim goes `stale` when its owner files change and stays stale, and `verify --stale` re-proves it | Index staleness (regenerate) | n/a - re-indexed per run in well under a second | No - the file silently ages | No | n/a - regenerated on demand | n/a - regenerated per chat | n/a - index refreshes | n/a |
| **Machine-checked rules** | Yes - `forbid-import`, `forbid-file`, `require-test`, `forbid-env`, `max-owners`; violation is a health finding and exit `2` | No project rules; `review-pr` audits a diff for scope and missing tests | No project rules; `--lint` and the quality panels judge code, not policy | No - the agent may or may not obey | No | No | No | No | No |
| **Deterministic output** | Yes - byte-identical given the same tree; tested | Yes - byte-identical map | Yes - byte-identical runs | n/a | n/a | Mostly - depends on options | No - depends on chat context | No | No |
| **Works offline, no account** | Yes | Yes | Yes | Yes | Editor | Yes | Yes (model aside) | Hosted / enterprise | Depends on providers |
| **Execution boundary** | One spawn site, only commands already in the document, gated over MCP | Runs nothing | Runs nothing | n/a | n/a | n/a | n/a | n/a | n/a |
| **Semantic / embedding search** | **No** | No (TF-IDF) | No (BM25, name-exact, PageRank) | No | No | No | No (structural) | Yes | Yes (codebase index) |
| **Cross-repository** | **No** | No | No | No | No | Remote repo packing | No | Yes | Partial |
| **Language coverage** | TS/JS, Python full; Go, Rust structural; anything else manifest-only | 35 (one AST, the rest regex or pattern) | 24 tree-sitter grammars | Any (prose) | Any (prose) | Any text | Dozens via tree-sitter | Any (search) | Any text |
| **Diff in pull requests** | Yes - semantic diff of the *claims* as a PR comment | `review-pr` audits the diff | `--pr-context`, `--edit-check` on the diff | Text diff of the file | Text diff | No | No | No | No |
| **Consumable by other tools** | Yes - a versioned schema at a stable URL, with a conformance spec | Evidence Pack JSON; adapters per assistant | XML/JSON to stdout; MCP | AGENTS.md is a de-facto standard for instructions | Cursor only | The packed file | aider only | Cody only | Continue only |

## Not a context engine

**sigmap** and **ripwire** are the closest neighbours by *vocabulary* - deterministic, offline, no
embeddings, every guess labelled, an MCP server - and the furthest by *unit of work*. Both index symbols
and rank them for a query: sigmap with TF-IDF over extracted signatures, ripwire with a tree-sitter call
graph and Personalized PageRank. Their output answers "which files and symbols should the model read for
this task, in the fewest tokens", and they answer it far better than `surface context` does, in more
languages, with a real blast radius.

project-surface has no symbol index. Its unit is a *capability* - a named thing the project does - with an
owner, a contract, the test that proves it, the rules around it, and a provenance tier. Two things follow
that neither of them attempts:

- **Evidence is executed, not retrieved.** `surface verify` runs the test, records the result and the
  commit it ran against, and fingerprints the owner files. Edit one and the claim reads `stale` until
  `verify --stale` re-proves it. The sigmap Evidence Pack is a retrieval artifact - ranked files with line
  anchors; the ripwire `--test-gate` says which tests to run and leaves the running to you.
- **Rules are checked, not recited.** A constraint with a `check` fails `doctor --strict` and CI; a
  `declared` claim from a maintainer overrides inference at confidence 1.0.
- **A change carries proof.** `surface gate` says, per capability a pull request touches, whether its
  evidence was produced against the commit under review - and the receipt is recomputed by CI, so a
  contributor (or an agent) cannot claim more than the runner reproduces.

They compose. Let ripwire or sigmap find the file; ask the surface whether what it implements is proven,
by which test, at which commit, and what must not be broken. A surface is what a retrieved file gets
checked against, not another way to retrieve it.

## What each one is for

**CLAUDE.md / AGENTS.md** are the right place for judgement: coding style, what not to touch, how the team
works. project-surface does not replace them - it *generates* the factual part (`surface agents`), with a
citation per line and a staleness check, so the hand-written part can stay short and the generated part
cannot quietly rot. The two live in the same file, separated by markers.

**Cursor rules** are the same idea, scoped by glob and applied inside one editor. Same relationship.

**repomix** answers "give the model everything". It is excellent when the repository fits the context
window and the question is open-ended. project-surface answers "give the model the *model* of the
repository" - a few kilobytes of claims with provenance, plus a token-bounded context pack per task - and
is designed for repositories that do not fit. They compose: pack the files `surface context` selects.

**aider's repo-map** is the closest structural relative: a symbol graph, ranked, token-bounded. It is
broader (tree-sitter, many languages), rebuilt per conversation, and internal to aider. project-surface is
narrower, committed, diffable, and carries provenance and evidence, which a repo-map does not try to.

**Cody** and **Continue** retrieve; they find relevant snippets by search or embeddings, across
repositories in Cody's case. project-surface does not retrieve - it has no index and no embeddings. Their
retrieval can consume a surface document as one more context source; a surface cannot do their job.

## Where project-surface loses

- **No retrieval.** `surface context` matches task words against capability names and paths. If the
  question is "where is the thing that does roughly X", sigmap, ripwire or an embedding index finds it; a
  surface only does if a capability was named that way. Nothing here ranks symbols, and nothing walks a
  call graph.
- **No symbol-level granularity.** A capability owns files. ripwire and sigmap anchor to a function and a
  line; `surface impact` stops at "a file this capability owns changed".
- **Slower.** A scan takes one to four seconds on the corpus repositories; ripwire indexes a tree of that
  size in well under a second, and sigmap answers a query in milliseconds once indexed.
- **No cross-repository view.** One document per repository; nothing joins them.
- **Language depth is uneven and says so.** Four languages plus a manifest-only fallback, against the 24
  tree-sitter grammars in ripwire and the 35 languages in sigmap (one of them a full AST parse). A Rust
  public function is `inferred`, because it came from a line scan.
- **It needs Node 20.** repomix and aider are one `pip`/`npx` away too, but a Go shop without Node has a
  step to take.
- **The format is new.** Nothing else consumes `project-surface/v1` today. The schema, conformance and
  versioning documents exist so that can change; it has not yet.
- **The benchmark is built, not recorded.** [`bench/RESULTS.md`](../bench/RESULTS.md) says whether a
  number exists. If it says *not recorded*, this page claims no advantage in agent output quality - only
  the properties in the table, each of which is tested.

## When to use what

- "Which files should the model read for this task", in any of two dozen languages: **ripwire** or
  **sigmap** - and a surface alongside, to say which of those files come with proof.
- Small repository, open-ended question: **repomix**.
- Many languages, working inside aider: **aider**.
- Many repositories, an organisation: **Cody** or an equivalent index.
- One repository, agents and CI that must work from the same facts, rules that must be enforced rather than
  hoped for, and a record of what was actually verified when: **project-surface** - alongside, not instead
  of, a hand-written AGENTS.md.
