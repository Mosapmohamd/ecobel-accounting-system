"""Homepage merchandising + offer integrity — against a throwaway SQLite DB
(never the shared development database):

    cd backend && python -m pytest -q
"""
import os
import tempfile

_db = os.path.join(tempfile.mkdtemp(), "test.db")
os.environ["DATABASE_URL"] = f"sqlite:///{_db}"
os.environ.pop("SECRET_KEY", None)

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app import models, auth  # noqa: E402
from app.database import SessionLocal  # noqa: E402
from app.main import app  # noqa: E402

client = TestClient(app)


@pytest.fixture(scope="module", autouse=True)
def seed():
    db = SessionLocal()
    db.add(models.User(username="staff", hashed_password=auth.hash_password("x")))
    db.add(models.Category(id="c1", name="العناية بالبشرة"))
    for i in range(1, 11):
        db.add(models.Product(id=f"p{i}", name=f"Product {i}", category_id="c1", sale_price=100, quantity=10))
    db.add(models.Product(id="off", name="Inactive", category_id="c1", sale_price=100, quantity=10, is_active=False))
    db.add(models.Product(id="empty", name="Sold out", category_id="c1", sale_price=100, quantity=0))
    db.add_all([models.Routine(id="r1", name="R1"), models.Routine(id="r2", name="R2"), models.Routine(id="r3", name="R3", is_active=False)])
    db.flush()
    for rid in ("r1", "r2", "r3"):
        db.add(models.RoutineItem(routine_id=rid, product_id="p1", position=0))
        db.add(models.RoutineItem(routine_id=rid, product_id="p2", position=1))
    db.commit()
    db.close()


H = {"Authorization": f"Bearer {auth.create_access_token({'sub': 'staff'})}"}


def put_products(product_ids):
    return client.put("/merchandising/featured-products", json={"product_ids": product_ids}, headers=H)


def test_requires_staff_login():
    assert client.get("/merchandising/featured-products").status_code == 401


def test_set_and_reorder_featured_products():
    res = put_products(["p3", "p1", "p2"])
    assert res.status_code == 200
    assert [(s["position"], s["product"]["id"]) for s in res.json()] == [(1, "p3"), (2, "p1"), (3, "p2")]
    # Reorder + replace in one save.
    res = put_products(["p1", "p4"])
    assert [s["product"]["id"] for s in res.json()] == ["p1", "p4"]
    assert [s["product"]["id"] for s in client.get("/merchandising/featured-products", headers=H).json()] == ["p1", "p4"]


def test_featured_products_validation():
    assert put_products([f"p{i}" for i in range(1, 10)]).status_code == 422  # 9 > max 8
    assert put_products(["p1", "p1"]).status_code == 400
    assert put_products(["off"]).status_code == 400
    assert put_products(["empty"]).status_code == 400
    assert put_products(["nope"]).status_code == 404
    # A rejected save leaves the previous selection untouched.
    assert [s["product"]["id"] for s in client.get("/merchandising/featured-products", headers=H).json()] == ["p1", "p4"]


def test_clear_featured_products():
    assert put_products([]).json() == []


def test_featured_product_turning_unsellable_is_flagged_not_hidden_from_staff():
    put_products(["p5"])
    db = SessionLocal()
    db.get(models.Product, "p5").quantity = 0
    db.commit()
    db.close()
    slot = client.get("/merchandising/featured-products", headers=H).json()[0]
    assert slot["is_visible"] is False and slot["issue"]


def test_featured_routines_validation_and_delete_frees_slot():
    put = lambda ids: client.put("/merchandising/featured-routines", json={"routine_ids": ids}, headers=H)  # noqa: E731
    assert put(["r1", "r2", "r1"]).status_code == 422  # 3 > max 2
    assert put(["r3"]).status_code == 400  # inactive
    res = put(["r2", "r1"])
    assert [s["routine"]["id"] for s in res.json()] == ["r2", "r1"]
    assert client.delete("/routines/r2", headers=H).status_code == 204
    assert [s["routine"]["id"] for s in client.get("/merchandising/featured-routines", headers=H).json()] == ["r1"]


def test_only_one_active_offer_per_product():
    first = client.post("/offers/", json={"product_id": "p6", "title": "A", "offer_price": 80}, headers=H)
    assert first.status_code == 201
    second = client.post("/offers/", json={"product_id": "p6", "title": "B", "offer_price": 70}, headers=H)
    assert second.status_code == 400
    # After deactivating the first, a new one is allowed.
    client.patch(f"/offers/{first.json()['id']}", json={"is_active": False}, headers=H)
    assert client.post("/offers/", json={"product_id": "p6", "title": "B", "offer_price": 70}, headers=H).status_code == 201
    # Re-activating the old one while B is active is refused.
    assert client.patch(f"/offers/{first.json()['id']}", json={"is_active": True}, headers=H).status_code == 400
