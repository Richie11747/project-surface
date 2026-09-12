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
first) and adds a `/surface` command that runs `doctor` and summarises the result.

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
