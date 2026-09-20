# GitHub Action

Regenerates `.project/surface.json` on every push or pull request, fails the job when the project has
drifted from what its surface claims, and - on pull requests - tells the reviewer two things the code diff
cannot: what changed about the project, and whether every behaviour the change touched is proven at the
commit under review.

```yaml
name: surface
on: [push, pull_request]

jobs:
  surface:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write      # for the comment
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0          # git history improves freshness and diff
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - uses: Richie11747/project-surface/integrations/github-action@main
        with:
          strict: "true"          # warnings fail the job
          fail-on-change: "true"  # the committed surface must be current
          comment: "true"         # tell the pull request what changed, and what is proven
          verify: "true"          # let the gate run the recorded test command at this commit
          fail-on-gate: "true"    # no proof, no merge
```

| Input | Default | Effect |
|---|---|---|
| `strict` | `false` | `doctor --strict`: stale claims and other warnings exit `2`. |
| `fail-on-change` | `false` | `diff --fail-on-change`: the regenerated document must equal the committed one. |
| `comment` | `false` | On pull requests, post one comment - updated in place on later pushes - with the semantic diff since the base branch and, when `gate` is on, the proof receipt. Needs `permissions: pull-requests: write`. |
| `gate` | `true` | On pull requests, run `surface gate --since origin/<base>`: for every capability the change touches, whether passing evidence was recorded at this commit (`proven`), carried over byte-identical owner files (`carried`), or is `stale`, `unproven` or `failing`; plus violated rules and touched risks. |
| `verify` | `false` | Let the gate run the project commands recorded in the surface first (`--verify`), so the receipt says `proven` at this commit. Only commands already present in `.project/surface.json` can run; there is no way to pass a command through this input. |
| `fail-on-gate` | `false` | Fail the job when the gate does not pass. |
| `working-directory` | `.` | Project root inside the repository. |
| `version` | `latest` | npm version of `project-surface` to run. |
| `run` | | Command prefix instead of `npx`; from a source checkout use `node packages/cli/dist/index.js`. |

## What the comment looks like

The comment is `surface diff --since origin/<base> --format markdown` followed by
`surface gate --since origin/<base> --format markdown`, verbatim. A reviewer sees the *semantic* diff next
to the code diff - a route appeared, a command changed, a rule was broken, a claim went stale - and then
the receipt:

> ## Proof of change
>
> **Passes.** 5 capabilities touched since `origin/main`, each with passing evidence at `c02ee9e`.
>
> | Capability | Touched via | Verdict | Why |
> |---|---|---|---|
> | `checkout.create` | owner | ✅ proven | Passing evidence recorded at c02ee9e, this commit. |
> | `checkout.get` | owner | ✅ proven | Passing evidence recorded at c02ee9e, this commit. |
>
> **Worth a look**
>
> - docs/contracts/checkout.md did not change while 2 capabilities it specifies did (checkout.create, checkout.get). Confirm the behaviour still matches the document.
> - Constraint "Never call the payment provider from a request handler." is violated in 1 place(s).

The receipt is recomputed from `.project/surface.json` and git on the runner. A contributor - human or
agent - can paste the same receipt into the pull request description, and it cannot say more than this
step will reproduce: a proof counts only when the run that produced it is recorded against the commit
under review, or its owner files are byte-identical to what that run saw.

Long sections are collapsed. The comment carries a marker so the action edits its own earlier comment
instead of posting a new one on every push.

The action runs the published npm package via `npx`; pin it with the `version` input. From a source
checkout, pass `run: node <checkout>/packages/cli/dist/index.js` instead - see
[`docs/cli.md`](../../docs/cli.md#typical-ci-step).

Exit code `2` means "the project has drift" (or, with `fail-on-gate`, "the change carries no proof");
`1` means the tool itself failed. Both fail the step.
