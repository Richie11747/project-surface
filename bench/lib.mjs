/**
 * Shared by `record.mjs` (calls the model) and `score.mjs` (never does).
 *
 * Two conditions, one question, one grader:
 *
 *   raw      the model gets every file of the fixture, verbatim
 *   surface  the model gets what an agent gets from project-surface: the
 *            overview and a task-scoped context pack (with file contents)
 *
 * Both answer in the same JSON shape and are graded by the same code against
 * ground truth written from the fixture sources. Prompts are built here so
 * that a scoring run can reproduce, byte for byte, what was sent.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSurface, packContext, readFileSafe } from "@project-surface/core";
import { CONFORMANCE_NOW } from "@project-surface/adapter-sdk";
import { typescriptAdapter } from "@project-surface/adapter-typescript";
import { pythonAdapter } from "@project-surface/adapter-python";
import { goAdapter } from "@project-surface/adapter-go";
import { rustAdapter } from "@project-surface/adapter-rust";
import { genericAdapter } from "@project-surface/adapter-generic";

export const BENCH_DIR = fileURLToPath(new URL("./", import.meta.url));
export const FIXTURES_DIR = fileURLToPath(new URL("../fixtures/", import.meta.url));
export const RECORDED_DIR = join(BENCH_DIR, "recorded");
export const CONDITIONS = ["raw", "surface"];

export const MODEL = "claude-opus-5";
/**
 * USD per million tokens, from each vendor's pricing table current at
 * recording time, keyed by model id prefix. A model that is not listed costs
 * `null`, and the results table says so rather than printing $0.00.
 */
export const PRICES = {
  "claude-opus-5": { input: 5, output: 25 },
  "claude-sonnet-5": { input: 3, output: 15 },
  "gpt-5-mini": { input: 0.25, output: 2 },
  "gpt-5": { input: 1.25, output: 10 },
};
/** @deprecated use PRICES; kept for callers that priced the default model. */
export const PRICE = PRICES[MODEL];

export function priceFor(model) {
  const key = Object.keys(PRICES)
    .sort((a, b) => b.length - a.length)
    .find((k) => (model ?? MODEL).startsWith(k));
  return key ? PRICES[key] : null;
}

export function loadQuestions() {
  return JSON.parse(readFileSync(join(BENCH_DIR, "questions.json"), "utf8")).questions;
}

/** Every committed file of a fixture, sorted, excluding the golden snapshot. */
export function listFixtureFiles(fixture) {
  const root = join(FIXTURES_DIR, fixture);
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir).sort()) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else out.push(relative(root, full).split("\\").join("/"));
    }
  };
  walk(root);
  return out.filter((f) => f !== "expected.surface.json" && f !== ".project/surface.json");
}

export async function fixtureSurface(fixture) {
  const root = join(FIXTURES_DIR, fixture);
  const { surface } = await buildSurface({
    root,
    adapters: [typescriptAdapter, pythonAdapter, goAdapter, rustAdapter, genericAdapter],
    previous: null,
    now: CONFORMANCE_NOW,
  });
  return { root, surface };
}

export const SYSTEM = [
  "You answer questions about a software repository for another engineer.",
  "Answer only from the material provided. Every path must be exactly as it appears in the material, relative to the repository root.",
  "If the honest answer is that nothing matches, return empty lists.",
  "Reply with a single JSON object and nothing else: {\"files\": string[], \"commands\": string[], \"env\": string[], \"reasoning\": string}.",
  "Put file paths in `files`, shell commands in `commands`, environment variable names in `env`. Leave a list empty when the question does not ask for that kind of thing.",
].join(" ");

export function rawPrompt(fixture, question) {
  const root = join(FIXTURES_DIR, fixture);
  const files = listFixtureFiles(fixture);
  const parts = [`Repository: ${fixture}`, "", "Files:", ...files.map((f) => `  ${f}`), ""];
  for (const f of files) {
    parts.push(`===== ${f} =====`);
    parts.push(readFileSync(join(root, f), "utf8").trimEnd());
    parts.push("");
  }
  parts.push(`Question: ${question}`);
  return parts.join("\n");
}

