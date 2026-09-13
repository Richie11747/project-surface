# How this compares

Every tool below is good at what it was built for, and several are better than project-surface at things
this project does not attempt. The table is about *what kind of thing each one produces*, not about which
is best. Claims about other tools link to their own documentation; if one is out of date, open an issue.

| | project-surface | [CLAUDE.md](https://docs.anthropic.com/en/docs/claude-code/memory) / [AGENTS.md](https://agents.md) | [Cursor rules](https://docs.cursor.com/context/rules) | [repomix](https://github.com/yamadashy/repomix) | [aider repo-map](https://aider.chat/docs/repomap.html) | [Cody context](https://sourcegraph.com/docs/cody/core-concepts/context) | [Continue](https://docs.continue.dev/customize/context-providers) |
|---|---|---|---|---|---|---|---|
| What it produces | A committed JSON document: capabilities, commands, rules, risks, evidence, each with provenance, confidence, freshness | Hand-written instructions | Hand-written rules, scoped by glob | The repository packed into one LLM-friendly file | A ranked symbol map, rebuilt per chat | Search results and snippets from an index | Snippets from context providers (codebase index, docs, ...) |
| **Provenance per claim** | Yes - `declared` / `verified` / `derived` / `inferred`, with source file and locator | No - prose | No - prose | No - raw source | No - symbols, ranked | No | No |
| **Evidence linking** | Yes - test ↔ implementation via import graph; `path-proximity` is labelled as a guess | No | No | No | Indirect - references count toward rank | No | No |
| **Staleness detection** | Yes - fingerprint-anchored; a verified claim goes `stale` when its owner files change and stays stale | No - the file silently ages | No | n/a - regenerated on demand | n/a - regenerated per chat | n/a - index refreshes | n/a |
| **Machine-checked rules** | Yes - `forbid-import`, `forbid-file`, `require-test`; violation is a health finding and exit `2` | No - the agent may or may not obey | No | No | No | No | No |
| **Deterministic output** | Yes - byte-identical given the same tree; tested | n/a | n/a | Mostly - depends on options | No - depends on chat context | No | No |
| **Works offline, no account** | Yes | Yes | Editor | Yes | Yes (model aside) | Hosted / enterprise | Depends on providers |
| **Execution boundary** | One spawn site, only commands already in the document, gated over MCP | n/a | n/a | n/a | n/a | n/a | n/a |
| **Semantic / embedding search** | **No** | No | No | No | No (structural) | Yes | Yes (codebase index) |
| **Cross-repository** | **No** | No | No | Remote repo packing | No | Yes | Partial |
| **Language coverage** | TS/JS, Python full; Go, Rust structural; anything else manifest-only | Any (prose) | Any (prose) | Any text | Dozens via tree-sitter | Any (search) | Any text |
| **Diff in pull requests** | Yes - semantic diff as a PR comment | Text diff of the file | Text diff | No | No | No | No |
| **Consumable by other tools** | Yes - a versioned schema at a stable URL, with a conformance spec | AGENTS.md is a de-facto standard for instructions | Cursor only | The packed file | aider only | Cody only | Continue only |

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

- **No semantic search.** If the question is "where is the thing that does roughly X", an embedding index
  finds it and a surface only does if a capability was named that way.
- **No cross-repository view.** One document per repository; nothing joins them.
- **Language depth is uneven and says so.** Four languages plus a manifest-only fallback, against
  tree-sitter's dozens. A Rust public function is `inferred`, because it came from a line scan.
- **It needs Node 20.** repomix and aider are one `pip`/`npx` away too, but a Go shop without Node has a
  step to take.
- **The format is new.** Nothing else consumes `project-surface/v1` today. The schema, conformance and
  versioning documents exist so that can change; it has not yet.
- **The benchmark is built, not recorded.** [`bench/RESULTS.md`](../bench/RESULTS.md) says whether a
  number exists. If it says *not recorded*, this page claims no advantage in agent output quality - only
  the properties in the table, each of which is tested.

## When to use what

- Small repository, open-ended question: **repomix**.
- Many languages, working inside aider: **aider**.
- Many repositories, an organisation: **Cody** or an equivalent index.
- One repository, agents and CI that must work from the same facts, rules that must be enforced rather than
  hoped for, and a record of what was actually verified when: **project-surface** - alongside, not instead
  of, a hand-written AGENTS.md.
