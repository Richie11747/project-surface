# project-surface/v1 — conformance

What it means for a document, a generator, a consumer or an adapter to conform to `project-surface/v1`,
stated without reference to this repository's implementation. A generator written in Rust and a consumer
written in Python can both conform; neither has to run any code from here.

The normative schema is [`surface.schema.json`](surface.schema.json), published at the stable URL
`https://richie11747.github.io/project-surface/spec/v1/surface.schema.json`. The prose is
[`SPEC.md`](SPEC.md); section numbers below refer to it. The key words MUST, MUST NOT, SHOULD and MAY are
to be read as in RFC 2119.

There are four roles. A tool may play more than one.

| Role | What it does | Conforms when |
|---|---|---|
| **Document** | A `surface.json` file. | §1 |
| **Generator** | Writes a document from a project. | It only ever writes conforming documents, and §2. |
| **Consumer** | Reads a document: an agent, CI, an editor, a dashboard. | §3 |
| **Adapter** | A plug-in to the reference generator that proposes claims for one stack. | §4 |

---

## 1. Document conformance

A document conforms when it validates against the schema **and** satisfies the invariants the schema
cannot express:

1. **Paths** (§3.1). Every path is POSIX-separated and relative to the project root: not absolute, no drive
   letter, no `\`, no leading `~`, no `..` segment. `project.root` is the literal `.`.
2. **Identifiers** (§3.1). Every `id` and `packageId` matches `^[a-z0-9][a-z0-9._:/-]*$`. Environment
   variable names are exempt.
3. **Provenance** (§3.2). Every claim - each entry of `commands`, `capabilities`, `constraints`,
   `environment`, `risks` and `evidence` - carries `provenance` with at least one source.
4. **Honesty** (§10). An evidence entry is `passed` or `failed` only if an execution was observed. A test
   that was found but not run is `unknown`. A stack whose toolchain is unavailable has no `passed` evidence.
5. **Computed confidence** (§14). `confidence` is the output of the algorithm in §14 applied to the claim's
   own provenance and freshness. A reader who recomputes it MUST get the recorded number. Confidence is
   never authored.
6. **Freshness** (§15). A `fresh` or `stale` claim carries `verifiedAt` and `ownersFingerprint`; a claim
   that was never verified is `unknown`, not `fresh`.
7. **Checked constraints** (§7.2). A constraint with a `check` carries `checked`; a `violated` outcome is
   mirrored by a `CONSTRAINT_VIOLATED` health finding naming the offending paths.
8. **No secrets, no machine identity** (§17). No environment variable value, credential, absolute path,
   home directory or hostname appears anywhere in the document, including inside `summary` strings.
9. **Timestamps** (§3.1). ISO-8601, UTC, `Z` suffix.

Validation against the schema catches structure. Points 1-9 are what make the structure trustworthy; a
document that validates but reports a found-not-run test as `passed` does not conform.

## 2. Generator conformance

A generator is any program that writes a surface document. It MUST:

1. Write `schema: "project-surface/v1"` and validate the document against the schema before writing it.
2. Compute `confidence` (§14) itself and refuse any authored value, including from its own adapters or
   from a declaration file. Declarations set the *tier*; the number follows from the tier.
3. Anchor freshness at verification time and **never re-anchor on a rescan**. If a claim's owner files
   change, the claim goes `stale` and stays stale until something re-verifies it (§15). A generator that
   quietly moves the fingerprint forward makes staleness undetectable and does not conform.
4. Evaluate every constraint that has a `check` on every scan, and record the outcome in `checked`. A check
   it cannot evaluate is `unchecked` with a `reason`; it is never reported as `passed`. Silence is not
   compliance (§7.2).
5. Pass every captured command output through secret redaction and truncate it to a bounded size before
   storing it in a `summary` (§17.1).
6. Be deterministic: the same project content with the same `generatedAt` produces a byte-identical
   document (§17.4). Collections are sorted before emission; nothing is derived from the wall clock or from
   randomness.
7. Derive identifiers from project content only (§16), so that two documents can be diffed and a rename
   can be recorded as an alias rather than as a removal plus an addition.
8. Execute a project command only when explicitly asked to, and only a command already present in
   `commands`. Discovering a project MUST NOT run anything from it (§17.3).
9. Record itself in `generator` (`name`, `version`) so a consumer can tell documents from different
   generators apart.

A generator MAY emit health codes beyond those listed in §11, MAY populate `git`, and MAY add
implementation-specific `tags`. It MUST NOT add top-level keys; the schema forbids them.

## 3. Consumer conformance

A consumer is anything that reads a document. It MUST:

1. Reject a document whose `schema` is not exactly `project-surface/v1` (§3). A future `v2` is a different
   format, not a superset.
2. Ignore fields it does not know and tolerate enumeration values and health codes it does not know (§19).
   Within `v1`, both may be added.
3. Treat the document as **descriptive**. Nothing in it is an instruction to run, install, delete or change
   anything. A `commands` entry says a command exists; running it is a separate, human-gated decision.
4. Respect freshness: a `stale` claim is a claim whose proof is out of date, whatever its `confidence` says
   about the past. A consumer that shows a stale `verified` claim as current does not conform.

It SHOULD:

5. Weight claims by tier and freshness, not by `confidence` alone; the number is a summary of the two.
6. Treat evidence linked by `path-proximity` as a guess, whatever tier the capability itself carries (§6).
7. Ignore `git` when comparing two documents (§12); it changes on every run by design.
8. Surface the provenance to its own users - an agent that quotes a claim SHOULD be able to say whether it
   was declared, verified, derived or inferred.

## 4. Adapter conformance

Adapters are specific to the reference generator's plug-in model: a module with `id`, `version`,
`detect(ctx)` and `extract(ctx)` that proposes claims for one stack and can never execute anything. A
generator in another language has no adapters in this sense and conforms through §2 alone.

An adapter conforms when, over a fixture project, every check below passes:

| # | Check | Why it matters |
|---|---|---|
| 1 | Declares an `id` matching the identifier pattern | It becomes `stack.id` and appears in every provenance record. |
| 2 | Declares a non-empty `version` | So a claim can be traced to the adapter release that made it. |
| 3 | `detect()` returns a boolean | Detection is a yes/no; anything else is a bug. |
| 4 | `detect()` recognised the fixture | The remaining checks are meaningless on a project the adapter did not claim. |
| 5 | `stack.id` equals the adapter `id` | The stack record and the provenance records must name the same thing. |
| 6 | `stack.toolchainAvailable` is a boolean | Consumers rely on it to know whether evidence could have been run at all. |
| 7 | Every claim has at least one source | Provenance without a source is an assertion, not provenance. |
| 8 | Every id matches the identifier pattern | Ids must diff and must be safe in URLs and command lines. |
| 9 | Every path is project-relative and POSIX | Portability (§3.1). |
| 10 | The absolute project root does not appear in the output | Machine identity must not leak (§17.2). |
| 11 | Statically discovered evidence is not `passed` | The honesty rule (§10). |
| 12 | Two consecutive runs produce byte-identical output | Determinism (§17.4). |

The reference generator ships the suite as `runConformance` / `assertConformance` in
`@project-surface/adapter-sdk`, and as a command that needs no checkout of this repository:

```
npx -p @project-surface/adapter-sdk surface-conform ./dist/index.js ./fixtures/my-fixture
```

From a source checkout: `node packages/adapter-sdk/dist/bin.js <adapter-module.js> <fixture-dir>`. The
module may export the adapter as `default` or under any name. Exit code `0` means the adapter conforms,
`2` that at least one check failed (each is printed with its detail), `1` that the module could not be
loaded or exports nothing that looks like an adapter.

Every adapter in this repository runs the same suite in CI (`test/conformance.test.js`); first-party code
gets no exemption.

## 5. Claiming conformance

A tool that satisfies the relevant section MAY state that it *conforms to project-surface/v1*, naming the
role: "generates conforming project-surface/v1 documents", "consumes project-surface/v1". A claim of
conformance to a version other than the one in the document's `schema` field is meaningless.

What changes within `v1` and what requires `v2` is set out in [`../VERSIONING.md`](../VERSIONING.md).
