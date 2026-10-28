"""Customer returns (app/returns.py, /online-orders/{id}/returns): partial
and full, per item, restocked or not; revenue reversed by what the customer
actually paid for the returned units (offers and coupon allocated, shipping
kept); retries and over-returns refused; history kept; cancellation stays a
separate path. Throwaway SQLite DB (tests/conftest.py).

The order used throughout (cash on delivery, delivered):
  A: 2 × 100 = 200   offer discount allocated 20
  B: 1 × 300 = 300   offer discount allocated 40
  C: 3 ×  50 = 150
  subtotal 650 − offers 60 − coupon 59 + shipping 40 = total 571
  after offers A 180 / B 260 / C 150 (= 590); coupon spread by that value:
  A 18 / B 26 / C 15 → paid A 162 (81 a unit) / B 234 / C 135 (45 a unit),
  merchandise 531 + shipping 40.
"""
import uuid
from datetime import timedelta

import pytest
from fastapi.testclient import TestClient

from app import auth, cairo_time, models, order_ledger, returns, revenue, services
from app.database import SessionLocal
from app.main import app

client = TestClient(app)
H = {"Authorization": f"Bearer {auth.create_access_token({'sub': 'rt_staff'})}"}
TODAY = cairo_time.cairo_today().isoformat()


@pytest.fixture(scope="module", autouse=True)
def seed():
    db = SessionLocal()
    db.add(models.User(username="rt_staff", hashed_password=auth.hash_password("x")))
    db.add(models.Category(id="rt_cat", name="فئة المرتجعات"))
    for pid in ("rt_a", "rt_b", "rt_c"):
        db.add(models.Product(id=pid, name=pid.upper(), category_id="rt_cat", sale_price=100, quantity=100))
    db.add(models.Customer(id="rt_cust", name="عميلة اختبار المرتجع", phone="01066660000"))
    db.commit()
    db.close()


def make_order(oid, *, method="cash_on_delivery", deliver=True, allocations=True):
    """The documented order, as checkout leaves it, then delivered by staff."""
    db = SessionLocal()
    db.add(models.Order(id=oid, order_number=oid.upper(), customer_id="rt_cust", customer_name="عميلة اختبار المرتجع",
                        customer_phone="01066660000", city="القاهرة", shipping_address="عنوان", subtotal=650,
                        promotion_discount=60, discount_amount=59, shipping_fee=40, total_amount=571, payment_method=method))
    for item_id, pid, unit, qty in ((f"{oid}_a", "rt_a", 100, 2), (f"{oid}_b", "rt_b", 300, 1), (f"{oid}_c", "rt_c", 50, 3)):
        db.add(models.OrderItem(id=item_id, order_id=oid, product_id=pid, product_name=pid.upper(), unit_price=unit,
                                quantity=qty, line_total=unit * qty))
        services.apply_stock_movement(db, db.get(models.Product, pid), -qty, models.MovementType.website_sale, reference_id=oid)
    db.add(models.OrderPromotion(order_id=oid, promotion_id="rt_promo", name="عرض", type="percentage", terms={}, discount=60,
                                 details={"allocations": {"rt_a": 20, "rt_b": 40}} if allocations else {}))
    db.commit()
    db.close()
    if deliver:
        assert client.patch(f"/online-orders/{oid}/status", json={"status": "delivered"}, headers=H).status_code == 200


def ret(oid, items, *, request_id=None, reason="المقاس مش مناسب", returned_on=TODAY, headers=H, path=""):
    body = {"items": [{"order_item_id": f"{oid}_{k}", "quantity": q, "restock": r} for k, q, r in items],
            "reason": reason, "returned_on": returned_on, "note": "اختبار"}
    if path != "/preview":
        body["request_id"] = request_id or uuid.uuid4().hex
    return client.post(f"/online-orders/{oid}/returns{path}", json=body, headers=headers)


