"""B2B lists (ordering, optional limit, customer name on orders) and order
creation pricing, which must stay as it was. Throwaway SQLite DB
(tests/conftest.py)."""
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from app import auth, models
from app.database import SessionLocal
from app.main import app

client = TestClient(app)
H = {"Authorization": f"Bearer {auth.create_access_token({'sub': 'b2b_staff'})}"}
BASE = datetime(2026, 1, 1, tzinfo=timezone.utc)


@pytest.fixture(scope="module", autouse=True)
def seed():
    db = SessionLocal()
    db.add(models.User(username="b2b_staff", hashed_password=auth.hash_password("x")))
    db.add(models.Category(id="b2b_cat", name="فئة الجملة"))
    db.add(models.Product(id="b2b_p1", name="Serum", category_id="b2b_cat", sale_price=200, quantity=100))
    db.add(models.Product(id="b2b_p2", name="Cream", category_id="b2b_cat", sale_price=50, quantity=100))
    # created oldest → newest: bc0 … bc6; names sort differently (Z…T, then A)
    for i, name in enumerate(["Zeta", "Yara", "Xenia", "Wafa", "Vera", "Uma", "Aya"]):
        db.add(models.B2BCustomer(id=f"bc{i}", name=name, discount_percentage=10, created_at=BASE + timedelta(days=i)))
    db.commit()
    # orders bo0 … bo6 one day apart; bo7 shares bo6's timestamp (tie)
    stamps = [BASE + timedelta(days=10 + i) for i in range(7)] + [BASE + timedelta(days=16)]
    for i, ts in enumerate(stamps):
        db.add(models.B2BOrder(id=f"bo{i}", customer_id=f"bc{i % 7}", total_amount=10 * i, created_at=ts))
    db.commit()
    db.close()


def ids(res):
    assert res.status_code == 200, res.text
    return [x["id"] for x in res.json()]


def test_customers_default_order_is_unchanged_by_name():
    assert ids(client.get("/b2b/customers", headers=H)) == ["bc6", "bc5", "bc4", "bc3", "bc2", "bc1", "bc0"]  # Aya, Uma, … Zeta


def test_customers_newest_first_with_limit():
    assert ids(client.get("/b2b/customers", headers=H, params={"order": "newest"})) == [f"bc{i}" for i in range(6, -1, -1)]
    assert ids(client.get("/b2b/customers", headers=H, params={"order": "newest", "limit": 6})) == [f"bc{i}" for i in range(6, 0, -1)]


def test_orders_newest_first_ties_broken_by_id_and_limited():
    all_ids = ids(client.get("/b2b/orders", headers=H))
    assert all_ids == ["bo7", "bo6", "bo5", "bo4", "bo3", "bo2", "bo1", "bo0"]  # bo7/bo6 share a timestamp: id desc
    assert ids(client.get("/b2b/orders", headers=H, params={"limit": 6})) == all_ids[:6]
    assert ids(client.get("/b2b/orders", headers=H, params={"customer_id": "bc0"})) == ["bo7", "bo0"]


def test_orders_carry_the_customer_name():
    first = client.get("/b2b/orders", headers=H, params={"limit": 1}).json()[0]
    assert first["id"] == "bo7" and first["customer_id"] == "bc0" and first["customer_name"] == "Zeta"


@pytest.mark.parametrize("path,params", [
    ("/b2b/orders", {"limit": 0}), ("/b2b/orders", {"limit": 501}),
    ("/b2b/customers", {"limit": 0}), ("/b2b/customers", {"order": "random"}),
])
def test_invalid_list_parameters_are_rejected(path, params):
    assert client.get(path, headers=H, params=params).status_code == 422


def test_lists_are_staff_only():
    assert client.get("/b2b/orders").status_code == 401
    assert client.get("/b2b/customers").status_code == 401


