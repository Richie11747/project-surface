/** Checkout session creation. Specified by docs/contracts/checkout.md. */

import { charge } from "../payments/provider.ts";
import { router } from "../router.ts";

export interface CheckoutItem {
  sku: string;
  quantity: number;
}

export interface CheckoutInput {
  items: CheckoutItem[];
  currency: string;
}

export interface CheckoutSession {
  id: string;
  total: number;
  currency: string;
  status: "open" | "complete";
}

const PRICES: Record<string, number> = {
  "sku-basic": 1000,
  "sku-pro": 2500,
};

let counter = 0;
const sessions = new Map<string, CheckoutSession>();

export class CheckoutError extends Error {}

export function createCheckout(input: CheckoutInput): CheckoutSession {
  if (!process.env.DATABASE_URL) {
    throw new CheckoutError("DATABASE_URL is not configured.");
  }
  if (input.items.length === 0) {
    throw new CheckoutError("A checkout needs at least one item.");
  }

  let total = 0;
  for (const item of input.items) {
    if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
      throw new CheckoutError(`Quantity for ${item.sku} must be a positive integer.`);
    }
    total += (PRICES[item.sku] ?? 0) * item.quantity;
  }

  counter += 1;
  const session: CheckoutSession = {
    id: `cs_${String(counter).padStart(6, "0")}`,
    total,
    currency: input.currency.toUpperCase(),
    status: "open",
  };
  sessions.set(session.id, session);
  return session;
}

/* Deliberately wrong, so the fixture has a real constraint violation: the
   contract says provider calls go through the job queue, not the handler. */
export function completeCheckout(id: string): CheckoutSession | undefined {
  const session = sessions.get(id);
  if (!session) return undefined;
  charge(session.total, session.currency);
  session.status = "complete";
  return session;
}

export function findCheckout(id: string): CheckoutSession | undefined {
  return sessions.get(id);
}

router.post("/checkout", (request) => {
  try {
    const session = createCheckout(request.body as CheckoutInput);
    return { status: 201, body: session };
  } catch (error) {
    return { status: 400, body: { error: (error as Error).message } };
  }
});

router.get("/checkout/:id", (request) => {
  const session = findCheckout(request.params.id ?? "");
  return session ? { status: 200, body: session } : { status: 404, body: { error: "not found" } };
});
