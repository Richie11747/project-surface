/**
 * @project-surface/adapter-generic
 *
 * The floor under every other adapter. A repository nobody recognises still
 * has structure a human would read first: a Makefile or justfile that says how
 * it is built and tested, a Taskfile, an `.env.example` that lists what it
 * needs. This adapter reads exactly that and nothing more.
 *
 * It runs in two situations. When no language adapter recognises the project it
 * runs as the fallback, so the tool never answers with an empty document and no
 * explanation. When a language adapter did run, it still contributes if a build
 * file exists - `make lint` is a real command in a Go repository too.
 *
 * It claims no capabilities. Guessing behaviour from a Makefile would be
 * exactly the kind of confident-sounding inference this project exists to
 * avoid; the honest answer is `NO_CAPABILITIES` plus a pointer to declarations.
 */

import { classifyCommand, emptyResult, isOnPath, isSafeCommandToken, provenance, source } from "@project-surface/adapter-sdk";
import type { Adapter, AdapterContext, AdapterResult, DraftCommand, DraftEnvironmentVariable } from "@project-surface/adapter-sdk";
import { commandId, looksSecretName } from "@project-surface/core";

export const ADAPTER_ID = "generic";
export const ADAPTER_VERSION = "0.2.0";

const MAKEFILES = ["Makefile", "GNUmakefile", "makefile"];
const JUSTFILES = ["justfile", "Justfile", ".justfile"];
const TASKFILES = ["Taskfile.yml", "Taskfile.yaml", "taskfile.yml"];
const ENV_EXAMPLES = [".env.example", ".env.sample", ".env.template"];

const MAKE_TARGET = /^([A-Za-z0-9][A-Za-z0-9_.-]*)\s*:(?!=)/;
const JUST_RECIPE = /^(?:@)?([A-Za-z_][A-Za-z0-9_-]*)(?:\s+([^:]*?))?\s*:(?!=)/;
const ENV_LINE = /^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=/;

function first(ctx: AdapterContext, names: string[]): string | null {
  return names.find((n) => ctx.exists(n)) ?? null;
}

/** Targets a person would type. Pattern rules, variables and specials are not. */
export function makeTargets(content: string): string[] {
  const out: string[] = [];
  for (const raw of content.split("\n")) {
    if (/^\s/.test(raw) || raw.startsWith("#")) continue;
    const m = MAKE_TARGET.exec(raw);
    const name = m?.[1];
    if (!name || name.startsWith(".") || name.includes("%") || name.includes("$")) continue;
    if (!out.includes(name)) out.push(name);
  }
  return out;
}

export type JustRecipe = { name: string; parameters: string[] };

export function justRecipes(content: string): JustRecipe[] {
  const out: JustRecipe[] = [];
  for (const raw of content.split("\n")) {
    if (/^\s/.test(raw) || raw.startsWith("#") || raw.startsWith("set ") || raw.startsWith("import ") || raw.startsWith("mod ")) continue;
    if (/^[A-Za-z_][A-Za-z0-9_-]*\s*:=/.test(raw)) continue;
    const m = JUST_RECIPE.exec(raw);
    const name = m?.[1];
    if (!name || name.startsWith("_")) continue;
    const parameters = (m[2] ?? "").trim().split(/\s+/).filter(Boolean).map((parameter) => parameter.split("=", 1)[0] ?? parameter);
    if (!out.some((recipe) => recipe.name === name)) out.push({ name, parameters });
  }
  return out;
}

/** Top-level keys under `tasks:` in a Taskfile. */
export function taskfileTasks(content: string): string[] {
  const out: string[] = [];
  let inTasks = false;
  for (const raw of content.split("\n")) {
    if (/^tasks:\s*$/.test(raw)) {
      inTasks = true;
      continue;
    }
    if (inTasks && /^\S/.test(raw)) inTasks = false;
    if (!inTasks) continue;
    const m = /^  ([A-Za-z0-9_:.-]+):\s*$/.exec(raw);
    if (m?.[1] && !out.includes(m[1])) out.push(m[1]);
  }
  return out;
}

