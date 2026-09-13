# Contributing

Thanks for helping. This project has a [Code of Conduct](CODE_OF_CONDUCT.md); by participating you agree to it. Security issues go through a [private advisory](SECURITY.md), not an issue.

## Setup

```console
npm install
npm run build
npm test
```

Node 20.10 or newer. There is no bundler, no test framework, and no native module anywhere in the tree - that is deliberate, and pull requests that add one need to argue for it.

## The rule that matters

Every claim this tool emits must say where it came from. If you add extraction logic, it reports a provenance tier and at least one source file. A claim with no source is not a claim.

Be honest about tiers:

- `derived` - you read it from structured config or a real parse tree
- `inferred` - you guessed from naming or layout

Marking a guess as `derived` to make the output look better defeats the entire purpose of the project.

## Adding an adapter

1. `packages/adapters/<language>/`, depending only on `@project-surface/adapter-sdk`.
2. Implement `detect` and `extract`.
3. Add a fixture under `fixtures/` - small, real, with at least one test that imports its implementation.
4. Pass the conformance suite:

```ts
import { assertConformance } from "@project-surface/adapter-sdk";
await assertConformance(myAdapter, "fixtures/my-fixture");
```

Conformance checks that every claim has a source, no absolute path leaks, discovered evidence is never reported as `passed`, and two runs produce byte-identical output. Determinism is the one contributors break most often - usually with `Date.now()` or unsorted iteration. Use `ctx.now` and sort before you emit.

## Pull requests

- `npm test` green, including the fixture snapshots.
- Regenerate snapshots deliberately (`npm run fixtures:update`) and review the diff - a changed snapshot is a changed promise to users.
- If you change `spec/v1/surface.schema.json`, run `node scripts/gen-schema-module.mjs`. CI fails if the embedded copy drifts.

## Releasing

1. Move the `[Unreleased]` entries in `CHANGELOG.md` under a new `[x.y.z] - date` heading and add its compare link.
2. Bump every workspace, internal pin and version constant: `npm version x.y.z --workspaces --include-workspace-root --no-git-tag-version`, then repin `"@project-surface/*": "x.y.z"`, `GENERATOR_VERSION` in `packages/core/src/version.ts` and `ADAPTER_VERSION` in each adapter, `npm install`, `npm run fixtures:update`.
3. Regenerate the self-surface (`surface init`, `verify --command test --command typecheck`, `agents --write CLAUDE.md`, `init`, `doctor --strict`), commit, tag `vx.y.z`, push the tag.
4. The `Release` workflow builds, tests, packs, attaches tarballs and an SBOM to the GitHub Release with the CHANGELOG section as notes, then waits at the `npm` environment. A reviewer approves the publish job; nothing reaches npm before that.
