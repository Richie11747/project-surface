---
name: Constraint check request
about: A rule you want machine-checked, not just written down
labels: constraint-check
---

**The rule, in one sentence**
As it would appear in `.project/surface.declare.yaml` under `rule:`.

**What would make it violated?**
The concrete condition: an import from X to Y, a file that must not exist, a path with no test, ...

**What the generator needs to see to decide**
Import graph, file list, evidence links, manifest fields? If no adapter reports it today, say so - the
check would be `unchecked` with a reason until one does, never silently `passed`.

**Proposed `check` shape**
```yaml
check:
  kind: <new-kind>
  ...
```

**A fixture that violates it**
Which of `fixtures/*` could carry a deliberate violation, or what a new minimal one would contain.
