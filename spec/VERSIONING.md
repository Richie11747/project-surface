# Versioning the project-surface format

The format has one version number, and it is the `schema` string inside every document: `project-surface/v1`.
This page says what may change without touching that string, what may not, and how a new version would be
introduced. It exists so that someone writing a generator or a consumer today can know what they are
committing to.

## The stable identifier

The schema for `v1` is published at

```
https://richie11747.github.io/project-surface/spec/v1/surface.schema.json
```

and that URL is its `$id`. The path carries the version. The URL will keep resolving to a `v1` schema for as
long as this project exists; a `v2` would live at `/spec/v2/` and leave `/spec/v1/` untouched. The file in
this repository (`spec/v1/surface.schema.json`) and the copy embedded in `@project-surface/core` are
checked for byte-equality in CI; the published URL serves the file from `main`.

## What may change within `v1`

These are **additive** and do not change the `schema` string. Consumers are required to tolerate them
([`CONFORMANCE.md` §3](v1/CONFORMANCE.md)):

| Change | Consumer obligation |
|---|---|
| A new **optional** field on any object | Ignore it if unknown. |
| A new value in an enumeration (`kind`, `type`, `status`, `link`, `check.kind`, ...) | Tolerate it; treat an unknown `check.kind` as `unchecked`. |
| A new health finding `code` | Tolerate it; display the `message`. |
| A new adapter / `stack.id` | Nothing; stack ids are open. |
| Prose clarifications in `SPEC.md` that do not change what validates | Nothing. |
| Tightening a pattern or constraint that every conforming document already satisfied | Nothing. |

Each additive change is recorded in the repository `CHANGELOG.md` under the heading **Specification**, with
the package release that first emitted it.

## What requires `v2`

Any change that could make a conforming `v1` document invalid, or change what an existing document
*means*, is breaking. In particular:

- removing or renaming a field, or making an optional field required;
- changing the type of a field, or the format of `timestamp`, `path` or `identifier`;
- removing a value from an enumeration;
- changing the meaning, order, floor or ceiling of a provenance tier (§13);
- changing the confidence algorithm (§14) such that an existing document would recompute to a different
  number - a reader must be able to verify the recorded value;
- changing identifier derivation (§16) so that the same project yields different ids;
- weakening the honesty rule (§10), the path rules (§3.1) or the safety requirements (§17);
- changing the freshness anchoring rule (§15) in either direction.

A breaking change means a new directory `spec/v2/`, a new `$id`, a new `schema` string
`project-surface/v2`, and a new `SPEC.md`. `v1` documents remain valid `v1` documents forever; a consumer
that only knows `v1` MUST reject a `v2` document rather than guess.

## Deprecation

A field or value that is going to be removed in `v2` is first marked *deprecated* in `SPEC.md`, stays valid
for the whole remaining life of `v1`, and is listed in the `v2` specification under a migration heading.
Nothing is ever silently dropped from `v1`.

## Packages versus the format

The npm packages (`project-surface`, `@project-surface/core`, `@project-surface/adapter-sdk`, the adapters,
`@project-surface/mcp-server`) follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
independently of the format:

- A package **major** does not imply a format version bump. `project-surface 2.0.0` can still write
  `project-surface/v1` documents - and is expected to.
- A format version bump **does** imply a package major for every package that emits or reads the document.
- The reference generator reads every format version it has ever written for at least one further package
  major after the next format version appears, so a repository can regenerate its committed surface with a
  newer tool without a manual migration step.
- `generator.version` in the document is the package version, never the format version; `schema` is the
  format version. Both are present so that a consumer can tell "which format" from "which tool".

## Adapters

An adapter's `version` is its own; it appears in `provenance` records so that a claim can be traced to the
adapter release that made it. Adapters are bound to the `Adapter` contract of `@project-surface/adapter-sdk`,
which follows the package's semver: a breaking change to `AdapterContext` or `AdapterResult` is a major of
that package, not a format change.
