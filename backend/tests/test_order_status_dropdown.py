"""Admin status dropdown (PATCH /online-orders/{id}/status): staff pick any
status schemas.ORDER_TRANSITIONS allows; a delivered (COD → paid → revenue)
order can be cancelled, which reverses its revenue and gives its stock back
exactly once; every change is audited; only signed-in staff can change it.
Throwaway SQLite DB (tests/conftest.py)."""
from fastapi.testclient import TestClient

import pytest

from app import auth, models, order_ledger, revenue, services
from app.database import SessionLocal
from app.main import app

client = TestClient(app)
H = {"Authorization": f"Bearer {auth.create_access_token({'sub': 'dd_staff'})}"}


@pytest.fixture(scope="module", autouse=True)
def seed():
    db = SessionLocal()
    db.add(models.User(username="dd_staff", hashed_password=auth.hash_password("x")))
    db.add(models.Category(id="dd_cat", name="فئة القائمة"))
    db.add(models.Product(id="dd_p", name="Cream", category_id="dd_cat", sale_price=100, quantity=40))
    db.add(models.Coupon(id="dd_cp", code="DDTEST", discount_type=models.CouponDiscountType.fixed, discount_value=10, used_count=3))
    db.add(models.Customer(id="dd_cust", name="عميلة اختبار القائمة", phone="01077770000"))
    db.commit()
    db.close()


def order(oid, *, total=250.0, method="cash_on_delivery", qty=2, coupon=None):
    """An order as checkout leaves it: `qty` units deducted, nothing booked."""
    db = SessionLocal()
    db.add(models.Order(id=oid, order_number=oid.upper(), customer_id="dd_cust", customer_name="عميلة اختبار القائمة",
                        customer_phone="01077770000", city="القاهرة", shipping_address="عنوان", subtotal=total,
                        shipping_fee=0, total_amount=total, payment_method=method, coupon_id=coupon))
    db.add(models.OrderItem(order_id=oid, product_id="dd_p", product_name="Cream", unit_price=100, quantity=qty, line_total=qty * 100))
    services.apply_stock_movement(db, db.get(models.Product, "dd_p"), -qty, models.MovementType.website_sale, reference_id=oid)
    db.commit()
    db.close()


def status(oid, s, headers=H):
    return client.patch(f"/online-orders/{oid}/status", json={"status": s}, headers=headers)


def state(oid):
    """(order status, stock, ledger entries, audit rows, coupon uses)"""
    db = SessionLocal()
    try:
        entries = sorted((e.type.value, e.amount) for e in db.query(models.FinanceEntry).filter_by(reference_id=oid).all())
        audit = [(a.from_status, a.to_status, a.changed_by, a.revenue_change, a.units_restored)
                 for a in db.query(models.OrderStatusChange).filter_by(order_id=oid).order_by(models.OrderStatusChange.created_at).all()]
        o = db.get(models.Order, oid)
        return o.status.value, db.get(models.Product, "dd_p").quantity, entries, audit, db.get(models.Coupon, "dd_cp").used_count
    finally:
        db.close()


def recognized(oid):
    db = SessionLocal()
    try:
        return round(sum(l.amount for l in revenue.revenue_lines(db) if l.reference_id == oid), 2)
    finally:
        db.close()


def test_pending_to_a_valid_status_is_applied_and_audited():
    order("dd_a")
    res = status("dd_a", "shipped")
    assert res.status_code == 200 and res.json()["status"] == "shipped"
    assert res.json()["next_statuses"] == ["pending", "delivered", "cancelled"]
    _, _, entries, audit, _ = state("dd_a")
    assert entries == [] and audit == [("pending", "shipped", "dd_staff", 0, 0)]


def test_dropdown_can_skip_straight_to_delivered_and_cod_delivery_recognizes_revenue_once():
    order("dd_b", total=300)
    assert status("dd_b", "delivered").json()["status"] == "delivered"  # no need to ship first
    assert status("dd_b", "delivered").status_code == 200  # re-saving: no-op
    _, _, entries, audit, _ = state("dd_b")
    assert entries == [("income", 300.0)] and audit == [("pending", "delivered", "dd_staff", 300.0, 0)]
    assert recognized("dd_b") == 300


def test_delivered_non_cod_order_is_not_recognized():
    order("dd_card", total=500, method="card")
    status("dd_card", "delivered")
    assert state("dd_card")[2] == [] and recognized("dd_card") == 0


