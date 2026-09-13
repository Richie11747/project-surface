# Quote API

`POST /quote` creates a quote for a SKU and quantity; `GET /quote/:id` reads it back.
Volume pricing (10% off) applies from ten units. Currency comes from `PRICING_CURRENCY`,
defaulting to EUR.