def books(oid):
    """(stock a, b, c), ledger entries for the order, customer_return movements, revenue counted for it."""
    db = SessionLocal()
    try:
        stock = tuple(db.get(models.Product, p).quantity for p in ("rt_a", "rt_b", "rt_c"))
        entries = sorted((e.type.value, e.category, e.amount) for e in db.query(models.FinanceEntry).filter_by(reference_id=oid).all())
        moves = sorted((m.product_id, m.quantity_change) for m in db.query(models.InventoryMovement)
                       .filter_by(reference_id=oid, type=models.MovementType.customer_return).all())
        counted = round(sum(l.amount for l in revenue.revenue_lines(db) if l.reference_id == oid), 2)
        return stock, entries, moves, counted
    finally:
        db.close()


def summary(oid):
    return client.get(f"/online-orders/{oid}/returns", headers=H).json()


SALE = ("income", order_ledger.SALE_CATEGORY, 571.0)


def test_unit_values_allocate_offers_per_product_and_spread_the_coupon():
    make_order("rt_v", deliver=False)
    db = SessionLocal()
    o = db.get(models.Order, "rt_v")
    units = returns.unit_values(db, o)
    assert {k: round(v, 6) for k, v in units.items()} == {"rt_v_a": 81, "rt_v_b": 234, "rt_v_c": 45}
    assert returns.merchandise_total(o) == 531
    db.close()


def test_returning_one_item_of_a_multi_item_order():
    make_order("rt_1")
    stock0, *_ = books("rt_1")
    res = ret("rt_1", [("b", 1, True)])
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["merchandise_value"] == 234 and body["revenue_reversed"] == 234 and body["processed_by"] == "rt_staff"
    stock, entries, moves, counted = books("rt_1")
    assert stock == (stock0[0], stock0[1] + 1, stock0[2])  # only B back
    assert entries == sorted([SALE, ("expense", returns.RETURN_CATEGORY, 234.0)])  # the sale entry stays
    assert moves == [("rt_b", 1)] and counted == 571 - 234
    s = summary("rt_1")
    assert {l["order_item_id"]: (l["returned"], l["restocked"], l["returnable"]) for l in s["lines"]} == {
        "rt_1_a": (0, 0, 2), "rt_1_b": (1, 1, 0), "rt_1_c": (0, 0, 3)}
    assert s["status"] == "delivered" and not s["fully_returned"] and s["can_return"]


def test_part_of_an_items_quantity_and_units_that_must_not_be_restocked():
    make_order("rt_2")
    stock0, *_ = books("rt_2")
    assert ret("rt_2", [("a", 1, True)]).json()["revenue_reversed"] == 81
    assert ret("rt_2", [("a", 1, False)], reason="تالف").json()["revenue_reversed"] == 81  # damaged: money back, no stock
    stock, entries, moves, counted = books("rt_2")
    assert stock == (stock0[0] + 1, stock0[1], stock0[2])
    assert moves == [("rt_a", 1)] and counted == 571 - 162
    line = next(l for l in summary("rt_2")["lines"] if l["order_item_id"] == "rt_2_a")
    assert (line["returned"], line["restocked"], line["returnable"]) == (2, 1, 0)


def test_full_return_reverses_exactly_the_merchandise_and_keeps_shipping():
    make_order("rt_3")
    stock0, *_ = books("rt_3")
    assert ret("rt_3", [("c", 3, True)]).json()["revenue_reversed"] == 135  # a whole item
    assert ret("rt_3", [("a", 1, True), ("b", 1, False)]).json()["revenue_reversed"] == 81 + 234
    last = ret("rt_3", [("a", 1, True)]).json()
    assert last["revenue_reversed"] == 81
    stock, entries, moves, counted = books("rt_3")
    assert sum(e[2] for e in entries if e[1] == returns.RETURN_CATEGORY) == 531  # to the cent
    assert counted == 40  # shipping stays recognized
    assert stock == (stock0[0] + 2, stock0[1], stock0[2] + 3)
    s = summary("rt_3")
    assert s["fully_returned"] and not s["can_return"] and s["merchandise_returned"] == 531 and s["shipping_fee"] == 40
    # nothing left to return
    assert ret("rt_3", [("c", 1, True)]).status_code == 409


