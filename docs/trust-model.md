# Trust model

Confidence in a surface document is **computed, never authored**. An adapter reports how it learned a
fact; core turns that into a number. An adapter cannot decide it is 95 % sure of something.

## Tiers

| Tier | Meaning | Floor | Ceiling |
|---|---|---|---|
| `declared` | A human asserted it in `.project/surface.declare.yaml`. | 1.00 | 1.00 |
| `verified` | A command was executed and its result observed. | 0.95 | 0.99 |
| `derived` | Read from structured config or a parsed syntax tree. | 0.70 | 0.90 |
| `inferred` | Heuristic guess from naming or layout. | 0.40 | 0.65 |

The bands do not overlap. A guess corroborated by fifty files still scores below a single derived fact.

## The formula

Implemented in `packages/core/src/model/confidence.ts` and tested in `packages/core/test/confidence.test.js`.

1. **Demotion.** A `verified` claim whose freshness is `stale` is treated as `derived`. Execution proves
   what the code did at a point in time; once the owner files change, that proof no longer describes the
   current code.
2. **Floor plus corroboration.** Start at the tier floor and add `0.05` per *distinct* source path beyond
   the first, capped at the tier ceiling.
3. **Stale penalty.** Multiply by `0.8` when stale - unless the tier is `declared`.
4. Clamp to `[0, 1]` and round to two decimals.

```
computeConfidence({ tier: "derived",  sourceCount: 1 })                      // 0.70
computeConfidence({ tier: "derived",  sourceCount: 3 })                      // 0.80
computeConfidence({ tier: "inferred", sourceCount: 50 })                     // 0.65 (ceiling)
computeConfidence({ tier: "verified", sourceCount: 1, freshness: "stale" })  // 0.56 (demoted, penalised)
computeConfidence({ tier: "declared", sourceCount: 1, freshness: "stale" })  // 1.00 (never decays)
```

## Promotion by evidence

When a test linked to a capability actually passes, the capability is promoted by **exactly one tier**:

- `inferred` → `derived`
- `derived` → `verified`
- `verified`, `declared` → unchanged

A green test proves the code behaves. It does not prove that the thing we guessed was a capability really
is one. So a guess with a passing test becomes a derived fact, not a verified one.

## Declarations never decay

A human owns a declared statement. If its owner files change, that is reported as a health finding for
the human to act on, rather than silently discounted. The document will not overrule a person.

## Freshness

Freshness is separate from confidence and feeds into it. Each verified claim stores `ownersFingerprint`,
an order-independent hash of its owner files at verification time (git blob SHAs inside a repository,
content hashes outside one).

| Status | Meaning |
|---|---|
| `unknown` | Never verified. Neither fresh nor stale - nobody has looked. |
| `fresh` | Verified, and the owner files are unchanged since. |
| `stale` | Verified, but an owner file changed since, or the backstop TTL (`staleAfterDays`, default 14) expired. |

The anchor moves only when the claim is re-verified. Rescanning does not clear staleness.

## Human labels

`surface inspect` shows `high` (≥ 0.85), `medium` (≥ 0.60) or `low`. These are for eyes. Programs should
read the number and the tier.
