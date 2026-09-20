import assert from "node:assert/strict";
import test from "node:test";

import { justRecipes } from "../dist/index.js";

test("just recipes expose parameter names without default values", () => {
  assert.deepEqual(
    justRecipes(`build target="debug":\nserve url="http://localhost":\ndeploy env version:`),
    [
      { name: "build", parameters: ["target"] },
      { name: "serve", parameters: ["url"] },
      { name: "deploy", parameters: ["env", "version"] },
    ],
  );
});
