// @ts-check
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseGo, parseGoMod } from "../dist/parse.js";

test("parseGo reads Go 1.22 method patterns, grouped types, and ignores comments", () => {
  const parsed = parseGo(`package api

/* r.Get("/commented-out", h) */
// mux.HandleFunc("/also-commented", h)

type (
\tServer struct{}
\tHandler interface{}
)

type Single struct{}

func Serve(mux *http.ServeMux) {
\tmux.HandleFunc("GET /items/{id}", getItem)
\tmux.HandleFunc("/health", health) // trailing comment
\tr.Post("/orders", createOrder)
\tlog.Println("see https://example.com/docs")
\tclient.Get("example.com/not-a-route")
}
`);
  assert.deepEqual(
    parsed.routes.map((r) => `${r.method} ${r.path}`),
    ["GET /items/{id}", "GET /health", "POST /orders"]
  );
  assert.deepEqual(parsed.symbols.map((s) => s.name).sort(), ["Handler", "Serve", "Server", "Single"]);
  assert.equal(parsed.packageName, "api");
});

test("parseGoMod tolerates a BOM-free first line and reads module and go version", () => {
  const mod = parseGoMod("module example.com/svc\n\ngo 1.22\n");
  assert.equal(mod.module, "example.com/svc");
  assert.equal(mod.goVersion, "1.22");
});
