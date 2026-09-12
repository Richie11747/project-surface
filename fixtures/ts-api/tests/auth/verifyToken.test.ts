import { test, before } from "node:test";
import assert from "node:assert/strict";
import { verifyToken } from "../../src/auth/verifyToken.ts";

before(() => {
  process.env.AUTH_SIGNING_SECRET = "test-secret";
});

test("accepts a token signed with the configured secret", () => {
  const claims = verifyToken("test-secret.user-42.read,write");
  assert.equal(claims.subject, "user-42");
  assert.deepEqual(claims.scopes, ["read", "write"]);
});

test("rejects a token with the wrong prefix", () => {
  assert.throws(() => verifyToken("other-secret.user-42."), /Invalid token/);
});
