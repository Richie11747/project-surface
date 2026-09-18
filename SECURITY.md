# Security

## Reporting

Report vulnerabilities through a [private security advisory](https://github.com/Richie11747/project-surface/security/advisories/new) on this repository. Please do not open a public issue. You should hear back within a few days; fixes ship as a patch release with a changelog entry that credits the reporter, unless they prefer otherwise.

## Supported versions

| Version | Supported |
|---|---|
| 0.2.x | Yes - current; fixes land here |
| 0.1.x | Security fixes only, until 0.3.0 |

Releases are built by `.github/workflows/release.yml` from a `v*` tag: tarballs and a CycloneDX SBOM are
attached to the GitHub Release, and npm publish runs with provenance behind a reviewer-gated environment.
A package on npm can be traced to the workflow run and commit that produced it.

## Design boundaries

These are the properties the project intends to hold. A break in any of them is a security bug.

**Project commands run from one module only.** `packages/core/src/evidence/runner.ts` is the only code that executes a project command. It will only run a command that already exists in the surface document, obtained through `resolveAllowedCommand`, from a working directory physically inside the project. There is no code path that executes an arbitrary string. Adapters have no exec capability at all. The only other spawn site is `packages/core/src/git/git.ts`, which invokes a fixed `git` binary with an argument array (no shell) for read-only queries and refuses refs that look like options.

**Symlinks are never followed.** The file reader refuses any path whose real location leaves the project root, so a committed link to a file outside the repository is not read. Files larger than 2 MiB are not read at all.

**Content handed out is guarded.** `surface context --content` and the MCP `surface_context` tool serve only files the project itself lists (tracked, or untracked and not ignored), never `.git/`, dotenv or key files, and redact what they return - so a declaration naming `.env` as an owner yields an omission, not the file.

**MCP execution is gated twice.** `surface_verify` requires `PROJECT_SURFACE_ALLOW_EXEC=1` *and* a command id already present in the document. It accepts an id, never a shell string. The worst outcome from an adversarial prompt is running a command the project itself declares; when such a declared command contains shell metacharacters the tool says so in its result, and repository-authored text in tool output is delimited as `<repo-data>` so a model can tell it from instructions.

**Working directories are contained.** A command whose `cwd` resolves outside the project root is refused.

**Secrets never enter the artifact.** Environment variable names are surfaced; values are never read. Every piece of captured process output passes through `sanitizeOutput` before storage, which strips credential patterns, connection strings, tokens, private keys, and machine-identifying paths.

**No network.** Core makes no network calls.

## Scope note

The surface document is meant to be committed. Treat it as public. If you believe redaction missed something, that is a vulnerability worth reporting.
