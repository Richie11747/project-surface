// @ts-check
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCargoToml, parseRust } from "../dist/parse.js";

test("parseRust recognises unqualified and fully-qualified route attributes", () => {
  const parsed = parseRust(`
#[get("/plain")]
async fn plain() {}

#[rocket::get("/rocket")]
async fn rocket_route() {}

#[actix_web::get("/actix")]
async fn actix_route() {}
`);

  assert.deepEqual(parsed.routes, [
    { method: "GET", path: "/plain", line: 2 },
    { method: "GET", path: "/rocket", line: 5 },
    { method: "GET", path: "/actix", line: 8 },
  ]);
});

test("parseRust ignores qualified route attributes without absolute paths", () => {
  const parsed = parseRust(`
#[rocket::get("relative")]
async fn relative_route() {}
`);

  assert.deepEqual(parsed.routes, []);
});

test("parseRust counts runtime-provided test attributes as tests", () => {
  for (const attr of ["#[test]", "#[tokio::test]", "#[async_std::test]", "#[sqlx::test]", "#[actix_web::test]"]) {
    const parsed = parseRust(`use crate::quote_for;\n\n${attr}\nasync fn it_works() {}\n`);
    assert.equal(parsed.hasInlineTests, true, attr);
  }
  const plain = parseRust("pub fn testing_helper() {}\n#[derive(Debug)]\nstruct T;\n");
  assert.equal(plain.hasInlineTests, false);
});

test("parseCargoToml reads workspace members and named [[bin]] targets", () => {
  const workspace = parseCargoToml('[workspace]\nresolver = "2"\nmembers = [\n  "crates/*",\n  "tools/cli",\n]\n');
  assert.deepEqual(workspace.workspaceMembers, ["crates/*", "tools/cli"]);
  assert.equal(workspace.name, null);

  const member = parseCargoToml(
    '[package]\nname = "api"\nversion = "0.1.0"\n\n[[bin]]\nname = "api-server"\npath = "src/main.rs"\n\n[[bin]]\nname = "api-admin"\n\n[dependencies]\npricing-core = { path = "../core" }\n'
  );
  assert.equal(member.name, "api");
  assert.deepEqual(member.bins, ["api-server", "api-admin"]);
  assert.deepEqual(member.dependencies, ["pricing-core"]);
});
