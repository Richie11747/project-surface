# MCP server

`@project-surface/mcp-server` exposes a surface document to any Model Context Protocol client over stdio.
The tool set mirrors the CLI, so an agent and a human see exactly the same model of the project.

## Setup

Claude Code:

```console
claude mcp add project-surface -- npx -y project-surface mcp
```

From a source checkout, or before the package is on npm:

```console
claude mcp add project-surface -- node /absolute/path/to/project-surface/packages/cli/dist/index.js mcp
```

Any other client: run `surface mcp` (or `project-surface-mcp`) as a stdio server with the project root as
the working directory, or pass `--root`. A ready-made config is in
[`examples/mcp.json`](../examples/mcp.json). The two entry points serve the same tools; `surface mcp` is the
one that owns the adapters, so only it can rebuild the document after `surface_verify` - the standalone
binary records the result and asks for `surface init`.

The server needs `.project/surface.json` to exist. Run `surface init` first; a missing document is
reported as tool content with that instruction, not as a protocol error.

## Tools

| Tool | Input | Returns |
|---|---|---|
| `surface_overview` | `format?: "text" \| "json"` | Project name, stacks, packages, counts, health summary. |
| `surface_find_capability` | `query`, `limit?` | Capabilities matching an id, route path or plain description - with owners, contracts, evidence and trust. |
| `surface_why` | `id`, `format?` | How a claim's confidence was derived: sources, evidence and its outcome, promotion, freshness, and each arithmetic step. Recomputed from the document and checked against the recorded score. |
| `surface_constraints` | `includeStale?` | Active constraints and their severity. |
| `surface_health` | `severity?` | Health findings at or above a severity. |
| `surface_impact` | `paths?`, `since?` | What a change affects and which commands to run. Omit both to use the staged set. |
| `surface_gate` | `paths?`, `since?`, `strict?` | The pull-request gate, from the document alone: per touched capability, `proven` at this commit, `carried`, `stale`, `unproven` or `failing`, plus violated rules and touched risks. Nothing is executed. |
| `surface_context` | `task`, `budgetTokens?`, `includeContent?` | Token-bounded context pack with a reason per file, and on every file the provenance tier and freshness of the claim it belongs to. |
| `surface_diff` | `since?` | What changed about the surface since a git ref. |
| `surface_verify` | `commandId?` or `stale?: true`, `timeoutSeconds?` | Runs one recorded command, or with `stale: true` exactly the commands that re-prove every stale capability, and stores the result as evidence with the commit it ran against. Served through `surface mcp`, it then rebuilds the document so freshness is re-anchored in the same call. **Gated - see below.** |

A resource, `surface`, serves the full document as `application/json`.

## Execution gate

Nine tools are strictly read-only. `surface_verify` can execute a process, so it is gated twice:

1. The operator must start the server with `PROJECT_SURFACE_ALLOW_EXEC=1` in the environment. Without it
   the tool answers with a refusal and does nothing.
2. The `commandId` must name a command already present in `surface.commands`. There is no parameter through
   which a caller can supply a shell string - only an id to look up. `stale: true` is the same gate from the
   other side: it resolves to the command ids the document already binds to its stale claims, and nothing else.

The worst an adversarial prompt can achieve is running a command the project already declares (its own
test suite, say), with output redacted and truncated before storage. A *declared* command (one written in
`.project/surface.declare.yaml`) that contains shell metacharacters is flagged in the tool result, because
that file is repository content rather than something the user typed.

Repository-authored text in tool output - constraint rules, rationales, health messages - is wrapped in
`<repo-data>` tags, and every response that carries claims says so, so a model can treat it as a
description of the project rather than as an instruction. `surface_context` with `includeContent` serves
only files the project lists and never `.git/`, dotenv or key files; what it returns is redacted.

## A useful first prompt

In a fresh session with no other context:

> Where is checkout implemented, what tests prove it, and what changes if I add a status field?

The agent should answer from `surface_find_capability` and `surface_impact` - citing owner files, the
contract, linked tests and active constraints - rather than by grepping.
