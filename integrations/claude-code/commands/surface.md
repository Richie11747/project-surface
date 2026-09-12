---
description: Check the project surface for drift, stale claims and unproven behaviour, then summarise.
allowed-tools: Bash(npx project-surface:*), Bash(npx -y project-surface:*), Bash(node *project-surface*), mcp__project-surface__*
---

If the `project-surface` MCP server is connected, call `surface_health` (severity `info`). Otherwise run
`npx -y project-surface doctor --json` in the repository root - or, from a source checkout,
`node <checkout>/packages/cli/dist/index.js doctor --json`. If it reports that no surface document exists,
run `init` the same way first, then `doctor` again.

Then summarise for the user:

1. Errors first (`BROKEN_COMMAND`, `DECLARATION_INVALID`), each with its remediation line.
2. Warnings (`STALE_CLAIM`, `MISSING_ENV_EXAMPLE`, ...), grouped by code.
3. One line of counts for info-level findings; do not list them individually.

If there are stale claims, name the capabilities and the command that would re-verify each one. Do not run
verification yourself unless the user asks - `surface verify` executes project commands.

$ARGUMENTS
