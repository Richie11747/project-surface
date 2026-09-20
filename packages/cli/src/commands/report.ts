/**
 * `surface report` - a self-contained HTML view.
 *
 * No external assets, no scripts, no network. The file can be opened from a CI
 * artifact directory or emailed, and it renders the same everywhere. It is
 * written to .project/surface.html, which .gitignore excludes: the JSON is the
 * artifact worth committing, this is a convenience.
 */

import { parseArgs } from "node:util";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { confidenceLabel } from "@project-surface/core";
import type { Surface } from "@project-surface/core";
import { GLOBAL_OPTIONS, requireSurface, resolveWriteTarget, type GlobalOptions } from "../context.js";
import { print, printJson, style } from "../output.js";
import { renderHtml } from "./report-template.js";

export async function run(args: string[], options: GlobalOptions): Promise<number> {
  const { values } = parseArgs({ args, strict: true, allowPositionals: true, options: { ...GLOBAL_OPTIONS, out: { type: "string" } } });

  const surface = requireSurface(options);
  const requested = typeof values.out === "string" ? values.out : ".project/surface.html";
  const { full: target, rel: relative } = resolveWriteTarget(options.root, requested);

  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, renderHtml(surface), "utf8");

  if (options.json) {
    printJson({ written: relative });
    return 0;
  }
  print(`Wrote ${style.bold(relative)}`);
  print(style.dim("  Self-contained: no scripts, no external assets, no network."));
  return 0;
}

export function escape(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function badge(label: string, kind: string): string {
  return `<span class="badge ${kind}">${escape(label)}</span>`;
}

export function confidenceBadge(score: number): string {
  const label = confidenceLabel(score);
  return badge(`${score.toFixed(2)} ${label}`, `conf-${label}`);
}

export function capabilityRows(surface: Surface): string {
  return surface.capabilities
    .map((c) => {
      const evidence = surface.evidence.filter((e) => c.evidence.some((r) => r.id === e.id));
      return `<tr>
        <td><code>${escape(c.id)}</code><div class="muted">${escape(c.title)}</div></td>
        <td>${c.owners.map((o) => `<code>${escape(o.path)}</code>`).join("<br>")}</td>
        <td>${c.contracts.map((o) => `<code>${escape(o.path)}</code>`).join("<br>") || '<span class="muted">none</span>'}</td>
        <td>${evidence.map((e) => `<code>${escape(e.path ?? e.id)}</code> ${badge(e.status, `st-${e.status}`)}`).join("<br>") || '<span class="muted">none</span>'}</td>
        <td>${badge(c.provenance.tier, `tier-${c.provenance.tier}`)}</td>
        <td>${confidenceBadge(c.confidence)}</td>
        <td>${badge(c.freshness?.status ?? "unknown", `fresh-${c.freshness?.status ?? "unknown"}`)}</td>
      </tr>`;
    })
    .join("\n");
}

export function commandRows(surface: Surface): string {
  return surface.commands
    .map(
      (c) => `<tr>
        <td><code>${escape(c.id)}</code></td>
        <td><code>${escape(c.run)}</code></td>
        <td>${escape(c.kind)}</td>
        <td>${c.verification ? badge(c.verification.status, `st-${c.verification.status}`) : '<span class="muted">never run</span>'}</td>
        <td>${confidenceBadge(c.confidence)}</td>
      </tr>`
    )
    .join("\n");
}

export function healthItems(surface: Surface): string {
  return surface.health
    .map(
      (f) => `<li>
        ${badge(f.severity, `sev-${f.severity}`)} <strong>${escape(f.code)}</strong>
        ${f.subject ? `<code>${escape(f.subject.id)}</code>` : ""}
        <div>${escape(f.message)}</div>
        ${f.remediation ? `<div class="muted">${escape(f.remediation)}</div>` : ""}
      </li>`
    )
    .join("\n");
}

export function constraintItems(surface: Surface): string {
  return surface.constraints
    .map(
      (c) =>
        `<li>${badge(c.severity, `sev-${c.severity}`)} ${escape(c.rule)} ` +
        `<span class="muted">${escape(c.provenance.sources.map((s) => s.path).join(", "))}</span></li>`
    )
    .join("\n");
}
