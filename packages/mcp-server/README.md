# @project-surface/mcp-server

[Model Context Protocol](https://modelcontextprotocol.io) server that exposes a project surface to AI agents. Ships inside the `project-surface` CLI as `surface mcp`; this package is the implementation.

```console
claude mcp add project-surface -- npx -y project-surface mcp
```

| Tool | Access | What it answers |
|---|---|---|
| `surface_overview` | read | What the project is, its stacks, packages and health summary |
| `surface_find_capability` | read | Where a behaviour lives and what proves it |
| `surface_constraints` | read | Rules that must not be violated |
| `surface_health` | read | Drift, stale claims and unproven behaviour |
| `surface_impact` | read | What a set of paths affects and what to run |
| `surface_context` | read | A token-bounded context pack for a task |
| `surface_diff` | read | What changed about the surface since a ref |
| `surface_verify` | **exec** | Run one already-recorded command and record the result |

`surface_verify` is gated twice: the operator must set `PROJECT_SURFACE_ALLOW_EXEC=1`, *and* the tool accepts only the id of a command that already exists in the document - never a shell string. The other seven tools are read-only: they answer from the committed document, read project files only to assemble a context pack (`surface_context`), and call `git` only for a read-only lookup of an earlier document (`surface_diff`). None of them can run a project command.

Reference: [`docs/mcp.md`](../../docs/mcp.md).