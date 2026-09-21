# Claude Code integration

## Just the MCP server

```console
claude mcp add project-surface -- npx -y project-surface mcp
```

From a source checkout (or before the package is published to npm):

```console
claude mcp add project-surface -- node /absolute/path/to/project-surface/packages/cli/dist/index.js mcp
```

Then, in a project that has run `surface init`, ask in a fresh session:

> Where is checkout implemented, what tests prove it, and what changes if I add a status field?

## As a plugin

This directory is a Claude Code plugin. It registers the MCP server from this checkout (so `npm run build`
first), adds a `/surface` command that runs `doctor` and summarises the result, and installs one hook:
on `SessionStart` it runs `surface brief`, so every session opens with one screen of orientation - the
proven commands, the rules that fail the build, the paths that need approval, and where things live - at
a cost of a few hundred tokens, once. A project without a surface document prints nothing and the session
starts normally.

The server it registers is the CLI-hosted one (`surface mcp`), which owns the adapters and rebuilds the
document after a verification so freshness is re-anchored in the same call. Its `surface_context` tool
does not repeat a file it already served in this session, and `surface_verify` declines to repeat a run
that failed on unchanged code - see [`docs/sessions.md`](../../docs/sessions.md).

```console
claude plugin add /absolute/path/to/project-surface/integrations/claude-code
```

## Letting Claude run verification

The `surface_verify` tool is disabled unless the server sees `PROJECT_SURFACE_ALLOW_EXEC=1`. Even then it
can only run command ids already recorded in `.project/surface.json` - never a shell string. To enable it:

```console
claude mcp add project-surface -e PROJECT_SURFACE_ALLOW_EXEC=1 -- npx -y project-surface mcp
```

See [`docs/mcp.md`](../../docs/mcp.md) for the full tool list and the security model.
