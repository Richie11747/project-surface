"""Console entry point."""

import os

from inventory.reserve import STOCK


def main() -> int:
    token = os.getenv("INVENTORY_ADMIN_TOKEN")
    if not token:
        print("INVENTORY_ADMIN_TOKEN is not set; running in read-only mode.")
    for sku, quantity in sorted(STOCK.items()):
        print(f"{sku}\t{quantity}")
    return 0