def test_rounding_never_drifts_on_a_full_return_in_awkward_pieces():
    db = SessionLocal()
    db.add(models.Order(id="rt_r", order_number="RT_R", customer_id="rt_cust", customer_name="x", customer_phone="01066660000",
                        city="القاهرة", shipping_address="عنوان", subtotal=100, discount_amount=10, shipping_fee=0,
                        total_amount=90, payment_method="cash_on_delivery"))
    db.add(models.OrderItem(id="rt_r_c", order_id="rt_r", product_id="rt_c", product_name="RT_C", unit_price=100 / 3,
                            quantity=3, line_total=100))
    services.apply_stock_movement(db, db.get(models.Product, "rt_c"), -3, models.MovementType.website_sale, reference_id="rt_r")
    db.commit()
    db.close()
    client.patch("/online-orders/rt_r/status", json={"status": "delivered"}, headers=H)
    amounts = [ret("rt_r", [("c", 1, True)]).json()["revenue_reversed"] for _ in range(3)]
    assert amounts == [30, 30, 30] and round(sum(amounts), 2) == 90


def test_quantities_above_what_is_left_are_refused_with_nothing_written():
    make_order("rt_4")
    before = books("rt_4")
    assert ret("rt_4", [("a", 3, True)]).status_code == 409  # ordered 2
    assert ret("rt_4", [("a", 1, True), ("a", 1, True)]).status_code == 409  # same line twice
    assert ret("rt_4", [("zz", 1, True)]).status_code == 409  # not this order's line
    assert ret("rt_4", [("a", 0, True)]).status_code == 422
    assert ret("rt_4", [], ).status_code == 422
    assert ret("rt_4", [("a", 1, True)], reason="  ").status_code == 422  # blank reason
    future = (cairo_time.cairo_today() + timedelta(days=1)).isoformat()
    assert ret("rt_4", [("a", 1, True)], returned_on=future).status_code == 400
    assert ret("rt_4", [("a", 1, True)], returned_on="2000-01-01").status_code == 400
    assert books("rt_4") == before
    assert ret("rt_4", [("a", 2, True)]).status_code == 201
    assert ret("rt_4", [("a", 1, True)]).status_code == 409  # now none left


def test_a_retried_request_records_the_return_once():
    make_order("rt_5")
    rid = uuid.uuid4().hex
    first = ret("rt_5", [("c", 2, True)], request_id=rid)
    after_first = books("rt_5")
    again = ret("rt_5", [("c", 2, True)], request_id=rid)
    assert first.status_code == 201 and again.status_code == 200 and again.json()["id"] == first.json()["id"]
    assert books("rt_5") == after_first and len(summary("rt_5")["returns"]) == 1
    make_order("rt_5b")
    assert ret("rt_5b", [("c", 1, True)], request_id=rid).status_code == 409  # someone else's request id


def test_preview_shows_the_effect_and_changes_nothing():
    make_order("rt_6")
    before = books("rt_6")
    p = ret("rt_6", [("a", 1, True), ("c", 2, False)], path="/preview").json()
    assert p["units"] == 3 and p["units_restocked"] == 1 and p["merchandise_value"] == 81 + 90
    assert p["revenue_reversed"] == 171 and p["shipping_refunded"] == 0
    assert books("rt_6") == before and summary("rt_6")["returns"] == []


def test_returns_need_a_delivered_order_and_unrecognized_orders_reverse_nothing():
    make_order("rt_7", deliver=False)
    assert ret("rt_7", [("a", 1, True)]).status_code == 409  # pending: cancel it instead
    assert summary("rt_7")["can_return"] is False
    make_order("rt_card", method="card")  # delivered, but never paid → never revenue
    res = ret("rt_card", [("a", 1, True)]).json()
    assert res["merchandise_value"] == 81 and res["revenue_reversed"] == 0
    _, entries, moves, counted = books("rt_card")
    assert entries == [] and moves == [("rt_a", 1)] and counted == 0


