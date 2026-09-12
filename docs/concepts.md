# Concepts

## The artifact

`project-surface` produces one file, `.project/surface.json`, and everything else - the CLI, the MCP
server, the HTML report, the GitHub Action - is a view onto it. The file is meant to be committed. It is
plain, indented JSON with stable ordering, so a pull request that changes what the project *is* shows up
as a readable diff.

The format is specified in [`spec/v1/SPEC.md`](../spec/v1/SPEC.md). This page explains the ideas behind it.

## Six kinds of fact

A repository, seen through a surface, is:

| Section | Question it answers |
|---|---|
| `capabilities` | What does this project do? Routes, exported functions, CLI commands, jobs, modules. |
| `commands` | How do you run, build, test or check it? |
| `evidence` | What proves a capability works? Tests, builds, type-checks - and whether they were actually run. |
| `constraints` | What must not be violated? |
| `environment` | Which variables does it need? Names only; values are never recorded. |
| `risks` | Where should a change be looked at twice? Migrations, secrets, infrastructure, generated code. |

Capabilities link to their **owners** (the files that implement them), **contracts** (docs or schemas that
specify them), **evidence** (tests that prove them) and **environment** (what they need). Those links are
what make `surface impact` and `surface context` possible: a change to an owner file has a bounded set of
affected capabilities, tests and constraints, and that set is computed rather than guessed.

## Every claim says where it came from

Each entry carries a `provenance` block: a tier, at least one source file, the adapter that produced it,
and when. The tier is the important part:

- `declared` - a human wrote it in `.project/surface.declare.yaml`.
- `verified` - a command was executed and its result observed.
- `derived` - read from structured configuration or a real parse tree.
- `inferred` - guessed from names or layout.

A claim that was guessed is labelled as guessed. A claim that was proven, and then its code changed, is
labelled stale. Nothing in the document pretends to be more certain than it is. See
[trust-model.md](trust-model.md) for how those labels become a number.

## Discovery is not execution

Finding `tests/checkout/create.test.ts` is not the same as running it. Statically discovered evidence is
recorded with status `unknown`. Only `surface verify` (or the gated MCP tool) runs anything, and only
commands the document already lists. Adapters have no execution capability at all.

This is also why there is exactly one place in the codebase that spawns a process:
`packages/core/src/evidence/runner.ts`.

## Freshness that does not self-heal

When a capability is verified, the document stores a fingerprint of its owner files as they were at that
moment. If the files change, the claim goes stale - and it stays stale on every subsequent rescan, because
the anchor only moves when something re-verifies the claim. A tool that quietly re-anchored on every scan
would make "stale" impossible to observe.

## What it is not

Not a multi-agent system, a vector database, a chat interface or a code modifier. It makes no network
calls, needs no account, and never writes to source files. The value is a small, fast, inspectable model
of the project that is honest about its own uncertainty.
