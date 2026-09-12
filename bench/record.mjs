/**
 * Ask the model every question under every condition and store the answers.
 *
 * This is the only script in the repository that talks to a network. It
 * needs Anthropic credentials (ANTHROPIC_API_KEY, or an `ant auth login`
 * profile) and spends real money; the amount is printed as it goes. Nothing
 * else in the benchmark - scoring, the results table, CI - ever calls the API.
 *
 *   node bench/record.mjs               record every question, both conditions
 *   node bench/record.mjs --only ts-01  one question
 *   node bench/record.mjs --condition surface
 *   node bench/record.mjs --dry-run     print prompt sizes, call nothing
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
    "dry-run": { type: "boolean", default: false },
    force: { type: "boolean", default: false },
  },
});

const questions = loadQuestions().filter((q) => !values.only || q.id === values.only);
const conditions = CONDITIONS.filter((c) => !values.condition || c === values.condition);
const commit = (() => {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
})();

const client = values["dry-run"] ? null : new Anthropic();
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

    const response = await client.messages.parse({
      model: MODEL,
      max_tokens: 4096,
      system: SYSTEM,
      messages: [{ role: "user", content: prompt }],
      output_config: { format: zodOutputFormat(Answer), effort: "medium" },
    });
    const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join("");
    const record = {
      id: q.id,
      condition,
      model: response.model,
      recordedAt: new Date().toISOString(),
      commit,
      promptSha256,
      promptChars: prompt.length,
      stopReason: response.stop_reason,
      usage: {
        input_tokens: response.usage.input_tokens,
        output_tokens: response.usage.output_tokens,
      },
      answer: response.parsed_output ?? null,
      text,
    };
    writeFileSync(target, `${JSON.stringify(record, null, 2)}\n`);
    spent += cost(record.usage);
    console.log(
      `recorded ${condition}/${q.id}  in ${record.usage.input_tokens} out ${record.usage.output_tokens}  ` +
        `$${cost(record.usage).toFixed(4)} (total $${spent.toFixed(2)})` +
        (record.answer ? "" : "  !! could not parse the answer")
    );
  }
}
