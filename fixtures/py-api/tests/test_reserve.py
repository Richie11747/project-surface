import os

import pytest

from inventory.reserve import InsufficientStock, STOCK, release, reserve

os.environ.setdefault("INVENTORY_DB_PATH", ":memory:")


def test_reserves_and_reduces_stock():
    before = STOCK["sku-basic"]
    result = reserve({"sku-basic": 2})
    assert result["id"].startswith("rsv_")
    assert STOCK["sku-basic"] == before - 2


def test_rejects_empty_reservation():
    with pytest.raises(ValueError):
        reserve({})


def test_rejects_oversized_reservation():
    with pytest.raises(InsufficientStock):
        reserve({"sku-pro": 10_000})


def test_release_returns_stock():
    before = STOCK["sku-pro"]
    result = reserve({"sku-pro": 1})
    assert STOCK["sku-pro"] == before - 1
    assert release(str(result["id"])) is True
    assert STOCK["sku-pro"] == before


def test_release_of_unknown_reservation_is_false():
    assert release("rsv_missing") is False
