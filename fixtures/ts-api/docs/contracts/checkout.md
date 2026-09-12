# Checkout contract

## POST /checkout

Creates a checkout session.

Request body:

- `items` - non-empty array of `{ sku: string, quantity: number }`
- `currency` - ISO 4217 code, uppercase

Response `201`:

- `id` - session identifier, prefixed `cs_`
- `total` - integer, minor units
- `currency` - echoes the request
- `status` - always `open` on creation

Errors: `400` when `items` is empty or a quantity is not a positive integer.

## GET /checkout/:id

Returns a previously created session, or `404`.
