"""CRUD audit (2026-11-01): regression tests for the create/update/delete
gaps found in the admin API. Throwaway SQLite DB (tests/conftest.py).

Each test names the audit finding it covers (ACC-n)."""
import pytest
from fastapi.testclient import TestClient

from app import auth, models
from app.database import SessionLocal
from app.main import app

client = TestClient(app)
H = {"Authorization": f"Bearer {auth.create_access_token({'sub': 'crud_staff'})}"}


@pytest.fixture(scope="module", autouse=True)
def seed():
    db = SessionLocal()
    db.add(models.User(username="crud_staff", hashed_password=auth.hash_password("x")))
    db.add(models.Category(id="crud_cat", name="فئة المراجعة"))
    db.add(models.Product(id="crud_p1", name="Audit Serum", category_id="crud_cat", sale_price=200, quantity=50))
    db.add(models.Product(id="crud_p2", name="Audit Cream", category_id="crud_cat", sale_price=100, quantity=50))
    db.add(models.Product(id="crud_old", name="Audit Archived", category_id="crud_cat", sale_price=80, quantity=50, is_active=False))
    db.add(models.B2BCustomer(id="crud_bc", name="صيدلية المراجعة", discount_percentage=0))
    db.commit()
    db.close()


def quantity(product_id: str) -> int:
    db = SessionLocal()
    try:
        return db.get(models.Product, product_id).quantity
    finally:
        db.close()


def ledger_sum(product_id: str) -> int:
    db = SessionLocal()
    try:
        return sum(m.quantity_change for m in db.query(models.InventoryMovement).filter_by(product_id=product_id))
    finally:
        db.close()


# ---------------- ACC-2: B2B order lines ----------------
def test_b2b_create_rejects_the_same_product_twice():
    """An order with the product split over two lines used to be accepted;
    editing it later moved the wrong stock (the edit sees only one line)."""
    before = quantity("crud_p1")
    res = client.post("/b2b/orders", headers=H, json={
        "customer_id": "crud_bc", "items": [{"product_id": "crud_p1", "quantity": 2}, {"product_id": "crud_p1", "quantity": 3}],
    })
    assert res.status_code == 400, res.text
    assert quantity("crud_p1") == before  # nothing moved


def test_b2b_create_rejects_an_archived_product_like_edit_does():
    before = quantity("crud_old")
    res = client.post("/b2b/orders", headers=H, json={"customer_id": "crud_bc", "items": [{"product_id": "crud_old", "quantity": 1}]})
    assert res.status_code == 400, res.text
    assert quantity("crud_old") == before


def test_b2b_create_then_edit_keeps_stock_equal_to_the_ledger():
    res = client.post("/b2b/orders", headers=H, json={"customer_id": "crud_bc", "items": [{"product_id": "crud_p2", "quantity": 4}]})
    assert res.status_code == 201, res.text
    order_id = res.json()["id"]
    res = client.put(f"/b2b/orders/{order_id}", headers=H, json={"items": [{"product_id": "crud_p2", "quantity": 6}]})
    assert res.status_code == 200, res.text
    # seeded with 50 and no opening movement: stock = 50 + the ledger
    assert quantity("crud_p2") == 44 and ledger_sum("crud_p2") == -6
    assert client.delete(f"/b2b/orders/{order_id}", headers=H).status_code == 204
    assert quantity("crud_p2") == 50 and ledger_sum("crud_p2") == 0


def test_b2b_customer_create_validates_like_edit():
    assert client.post("/b2b/customers", headers=H, json={"name": "   "}).status_code == 422
    assert client.post("/b2b/customers", headers=H, json={"name": "x" * 201}).status_code == 422
    res = client.post("/b2b/customers", headers=H, json={"name": "  صيدلية جديدة  "})
    assert res.status_code == 201 and res.json()["name"] == "صيدلية جديدة"


# ---------------- ACC-3: coupon delete ----------------
def _coupon(code: str) -> str:
    res = client.post("/coupons/", headers=H, json={"code": code, "discount_type": "percentage", "discount_value": 10})
    assert res.status_code == 201, res.text
    return res.json()["id"]


