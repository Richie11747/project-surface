# Integrations

| Directory | What it is |
|---|---|
| [`claude-code/`](claude-code/README.md) | A Claude Code plugin: the MCP server plus a `/surface` command. |
| [`github-action/`](github-action/README.md) | A composite GitHub Action that regenerates the surface and fails the job on drift. |

Both are thin wrappers over the CLI. Anything they do can be done with `surface init` and `surface doctor`.