def test_cancelling_a_delivered_order_reverses_revenue_and_restores_stock_exactly_once():
    order("dd_c", total=180, qty=3, coupon="dd_cp")
    stock_before_delivery = state("dd_c")[1]
    status("dd_c", "shipped")
    status("dd_c", "delivered")
    uses = state("dd_c")[4]
    assert recognized("dd_c") == 180

    res = status("dd_c", "cancelled")
    assert res.status_code == 200 and res.json()["next_statuses"] == []
    st, stock, entries, audit, coupon_uses = state("dd_c")
    assert st == "cancelled" and stock == stock_before_delivery + 3 and coupon_uses == uses - 1
    # the income entry stays; one reversal is added
    assert entries == [("expense", 180.0), ("income", 180.0)]
    assert audit[-1] == ("delivered", "cancelled", "dd_staff", -180.0, 3)
    assert recognized("dd_c") == 0

    # retries / repeated saves: nothing more happens
    assert status("dd_c", "cancelled").status_code == 200
    db = SessionLocal()
    o = db.get(models.Order, "dd_c")
    assert order_ledger.settle_revenue(db, models, o, "retry") is None
    assert order_ledger.restore_stock(db, models, services, o, "retry") == {}
    db.rollback()
    db.close()
    assert state("dd_c") == (st, stock, entries, audit, coupon_uses)

    # history endpoint shows the audit trail in order
    hist = client.get("/online-orders/dd_c/status-history", headers=H).json()
    assert [(h["from_status"], h["to_status"], h["changed_by"]) for h in hist] == [
        ("pending", "shipped", "dd_staff"), ("shipped", "delivered", "dd_staff"), ("delivered", "cancelled", "dd_staff")]
    assert hist[-1]["revenue_change"] == -180 and hist[-1]["units_restored"] == 3


def test_invalid_values_and_transitions_are_rejected_without_side_effects():
    order("dd_d")
    before = state("dd_d")
    assert status("dd_d", "refunded").status_code == 422  # not a status
    assert status("dd_d", "").status_code == 422
    assert client.patch("/online-orders/dd_d/status", json={}, headers=H).status_code == 422
    assert status("dd_missing", "shipped").status_code == 404
    status("dd_d", "delivered")
    for bad in ("pending", "shipped"):  # a delivered order can only be cancelled
        res = status("dd_d", bad)
        assert res.status_code == 409 and "مينفعش" in res.json()["detail"]
    status("dd_d", "cancelled")
    for bad in ("pending", "shipped", "delivered"):  # cancelled is final
        assert status("dd_d", bad).status_code == 409
    assert len(state("dd_d")[3]) == 2 and before[3] == []


def test_only_signed_in_staff_can_change_status():
    order("dd_e")
    before = state("dd_e")
    for headers in ({}, {"Authorization": "Bearer not-a-token"},
                    {"Authorization": f"Bearer {auth.create_access_token({'sub': 'nobody_here'})}"}):
        assert status("dd_e", "cancelled", headers=headers).status_code == 401
        assert client.get("/online-orders/dd_e/status-history", headers=headers).status_code == 401
    assert state("dd_e") == before


def test_reports_exclude_cancelled_orders_and_b2b():
    db = SessionLocal()
    base = revenue.revenue(db).total
    db.close()
    order("dd_f", total=410)
    status("dd_f", "delivered")
    assert client.get("/reports/dashboard", params={"period": "month"}, headers=H).status_code == 200
    db = SessionLocal()
    assert revenue.revenue(db).total == round(base + 410, 2)
    db.close()
    status("dd_f", "cancelled")
    db = SessionLocal()
    after = revenue.revenue(db)
    db.add(models.B2BCustomer(id="dd_b2bc", name="Shop", discount_percentage=0))
    db.add(models.B2BOrder(id="dd_b2bo", customer_id="dd_b2bc", total_amount=900))
    db.add(models.FinanceEntry(type=models.FinanceEntryType.income, category=revenue.B2B_SALE_CATEGORY, amount=900,
                               reference_id="dd_b2bo", source="b2b"))
    db.commit()
    assert after.total == base and revenue.revenue(db).total == base  # cancelled: out; B2B: never in
    db.close()
    month = client.get("/reports/dashboard", params={"period": "month"}, headers=H).json()
    analytics = client.get("/sales-analytics/", headers=H).json()
    monthly = client.get("/reports/monthly-sales", params={"months": 1}, headers=H).json()
    assert month["period_revenue"] == monthly[-1]["total"]
    assert analytics["total_revenue"] == base and analytics["b2b_sales"] >= 900
