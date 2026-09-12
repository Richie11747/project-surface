# Inventory contract

## POST /inventory/reserve

Reserves stock for a set of SKUs.

- `items` - mapping of SKU to a positive integer quantity
- returns a reservation id and the remaining stock per SKU
- raises `InsufficientStock` when any SKU cannot satisfy the request
