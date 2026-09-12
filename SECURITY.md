# Security

## Reporting

Report vulnerabilities through GitHub private security advisories on this repository. Please do not open a public issue.

## Design boundaries

These are the properties the project intends to hold. A break in any of them is a security bug.

**Execution is confined to one module.** `packages/core/src/evidence/runner.ts` is the only code that spawns a process. It will only run a command that already exists in the surface document, obtained through `resolveAllowedCommand`. There is no code path that executes an arbitrary string. Adapters have no exec capability at all.

**MCP execution is gated twice.** `surface_verify` requires `PROJECT_SURFACE_ALLOW_EXEC=1` *and* a command id already present in the document. It accepts an id, never a shell string. The worst outcome from an adversarial prompt is running a command the project itself declares.

**Working directories are contained.** A command whose `cwd` resolves outside the project root is refused.

**Secrets never enter the artifact.** Environment variable names are surfaced; values are never read. Every piece of captured process output passes through `sanitizeOutput` before storage, which strips credential patterns, connection strings, tokens, private keys, and machine-identifying paths.

**No network.** Core makes no network calls.

## Scope note

The surface document is meant to be committed. Treat it as public. If you believe redaction missed something, that is a vulnerability worth reporting.
