/**
 * The payment provider client. Talks to a third party with real money behind
 * it, which is why the contract says request handlers must never call it
 * directly - provider calls belong in the job queue.
 */

export interface Charge {
  id: string;
  amount: number;
  currency: string;
}

let sequence = 0;

export function charge(amount: number, currency: string): Charge {
  if (!process.env.PAYMENT_PROVIDER_KEY) {
    throw new Error("PAYMENT_PROVIDER_KEY is not configured.");
  }
  sequence += 1;
  return { id: `ch_${String(sequence).padStart(6, "0")}`, amount, currency };
}
