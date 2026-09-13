# GitHub Action

Regenerates `.project/surface.json` on every push or pull request and fails the job when the project has
drifted from what its surface claims.

```yaml
name: surface
on: [push, pull_request]

jobs:
  surface:
    runs-on: ubuntu-latest
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
          comment: "true"         # tell the pull request what changed
```

| Input | Default | Effect |
|---|---|---|
| `strict` | `false` | `doctor --strict`: stale claims and other warnings exit `2`. |
| `fail-on-change` | `false` | `diff --fail-on-change`: the regenerated document must equal the committed one. |
| `comment` | `false` | On pull requests, post one comment - updated in place on later pushes - with the semantic diff since the base branch: capabilities, commands and constraints that were added, removed or changed, and health findings that appeared or resolved. Needs `permissions: pull-requests: write`. |
| `working-directory` | `.` | Project root inside the repository. |
| `version` | `latest` | npm version of `project-surface` to run. |
| `run` | | Command prefix instead of `npx`; from a source checkout use `node packages/cli/dist/index.js`. |

## What the comment looks like

The comment is `surface diff --since origin/<base> --format markdown`, verbatim. A reviewer sees the
*semantic* diff next to the code diff: a route appeared, a command changed, a rule was broken, a claim went
stale. For example:

> ## Surface changes
>
> Since `origin/main`: capabilities +1 ~1 · constraints +1 · 1 new finding.
>
> ### Capabilities
>
> - **added** `checkout.complete`
> - **changed** `checkout.create`
>   - confidence: `0.95` → `0.56`
>
> ### New health findings
>
> - **warn** `CONSTRAINT_VIOLATED` (constraint `constraint:no-provider-in-handlers`): Constraint "Never call the payment provider from a request handler." is violated in 1 place(s): src/checkout/create.ts (imports src/payments/provider.ts).
>   - fix: Handlers must stay idempotent; provider calls go through the job queue. Fix the listed files, or change the check in .project/surface.declare.yaml.

Long sections are collapsed. The comment carries a marker so the action edits its own earlier comment
instead of posting a new one on every push.

The action runs the published npm package via `npx`; pin it with the `version` input. From a source
checkout, pass `run: node <checkout>/packages/cli/dist/index.js` instead - see
[`docs/cli.md`](../../docs/cli.md#typical-ci-step).

Exit code `2` means "the project has drift"; `1` means the tool itself failed. Both fail the step.
