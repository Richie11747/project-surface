/**
 * The HTML shell for `surface report`.
 *
 * Split from report.ts so the markup and the data shaping stay legible on their
 * own. The palette is defined once for light and overridden for dark, so the
 * page follows the reader rather than picking a side.
 */

import type { Surface } from "@project-surface/core";
import {
  capabilityRows,
  commandRows,
  constraintItems,
  escape,
  healthItems,
} from "./report.js";

const STYLES = `
  :root {
    --bg: #ffffff; --fg: #17181c; --muted: #6b7280; --line: #e5e7eb; --card: #f9fafb;
    --green: #047857; --amber: #b45309; --red: #b91c1c; --blue: #1d4ed8;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #0d0e12; --fg: #e8eaed; --muted: #9aa0aa; --line: #262a33; --card: #15171d;
      --green: #34d399; --amber: #fbbf24; --red: #f87171; --blue: #60a5fa;
    }
  }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 2rem 1.25rem 4rem; background: var(--bg); color: var(--fg);
    font: 15px/1.55 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  main { max-width: 1100px; margin: 0 auto; }
  h1 { font-size: 1.6rem; margin: 0 0 .25rem; }
  h2 { font-size: 1.05rem; margin: 2.5rem 0 .75rem; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .86em; }
  .muted { color: var(--muted); font-size: .86em; }
  .meta { color: var(--muted); margin-bottom: 1.5rem; }
  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: .75rem; }
  .card { background: var(--card); border: 1px solid var(--line); border-radius: 8px; padding: .75rem .9rem; }
  .card .n { font-size: 1.5rem; font-weight: 600; }
  .scroll { overflow-x: auto; border: 1px solid var(--line); border-radius: 8px; }
  table { border-collapse: collapse; width: 100%; min-width: 760px; }
  th, td { text-align: left; padding: .6rem .8rem; border-bottom: 1px solid var(--line); vertical-align: top; }
  th { font-size: .72rem; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); }
  tr:last-child td { border-bottom: none; }
  ul { padding-left: 0; list-style: none; margin: 0; }
  li { border: 1px solid var(--line); border-radius: 8px; padding: .7rem .9rem; margin-bottom: .5rem; background: var(--card); }
  .badge { display: inline-block; padding: .1rem .45rem; border-radius: 999px; font-size: .72rem;
    font-weight: 600; border: 1px solid currentColor; white-space: nowrap; }
  .tier-declared, .tier-verified, .fresh-fresh, .st-passed, .conf-high { color: var(--green); }
  .tier-derived { color: var(--blue); }
  .tier-inferred, .conf-low, .st-failed, .sev-error { color: var(--red); }
  .conf-medium, .fresh-stale, .sev-warn, .st-unknown { color: var(--amber); }
  .fresh-unknown, .sev-info, .st-skipped { color: var(--muted); }
  footer { margin-top: 3rem; color: var(--muted); font-size: .82rem; }
`;

export function renderHtml(surface: Surface): string {
  const stacks = surface.project.stacks.map((s) => s.id).join(", ") || "no stack detected";
  const healthErrors = surface.health.filter((h) => h.severity === "error").length;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(surface.project.name)} - project surface</title>
<style>${STYLES}</style>
</head>
<body>
<main>
  <h1>${escape(surface.project.name)}</h1>
  <div class="meta">
    ${escape(stacks)}
    &middot; generated ${escape(surface.generatedAt)}
    &middot; ${escape(surface.generator.name)} ${escape(surface.generator.version)}
  </div>

  <div class="cards">
    <div class="card"><div class="n">${surface.capabilities.length}</div><div class="muted">capabilities</div></div>
    <div class="card"><div class="n">${surface.commands.length}</div><div class="muted">commands</div></div>
    <div class="card"><div class="n">${surface.evidence.length}</div><div class="muted">evidence</div></div>
    <div class="card"><div class="n">${surface.constraints.length}</div><div class="muted">constraints</div></div>
    <div class="card"><div class="n">${healthErrors}</div><div class="muted">health errors</div></div>
  </div>

  <h2>Capabilities</h2>
  <div class="scroll"><table>
    <thead><tr><th>Capability</th><th>Owner</th><th>Contract</th><th>Evidence</th><th>Provenance</th><th>Confidence</th><th>Freshness</th></tr></thead>
    <tbody>${capabilityRows(surface) || '<tr><td colspan="7" class="muted">None discovered.</td></tr>'}</tbody>
  </table></div>

  <h2>Commands</h2>
  <div class="scroll"><table>
    <thead><tr><th>Id</th><th>Run</th><th>Kind</th><th>Last result</th><th>Confidence</th></tr></thead>
    <tbody>${commandRows(surface) || '<tr><td colspan="5" class="muted">None discovered.</td></tr>'}</tbody>
  </table></div>

  <h2>Constraints</h2>
  <ul>${constraintItems(surface) || '<li class="muted">None.</li>'}</ul>

  <h2>Health</h2>
  <ul>${healthItems(surface) || '<li class="muted">Nothing to report.</li>'}</ul>

  <footer>
    Provenance tiers, strongest first: declared, verified, derived, inferred.
    A claim marked inferred is a heuristic guess and should be checked before it is relied on.
  </footer>
</main>
</body>
</html>
`;
}