export function envExampleNames(content: string): string[] {
  const out = new Set<string>();
  for (const raw of content.split("\n")) {
    const m = ENV_LINE.exec(raw);
    if (m?.[1]) out.add(m[1]);
  }
  return [...out].sort();
}

export const genericAdapter: Adapter = {
  id: ADAPTER_ID,
  version: ADAPTER_VERSION,
  fallback: true,

  /* A build file is reason enough to contribute beside a language adapter;
     an .env.example alone is not - the language adapters already read env
     usage from source, and a second stack entry for every project that ships
     an example file would be noise. It is still read once this adapter runs. */
  detect(ctx: AdapterContext): boolean {
    return first(ctx, [...MAKEFILES, ...JUSTFILES, ...TASKFILES]) !== null;
  },

  extract(ctx: AdapterContext): AdapterResult {
    const makefile = first(ctx, MAKEFILES);
    const justfile = first(ctx, JUSTFILES);
    const taskfile = first(ctx, TASKFILES);
    const envExample = first(ctx, ENV_EXAMPLES);

    const runners: Array<[string | null, string]> = [
      [makefile, "make"],
      [justfile, "just"],
      [taskfile, "task"],
    ];
    const missing = runners.filter(([file, bin]) => file !== null && !isOnPath(bin)).map(([, bin]) => bin);
    const toolchainAvailable = missing.length === 0;
    const notes: string[] = [];
    if (missing.length > 0) {
      notes.push(`The ${missing.join(", ")} toolchain was not found on PATH; the build file was read, but its targets cannot be verified on this machine.`);
    }
    if (!makefile && !justfile && !taskfile && !envExample) {
      notes.push(
        "No language adapter recognised this project and no build file or .env.example was found. " +
          "Nothing was inferred. Declare what the project does in .project/surface.declare.yaml."
      );
    } else {
      notes.push("Only build-tool targets and environment names were read; no capability is claimed from them.");
    }
    const stack = { id: ADAPTER_ID, adapter: "@project-surface/adapter-generic", adapterVersion: ADAPTER_VERSION, toolchainAvailable, notes };
    const result = emptyResult(stack);

    const commands: DraftCommand[] = [];
    const add = (file: string | null, runner: string, targets: (c: string) => Array<string | JustRecipe>): void => {
      if (!file) return;
      const content = ctx.readFile(file);
      if (content === null) return;
      for (const target of targets(content)) {
        const name = typeof target === "string" ? target : target.name;
        if (!isSafeCommandToken(name)) continue;
        const parameterText = typeof target === "string" || target.parameters.length === 0
          ? ""
          : ` Parameters: ${target.parameters.join(", ")}.`;
        commands.push({
          id: commandId(`${runner}-${name}`),
          run: `${runner} ${name}`,
          cwd: ".",
          kind: classifyCommand(name),
          description: `${name} target in ${file}.${parameterText}`,
          provenance: provenance({ tier: "derived", adapter: ADAPTER_ID, now: ctx.now, sources: [source(file, name)] }),
        });
      }
    };
    add(makefile, "make", makeTargets);
    add(justfile, "just", justRecipes);
    add(taskfile, "task", taskfileTasks);
    result.commands = commands;

    if (envExample) {
      const content = ctx.readFile(envExample);
      if (content !== null) {
        const environment: DraftEnvironmentVariable[] = envExampleNames(content).map((name) => ({
          name,
          required: false,
          secret: looksSecretName(name),
          usedBy: [source(envExample, name)],
          provenance: provenance({ tier: "derived", adapter: ADAPTER_ID, now: ctx.now, sources: [source(envExample, name)] }),
        }));
        result.environment = environment;
      }
    }

    return result;
  },
};

export default genericAdapter;