export async function surfacePrompt(fixture, question) {
  const { root, surface } = await fixtureSurface(fixture);
  const pack = packContext(surface, question, (p) => readFileSafe(root, p), {
    includeContent: true,
    budgetTokens: 8000,
  });
  const overview = {
    project: surface.project.name,
    commands: surface.commands.map((c) => ({ id: c.id, run: c.run, kind: c.kind, cwd: c.cwd })),
    capabilities: surface.capabilities.map((c) => ({
      id: c.id,
      title: c.title,
      owners: c.owners.map((o) => o.path),
      contracts: c.contracts.map((o) => o.path),
      evidence: c.evidence.map((e) => surface.evidence.find((x) => x.id === e.id)?.path ?? e.id),
      environment: c.environment,
      tier: c.provenance.tier,
      confidence: c.confidence,
    })),
    constraints: surface.constraints.map((c) => ({
      rule: c.rule,
      severity: c.severity,
      source: c.provenance.sources[0]?.path,
      ...(c.check ? { check: c.check, checked: c.checked } : {}),
    })),
    environment: surface.environment.map((e) => ({ name: e.name, usedBy: e.usedBy.map((u) => u.path) })),
    risks: surface.risks.map((r) => ({ paths: r.paths, type: r.type, reason: r.reason })),
    health: surface.health.map((h) => ({ code: h.code, severity: h.severity, message: h.message })),
  };
  const parts = [
    `Repository: ${fixture}`,
    "",
    "The repository has a project-surface document. Overview (JSON):",
    JSON.stringify(overview),
    "",
    "Task-scoped context pack from `surface context` (JSON), with the contents of the files it selected:",
    JSON.stringify(pack),
    "",
    `Question: ${question}`,
  ];
  return parts.join("\n");
}

export async function buildPrompt(condition, fixture, question) {
  return condition === "raw" ? rawPrompt(fixture, question) : surfacePrompt(fixture, question);
}

/* ---------------------------------------------------------------- grading */

function normPath(p) {
  return String(p).trim().replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "");
}

function normCommand(c) {
  return String(c).trim().replace(/\s+/g, " ").toLowerCase();
}

function setScore(expected, actual, norm) {
  const exp = new Set(expected.map(norm));
  const act = new Set(actual.map(norm));
  if (exp.size === 0 && act.size === 0) return { precision: 1, recall: 1, exact: true };
  const hits = [...act].filter((a) => exp.has(a)).length;
  const precision = act.size === 0 ? 0 : hits / act.size;
  const recall = exp.size === 0 ? (act.size === 0 ? 1 : 0) : hits / exp.size;
  return { precision, recall, exact: hits === exp.size && act.size === exp.size };
}

/**
 * Grade one answer. Only the kinds the question asks for are graded; a
 * command question is scored as hit/miss against the accepted spellings.
 */
export function grade(question, answer) {
  const expect = question.expect;
  const out = {};
  if (expect.files !== undefined) out.files = setScore(expect.files, answer.files ?? [], normPath);
  if (expect.env !== undefined) out.env = setScore(expect.env, answer.env ?? [], (s) => String(s).trim());
  if (expect.commands !== undefined) {
    const given = (answer.commands ?? []).map(normCommand);
    const accepted = expect.commands.map(normCommand);
    const hit = given.some((g) => accepted.some((a) => g === a || g.endsWith(` ${a}`) || g.includes(a)));
    out.commands = { precision: hit ? 1 : 0, recall: hit ? 1 : 0, exact: hit };
  }
  const parts = Object.values(out);
  const mean = (k) => parts.reduce((s, p) => s + p[k], 0) / parts.length;
  return { ...out, precision: mean("precision"), recall: mean("recall"), exact: parts.every((p) => p.exact) };
}

/** USD for one recording, or `null` when the model has no known price. */
export function cost(usage, model) {
  const price = priceFor(model);
  if (!price) return null;
  return ((usage.input_tokens ?? 0) * price.input + (usage.output_tokens ?? 0) * price.output) / 1_000_000;
}
