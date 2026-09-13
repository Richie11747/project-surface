# @project-surface/adapter-sdk

The contract every [project-surface](https://github.com/Richie11747/project-surface) adapter implements, plus the conformance suite that proves it.

An adapter implements `detect` and `extract`, gets read-only file access through its context, and *proposes* claims - commands, capabilities, evidence, environment - each carrying a provenance tier and at least one source. It can never execute anything.

```ts
import { assertConformance } from "@project-surface/adapter-sdk";

await assertConformance(myAdapter, "fixtures/my-fixture");
```

The conformance suite enforces what every consumer relies on:

- every claim names a source file and an honest tier (`derived` or `inferred`),
- no absolute or machine-specific path leaks into the output,
- statically discovered evidence is never reported as `passed`,
- two runs over the same project produce byte-identical output.

The same suite runs as a command, for adapters that live outside the project-surface repository:

```
npx -p @project-surface/adapter-sdk surface-conform ./dist/index.js fixtures/my-fixture
```

Exit `0` conforms, `2` a check failed (each is printed with its detail), `1` the module is not an adapter.

Also exported: claim builders, contract-document discovery (`findContracts`) and toolchain probes (`isOnPath`) that check for a binary without running it.

Read [`docs/adapters.md`](../../docs/adapters.md) before writing one.