def test_order_creation_pricing_is_unchanged():
    res = client.post("/b2b/orders", headers=H, json={
        "customer_id": "bc1", "extra_discount_percentage": 5,
        "items": [{"product_id": "b2b_p1", "quantity": 3}, {"product_id": "b2b_p2", "quantity": 4}],
    })
    assert res.status_code == 201, res.text
    body = res.json()
    # customer 10% + one-time 5% = 15% on every line
    assert [(i["unit_price"], i["discount_percentage"], i["line_total"]) for i in body["items"]] == [(200, 15, 510.0), (50, 15, 170.0)]
    assert body["total_amount"] == 680.0 and body["customer_name"] == "Yara"
    db = SessionLocal()
    try:
        assert db.get(models.Product, "b2b_p1").quantity == 97 and db.get(models.Product, "b2b_p2").quantity == 96
        income = db.query(models.FinanceEntry).filter_by(reference_id=body["id"]).one()
        assert income.amount == 680.0 and income.source == "b2b"
    finally:
        db.close()


# ---------------- helpers for the management tests ----------------
def make(prefix, discount=10, products=(("A", 100, 50), ("B", 40, 50))):
    """A customer and products (name, price, stock) unique to one test."""
    db = SessionLocal()
    db.add(models.B2BCustomer(id=f"{prefix}_c", name=f"عميل {prefix}", discount_percentage=discount))
    for name, price, qty in products:
        db.add(models.Product(id=f"{prefix}_{name}", name=f"{prefix} {name}", category_id="b2b_cat", sale_price=price, quantity=qty))
    db.commit()
    db.close()


def order(prefix, items, extra=0, note=None):
    res = client.post("/b2b/orders", headers=H, json={
        "customer_id": f"{prefix}_c", "extra_discount_percentage": extra, "note": note,
        "items": [{"product_id": f"{prefix}_{p}", "quantity": q} for p, q in items],
    })
    assert res.status_code == 201, res.text
    return res.json()


def stock(prefix, name):
    db = SessionLocal()
    try:
        return db.get(models.Product, f"{prefix}_{name}").quantity
    finally:
        db.close()


def ledger(order_id):
    """(movements, finance entries) referencing an order."""
    db = SessionLocal()
    try:
        moves = sorted((m.product_id, m.quantity_change) for m in db.query(models.InventoryMovement).filter_by(reference_id=order_id))
        money = sorted((f.type.value, round(f.amount, 2)) for f in db.query(models.FinanceEntry).filter_by(reference_id=order_id))
        return moves, money
    finally:
        db.close()


def put(order_id, items, prefix, extra=0, note=None):
    return client.put(f"/b2b/orders/{order_id}", headers=H, json={
        "extra_discount_percentage": extra, "note": note,
        "items": [{"product_id": f"{prefix}_{p}", "quantity": q} for p, q in items],
    })


# ---------------- customer details / edit / delete ----------------
def test_customer_details_and_complete_order_history_newest_first():
    make("h1")
    first, second = order("h1", [("A", 1)]), order("h1", [("B", 2)])
    c = client.get("/b2b/customers/h1_c", headers=H).json()
    assert c["name"] == "عميل h1" and c["discount_percentage"] == 10
    history = client.get("/b2b/orders", headers=H, params={"customer_id": "h1_c"}).json()
    assert [o["id"] for o in history] == [second["id"], first["id"]]
    assert history[0]["items"][0]["product_name"] == "h1 B"
    assert client.get("/b2b/customers/missing", headers=H).status_code == 404


def test_edit_customer_fields_and_validation():
    make("h2")
    res = client.patch("/b2b/customers/h2_c", headers=H, json={"name": "  صيدلية النور ", "phone": " ", "discount_percentage": 12.5, "notes": "ملاحظة"})
    assert res.status_code == 200, res.text
    assert (res.json()["name"], res.json()["phone"], res.json()["discount_percentage"]) == ("صيدلية النور", None, 12.5)
    for bad in ({"name": "  "}, {"name": None}, {"discount_percentage": None}, {"discount_percentage": -1}, {"discount_percentage": 100.5}):
        assert client.patch("/b2b/customers/h2_c", headers=H, json=bad).status_code == 422, bad
    assert client.get("/b2b/customers/h2_c", headers=H).json()["discount_percentage"] == 12.5  # nothing changed


