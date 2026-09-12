import { test } from "node:test";
import assert from "node:assert/strict";
import { renderDiffMarkdown, DIFF_COMMENT_MARKER } from "../dist/index.js";

/*
 * The pull-request comment renderer. It must be findable (marker), scannable
 * (one summary line), and must not become a wall of text on a big refactor.
 */

const empty = { added: [], removed: [], changed: [] };

test("an empty diff says so and still carries the marker", () => {
  const md = renderDiffMarkdown(
    { capabilities: empty, commands: empty, constraints: empty, health: { appeared: [], resolved: [] }, empty: true },
    "origin/main"
  );
  assert.ok(md.startsWith(DIFF_COMMENT_MARKER));
  assert.match(md, /Nothing about the project surface changed since `origin\/main`/);
});

test("a diff summarises counts on one line and lists findings with severity", () => {
  const md = renderDiffMarkdown(
    {
      capabilities: { added: ["checkout.complete"], removed: [], changed: [{ id: "checkout.create", changes: [{ field: "confidence", before: "0.95", after: "0.56" }] }] },
      commands: empty,
      constraints: { added: ["constraint:no-provider-in-handlers"], removed: [], changed: [] },
      health: {
        appeared: [
          { code: "CONSTRAINT_VIOLATED", severity: "warn", message: "Constraint violated | see file", subject: { kind: "constraint", id: "constraint:no-provider-in-handlers" }, remediation: "Fix it" },
        ],
        resolved: [{ code: "UNPROVEN_CAPABILITY", severity: "info", message: "x", subject: { kind: "capability", id: "a.b" } }],
      },
      empty: false,
    },
    "origin/main"
  );
  assert.match(md, /^Since `origin\/main`: capabilities \+1 ~1 · constraints \+1 · 1 new finding · 1 resolved\.$/m);
  assert.match(md, /- \*\*added\*\* `checkout\.complete`/);
  assert.match(md, /confidence: `0\.95` → `0\.56`/);
  assert.match(md, /- \*\*warn\*\* `CONSTRAINT_VIOLATED` \(constraint `constraint:no-provider-in-handlers`\): Constraint violated \\\| see file/);
  assert.match(md, /fix: Fix it/);
  assert.match(md, /### Resolved\n\n- `UNPROVEN_CAPABILITY` \(capability `a\.b`\)/);
  assert.doesNotMatch(md, /<details>/, "short lists are not collapsed");
});

test("long lists are collapsed", () => {
  const added = Array.from({ length: 30 }, (_, i) => `cap.${i}`);
  const md = renderDiffMarkdown(
    { capabilities: { added, removed: [], changed: [] }, commands: empty, constraints: empty, health: { appeared: [], resolved: [] }, empty: false },
    "HEAD"
  );
  assert.match(md, /<details><summary>30 entries<\/summary>/);
  assert.match(md, /<\/details>/);
});
