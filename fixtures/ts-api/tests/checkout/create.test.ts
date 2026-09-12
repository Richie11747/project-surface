import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createCheckout, findCheckout, CheckoutError } from "../../src/checkout/create.ts";

before(() => {
  process.env.DATABASE_URL = "postgres://localhost:5432/checkout-test";
});

test("creates a session and totals the line items", () => {
  const session = createCheckout({
    items: [
      { sku: "sku-basic", quantity: 2 },
      { sku: "sku-pro", quantity: 1 },
    ],
    currency: "eur",
  });

  assert.match(session.id, /^cs_\d{6}$/);
  assert.equal(session.total, 4500);
  assert.equal(session.currency, "EUR");
  assert.equal(session.status, "open");
});

test("rejects an empty basket", () => {
  assert.throws(() => createCheckout({ items: [], currency: "EUR" }), CheckoutError);
});

test("rejects a non-positive quantity", () => {
  assert.throws(
    () => createCheckout({ items: [{ sku: "sku-basic", quantity: 0 }], currency: "EUR" }),
    CheckoutError
  );
});

test("a created session can be found again", () => {
  const session = createCheckout({ items: [{ sku: "sku-pro", quantity: 1 }], currency: "USD" });
  assert.deepEqual(findCheckout(session.id), session);
});

test("an unknown session is not found", () => {
  assert.equal(findCheckout("cs_999999"), undefined);
});
