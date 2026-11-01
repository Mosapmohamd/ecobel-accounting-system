"""Category management (CRUD audit, approved 2026-11-01): create, list with
product counts, details, rename, and delete only when nothing refers to the
category (409 otherwise — never a cascade). Throwaway SQLite DB
(tests/conftest.py)."""
import pytest
from fastapi.testclient import TestClient

from app import auth, models
from app.database import SessionLocal
from app.main import app

client = TestClient(app)
H = {"Authorization": f"Bearer {auth.create_access_token({'sub': 'cat_staff'})}"}


@pytest.fixture(scope="module", autouse=True)
def seed():
    db = SessionLocal()
    db.add(models.User(username="cat_staff", hashed_password=auth.hash_password("x")))
    db.add_all([models.Category(id="cm_full", name="كريمات المراجعة"), models.Category(id="cm_arch", name="فئة مؤرشفة للمراجعة"),
                models.Category(id="cm_offer", name="فئة عليها عرض"), models.Category(id="cm_empty", name="فئة فاضية")])
    db.add_all([
        models.Product(id="cm_p1", name="Cream 1", category_id="cm_full", sale_price=10, quantity=5),
        models.Product(id="cm_p2", name="Cream 2", category_id="cm_full", sale_price=10, quantity=0),
        models.Product(id="cm_p3", name="Old Cream", category_id="cm_full", sale_price=10, quantity=5, is_active=False),
        models.Product(id="cm_p4", name="Archived only", category_id="cm_arch", sale_price=10, quantity=5, is_active=False),
    ])
    db.add(models.Promotion(id="cm_promo", name="عرض الفئة", type="percentage_discount", status="draft", config={}))
    db.add(models.PromotionTarget(promotion_id="cm_promo", role="eligible", category_id="cm_offer"))
    db.commit()
    db.close()


def listed() -> dict:
    res = client.get("/categories/", headers=H)
    assert res.status_code == 200
    return {c["id"]: c for c in res.json()}


# ---------------- READ ----------------
def test_list_and_details_show_product_counts():
    cats = listed()
    assert (cats["cm_full"]["product_count"], cats["cm_full"]["archived_product_count"]) == (2, 1)  # sold out counts as active
    assert (cats["cm_arch"]["product_count"], cats["cm_arch"]["archived_product_count"]) == (0, 1)
    assert (cats["cm_empty"]["product_count"], cats["cm_empty"]["archived_product_count"]) == (0, 0)
    names = [c["name"] for c in client.get("/categories/", headers=H).json()]
    assert names == sorted(names)
    one = client.get("/categories/cm_full", headers=H)
    assert one.status_code == 200 and one.json()["name"] == "كريمات المراجعة" and one.json()["product_count"] == 2
    assert client.get("/categories/missing", headers=H).status_code == 404


# ---------------- CREATE ----------------
def test_create_validates_and_never_makes_a_twin():
    res = client.post("/categories/", headers=H, json={"name": "  زيوت   الشعر "})
    assert res.status_code == 201 and res.json()["name"] == "زيوت الشعر" and res.json()["product_count"] == 0
    cid = res.json()["id"]
    for same in ("زيوت الشعر", " زيوت  الشعر "):
        again = client.post("/categories/", headers=H, json={"name": same})
        assert again.json()["id"] == cid  # the existing category, not a duplicate
    latin = client.post("/categories/", headers=H, json={"name": "Hair Oils"})
    assert client.post("/categories/", headers=H, json={"name": "hair oils"}).json()["id"] == latin.json()["id"]  # case-insensitive
    for bad in ({"name": "   "}, {"name": "x" * 101}, {"name": None}, {}):
        assert client.post("/categories/", headers=H, json=bad).status_code == 422, bad
    assert [c["name"] for c in client.get("/categories/", headers=H).json()].count("زيوت الشعر") == 1


# ---------------- UPDATE ----------------
def test_rename_keeps_products_in_the_category():
    res = client.patch("/categories/cm_full", headers=H, json={"name": "  كريمات   الوش "})
    assert res.status_code == 200, res.text
    assert res.json()["name"] == "كريمات الوش" and res.json()["product_count"] == 2
    db = SessionLocal()
    try:
        assert {p.id for p in db.query(models.Product).filter_by(category_id="cm_full")} == {"cm_p1", "cm_p2", "cm_p3"}
        assert db.get(models.Product, "cm_p1").category_name == "كريمات الوش"
    finally:
        db.close()
    # the products list shows the new name
    p = client.get("/products/cm_p1", headers=H).json()
    assert p["category_name"] == "كريمات الوش"


def test_rename_rejects_duplicates_and_invalid_names():
    assert client.patch("/categories/cm_empty", headers=H, json={"name": "فئة عليها عرض"}).status_code == 409
    assert client.patch("/categories/cm_empty", headers=H, json={"name": " فئة   عليها عرض "}).status_code == 409
    for bad in ({"name": ""}, {"name": "  "}, {"name": "x" * 101}, {"name": None}, {}):
        assert client.patch("/categories/cm_empty", headers=H, json=bad).status_code == 422, bad
    assert client.patch("/categories/missing", headers=H, json={"name": "اسم"}).status_code == 404
    # same name (or a spacing-only change) on the category itself is fine
    assert client.patch("/categories/cm_empty", headers=H, json={"name": "فئة فاضية"}).status_code == 200
    assert listed()["cm_empty"]["name"] == "فئة فاضية"


# ---------------- DELETE ----------------
@pytest.mark.parametrize("cid, why", [("cm_full", "منتج ظاهر"), ("cm_arch", "منتج مؤرشف"), ("cm_offer", "عرض")])
def test_delete_is_refused_while_anything_refers_to_the_category(cid, why):
    res = client.delete(f"/categories/{cid}", headers=H)
    assert res.status_code == 409 and why in res.json()["detail"]
    assert cid in listed()  # still there
    db = SessionLocal()
    try:  # nothing cascaded
        assert db.query(models.Product).filter(models.Product.id.in_(["cm_p1", "cm_p2", "cm_p3", "cm_p4"])).count() == 4
        assert db.query(models.PromotionTarget).filter_by(category_id="cm_offer").count() == 1
    finally:
        db.close()


def test_unused_category_can_be_deleted():
    cid = client.post("/categories/", headers=H, json={"name": "فئة مؤقتة"}).json()["id"]
    assert client.delete(f"/categories/{cid}", headers=H).status_code == 204
    assert cid not in listed()
    assert client.get(f"/categories/{cid}", headers=H).status_code == 404
    assert client.delete(f"/categories/{cid}", headers=H).status_code == 404


def test_category_endpoints_need_staff_login():
    for method, path in (("GET", "/categories/"), ("GET", "/categories/cm_empty"), ("POST", "/categories/"),
                         ("PATCH", "/categories/cm_empty"), ("DELETE", "/categories/cm_empty")):
        assert client.request(method, path, json={"name": "x"}).status_code == 401, (method, path)