def test_new_discount_applies_to_future_orders_only():
    make("h3")
    old = order("h3", [("A", 2)])  # 10% → 180
    assert client.patch("/b2b/customers/h3_c", headers=H, json={"discount_percentage": 25}).status_code == 200
    again = client.get(f"/b2b/orders/{old['id']}", headers=H).json()
    assert again["total_amount"] == 180 and again["items"][0]["discount_percentage"] == 10  # history untouched
    assert ledger(old["id"])[1] == [("income", 180.0)]
    assert order("h3", [("A", 2)])["total_amount"] == 150  # 25% from now on


def test_customer_with_orders_cannot_be_deleted():
    make("h4")
    o = order("h4", [("A", 1)])
    res = client.delete("/b2b/customers/h4_c", headers=H)
    assert res.status_code == 409 and "أوردر" in res.json()["detail"]
    assert client.get("/b2b/customers/h4_c", headers=H).status_code == 200
    assert client.get(f"/b2b/orders/{o['id']}", headers=H).status_code == 200 and ledger(o["id"])[1] == [("income", 90.0)]


def test_customer_without_orders_can_be_deleted_once():
    make("h5")
    assert client.delete("/b2b/customers/h5_c", headers=H).status_code == 204
    assert client.get("/b2b/customers/h5_c", headers=H).status_code == 404
    assert client.delete("/b2b/customers/h5_c", headers=H).status_code == 404


# ---------------- order edit ----------------
def test_edit_reconciles_stock_lines_total_and_finance():
    make("e1", products=(("A", 100, 50), ("B", 40, 50), ("C", 30, 10)))
    o = order("e1", [("A", 5), ("B", 2)])  # 10%: 450 + 72 = 522
    assert (stock("e1", "A"), stock("e1", "B")) == (45, 48)
    res = put(o["id"], [("A", 3), ("C", 4)], "e1", note="معدّل")  # reduce A, drop B, add C
    assert res.status_code == 200, res.text
    body = res.json()
    lines = {i["product_id"]: (i["quantity"], i["unit_price"], i["discount_percentage"], i["line_total"]) for i in body["items"]}
    assert lines == {"e1_A": (3, 100, 10, 270.0), "e1_C": (4, 30, 10, 108.0)}
    assert body["total_amount"] == 378.0 and body["note"] == "معدّل"
    assert (stock("e1", "A"), stock("e1", "B"), stock("e1", "C")) == (47, 50, 6)
    moves, money = ledger(o["id"])
    assert moves == sorted([("e1_A", -5), ("e1_B", -2), ("e1_A", 2), ("e1_B", 2), ("e1_C", -4)])
    assert money == sorted([("income", 522.0), ("expense", 144.0)])  # nets to the new total, 378


def test_edit_keeps_historical_prices_and_customer_discount():
    make("e2")
    o = order("e2", [("A", 2)])  # 100 at 10% → 180
    db = SessionLocal()
    db.get(models.Product, "e2_A").sale_price = 999  # price changed since
    db.get(models.B2BCustomer, "e2_c").discount_percentage = 40  # customer discount changed since
    db.commit()
    db.close()
    body = put(o["id"], [("A", 3)], "e2").json()
    assert body["items"][0]["unit_price"] == 100 and body["items"][0]["discount_percentage"] == 10 and body["total_amount"] == 270
    # extra discount edited: the original customer part (10) + the new extra (5)
    body = put(o["id"], [("A", 3)], "e2", extra=5).json()
    assert body["items"][0]["discount_percentage"] == 15 and body["total_amount"] == 255 and body["extra_discount_percentage"] == 5
    assert ledger(o["id"])[1] == sorted([("income", 180.0), ("income", 90.0), ("expense", 15.0)])  # nets to 255


def test_repeating_an_edit_adds_no_stock_or_finance_entries():
    make("e3")
    o = order("e3", [("A", 2)])
    assert put(o["id"], [("A", 4)], "e3").status_code == 200
    before = ledger(o["id"])
    for _ in range(2):
        assert put(o["id"], [("A", 4)], "e3").status_code == 200
    assert ledger(o["id"]) == before and stock("e3", "A") == 46


