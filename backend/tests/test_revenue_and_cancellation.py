"""One revenue definition (app/revenue.py) and idempotent cancellation /
recognition (app/order_ledger.py): revenue = completed AND paid orders only;
cancellation gives back exactly the stock still held and reverses exactly the
revenue still recognized — never twice, never when there was none; every
report shows the same totals. Throwaway SQLite DB (tests/conftest.py)."""
from datetime import datetime, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import auth, models, order_ledger, returns, revenue, services
from app.database import SessionLocal
from app.main import app

client = TestClient(app)
H = {"Authorization": f"Bearer {auth.create_access_token({'sub': 'rev_staff'})}"}
NOW = datetime.now(timezone.utc)


@pytest.fixture(scope="module", autouse=True)
def seed():
    db = SessionLocal()
    db.add(models.User(username="rev_staff", hashed_password=auth.hash_password("x")))
    db.add(models.Category(id="rv_cat", name="فئة الإيرادات"))
    db.add(models.Product(id="rv_p", name="Toner", category_id="rv_cat", sale_price=100, quantity=50))
    db.add(models.Customer(id="rv_cust", name="عميلة اختبار الإيرادات", phone="01055550000"))
    db.commit()
    db.close()


def order(oid, *, status="pending", total=200.0, method="cash_on_delivery", deducted=2, booked_at_checkout=0.0):
    """An order as checkout leaves it: `deducted` units out of stock (a
    website_sale movement); optionally income booked at checkout (orders
    placed before revenue waited for delivery)."""
    db = SessionLocal()
    db.add(models.Order(id=oid, order_number=oid.upper(), customer_id="rv_cust", customer_name="عميلة اختبار الإيرادات",
                        customer_phone="01055550000", city="القاهرة", shipping_address="عنوان", subtotal=total,
                        shipping_fee=0, total_amount=total, status=models.OrderStatus(status), payment_method=method))
    db.add(models.OrderItem(order_id=oid, product_id="rv_p", product_name="Toner", unit_price=total / 2, quantity=2, line_total=total))
    if deducted:
        p = db.get(models.Product, "rv_p")
        services.apply_stock_movement(db, p, -deducted, models.MovementType.website_sale, reference_id=oid)
    if booked_at_checkout:
        db.add(models.FinanceEntry(type=models.FinanceEntryType.income, category=order_ledger.SALE_CATEGORY,
                                   amount=booked_at_checkout, reference_id=oid, source="website"))
    db.commit()
    db.close()


def entries(oid):
    db = SessionLocal()
    try:
        return sorted((e.type.value, e.category, e.amount) for e in db.query(models.FinanceEntry).filter_by(reference_id=oid).all())
    finally:
        db.close()


def stock():
    db = SessionLocal()
    try:
        return db.get(models.Product, "rv_p").quantity
    finally:
        db.close()


def status(oid, s):
    return client.patch(f"/online-orders/{oid}/status", json={"status": s}, headers=H)


def online_revenue_for(ids):
    db = SessionLocal()
    try:
        return round(sum(l.amount for l in revenue.revenue_lines(db) if l.reference_id in ids), 2)
    finally:
        db.close()


# ---------------------------------------------------------------- the revenue rule
def test_only_completed_and_paid_orders_are_revenue():
    order("rv_deliv", status="pending", total=300)
    order("rv_pending", total=150)
    order("rv_shipped", total=120)
    order("rv_cancel", total=90)
    order("rv_card", total=500, method="card")  # no payment confirmation exists → unpaid
    order("rv_legacy", total=250, booked_at_checkout=250)  # booked at checkout, still pending
    for oid in ("rv_deliv", "rv_shipped", "rv_card"):
        assert status(oid, "shipped").status_code == 200
    assert status("rv_deliv", "delivered").status_code == 200
    assert status("rv_card", "delivered").status_code == 200
    assert status("rv_cancel", "cancelled").status_code == 200
    ids = {"rv_deliv", "rv_pending", "rv_shipped", "rv_cancel", "rv_card", "rv_legacy"}
    assert online_revenue_for(ids) == 300
    # nothing was booked for orders that aren't completed and paid
    assert entries("rv_pending") == [] and entries("rv_shipped") == [] and entries("rv_card") == []
    assert entries("rv_deliv") == [("income", order_ledger.SALE_CATEGORY, 300.0)]


