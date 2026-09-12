# Pricing contract

## GET /pricing/quote

Returns a quote for a SKU and quantity.

- `sku` - known SKU identifier
- `quantity` - positive integer
- volume discount of 10 percent applies at 100 units or more
- unknown SKUs return `ErrUnknownSKU`
