# Declarations

Inference is wrong sometimes. When it is, state the truth once in `.project/surface.declare.yaml` and every
tool respects it. Declarations are loaded last, at tier `declared` (confidence `1.00`), and override
anything an adapter produced for the same id.

Full example: [`examples/surface.declare.yaml`](../examples/surface.declare.yaml).

## Format

```yaml
project:
  name: checkout-api            # overrides the detected name

capabilities:
  - id: checkout.create         # optional; derived from the first owner when absent
    title: Creates a checkout session
    description: Validates the cart and opens a Stripe session.
    owners: [src/checkout/create.ts]           # at least one, project-relative
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
