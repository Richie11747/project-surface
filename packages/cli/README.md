# project-surface

**The missing semantic layer for AI-readable software projects.**

`surface` reads a repository and writes one small, verifiable artifact - `.project/surface.json` - that tells any AI agent what the project can do, where it lives, what proves it, and what a change will affect. Every claim carries an owner, evidence, freshness, confidence and a provenance tier.

```console
npx project-surface init          # detect the stack, write .project/surface.json
npx project-surface inspect       # what the project does, and what proves it
npx project-surface verify        # run project commands and record the result
npx project-surface doctor        # drift, stale claims, unproven behaviour
npx project-surface mcp           # serve the surface to agents over MCP
```

| Command | What it does |
|---|---|
| `init` | Detect the stack and write `.project/surface.json` |
| `inspect [capability]` | What the project does, and what proves it |
| `map` | Ownership table: owner, contract, evidence, confidence |
| `verify` | Run project commands and record the result as evidence |
| `impact <paths>` | What a change affects, and what to run |
| `context "<task>"` | Token-bounded context pack, with a reason per file |
| `diff --since <ref>` | What changed about the project surface |
| `doctor` | Drift, stale claims, unproven behaviour |
| `report` | Self-contained HTML report |
| `mcp` | Serve the surface to agents over MCP |

Every command supports `--json`. Exit code `2` means a check failed, so CI can gate on it.

Node 20.10 or newer. No native modules, no network calls, read-only by default.

Full documentation, the trust model and the specification live in the
[repository](https://github.com/richardadamik/project-surface#readme).