def test_unused_coupon_can_be_deleted():
    cid = _coupon("CRUDFREE")
    assert client.delete(f"/coupons/{cid}", headers=H).status_code == 204
    assert all(c["id"] != cid for c in client.get("/coupons/", headers=H).json())


def test_coupon_used_by_an_order_cannot_be_deleted():
    """Orders keep pointing at their coupon (order history). Deleting it hit
    the foreign key (a 500 on PostgreSQL); now it's refused with a reason."""
    cid = _coupon("CRUDUSED")
    db = SessionLocal()
    db.add(models.Order(id="crud_o1", order_number="CRUD-1", customer_name="A", customer_phone="01000000000",
                        shipping_address="x", subtotal=100, discount_amount=10, total_amount=90, coupon_id=cid))
    db.commit()
    db.close()
    res = client.delete(f"/coupons/{cid}", headers=H)
    assert res.status_code == 409, res.text
    assert any(c["id"] == cid for c in client.get("/coupons/", headers=H).json())


# ---------------- ACC-4: coupon update ----------------
@pytest.mark.parametrize("field", ["discount_value", "min_order_amount", "is_active"])
def test_coupon_update_rejects_null_for_required_fields(field):
    cid = _coupon(f"CRUDNULL{field.upper()[:4]}")
    assert client.patch(f"/coupons/{cid}", headers=H, json={field: None}).status_code == 422
    assert client.get("/coupons/", headers=H).status_code == 200  # the list still loads


def test_coupon_update_keeps_percentage_at_most_100():
    cid = _coupon("CRUDPCT")
    assert client.patch(f"/coupons/{cid}", headers=H, json={"discount_value": 150}).status_code == 400
    assert client.patch(f"/coupons/{cid}", headers=H, json={"discount_value": 100}).status_code == 200


def test_coupon_partial_update_keeps_other_fields():
    cid = _coupon("CRUDPART")
    res = client.patch(f"/coupons/{cid}", headers=H, json={"min_order_amount": 300})
    assert res.status_code == 200
    body = res.json()
    assert body["min_order_amount"] == 300 and body["discount_value"] == 10 and body["is_active"] is True


# ---------------- ACC-5 / ACC-6: shipping rates and offers ----------------
def test_shipping_rate_update_rejects_null():
    res = client.post("/shipping-rates/", headers=H, json={"city": "مدينة المراجعة", "fee": 50})
    assert res.status_code == 201, res.text
    rid = res.json()["id"]
    for field in ("fee", "is_active"):
        assert client.patch(f"/shipping-rates/{rid}", headers=H, json={field: None}).status_code == 422
    assert client.get("/shipping-rates/", headers=H).status_code == 200


def test_offer_update_rejects_null():
    res = client.post("/offers/", headers=H, json={"product_id": "crud_p1", "title": "عرض المراجعة", "offer_price": 150, "is_active": False})
    assert res.status_code == 201, res.text
    oid = res.json()["id"]
    for field in ("offer_price", "is_active"):
        assert client.patch(f"/offers/{oid}", headers=H, json={field: None}).status_code == 422
    assert client.get("/offers/", headers=H).status_code == 200


# ---------------- ACC-7: routines ----------------
def test_routine_rejects_blank_name_and_repeated_product():
    assert client.post("/routines/", headers=H, json={"name": "  ", "product_ids": ["crud_p1", "crud_p2"]}).status_code == 422
    assert client.post("/routines/", headers=H, json={"name": "روتين", "product_ids": ["crud_p1", "crud_p1"]}).status_code == 422
    res = client.post("/routines/", headers=H, json={"name": " روتين المراجعة ", "product_ids": ["crud_p1", "crud_p2"]})
    assert res.status_code == 201, res.text
    rid = res.json()["id"]
    assert res.json()["name"] == "روتين المراجعة"
    for body in ({"name": None}, {"name": " "}, {"is_active": None}, {"product_ids": ["crud_p2", "crud_p2"]}):
        assert client.patch(f"/routines/{rid}", headers=H, json=body).status_code == 422, body
    assert client.get("/routines/", headers=H).status_code == 200


