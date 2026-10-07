"""Online-order status lifecycle — against a throwaway SQLite DB (never the
shared development database):

    cd backend && python -m pytest -q
"""
import os
import sys
import tempfile

# Alongside the other test files the app is already bound to their
# throwaway DB (ids below don't collide); run alone, this file gets its own.
if "app.database" not in sys.modules:
    os.environ["DATABASE_URL"] = f"sqlite:///{os.path.join(tempfile.mkdtemp(), 'test.db')}"
    os.environ.pop("SECRET_KEY", None)

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app import models, auth  # noqa: E402
from app.database import SessionLocal  # noqa: E402
from app.main import app  # noqa: E402

client = TestClient(app)
H = {"Authorization": f"Bearer {auth.create_access_token({'sub': 'orders_staff'})}"}


@pytest.fixture(scope="module", autouse=True)
def seed():
    db = SessionLocal()
    db.add(models.User(username="orders_staff", hashed_password=auth.hash_password("x")))
    db.add(models.Category(id="oc", name="فئة الطلبات"))
    db.add(models.Product(id="op1", name="Serum", category_id="oc", sale_price=100, quantity=5))
    db.add(models.Coupon(id="ocp", code="OTEST", discount_type=models.CouponDiscountType.fixed, discount_value=10, used_count=1))
    # A guest profile (no password): staff manage guest orders like any other.
    db.add(models.Customer(id="ocust", name="عميلة اختبار الطلبات", phone="01012340000"))
    for oid in ("o_cancel", "o_ship"):
        db.add(models.Order(
            id=oid, order_number=oid.upper(), customer_id="ocust", customer_name="عميلة اختبار الطلبات",
            customer_phone="01012340000", city="القاهرة", shipping_address="عنوان", subtotal=200,
            discount_amount=10, shipping_fee=0, total_amount=190, coupon_id="ocp",
        ))
        db.add(models.OrderItem(order_id=oid, product_id="op1", product_name="Serum", unit_price=100, quantity=2, line_total=200))
    db.commit()
    db.close()


def set_status(order_id, status):
    return client.patch(f"/online-orders/{order_id}/status", json={"status": status}, headers=H)


def snapshot():
    db = SessionLocal()
    try:
        expenses = db.query(models.FinanceEntry).filter(models.FinanceEntry.type == models.FinanceEntryType.expense).count()
        return db.get(models.Product, "op1").quantity, db.get(models.Coupon, "ocp").used_count, expenses
    finally:
        db.close()


def test_orders_list_tells_staff_the_allowed_next_statuses():
    orders = {o["id"]: o for o in client.get("/online-orders/", headers=H).json()}
    assert orders["o_ship"]["next_statuses"] == ["shipped", "cancelled"]


def test_cancel_releases_stock_coupon_and_revenue_exactly_once():
    stock, uses, expenses = snapshot()
    res = set_status("o_cancel", "cancelled")
    assert res.status_code == 200 and res.json()["next_statuses"] == []
    assert snapshot() == (stock + 2, uses - 1, expenses + 1)

    # A cancelled order can't be revived (it would sell stock it no longer holds)...
    assert set_status("o_cancel", "pending").status_code == 409
    assert set_status("o_cancel", "shipped").status_code == 409
    # ...and re-saving the same status changes nothing.
    assert set_status("o_cancel", "cancelled").status_code == 200
    assert snapshot() == (stock + 2, uses - 1, expenses + 1)


def test_forward_lifecycle_and_no_skipping_back():
    assert set_status("o_ship", "delivered").status_code == 409  # must ship first
    assert set_status("o_ship", "shipped").json()["status"] == "shipped"
    assert set_status("o_ship", "pending").status_code == 409
    assert set_status("o_ship", "delivered").json()["next_statuses"] == []
    assert set_status("o_ship", "cancelled").status_code == 409
