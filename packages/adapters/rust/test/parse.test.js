// @ts-check
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRust } from "../dist/parse.js";

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
