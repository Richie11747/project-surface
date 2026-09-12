"""Stock reservation. Specified by docs/inventory.md."""

import os
import uuid

from inventory.router import app

STOCK: dict[str, int] = {"sku-basic": 40, "sku-pro": 12}
RESERVATIONS: dict[str, dict[str, int]] = {}


class InsufficientStock(Exception):
    """Raised when a requested quantity exceeds available stock."""


def _database_path() -> str:
    path = os.environ.get("INVENTORY_DB_PATH")
    if not path:
        raise RuntimeError("INVENTORY_DB_PATH is not configured.")
    return path


def reserve(items: dict[str, int]) -> dict[str, object]:
    """Reserve stock for each SKU, or raise if any cannot be satisfied."""
    _database_path()

    if not items:
        raise ValueError("A reservation needs at least one item.")

    for sku, quantity in items.items():
        if not isinstance(quantity, int) or quantity <= 0:
            raise ValueError(f"Quantity for {sku} must be a positive integer.")
        if STOCK.get(sku, 0) < quantity:
            raise InsufficientStock(f"Not enough {sku} in stock.")

    for sku, quantity in items.items():
        STOCK[sku] -= quantity

    reservation_id = f"rsv_{uuid.uuid4().hex[:8]}"
    RESERVATIONS[reservation_id] = dict(items)
    return {
        "id": reservation_id,
        "remaining": {sku: STOCK[sku] for sku in items},
    }


def release(reservation_id: str) -> bool:
    """Return reserved stock. Returns False when the reservation is unknown."""
    items = RESERVATIONS.pop(reservation_id, None)
    if items is None:
        return False
    for sku, quantity in items.items():
        STOCK[sku] = STOCK.get(sku, 0) + quantity
    return True


@app.post("/inventory/reserve")
def reserve_endpoint(payload: dict) -> dict:
    return reserve(payload.get("items", {}))


@app.get("/inventory/stock")
def stock_endpoint() -> dict:
    return dict(STOCK)
