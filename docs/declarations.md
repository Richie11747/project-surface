# Declarations

Inference is wrong sometimes. When it is, state the truth once in `.project/surface.declare.yaml` and every
tool respects it. Declarations are loaded last, at tier `declared` (confidence `1.00`), and override
anything an adapter produced for the same id.

Full example: [`examples/surface.declare.yaml`](../examples/surface.declare.yaml).

## Format

```yaml
project:
  name: checkout-api            # overrides the detected name

ignore:                         # files the scan must not see at all (globs)
  - fixtures/**                 # example projects that are inputs, not this project
  - vendor/legacy-client

capabilities:
  - id: checkout.create         # optional; derived from the first owner when absent
    title: Creates a checkout session
    description: Validates the cart and opens a Stripe session.
    owners: [src/checkout/**]                  # at least one; files or globs, project-relative
    contracts: [docs/contracts/checkout.md]
    evidence: [tests/checkout/create.test.ts]  # linked with link: declared
    environment: [DATABASE_URL, STRIPE_SECRET_KEY]
    tags: [http, payments]

commands:
  - id: e2e                     # optional; defaults to the run string
    run: npm run test:e2e
    cwd: .                      # default
    kind: test                  # test build dev lint typecheck format start migrate other
    description: Playwright suite against a local server.

constraints:
  - rule: Never call the payment provider from a request handler.
    rationale: Handlers must stay idempotent; provider calls go through the job queue.
    severity: error             # error | warn | info (default warn)

risks:
  - paths: [db/migrations]
    type: migration             # migration secret infra generated external-service
    approval: required          # required | advisory
    reason: Schema changes are hard to roll back.

environment:
  - DATABASE_URL                # shorthand: required, secret inferred from the name
  - name: STRIPE_SECRET_KEY
    required: true
    secret: true
```

## Rules

- Paths are project-relative and POSIX. Absolute paths are rejected.
- A declared capability whose owner file changes is **not** discounted - a human owns the statement. It is
  reported as a health finding so the person can update the declaration.
- An invalid entry does not abort the scan. It is collected and surfaced as `DECLARATION_INVALID`
  (severity `error`), which makes `surface doctor` exit `2`.
- Declaring a capability with the same id as an inferred one replaces it. Keep the old id in `aliases` if
  you rename, so diffs and consumers stay continuous.

## Scope: `ignore`

`ignore` lists globs for files the scan must not see. They are removed from the file list *before* any
adapter runs, so an ignored `package.json` produces no package, no commands and no capabilities. Use it for
example projects, test fixtures that are repositories in their own right, and vendored code. Patterns are
project-relative; `**` crosses directories, `*` and `?` do not; a bare path names a file or a whole tree.
`.gitignore` is still respected on top of this - `ignore` is for files you *do* commit but do not want
described.

## Granularity: glob owners and absorption

Inference works at the granularity it can see - one exported symbol, one route. A declaration works at the
granularity that matters. Two rules make that possible:

1. **Owners may be globs.** `owners: [src/model/**]` is expanded against the file list at scan time, so
   fingerprints, missing-owner checks and impact analysis all work on concrete files. A glob that matches
   nothing is a `DECLARATION_INVALID` error, because a claim about no files is not a claim.
2. **A declaration absorbs the guesses it covers.** An `inferred` capability whose owner files all lie
   within a declared capability's owners is folded into it: its sources become corroboration, its evidence
   links and environment names are merged, and its id is kept in `aliases` so nothing that learned the old
   id breaks. Only `inferred` claims are absorbed. A `derived` claim - a route parsed from real code, a
   command read from a manifest - stands on its own unless a declaration reuses its id.

The self-surface of this repository ([`.project/surface.declare.yaml`](../.project/surface.declare.yaml))
is the worked example: 156 exported symbols become 32 declared capabilities, each with a contract and a
test suite, and one honest leftover that no declaration covers.