def test_delivery_recognizes_revenue_exactly_once():
    order("rv_once", total=180)
    status("rv_once", "shipped")
    status("rv_once", "delivered")
    status("rv_once", "delivered")  # re-saving the same status
    db = SessionLocal()
    o = db.get(models.Order, "rv_once")
    assert order_ledger.settle_revenue(db, models, o, "retry") is None  # a retry adds nothing
    db.close()
    assert entries("rv_once") == [("income", order_ledger.SALE_CATEGORY, 180.0)]


def test_an_order_booked_at_checkout_is_settled_to_its_final_total_on_delivery():
    order("rv_edited", total=230, booked_at_checkout=200)  # edited after checkout under the old code
    status("rv_edited", "shipped")
    status("rv_edited", "delivered")
    assert entries("rv_edited") == sorted([("income", order_ledger.SALE_CATEGORY, 200.0), ("income", order_ledger.SALE_CATEGORY, 30.0)])
    assert online_revenue_for({"rv_edited"}) == 230


# ---------------------------------------------------------------- cancellation
def test_cancel_before_recognition_writes_no_reversal_and_restores_stock_once():
    before = stock()
    order("rv_c1", total=200, deducted=2)
    assert stock() == before - 2
    assert status("rv_c1", "cancelled").status_code == 200
    assert stock() == before and entries("rv_c1") == []
    assert status("rv_c1", "cancelled").status_code == 200  # repeated request
    db = SessionLocal()
    o = db.get(models.Order, "rv_c1")
    assert order_ledger.restore_stock(db, models, services, o, "retry") == {}  # nothing left to give back
    assert order_ledger.settle_revenue(db, models, o, "retry") is None
    db.commit()
    db.close()
    assert stock() == before and entries("rv_c1") == []


def test_cancel_after_recognition_reverses_it_exactly_once():
    order("rv_c2", total=260, booked_at_checkout=260)
    assert status("rv_c2", "cancelled").status_code == 200
    assert entries("rv_c2") == sorted([("income", order_ledger.SALE_CATEGORY, 260.0), ("expense", order_ledger.REVERSAL_CATEGORY, 260.0)])
    status("rv_c2", "cancelled")
    db = SessionLocal()
    assert order_ledger.settle_revenue(db, models, db.get(models.Order, "rv_c2"), "retry") is None
    db.close()
    assert len(entries("rv_c2")) == 2 and online_revenue_for({"rv_c2"}) == 0


def test_stock_comes_back_only_if_it_was_deducted():
    before = stock()
    order("rv_none", total=100, deducted=0)  # never deducted
    status("rv_none", "cancelled")
    assert stock() == before
    order("rv_part", total=100, deducted=3)  # 3 out, then 1 given back by an edit
    db = SessionLocal()
    services.apply_stock_movement(db, db.get(models.Product, "rv_p"), 1, models.MovementType.website_sale, reference_id="rv_part")
    db.commit()
    db.close()
    assert stock() == before - 2
    status("rv_part", "cancelled")
    assert stock() == before  # the 2 still held, not the 2 on the order line plus extra