def test_edit_is_atomic_when_stock_is_insufficient():
    make("e4", products=(("A", 100, 3), ("B", 40, 50)))
    o = order("e4", [("A", 1), ("B", 1)])
    before = (ledger(o["id"]), stock("e4", "A"), stock("e4", "B"))
    res = put(o["id"], [("A", 10), ("B", 5)], "e4")  # A needs 9 more, only 2 left
    assert res.status_code == 400 and "غير كافية" in res.json()["detail"]
    assert (ledger(o["id"]), stock("e4", "A"), stock("e4", "B")) == before
    assert client.get(f"/b2b/orders/{o['id']}", headers=H).json()["total_amount"] == o["total_amount"]


@pytest.mark.parametrize("case,items,status", [
    ("empty", [], 422), ("zero", [("A", 0)], 422), ("dup", [("A", 1), ("A", 2)], 400), ("unknown", [("missing", 1)], 404),
])
def test_edit_rejects_invalid_items(case, items, status):
    p = f"e5{case}"
    make(p)
    o = order(p, [("A", 1)])
    assert put(o["id"], items, p).status_code == status
    assert client.get(f"/b2b/orders/{o['id']}", headers=H).json()["total_amount"] == o["total_amount"]


def test_edit_of_an_unknown_order_is_404():
    assert client.put("/b2b/orders/missing", headers=H, json={"items": [{"product_id": "b2b_p1", "quantity": 1}]}).status_code == 404


def test_extra_discount_edit_refused_when_discount_was_capped_at_100():
    make("e6", discount=90)
    o = order("e6", [("A", 1)], extra=20)  # capped at 100
    assert put(o["id"], [("A", 1)], "e6", extra=5).status_code == 409
    assert put(o["id"], [("A", 2)], "e6", extra=20).status_code == 200  # quantities still editable


def test_archived_product_cannot_be_increased_but_can_be_reduced():
    make("e7")
    o = order("e7", [("A", 3)])
    db = SessionLocal()
    db.get(models.Product, "e7_A").is_active = False
    db.commit()
    db.close()
    assert put(o["id"], [("A", 4)], "e7").status_code == 400
    assert put(o["id"], [("A", 1)], "e7").status_code == 200 and stock("e7", "A") == 49


# ---------------- order delete ----------------
def test_delete_order_reverses_stock_and_revenue_once():
    make("d1")
    o = order("d1", [("A", 4), ("B", 5)])  # 360 + 180 = 540
    assert client.delete(f"/b2b/orders/{o['id']}", headers=H).status_code == 204
    assert (stock("d1", "A"), stock("d1", "B")) == (50, 50)
    moves, money = ledger(o["id"])
    assert moves == sorted([("d1_A", -4), ("d1_B", -5), ("d1_A", 4), ("d1_B", 5)])  # history kept + reversal
    assert money == sorted([("income", 540.0), ("expense", 540.0)])
    assert client.get(f"/b2b/orders/{o['id']}", headers=H).status_code == 404
    # a retried request reverses nothing twice
    assert client.delete(f"/b2b/orders/{o['id']}", headers=H).status_code == 404
    assert ledger(o["id"]) == (moves, money) and stock("d1", "A") == 50
    # the customer can be deleted once their only order is gone
    assert client.delete("/b2b/customers/d1_c", headers=H).status_code == 204


def test_deleted_order_leaves_the_order_lists():
    make("d2")
    o = order("d2", [("A", 1)])
    assert o["id"] in {x["id"] for x in client.get("/b2b/orders", headers=H).json()}
    client.delete(f"/b2b/orders/{o['id']}", headers=H)
    assert o["id"] not in {x["id"] for x in client.get("/b2b/orders", headers=H).json()}


# ---------------- access control ----------------
@pytest.mark.parametrize("method,path", [
    ("GET", "/b2b/customers/x"), ("PATCH", "/b2b/customers/x"), ("DELETE", "/b2b/customers/x"),
    ("GET", "/b2b/orders/x"), ("PUT", "/b2b/orders/x"), ("DELETE", "/b2b/orders/x"),
])
def test_management_endpoints_are_staff_only(method, path):
    customer_token = {"Authorization": f"Bearer {auth.create_access_token({'sub': 'cust', 'type': 'customer'})}"}
    for headers in ({}, customer_token):
        assert client.request(method, path, headers=headers, json={}).status_code == 401
