// @ts-check
import { test } from "node:test";
import assert from "node:assert/strict";
import { isPythonTest, parsePython, pythonModuleToPaths } from "../dist/parse.js";

test("parsePython keeps a hash inside a route string and records imported names", () => {
  const parsed = parsePython(`import os
from . import reserve, release as free
from inventory.pricing import quote

@app.get("/items/#anchor")  # a comment
def list_items():
    return os.environ["DATABASE_URL"]
`);
  assert.deepEqual(parsed.routes.map((r) => r.path), ["/items/#anchor"]);
  assert.deepEqual(parsed.envNames, ["DATABASE_URL"]);
  const relative = parsed.imports.find((i) => i.level === 1);
  assert.deepEqual(relative?.names, ["reserve", "release"]);
});

test("pythonModuleToPaths names submodules for `from . import x` and tries the src/ layout", () => {
  const relative = pythonModuleToPaths("inventory/tests/test_reserve.py", { level: 1, module: "", names: ["reserve"] });
  assert.ok(relative.includes("inventory/tests/reserve.py"), relative.join(", "));
  const absolute = pythonModuleToPaths("tests/test_quote.py", { level: 0, module: "inventory.pricing", names: ["quote"] });
  assert.ok(absolute.includes("inventory/pricing.py"), absolute.join(", "));
  assert.ok(absolute.includes("src/inventory/pricing.py"), absolute.join(", "));
  assert.ok(absolute.includes("src/inventory/pricing/quote.py"), absolute.join(", "));
});

test("isPythonTest is a filename rule; conftest is excluded by the adapter, not here", () => {
  assert.equal(isPythonTest("tests/test_a.py"), true);
  assert.equal(isPythonTest("tests/a_test.py"), true);
  assert.equal(isPythonTest("tests/conftest.py"), false);
});