# ---------------- ACC-9: free distribution ----------------
def test_free_distribution_rejects_blank_recipient():
    before = quantity("crud_p2")
    res = client.post("/free-distribution/", headers=H, json={
        "recipient_name": "  ", "recipient_type": "pharmacy", "items": [{"product_id": "crud_p2", "quantity": 1}],
    })
    assert res.status_code == 422, res.text
    assert quantity("crud_p2") == before


# ---------------- ACC-1: stock changes lock the product row ----------------
def test_stock_writers_lock_the_product_row(monkeypatch):
    """Manual adjustments, free distributions and new B2B orders must read
    the product under a row lock (like website checkout does), or a
    concurrent sale's deduction is overwritten. SQLite ignores FOR UPDATE,
    so this checks the lock is requested; the race itself was reproduced
    on PostgreSQL (see the audit report)."""
    from sqlalchemy.orm import Query

    locked = []
    original = Query.with_for_update

    def spy(self, *args, **kwargs):
        locked.append([d["entity"] for d in self.column_descriptions])
        return original(self, *args, **kwargs)

    monkeypatch.setattr(Query, "with_for_update", spy)

    def product_locked():
        found = any(models.Product in entities for entities in locked)
        locked.clear()
        return found

    assert client.post("/inventory/adjust", headers=H, json={"product_id": "crud_p1", "quantity_change": 1}).status_code == 201
    assert product_locked(), "inventory adjust"
    assert client.post("/free-distribution/", headers=H, json={
        "recipient_name": "مؤثرة", "recipient_type": "pharmacy", "items": [{"product_id": "crud_p1", "quantity": 1}],
    }).status_code == 201
    assert product_locked(), "free distribution"
    assert client.post("/b2b/orders", headers=H, json={"customer_id": "crud_bc", "items": [{"product_id": "crud_p1", "quantity": 1}]}).status_code == 201
    assert product_locked(), "b2b create"


# ================= Coverage for CRUD paths that had no tests =================
def test_every_admin_mutation_requires_a_staff_login():
    """Sweep: every POST/PUT/PATCH/DELETE route except staff login answers
    401 without a token, and with a token that isn't a staff token."""
    not_staff = {"Authorization": "Bearer not-a-real-token"}
    checked = 0
    for route_path, operations in app.openapi()["paths"].items():
        if route_path == "/auth/login":
            continue
        for method in {m.upper() for m in operations} & {"POST", "PUT", "PATCH", "DELETE"}:
            path = route_path.replace("{", "").replace("}", "")  # any id: auth is checked first
            for headers in ({}, not_staff):
                res = client.request(method, path, headers=headers, json={})
                assert res.status_code == 401, (method, route_path, res.status_code)
            checked += 1
    assert checked >= 40  # the sweep really ran over the admin API


def test_failed_multi_item_stock_operation_rolls_back_everything():
    """Free distribution of two products where the second is short: nothing
    is saved — no distribution, no movement, the first product's stock is
    untouched (one transaction)."""
    db = SessionLocal()
    db.add(models.Product(id="crud_short", name="Audit Short", category_id="crud_cat", sale_price=10, quantity=1))
    db.commit()
    db.close()
    before, ledger_before = quantity("crud_p2"), ledger_sum("crud_p2")
    count_before = len(client.get("/free-distribution/", headers=H).json())
    res = client.post("/free-distribution/", headers=H, json={
        "recipient_name": "صيدلية", "recipient_type": "pharmacy",
        "items": [{"product_id": "crud_p2", "quantity": 2}, {"product_id": "crud_short", "quantity": 5}],
    })
    assert res.status_code == 400, res.text
    assert quantity("crud_p2") == before and ledger_sum("crud_p2") == ledger_before
    assert quantity("crud_short") == 1
    assert len(client.get("/free-distribution/", headers=H).json()) == count_before

    # same for a B2B order
    res = client.post("/b2b/orders", headers=H, json={"customer_id": "crud_bc", "items": [
        {"product_id": "crud_p2", "quantity": 2}, {"product_id": "crud_short", "quantity": 5}]})
    assert res.status_code == 400
    assert quantity("crud_p2") == before and ledger_sum("crud_p2") == ledger_before


