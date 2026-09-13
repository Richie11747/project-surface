# Writing an adapter

An adapter recognises a stack and proposes claims. It gets read-only file access and **no** execution
capability: it may say that `mix test` is the test command; only core may ever run it.

## Contract

```ts
import type { Adapter, AdapterContext, AdapterResult } from "@project-surface/adapter-sdk";
import { classifyCommand, emptyResult, provenance, source } from "@project-surface/adapter-sdk";

export const elixirAdapter: Adapter = {
  id: "elixir",
  version: "0.1.0",

  async detect(ctx: AdapterContext) {
    return ctx.exists("mix.exs");
  },

  async extract(ctx: AdapterContext): Promise<AdapterResult> {
    const result = emptyResult({
      id: "elixir",
      adapter: "@acme/adapter-elixir",
      adapterVersion: "0.1.0",
      toolchainAvailable: true,
    });
    result.commands = [
      {
        id: "test",
        run: "mix test",
        cwd: ".",
        kind: classifyCommand("test"),
        provenance: provenance({
          tier: "derived",
          adapter: "elixir",
          now: ctx.now,
          sources: [source("mix.exs", "project.deps")],
        }),
      },
    ];
    return result;
  },
};
```

`AdapterContext` gives you root-relative `files`, `exists`, `readFile`, `readJson`, `match`, `git` metadata
and a fixed `now`. Use `ctx.now` for every timestamp; never call `Date.now()`.

## What to return

`AdapterResult` has `stack`, `packages`, `commands`, `capabilities`, `constraints`, `environment`, `risks`
and `evidence`. Every claim needs a `provenance` with at least one `source`. Confidence and freshness are
deliberately absent from the contract - core computes them, so an adapter cannot inflate its own score.

Report the tier honestly:

- `derived` - you read it from a manifest, config file or real parse tree.
- `inferred` - you guessed from a filename, directory name or convention.

Evidence you discover statically gets `status: "unknown"`. Never `passed`.

Link tests to capabilities by reading the import graph when you can (`link: "import-graph"`); fall back to
`path-proximity` and say so. The distinction is the whole point of the project.

If the language toolchain is absent on the machine, set `stack.toolchainAvailable = false` and add a note.
The Go adapter (`packages/adapters/go/src/index.ts`) is the reference for this.

An adapter may set `fallback: true`. A fallback runs after the language adapters - always when none of
them recognised the project, otherwise only if its own `detect` fires - so a scan never returns an empty
document without saying why. `packages/adapters/generic` is the built-in one; it reads build-tool targets
and `.env.example` and deliberately claims no capabilities.

## Conformance

```ts
import { assertConformance } from "@project-surface/adapter-sdk";
await assertConformance(elixirAdapter, "fixtures/elixir-app");
```

The suite checks that the adapter:

1. declares an id (`^[a-z0-9][a-z0-9._:/-]*$`) and a version;
2. returns a boolean from `detect`, and matched the fixture;
3. produces a stack whose `id` equals the adapter id, with `toolchainAvailable` set;
4. attaches at least one source to every claim;
5. gives every claim an id matching the identifier pattern;
6. emits only project-relative POSIX paths - no drive letters, no backslashes, no `..`, no `~`;
7. does not leak the absolute fixture root anywhere in its output;
8. never reports statically discovered evidence as `passed`;
9. produces byte-identical output on two consecutive runs.

Number 9 is the one contributors break most often - usually with `Date.now()`, a `Set` built from
unsorted input, or a random id. Sort before you emit.

The same suite runs as a command, so an adapter outside this repository can be checked without cloning it:

```
npx -p @project-surface/adapter-sdk surface-conform ./dist/index.js ./fixtures/elixir-app
```

From a source checkout, `node packages/adapter-sdk/dist/bin.js <adapter-module.js> <fixture-dir>`. Each
check is printed as `pass` or `FAIL` with its detail; exit `0` conforms, `2` at least one check failed,
`1` the module could not be loaded or exports nothing with `id`, `detect` and `extract`. What conformance
means for every role - document, generator, consumer, adapter - is in
[`spec/v1/CONFORMANCE.md`](../spec/v1/CONFORMANCE.md).

## Shipping it

1. Put it in `packages/adapters/<language>/`, depending only on `@project-surface/adapter-sdk`.
2. Add a fixture under `fixtures/<name>/` - small, real, with at least one test that imports the code it
   tests.
3. Register it in `scripts/fixture-snapshot.mjs` and `packages/cli/src/adapters.ts`, run
   `npm run fixtures:update`, review the generated `expected.surface.json`, and add a case to
   `test/conformance.test.js`.
4. `npm test`.
