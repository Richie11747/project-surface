/**
 * Ask the model every question under every condition and store the answers.
 *
 * This is the only script in the repository that talks to a network. It
 * needs credentials for one vendor - ANTHROPIC_API_KEY (or an `ant auth login`
 * profile) for the default provider, OPENAI_API_KEY for --provider openai - and
 * spends real money; the amount is printed as it goes. Nothing else in the
 * benchmark - scoring, the results table, CI - ever calls the API.
 *
 *   node bench/record.mjs               record every question, both conditions
 *   node bench/record.mjs --only ts-01  one question
 *   node bench/record.mjs --condition surface
 *   node bench/record.mjs --dry-run     print prompt sizes, call nothing
 *   node bench/record.mjs --provider openai --model gpt-5-mini
 */

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { buildPrompt, cost, loadQuestions, CONDITIONS, MODEL, RECORDED_DIR, SYSTEM } from "./lib.mjs";

const Answer = z.object({
  files: z.array(z.string()),
  commands: z.array(z.string()),
  env: z.array(z.string()),
  reasoning: z.string(),
});

const { values } = parseArgs({
  options: {
    only: { type: "string" },
    condition: { type: "string" },
    /* anthropic (default) or openai. The same questions, prompts, answer
       shape and grader either way; only the wire call differs, so a second
       vendor is a second row in RESULTS.md, not a second benchmark. */
    provider: { type: "string", default: process.env.BENCH_PROVIDER ?? "anthropic" },
    model: { type: "string" },
    "dry-run": { type: "boolean", default: false },
    force: { type: "boolean", default: false },
  },
});

const ANSWER_JSON_SCHEMA = {
  type: "object",
  properties: {
    files: { type: "array", items: { type: "string" } },
    commands: { type: "array", items: { type: "string" } },
    env: { type: "array", items: { type: "string" } },
    reasoning: { type: "string" },
  },
  required: ["files", "commands", "env", "reasoning"],
  additionalProperties: false,
};

/** One call, one shape back, whichever vendor answers. */
async function ask(provider, model, prompt) {
  if (provider === "anthropic") {
    const client = new Anthropic();
    const response = await client.messages.parse({
      model,
      max_tokens: 4096,
      system: SYSTEM,
      messages: [{ role: "user", content: prompt }],
      output_config: { format: zodOutputFormat(Answer), effort: "medium" },
    });
    return {
      model: response.model,
      stopReason: response.stop_reason,
      usage: { input_tokens: response.usage.input_tokens, output_tokens: response.usage.output_tokens },
      answer: response.parsed_output ?? null,
      text: response.content.filter((b) => b.type === "text").map((b) => b.text).join(""),
    };
  }
  if (provider === "openai") {
    const key = process.env.OPENAI_API_KEY;
    if (!key) throw new Error("OPENAI_API_KEY is not set");
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        max_completion_tokens: 4096,
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: prompt },
        ],
        response_format: { type: "json_schema", json_schema: { name: "answer", strict: true, schema: ANSWER_JSON_SCHEMA } },
      }),
    });
    if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const body = await res.json();
    const choice = body.choices?.[0];
    const text = choice?.message?.content ?? "";
    let answer = null;
    try {
      const parsed = Answer.safeParse(JSON.parse(text));
      answer = parsed.success ? parsed.data : null;
    } catch {
      answer = null;
    }
    return {
      model: body.model ?? model,
      stopReason: choice?.finish_reason ?? "unknown",
      usage: { input_tokens: body.usage?.prompt_tokens ?? 0, output_tokens: body.usage?.completion_tokens ?? 0 },
      answer,
      text,
    };
  }
  throw new Error(`unknown provider "${provider}" (anthropic | openai)`);
}

const DEFAULT_MODELS = { anthropic: MODEL, openai: "gpt-5" };
const provider = values.provider;
const model = values.model ?? DEFAULT_MODELS[provider];
if (!model) throw new Error(`unknown provider "${provider}" (anthropic | openai)`);

const questions = loadQuestions().filter((q) => !values.only || q.id === values.only);
const conditions = CONDITIONS.filter((c) => !values.condition || c === values.condition);
const commit = (() => {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
})();

let spent = 0;

for (const condition of conditions) {
  mkdirSync(join(RECORDED_DIR, condition), { recursive: true });
  for (const q of questions) {
    const target = join(RECORDED_DIR, condition, `${q.id}.json`);
    if (existsSync(target) && !values.force) {
      console.log(`skip     ${condition}/${q.id} (recorded; --force to redo)`);
      continue;
    }
    const prompt = await buildPrompt(condition, q.fixture, q.question);
    const promptSha256 = createHash("sha256").update(prompt).digest("hex");
    if (values["dry-run"]) {
      console.log(`dry-run  ${condition}/${q.id}  ~${Math.ceil(prompt.length / 4)} tokens`);
      continue;
    }

    const reply = await ask(provider, model, prompt);
    const record = {
      id: q.id,
      condition,
      provider,
      model: reply.model,
      recordedAt: new Date().toISOString(),
      commit,
      promptSha256,
      promptChars: prompt.length,
      stopReason: reply.stopReason,
      usage: reply.usage,
      answer: reply.answer,
      text: reply.text,
    };
    writeFileSync(target, `${JSON.stringify(record, null, 2)}\n`);
    const price = cost(record.usage, record.model);
    if (price !== null) spent += price;
    console.log(
      `recorded ${condition}/${q.id}  in ${record.usage.input_tokens} out ${record.usage.output_tokens}  ` +
        (price === null ? "(unpriced model)" : `$${price.toFixed(4)} (total $${spent.toFixed(2)})`) +
        (record.answer ? "" : "  !! could not parse the answer")
    );
  }
}