def test_category_create_is_trimmed_idempotent_and_rejects_blank():
    a = client.post("/categories/", headers=H, json={"name": "  فئة جديدة للمراجعة "})
    assert a.status_code == 201 and a.json()["name"] == "فئة جديدة للمراجعة"
    b = client.post("/categories/", headers=H, json={"name": "فئة جديدة للمراجعة"})
    assert b.json()["id"] == a.json()["id"]  # same name → the existing category
    assert client.post("/categories/", headers=H, json={"name": "   "}).status_code == 422
    names = [c["name"] for c in client.get("/categories/", headers=H).json()]
    assert names.count("فئة جديدة للمراجعة") == 1


def test_shipping_rate_crud():
    res = client.post("/shipping-rates/", headers=H, json={"city": " مدينة الشحن ", "fee": 40})
    assert res.status_code == 201 and res.json()["city"] == "مدينة الشحن"
    rid = res.json()["id"]
    assert client.post("/shipping-rates/", headers=H, json={"city": "مدينة الشحن", "fee": 10}).status_code == 400  # duplicate
    assert client.post("/shipping-rates/", headers=H, json={"city": "x", "fee": -1}).status_code == 422
    res = client.patch(f"/shipping-rates/{rid}", headers=H, json={"fee": 55})
    assert res.json()["fee"] == 55 and res.json()["is_active"] is True  # partial update keeps the rest
    assert client.delete(f"/shipping-rates/{rid}", headers=H).status_code == 204
    assert client.delete(f"/shipping-rates/{rid}", headers=H).status_code == 404
    assert client.patch("/shipping-rates/missing", headers=H, json={"fee": 1}).status_code == 404


def test_manual_stock_adjustment_and_movement_history():
    before, ledger_before = quantity("crud_p2"), ledger_sum("crud_p2")
    assert client.post("/inventory/adjust", headers=H, json={"product_id": "crud_p2", "quantity_change": 7, "note": "جرد"}).status_code == 201
    assert client.post("/inventory/adjust", headers=H, json={"product_id": "crud_p2", "quantity_change": -2}).status_code == 201
    assert quantity("crud_p2") == before + 5 and ledger_sum("crud_p2") == ledger_before + 5
    moves = client.get("/inventory/movements", headers=H, params={"product_id": "crud_p2", "limit": 2}).json()
    assert [m["quantity_change"] for m in moves] == [-2, 7]  # newest first
    assert client.post("/inventory/adjust", headers=H, json={"product_id": "missing", "quantity_change": 1}).status_code == 404


def test_finance_entries_create_validate_and_filter():
    ok = client.post("/finance/entries", headers=H, json={"type": "expense", "category": "مواد خام", "amount": 125.5})
    assert ok.status_code == 201 and ok.json()["source"] == "spending"
    for bad in ({"type": "expense", "category": "x", "amount": 0}, {"type": "expense", "category": "x", "amount": -5},
                {"type": "gift", "category": "x", "amount": 5}, {"type": "expense", "category": "x", "amount": 5, "source": "other"}):
        assert client.post("/finance/entries", headers=H, json=bad).status_code == 422, bad
    spending = client.get("/finance/entries", headers=H, params={"source": "spending", "type": "expense"}).json()
    assert ok.json()["id"] in [e["id"] for e in spending]
    assert ok.json()["id"] not in [e["id"] for e in client.get("/finance/entries", headers=H, params={"type": "income"}).json()]


def test_review_moderation():
    db = SessionLocal()
    db.add(models.Customer(id="crud_cust", name="عميلة", phone="01011112222"))
    db.add(models.Review(id="crud_rev", product_id="crud_p1", customer_id="crud_cust", rating=5, comment="ممتاز"))
    db.commit()
    db.close()
    pending = client.get("/reviews/", headers=H, params={"is_approved": False}).json()
    assert "crud_rev" in [r["id"] for r in pending]
    assert client.post("/reviews/crud_rev/approve", headers=H).json()["is_approved"] is True
    assert "crud_rev" in [r["id"] for r in client.get("/reviews/", headers=H, params={"is_approved": True}).json()]
    assert client.delete("/reviews/crud_rev", headers=H).status_code == 204
    assert client.delete("/reviews/crud_rev", headers=H).status_code == 404
    assert client.post("/reviews/crud_rev/approve", headers=H).status_code == 404
