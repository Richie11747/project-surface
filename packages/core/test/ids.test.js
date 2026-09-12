import { test } from "node:test";
import assert from "node:assert/strict";
import {
  camelToKebab,
  capabilityIdFromRoute,
  capabilityIdFromSymbol,
  moduleNamespace,
  packageIdFromPath,
  slug,
  uniqueId,
} from "../dist/index.js";

const IDENTIFIER = /^[a-z0-9][a-z0-9._:/-]*$/;

test("routes become readable area.action ids", () => {
  assert.equal(capabilityIdFromRoute("POST", "/checkout"), "checkout.create");
  assert.equal(capabilityIdFromRoute("GET", "/checkout/:id"), "checkout.get");
  assert.equal(capabilityIdFromRoute("GET", "/checkout"), "checkout.list");
  assert.equal(capabilityIdFromRoute("DELETE", "/checkout/:id"), "checkout.delete");
});

test("version and api prefixes are dropped, parameters are not part of the resource", () => {
  assert.equal(capabilityIdFromRoute("GET", "/v1/orders/:id"), "orders.get");
  assert.equal(capabilityIdFromRoute("GET", "/api/v2/orders"), "orders.list");
});

test("symbol ids do not stutter against their namespace", () => {
  assert.equal(capabilityIdFromSymbol("src/checkout/create.ts", "createCheckout"), "checkout.create");
  assert.equal(capabilityIdFromSymbol("src/auth/verifyToken.ts", "verifyToken"), "auth.verify-token");
  assert.equal(capabilityIdFromSymbol("app/orders/handler.py", "list_orders"), "orders.list");
});

test("generic layout directories are not used as namespaces", () => {
  assert.equal(moduleNamespace("src/checkout/create.ts"), "checkout");
  assert.equal(moduleNamespace("internal/pricing/quote.go"), "pricing");
});

test("camel and snake case normalize identically", () => {
  assert.equal(camelToKebab("createCheckout"), "create-checkout");
  assert.equal(camelToKebab("list_orders"), "list-orders");
  assert.equal(camelToKebab("HTTPServer"), "http-server");
});

test("every derived id matches the spec identifier pattern", () => {
  const samples = [
    capabilityIdFromRoute("POST", "/Weird Path/With Spaces"),
    capabilityIdFromSymbol("src/x/y.ts", "SomeClass"),
    packageIdFromPath("apps/web"),
    slug("Mixed Case With Symbols!"),
  ];
  for (const id of samples) assert.match(id, IDENTIFIER, `bad id: ${id}`);
});

test("id derivation is a pure function of its inputs", () => {
  for (let i = 0; i < 100; i++) {
    assert.equal(capabilityIdFromRoute("POST", "/checkout"), "checkout.create");
  }
});

test("collisions resolve deterministically", () => {
  const taken = new Set();
  assert.equal(uniqueId("a.b", taken), "a.b");
  assert.equal(uniqueId("a.b", taken), "a.b-2");
  assert.equal(uniqueId("a.b", taken), "a.b-3");
});
