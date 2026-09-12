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
```

| Input | Default | Effect |
|---|---|---|
| `strict` | `false` | `doctor --strict`: stale claims and other warnings exit `2`. |
| `fail-on-change` | `false` | `diff --fail-on-change`: the regenerated document must equal the committed one. |
| `working-directory` | `.` | Project root inside the repository. |
| `version` | `latest` | npm version of `project-surface` to run. |

The action runs the published npm package via `npx`. Until `0.1.0` is on npm, use the same three commands
from a source checkout instead - see [`docs/cli.md`](../../docs/cli.md#typical-ci-step).

Exit code `2` means "the project has drift"; `1` means the tool itself failed. Both fail the step.
