// @ts-check
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSource } from "../dist/parse.js";

test("parseSource reads environment names from destructuring as well as member access", () => {
  const parsed = parseSource(
    "src/config.ts",
    `const { DATABASE_URL, PORT = "3000", "WITH-DASH": dashed } = process.env;
const key = process.env.API_KEY ?? process.env["FALLBACK"];
export function load() { return { DATABASE_URL, PORT, dashed, key }; }
`
  );
  /* A key that is not a conventional variable name is dropped, as everywhere else. */
  assert.deepEqual([...parsed.envNames].sort(), ["API_KEY", "DATABASE_URL", "FALLBACK", "PORT"]);
});
