# Sessions: fewer tokens, no loops

The surface document remembers one verification per command - the latest - because it is committed and must
not change when nothing about the project did. A *session* is the opposite kind of record: machine-local,
append-only, and interested precisely in repetition. It lives in `.project/session.local.json`, which the
generated `.gitignore` pattern `.project/*.local.json` already excludes, and it is never part of the
document. Delete it at any time; `surface session --reset` does.

What is recorded, what follows from it, and what is deliberately left out.

## What is recorded

**Runs.** Every command `surface verify` (and `surface gate --verify`, and the MCP `surface_verify` tool)
executes is appended as an *attempt*: the command id, its `run` string and working directory, the commit,
whether the tree was dirty, the exit status, and two fingerprints:

- the **working-tree fingerprint** - the commit plus the content hash of every path that differs from it,
  untracked files included, with the document and the session file excluded. Two runs with the same
  fingerprint saw byte-identical code. It is `null` outside git, and every rule that needs it is then
  skipped rather than guessed.
- the **failure signature** - a hash of the captured output after durations, timestamps, hashes and
  `line:column` pairs are removed, plus the exit code. Two failures with the same signature are the same
  failure; `null` when the command passed.

Nothing else is recorded. In particular a command run any other way - `npm test` in a shell, a test
runner in an editor - is invisible to the session. The signals below are about runs that went through the
tool; the document does not claim to know about the rest.

## The three signals

Each is a deterministic function of the ledger, keyed by `(command id, run, cwd)` so that two stacks'
`test` commands in a polyglot repository do not share a history.

| Signal | Severity | Fires when | Says |
|---|---|---|---|
| `unchanged-rerun` | warn | The last attempt of this command failed (or did not complete) on a working tree with this exact fingerprint. | Running it again will produce the same result. Change something first, or pass `force`. |
| `same-failure` | warn | The last three attempts of this command failed with the same signature across at least two different working trees. | The edits are not reaching the failure. Read the output; `surface why`, `surface impact`, the contract. |
| `flapping` | info | Among the last four attempts, the same working tree both passed and failed. | The result does not depend on the code. Treat it as flaky, not as proof. |

`unchanged-rerun` is evaluated *before* a run; the other two describe the history *after* one. Where they
appear:

- `surface verify` prints signals before the first command starts and after the results. With
  `--if-changed`, a command under `unchanged-rerun` is skipped, the reason is printed, and the exit code is
  `0` - nothing ran, nothing failed. `--json` carries `signals` and `skipped`.
- The MCP `surface_verify` tool **declines** a run under `unchanged-rerun` - the response begins `Not run.`
  and is not an error - unless `force: true` is passed. After a run it appends any history signals and a
  one-line session summary.
- `surface session` lists every attempt, the signals that currently hold, and the packs; `--reset` forgets
  everything. Over MCP the same summary is the `surface://session` resource.

## What this is not

It is not a memory of the conversation, a plan, or a judgement about whether an agent is making progress.
It is a fingerprint-keyed record of two facts - what was run, what was served - and three rules that follow
from them by construction. The same discipline that makes a `verified` claim go `stale` when its owner
files change is what lets a session say that re-running a failed command on unchanged code cannot help.