# ---------------------------------------------------------------- reports agree
def test_reports_use_the_same_revenue_and_keep_other_income_and_expenses_apart():
    db = SessionLocal()
    db.add(models.B2BCustomer(id="rv_b2bc", name="Shop", discount_percentage=0))
    db.add(models.B2BOrder(id="rv_b2bo", customer_id="rv_b2bc", total_amount=400))
    db.add(models.FinanceEntry(type=models.FinanceEntryType.income, category=revenue.B2B_SALE_CATEGORY, amount=400, reference_id="rv_b2bo", source="b2b"))
    db.add(models.FinanceEntry(type=models.FinanceEntryType.income, category="إيراد آخر", amount=55, source="spending"))
    db.add(models.FinanceEntry(type=models.FinanceEntryType.expense, category="إيجار", amount=70, source="spending"))
    db.commit()
    all_time = revenue.revenue(db)
    b2b_booked = revenue.b2b_sales(db).total
    db.close()
    month = client.get("/reports/dashboard", params={"period": "month"}, headers=H).json()
    monthly = client.get("/reports/monthly-sales", params={"months": 1}, headers=H).json()
    analytics = client.get("/sales-analytics/", headers=H).json()
    assert month["period_revenue"] == monthly[-1]["total"]  # same rule, same Cairo month
    # B2B is not recognized revenue yet: shown on its own, never added in
    assert month["period_revenue"] == month["period_online_revenue"] == all_time.total
    assert month["period_b2b_sales"] == b2b_booked >= 400
    assert month["period_income"] == round(month["period_revenue"] + month["period_other_income"], 2)
    assert analytics["total_revenue"] == all_time.total and analytics["b2b_sales"] == b2b_booked
    assert all_time.total > 0 and "rv_b2bo" not in {l.reference_id for l in all_time.lines}
    assert month["period_other_income"] >= 55 and month["period_expense"] >= 70
    # a revenue reversal is not an operating expense
    # (website reversals, and B2B edit/cancellation reversals that reference an order)
    db = SessionLocal()
    expenses = db.query(models.FinanceEntry).filter_by(type=models.FinanceEntryType.expense).all()
    reversals = sum(e.amount for e in expenses if e.reference_id and (
        (e.source == "website" and e.category in (order_ledger.REVERSAL_CATEGORY, returns.RETURN_CATEGORY))
        or (e.source == "b2b" and e.category in revenue.B2B_REVERSAL_CATEGORIES)))
    assert reversals > 0 and revenue.operating_expenses(db) == round(sum(e.amount for e in expenses) - reversals, 2)
    db.close()
    online = client.get("/sales-analytics/", params={"source": "online"}, headers=H).json()
    b2b = client.get("/sales-analytics/", params={"source": "b2b"}, headers=H).json()
    assert online["total_revenue"] == analytics["total_revenue"] and online["b2b_sales"] == 0
    assert b2b["total_revenue"] == 0 and b2b["b2b_sales"] == b2b_booked
    # every entry in this test DB was booked today → the 31-day series holds all of it
    assert round(sum(p["total"] for p in analytics["revenue_last_30_days"]), 2) == all_time.total


def test_order_ledger_is_identical_in_both_repositories():
    here = Path(__file__).resolve().parents[1] / "app" / "order_ledger.py"
    other = Path(__file__).resolve().parents[3] / "ecobel-website" / "backend" / "app" / "order_ledger.py"
    if not other.exists():
        pytest.skip("ecobel-website checkout not next to this repository")
    assert here.read_bytes() == other.read_bytes(), "app/order_ledger.py differs between the two repositories"


def test_a_new_products_opening_stock_is_recorded_as_a_movement():
    res = client.post("/products/", headers=H, json={"name": "Opening Stock Product", "category_id": "rv_cat", "sale_price": 90, "quantity": 40})
    assert res.status_code == 201, res.text
    pid = res.json()["id"]
    db = SessionLocal()
    try:
        moves = db.query(models.InventoryMovement).filter_by(product_id=pid).all()
        assert res.json()["quantity"] == 40 and [(m.type.value, m.quantity_change) for m in moves] == [("restock", 40)]
    finally:
        db.close()
    res0 = client.post("/products/", headers=H, json={"name": "No Stock Product", "category_id": "rv_cat", "sale_price": 90})
    db = SessionLocal()
    try:
        assert db.query(models.InventoryMovement).filter_by(product_id=res0.json()["id"]).count() == 0
    finally:
        db.close()
