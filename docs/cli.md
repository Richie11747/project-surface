# CLI reference

Binary: `surface` (alias `project-surface`). From a source checkout: `node packages/cli/dist/index.js`.

```
surface <command> [options]
```

The command comes first, git-style. Global options are accepted anywhere after it.

| Global option | Effect |
|---|---|
| `--root <dir>` | Project root. Defaults to the working directory. |
| `--json` | Machine-readable output. Every command supports it. |
| `--no-color` | Disable colour. Also disabled automatically when stdout is not a TTY or `--json` is set. |
| `--version`, `--help` | |

## Exit codes

| Code | Meaning |
|---|---|
| `0` | Success. |
| `1` | The tool failed: bad arguments, no surface document, unreadable project. |
| `2` | A check failed. `doctor` with error-level findings (or any warning under `--strict`), `diff --fail-on-change` with changes, `verify` with a failing command. Gate CI on this. |

## Commands

### `surface init`

Detect the stack and write `.project/surface.json`. Re-running is the normal way to refresh: the previous
document is read first and verification results are carried forward, so a rescan does not lose what
`verify` recorded.

| Option | |
|---|---|
| `--force` | Ignore the previous document. |
| `--max-files <n>` | Cap the file walk (default in `packages/core/src/fs/walk.ts`). Truncation is reported as `FILE_SCAN_TRUNCATED`. |

### `surface inspect [capability]`

Without an argument: a summary of the project. With a capability id: its owners, contract, evidence,
environment, the command that checks it, and the trust line (`confidence label | tier | freshness`).

### `surface why <id>`

The derivation behind a number. For a capability, command, constraint, risk or environment variable: the
files it was read from, the evidence that ran against it and what it said, the promotion that earned (or
the one withheld because the owner files moved), the freshness anchor, and every arithmetic step from tier
floor to final score. The score is recomputed from the document alone and compared with the recorded value;
a mismatch is printed, not hidden. Accepts aliases and trailing id segments (`why create` finds
`checkout.create`).

```console
$ surface why checkout.create

  Proven by
    passed  tests/checkout/create.test.ts  (linked by import-graph, command test, observed 2026-09-12T19:30:34Z)
    derived -> verified: Linked evidence passed; passing evidence raises a claim by exactly one tier.

  Score
     0.95  tier-floor       verified starts at 0.95 and cannot exceed 0.99.
     0.95  corroboration    One source file; no corroboration bonus.
    =====
    0.95 high

  Recomputed from the document and matches the recorded 0.95.
```

### `surface map`

One row per capability: owner, contract, evidence, tier, confidence, freshness. Good for a first look at a
foreign repo, and for checking that what was verified is still verified.

### `surface verify [paths...]`

Run project commands and record the result as evidence. Only commands already present in the document can
run - there is no way to pass a shell string. The document knows which commands prove which capabilities,
so the selection can be made by *claim* rather than by command id; that is what lets `doctor` report a
stale claim and one command re-prove it.

| Option | |
|---|---|
| `--command <id>` | Run this command. Repeatable. |
| `--capability <id>` | Run the commands that exercise this capability. |
| `--stale` | Run exactly the commands that re-prove every capability whose freshness is `stale`, then report how many are fresh again. Nothing stale is a clean exit `0`, so CI can run it unconditionally. |
| `--since <ref>` / `--staged` / `paths...` | Run what `surface impact` would list for that change set: the commands bound to affected evidence and the test command of each affected package. When no capability is known to depend on the paths, every test command runs, and the output says so. |
| `--all` | Run every test, build and typecheck command. |
| `--timeout <seconds>` | Per-command timeout. |

Every record carries the commit the working tree was at and whether the tree was dirty (the regenerated
`.project/surface.json` itself does not count), so `inspect` and `why` can say *which code* a claim was
proven against. Output is redacted for secret-shaped strings and truncated before it is stored. Exit `2`
when any command failed.

### `surface impact <paths...>`

What a change affects: capabilities owning the paths, their evidence, active constraints, and which
commands to run.

| Option | |
|---|---|
| `--staged` | Use the git staged set instead of explicit paths. |
| `--since <ref>` | Use everything changed since a git ref. |

### `surface context "<task>"`

A token-bounded context pack for a task: the capabilities most relevant to the wording, their owners,
contracts and tests, each with a one-line reason for inclusion and the provenance tier and freshness of
the claim it belongs to - so `declared·fresh` and `inferred·stale` are visible on every line. This is not
retrieval: it matches words against capability names, not against code. Without `--content` it sizes
files by `stat` and opens none of them.

| Option | |
|---|---|
| `--budget <tokens>` | Default in `packages/core/src/analysis/context.ts`. |
| `--max-capabilities <n>` | |
| `--content` | Include file contents, not only paths. |

### `surface agents [--write <file>] [--include-inferred] [--max-capabilities n]`

Agent instructions generated from the surface: the commands that were actually run, the rules and whether
each is machine-checked and passing, the paths that need care, where each capability lives with its contract
and the test that proves it, and the environment names. Every line carries its provenance; `inferred` guesses
are omitted unless `--include-inferred` is given.

Without `--write` the block is printed. With `--write AGENTS.md` (or `CLAUDE.md`, or any path inside the
project) it is inserted between `<!-- project-surface:begin fingerprint=... -->` and
`<!-- project-surface:end -->` markers; anything a person wrote outside the markers is preserved byte for byte,
and a second run with an unchanged surface is a no-op.

The fingerprint is what makes the file honest. Every later scan compares it with what the current surface
would render, and `surface doctor` reports `AGENTS_MD_STALE` (warn) when they differ - a hand-written
CLAUDE.md goes stale silently; this one cannot.

### `surface diff [--since <ref>] [--format text|markdown] [--fail-on-change]`

What changed about the project surface between the committed document and the working tree.

| Option | |
|---|---|
| `--since <ref>` | Git ref to compare against. Default `HEAD`. |
| `--fail-on-change` | Exit `2` when anything changed. |
| `--format markdown` | Render as a pull-request comment: one summary line, then added / removed / changed entries and health findings with severity; long lists collapsed. This is what the GitHub Action posts with `comment: true`. |

### `surface doctor`

Report drift, stale claims and unproven behaviour. Findings and codes are listed in
[`spec/v1/SPEC.md` §11](../spec/v1/SPEC.md#11-healthfinding).

| Option | |
|---|---|
| `--strict` | Treat warnings as failures (exit `2`). |
| `--severity <error|warn|info>` | Minimum severity to print. |

### `surface report [--out path]`

A self-contained HTML report. Defaults to `.project/surface.html`, which is git-ignored by the template
`.gitignore`.

### `surface mcp`

Serve the surface over MCP on stdio. See [mcp.md](mcp.md).

## Typical CI step

```yaml
- run: npx project-surface init
- run: npx project-surface doctor --strict
```

Or use the composite action in [`integrations/github-action`](../integrations/github-action/README.md).