def test_older_orders_without_offer_allocations_spread_the_offer_discount_by_value():
    make_order("rt_8", allocations=False)
    # offers 60 spread over 650 of goods, then the coupon over what's left
    db = SessionLocal()
    units = returns.unit_values(db, db.get(models.Order, "rt_8"))
    db.close()
    assert round(sum(units[f"rt_8_{k}"] * q for k, q in (("a", 2), ("b", 1), ("c", 3))), 6) == 531


def test_history_is_kept_and_a_returned_order_cannot_be_cancelled():
    make_order("rt_9")
    ret("rt_9", [("a", 1, False)])
    res = client.patch("/online-orders/rt_9/status", json={"status": "cancelled"}, headers=H)
    assert res.status_code == 409 and "مرتجع" in res.json()["detail"]
    db = SessionLocal()
    o = db.get(models.Order, "rt_9")
    assert o.status == models.OrderStatus.delivered and o.total_amount == 571 and len(o.items) == 3
    assert [(i.quantity, i.line_total) for i in sorted(o.items, key=lambda i: i.id)] == [(2, 200), (1, 300), (3, 150)]
    db.close()
    _, entries, *_ = books("rt_9")
    assert SALE in entries
    # an order without returns still cancels as before: one reversal, stock back
    make_order("rt_9b")
    stock0, *_ = books("rt_9b")
    assert client.patch("/online-orders/rt_9b/status", json={"status": "cancelled"}, headers=H).status_code == 200
    stock, entries, _, counted = books("rt_9b")
    assert entries == sorted([SALE, ("expense", order_ledger.REVERSAL_CATEGORY, 571.0)]) and counted == 0
    assert stock == (stock0[0] + 2, stock0[1] + 1, stock0[2] + 3)


def test_only_signed_in_staff_can_record_or_view_returns():
    make_order("rt_10")
    before = books("rt_10")
    for headers in ({}, {"Authorization": "Bearer nope"}):
        assert ret("rt_10", [("a", 1, True)], headers=headers).status_code == 401
        assert client.get("/online-orders/rt_10/returns", headers=headers).status_code == 401
    assert books("rt_10") == before


def test_reports_net_returns_out_of_revenue_and_keep_them_apart():
    make_order("rt_11")
    db = SessionLocal()
    base = revenue.revenue(db)
    db.add(models.B2BCustomer(id="rt_b2bc", name="Shop", discount_percentage=0))
    db.add(models.B2BOrder(id="rt_b2bo", customer_id="rt_b2bc", total_amount=700))
    db.add(models.FinanceEntry(type=models.FinanceEntryType.income, category=revenue.B2B_SALE_CATEGORY, amount=700,
                               reference_id="rt_b2bo", source="b2b"))
    db.commit()
    db.close()
    ret("rt_11", [("b", 1, True)])
    db = SessionLocal()
    after = revenue.revenue(db)
    expenses = revenue.operating_expenses(db)
    db.close()
    assert after.total == round(base.total - 234, 2)  # and B2B's 700 never enters revenue
    month = client.get("/reports/dashboard", params={"period": "month"}, headers=H).json()
    monthly = client.get("/reports/monthly-sales", params={"months": 1}, headers=H).json()
    analytics = client.get("/sales-analytics/", headers=H).json()
    assert month["period_revenue"] == monthly[-1]["total"] == analytics["total_revenue"] == after.total
    assert month["period_returns"] == analytics["returns_total"] == revenue.returns_total(after.lines) > 0
    assert analytics["fully_returned_orders"] >= 1 and analytics["partially_returned_orders"] >= 1
    assert month["period_expense"] == expenses  # a return is not an operating expense
    db = SessionLocal()
    spending = [e for e in db.query(models.FinanceEntry).filter_by(type=models.FinanceEntryType.expense).all()
                if e.category not in (order_ledger.REVERSAL_CATEGORY, returns.RETURN_CATEGORY, *revenue.B2B_REVERSAL_CATEGORIES)]
    db.close()
    assert expenses == round(sum(e.amount for e in spending), 2)
