/**
 * Terminal formatting.
 *
 * Two rules keep the CLI usable in the places it actually runs. Colour is
 * disabled whenever output is not a TTY, so piping into a file or an agent
 * yields clean text. And every command supports `--json`, because the primary
 * consumer of this tool is a program, not a person.
 */

import pc from "picocolors";
import { confidenceLabel } from "@project-surface/core";
import type { Freshness, HealthFinding, ProvenanceTier, Severity } from "@project-surface/core";

let colorEnabled = true;

export function setColor(enabled: boolean): void {
  colorEnabled = enabled;
}

function paint(fn: (s: string) => string, text: string): string {
  return colorEnabled ? fn(text) : text;
}

export const style = {
  bold: (s: string): string => paint(pc.bold, s),
  dim: (s: string): string => paint(pc.dim, s),
  red: (s: string): string => paint(pc.red, s),
  yellow: (s: string): string => paint(pc.yellow, s),
  green: (s: string): string => paint(pc.green, s),
  cyan: (s: string): string => paint(pc.cyan, s),
  magenta: (s: string): string => paint(pc.magenta, s),
};

export function heading(text: string): string {
  return style.bold(text);
}

/** Confidence rendered so the reader sees the number and the judgement. */
export function confidence(score: number): string {
  const label = confidenceLabel(score);
  const text = `${score.toFixed(2)} ${label}`;
  if (label === "high") return style.green(text);
  if (label === "medium") return style.yellow(text);
  return style.red(text);
}

export function tier(value: ProvenanceTier): string {
  if (value === "declared") return style.magenta(value);
  if (value === "verified") return style.green(value);
  if (value === "derived") return style.cyan(value);
  return style.dim(value);
}

export function freshness(value: Freshness | undefined): string {
  if (!value || value.status === "unknown") return style.dim("unverified");
  if (value.status === "stale") return style.yellow("stale");
  return style.green("fresh");
}

export function severity(value: Severity): string {
  if (value === "error") return style.red(value);
  if (value === "warn") return style.yellow(value);
  return style.dim(value);
}

export function finding(f: HealthFinding): string {
  const subject = f.subject ? style.dim(` [${f.subject.id}]`) : "";
  const remediation = f.remediation ? `\n      ${style.dim(f.remediation)}` : "";
  return `  ${severity(f.severity).padEnd(16)} ${style.bold(f.code)}${subject}\n      ${f.message}${remediation}`;
}

/** Left-aligned columns, sized to content. Avoids a table dependency. */
export function table(rows: string[][]): string {
  if (rows.length === 0) return "";
  const widths: number[] = [];
  for (const row of rows) {
    row.forEach((cell, i) => {
      widths[i] = Math.max(widths[i] ?? 0, visibleLength(cell));
    });
  }
  return rows
    .map((row) =>
      row
        .map((cell, i) =>
          i === row.length - 1 ? cell : cell + " ".repeat((widths[i] ?? 0) - visibleLength(cell))
        )
        .join("  ")
    )
    .join("\n");
}

/** Length ignoring ANSI escapes, so colour does not break alignment. */
function visibleLength(text: string): number {
  return text.replace(/\u001B\[[0-9;]*m/g, "").length;
}

export function bullet(text: string): string {
  return `  ${style.dim("-")} ${text}`;
}

export function print(text: string): void {
  process.stdout.write(`${text}\n`);
}

export function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

export function printError(text: string): void {
  process.stderr.write(`${style.red("error")} ${text}\n`);
}
