"""The Offer Builder's admin API (/promotions): staff-only access,
validation of every offer type, list filters/sort/paging, status actions,
safe delete, terms locked after use, the preview, and staff cancellation
giving back offer uses. Throwaway SQLite DB (tests/conftest.py)."""
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import auth, models
from app.database import SessionLocal
from app.main import app

client = TestClient(app)
H = {"Authorization": f"Bearer {auth.create_access_token({'sub': 'promo_staff'})}"}
NOW = datetime.now(timezone.utc)


@pytest.fixture(scope="module", autouse=True)
def seed():
    db = SessionLocal()
    db.add(models.User(username="promo_staff", hashed_password=auth.hash_password("x")))
    db.add_all([models.Category(id="pr_skin", name="بشرة"), models.Category(id="pr_hair", name="شعر")])
    db.add_all([
        models.Product(id="pr_a", name="Serum", category_id="pr_skin", sale_price=250, quantity=20),
        models.Product(id="pr_b", name="Cream", category_id="pr_skin", sale_price=300, quantity=20),
        models.Product(id="pr_g", name="Mask", category_id="pr_hair", sale_price=80, quantity=20),
    ])
    db.add(models.Offer(product_id="pr_b", title="خصم", offer_price=280))  # product sale price: preview uses 280
    db.add(models.ShippingRate(city="المنصورة-pr", fee=50))
    db.commit()
    db.close()


@pytest.fixture(autouse=True)
def clean():
    yield
    db = SessionLocal()
    db.query(models.OrderPromotion).delete()
    db.query(models.PromotionTarget).delete()
    db.query(models.Promotion).delete()
    db.commit()
    db.close()


def body(type_="percentage", config=None, **kw):
    data = {"name": "عرض تجريبي", "type": type_, "config": config if config is not None else {"percent": 10}}
    data.update(kw)
    return data


def create(**kw):
    res = client.post("/promotions/", headers=H, json=body(**kw))
    assert res.status_code == 201, res.text
    return res.json()


def err(res, code=400):
    assert res.status_code == code, res.text
    return res.json()["detail"]


# ---------------------------------------------------------------- access
@pytest.mark.parametrize("method,url", [
    ("get", "/promotions/"), ("post", "/promotions/"), ("get", "/promotions/x"), ("put", "/promotions/x"),
    ("post", "/promotions/x/activate"), ("post", "/promotions/x/deactivate"), ("post", "/promotions/x/duplicate"),
    ("delete", "/promotions/x"), ("post", "/promotions/preview"),
])
def test_every_endpoint_needs_a_staff_login(method, url):
    assert getattr(client, method)(url).status_code == 401
    customer = {"Authorization": f"Bearer {auth.create_access_token({'sub': 'promo_staff', 'type': 'customer'})}"}
    assert getattr(client, method)(url, headers=customer).status_code == 401


# ---------------------------------------------------------------- create & validate
def test_create_each_type_with_clean_config():
    b = create(type_="bundle", config={"bundle_quantity": 3, "bundle_price": 600, "junk": 1}, eligible_category_ids=["pr_skin"])
    assert b["config"] == {"mode": "any", "bundle_price": 600, "bundle_quantity": 3, "allow_multiple": True,
                           "max_bundles": None, "distinct_products": False}
    assert b["status"] == b["state"] == "draft" and b["summary"] == "اختاري 3 منتجات بـ 600 ج.م"
    assert b["created_by"] == "promo_staff" and b["eligible_categories"] == [{"id": "pr_skin", "name": "بشرة", "quantity": 1}]
    fs = create(type_="free_shipping", config={"cities": ["المنصورة-pr"], "basis": "before"}, min_subtotal=500)
    assert fs["config"]["cities"] == ["المنصورة-pr"]
    create(type_="fixed_amount", config={"amount": 50, "apply_per": "item", "max_quantity": 2})
    g = create(type_="buy_x_get_y", config={"buy_quantity": 2, "get_quantity": 1}, eligible_product_ids=["pr_a"], reward_product_ids=["pr_g"])
    assert g["reward_products"] == [{"id": "pr_g", "name": "Mask", "quantity": 1}]
    c = create(type_="bundle", config={"mode": "combination", "bundle_price": 450}, eligible_product_ids=["pr_a", "pr_b"])
    assert c["config"]["bundle_quantity"] == 2


@pytest.mark.parametrize("kw,needle", [
    ({"config": {"percent": 0}}, "نسبة الخصم"),
    ({"config": {"percent": 150}}, "نسبة الخصم"),
    ({"config": {}}, "نسبة الخصم"),
    ({"type_": "fixed_amount", "config": {"amount": -5}}, "مبلغ الخصم"),
    ({"type_": "bundle", "config": {"bundle_quantity": 1, "bundle_price": 100}}, "عدد منتجات الباقة"),
    ({"type_": "bundle", "config": {"bundle_quantity": 3, "bundle_price": 0}}, "سعر الباقة"),
    ({"type_": "bundle", "config": {"mode": "combination", "bundle_price": 100}, "eligible_product_ids": ["pr_a"]}, "قطعتين"),
    ({"type_": "bundle", "config": {"mode": "combination", "bundle_price": 100}, "eligible_category_ids": ["pr_skin"]}, "منتجات محددة"),
    ({"type_": "bundle", "config": {"mode": "combination", "bundle_price": 100}, "eligible_product_ids": ["pr_a", "pr_b"],
      "product_quantities": {"pr_a": 99}}, "من 1 لـ 50"),
    ({"type_": "bundle", "config": {"mode": "combination", "bundle_price": 550}, "eligible_product_ids": ["pr_a", "pr_b"]}, "أقل من مجموع"),
    ({"type_": "buy_x_get_y", "config": {"buy_quantity": 0, "get_quantity": 1}}, "شراؤها"),
    ({"type_": "free_shipping", "config": {"cities": ["مش موجودة"]}}, "مش موجودة"),
    ({"eligible_product_ids": ["missing"]}, "منتج"),
    ({"eligible_category_ids": ["missing"]}, "فئة"),
    ({"reward_product_ids": ["pr_g"]}, "الهدية"),
    ({"starts_at": "2026-12-10", "ends_at": "2026-12-01"}, "قبل"),
    ({"name": "   "}, "اسم"),
    ({"config": {"percent": True}}, "نسبة"),
])
def test_invalid_offers_are_refused(kw, needle):
    detail = err(client.post("/promotions/", headers=H, json=body(**kw)))
    assert needle in detail


def test_pydantic_level_limits():
    assert client.post("/promotions/", headers=H, json=body(min_subtotal=-1)).status_code == 422
    assert client.post("/promotions/", headers=H, json=body(usage_limit=0)).status_code == 422
    assert client.post("/promotions/", headers=H, json=body(type="nope")).status_code == 422


def test_cannot_go_live_with_an_end_date_in_the_past():
    assert "فات" in err(client.post("/promotions/", headers=H, json=body(status="active", ends_at=(NOW - timedelta(days=2)).date().isoformat())))
    p = create(ends_at=(NOW - timedelta(days=2)).isoformat())
    assert "فات" in err(client.post(f"/promotions/{p['id']}/activate", headers=H))


# ---------------------------------------------------------------- states, list
def test_states_and_actions():
    p = create()
    assert client.post(f"/promotions/{p['id']}/activate", headers=H).json()["state"] == "active"
    assert client.post(f"/promotions/{p['id']}/deactivate", headers=H).json()["state"] == "inactive"
    future = create(status="active", starts_at=(NOW + timedelta(days=3)).isoformat())
    assert future["state"] == "scheduled"
    dup = client.post(f"/promotions/{future['id']}/duplicate", headers=H)
    assert dup.status_code == 201 and dup.json()["status"] == "draft" and dup.json()["name"].endswith("(نسخة)")
    assert dup.json()["used_count"] == 0


def _promos(page):
    """Cart-offer rows only (the list also holds per-product sale prices,
    some created by other test modules in this shared test DB)."""
    return [i["name"] for i in page["items"] if i["source"] == "promotion"]


def test_list_search_filter_sort_and_page():
    base = client.get("/promotions/", headers=H, params={"type": "product_price", "limit": 100}).json()["total"]
    create(name="باقة الصيف", type_="bundle", config={"bundle_quantity": 2, "bundle_price": 400}, priority=1)
    create(name="خصم الشتاء", priority=9, status="active")
    ended = create(name="شحن مجاني", type_="free_shipping", config={}, ends_at=(NOW - timedelta(hours=1)).isoformat())
    db = SessionLocal()
    db.get(models.Promotion, ended["id"]).status = "active"  # went live earlier, has ended since
    db.commit()
    db.close()
    page = client.get("/promotions/", headers=H, params={"sort": "priority", "limit": 100}).json()
    assert page["total"] == 3 + base and _promos(page)[0] == "خصم الشتاء"
    assert page["counts"]["total"] == 3 + base and page["counts"]["draft"] == 1
    assert _promos(client.get("/promotions/", headers=H, params={"q": "باقة"}).json()) == ["باقة الصيف"]
    assert client.get("/promotions/", headers=H, params={"type": "free_shipping"}).json()["total"] == 1
    assert _promos(client.get("/promotions/", headers=H, params={"state": "expired", "limit": 100}).json()) == ["شحن مجاني"]
    assert _promos(client.get("/promotions/", headers=H, params={"state": "active", "limit": 100}).json()) == ["خصم الشتاء"]
    two = client.get("/promotions/", headers=H, params={"sort": "name", "limit": 2, "offset": 2}).json()
    assert two["total"] == 3 + base and len(two["items"]) == min(2, 1 + base)
    assert client.get("/promotions/", headers=H, params={"state": "bogus"}).status_code == 422


def test_unified_list_shows_product_sale_prices_in_every_state():
    """Per-product sale prices (/offers) are offers too: listed with type
    product_price, whatever their state, and none is hidden."""
    db = SessionLocal()
    db.add_all([
        models.Offer(id="uo_live", product_id="pr_a", title="خصم السيروم", offer_price=200),
        models.Offer(id="uo_off", product_id="pr_g", title="ماسك موقوف", offer_price=60, is_active=False),
        models.Offer(id="uo_old", product_id="pr_g", title="ماسك قديم", offer_price=50, expires_at=NOW - timedelta(days=1)),
    ])
    db.commit()
    db.close()
    try:
        rows = {i["id"]: i for i in client.get("/promotions/", headers=H, params={"type": "product_price", "limit": 100}).json()["items"]}
        assert {k: rows[k]["state"] for k in ("uo_live", "uo_off", "uo_old")} == {"uo_live": "active", "uo_off": "inactive", "uo_old": "expired"}
        live = rows["uo_live"]
        assert live["source"] == "product_offer" and live["config"]["offer_price"] == 200 and live["config"]["original_price"] == 250
        assert live["eligible_products"] == [{"id": "pr_a", "name": "Serum", "quantity": 1}]
        found = {i["id"] for i in client.get("/promotions/", headers=H, params={"q": "ماسك", "limit": 100}).json()["items"]}
        assert {"uo_off", "uo_old"} <= found and "uo_live" not in found
        found = {i["id"] for i in client.get("/promotions/", headers=H, params={"state": "inactive", "limit": 100}).json()["items"]}
        assert "uo_off" in found and "uo_live" not in found
        # a paused copy (duplicate) doesn't clash with the running offer
        res = client.post("/offers/", headers=H, json={"product_id": "pr_a", "title": "خصم السيروم (نسخة)", "offer_price": 200, "is_active": False})
        assert res.status_code == 201 and res.json()["is_active"] is False
        assert client.post("/offers/", headers=H, json={"product_id": "pr_a", "title": "تاني", "offer_price": 190}).status_code == 400
    finally:
        db = SessionLocal()
        db.query(models.Offer).filter(models.Offer.id.in_(["uo_live", "uo_off", "uo_old"])).delete(synchronize_session=False)
        db.query(models.Offer).filter(models.Offer.title == "خصم السيروم (نسخة)").delete(synchronize_session=False)
        db.commit()
        db.close()


def test_fixed_bundle_quantities_are_saved_shown_and_locked_after_use():
    b = create(type_="bundle", config={"mode": "combination", "bundle_price": 600}, eligible_product_ids=["pr_a", "pr_b"],
               product_quantities={"pr_a": 2}, status="active")
    assert b["config"]["bundle_quantity"] == 3 and b["summary"] == "باقة 3 منتجات بـ 600 ج.م"
    assert sorted((t["id"], t["quantity"]) for t in b["eligible_products"]) == [("pr_a", 2), ("pr_b", 1)]
    # the price must be below the contents' regular price: 2 × 250 + 300 = 800
    bad = body(type_="bundle", config={"mode": "combination", "bundle_price": 800}, eligible_product_ids=["pr_a", "pr_b"], product_quantities={"pr_a": 2})
    assert "أقل من مجموع" in err(client.post("/promotions/", headers=H, json=bad))
    dup = client.post(f"/promotions/{b['id']}/duplicate", headers=H).json()
    assert sorted((t["id"], t["quantity"]) for t in dup["eligible_products"]) == [("pr_a", 2), ("pr_b", 1)]
    _use(b["id"])
    changed = body(type_="bundle", config={"mode": "combination", "bundle_price": 600}, eligible_product_ids=["pr_a", "pr_b"],
                   product_quantities={"pr_a": 3}, status="active")
    assert client.put(f"/promotions/{b['id']}", headers=H, json=changed).status_code == 409


# ---------------------------------------------------------------- used offers
def _use(promotion_id, status=models.OrderStatus.pending):
    db = SessionLocal()
    o = models.Order(order_number=f"EBPR{promotion_id[:6]}{status.value[:2]}", customer_name="x", customer_phone="01000000000",
                     shipping_address="عنوان", status=status, subtotal=300, promotion_discount=30, total_amount=270)
    db.add(o)
    db.flush()
    db.add(models.OrderPromotion(order_id=o.id, promotion_id=promotion_id, name="x", type="percentage", discount=30))
    db.get(models.Promotion, promotion_id).used_count += 1
    db.commit()
    oid = o.id
    db.close()
    return oid


def test_delete_only_when_never_used():
    p = create()
    assert client.delete(f"/promotions/{p['id']}", headers=H).status_code == 204
    assert client.get(f"/promotions/{p['id']}", headers=H).status_code == 404
    used = create(status="active")
    _use(used["id"])
    assert "وقّفيه" in err(client.delete(f"/promotions/{used['id']}", headers=H), 409)


def test_terms_of_a_used_offer_are_locked_but_the_rest_can_change():
    p = create(status="active", eligible_product_ids=["pr_a"])
    _use(p["id"])
    got = client.get(f"/promotions/{p['id']}", headers=H).json()
    assert got["terms_locked"] and got["orders_count"] == 1 and got["used_count"] == 1
    changed = body(status="active", eligible_product_ids=["pr_a"], config={"percent": 20})
    assert "نسخة" in err(client.put(f"/promotions/{p['id']}", headers=H, json=changed), 409)
    other_products = body(status="active", eligible_product_ids=["pr_b"])
    assert client.put(f"/promotions/{p['id']}", headers=H, json=other_products).status_code == 409
    ok = client.put(f"/promotions/{p['id']}", headers=H, json=body(name="اسم جديد", status="inactive", usage_limit=5, eligible_product_ids=["pr_a"]))
    assert ok.status_code == 200 and ok.json()["name"] == "اسم جديد" and ok.json()["usage_limit"] == 5


def test_unused_offer_can_be_fully_edited():
    p = create()
    res = client.put(f"/promotions/{p['id']}", headers=H, json=body(type_="fixed_amount", config={"amount": 40}, eligible_category_ids=["pr_hair"]))
    assert res.status_code == 200 and res.json()["type"] == "fixed_amount" and res.json()["eligible_categories"][0]["id"] == "pr_hair"


def test_staff_cancellation_gives_back_the_offer_use():
    p = create(status="active")
    oid = _use(p["id"])
    res = client.patch(f"/online-orders/{oid}/status", headers=H, json={"status": "cancelled"})
    assert res.status_code == 200, res.text
    got = client.get(f"/promotions/{p['id']}", headers=H).json()
    assert got["used_count"] == 0 and got["orders_count"] == 0
    listed = client.get("/online-orders/", headers=H).json()
    mine = next(o for o in listed if o["id"] == oid)
    assert mine["promotion_discount"] == 30 and mine["applied_promotions"][0]["promotion_id"] == p["id"]


# ---------------------------------------------------------------- preview
def preview(promotion, items, city=None):
    res = client.post("/promotions/preview", headers=H, json={"promotion": promotion, "items": items, "city": city})
    assert res.status_code == 200, res.text
    return res.json()


def test_preview_uses_current_prices_and_explains():
    bundle = body(type_="bundle", config={"bundle_quantity": 3, "bundle_price": 600}, eligible_category_ids=["pr_skin"])
    out = preview(bundle, [{"product_id": "pr_a", "quantity": 2}, {"product_id": "pr_b", "quantity": 1}])
    assert out["subtotal"] == 250 * 2 + 280 and out["applied"] and out["discount"] == 180 and out["total"] == 600
    short = preview(bundle, [{"product_id": "pr_a", "quantity": 2}])
    assert not short["applied"] and "3 منتجات" in short["reason"]
    fixed = body(type_="bundle", config={"mode": "combination", "bundle_price": 600}, eligible_product_ids=["pr_a", "pr_b"],
                 product_quantities={"pr_a": 2})
    out = preview(fixed, [{"product_id": "pr_a", "quantity": 2}, {"product_id": "pr_b", "quantity": 1}])
    assert out["applied"] and out["subtotal"] == 780 and out["total"] == 600
    assert "محتوى الباقة" in preview(fixed, [{"product_id": "pr_a", "quantity": 1}, {"product_id": "pr_b", "quantity": 1}])["reason"]
    gift = body(type_="buy_x_get_y", config={"buy_quantity": 1, "get_quantity": 1}, eligible_product_ids=["pr_a"], reward_product_ids=["pr_g"])
    out = preview(gift, [{"product_id": "pr_a", "quantity": 1}, {"product_id": "pr_g", "quantity": 1}])
    assert out["discount"] == 80 and [l["free_units"] for l in out["lines"]] == [0, 1]
    ship = body(type_="free_shipping", config={}, min_subtotal=200)
    out = preview(ship, [{"product_id": "pr_a", "quantity": 1}], city="المنصورة-pr")
    assert out["shipping_discount"] == 50 and out["shipping_fee"] == 0 and out["total"] == 250
    assert "محافظة" in preview(ship, [{"product_id": "pr_a", "quantity": 1}])["reason"]
    # a draft dated in the future still previews (as if live); nothing is saved
    future = body(starts_at=(NOW + timedelta(days=5)).date().isoformat())
    assert preview(future, [{"product_id": "pr_a", "quantity": 1}])["discount"] == 25
    assert _promos(client.get("/promotions/", headers=H, params={"limit": 100}).json()) == []


def test_preview_rejects_invalid_offers_and_unknown_products():
    res = client.post("/promotions/preview", headers=H, json={"promotion": body(config={"percent": 200}), "items": [{"product_id": "pr_a", "quantity": 1}]})
    assert res.status_code == 400
    res = client.post("/promotions/preview", headers=H, json={"promotion": body(), "items": [{"product_id": "nope", "quantity": 1}]})
    assert res.status_code == 400


def test_the_rules_module_is_identical_in_both_repositories():
    here = Path(__file__).resolve().parents[1] / "app" / "promotions.py"
    other = Path(__file__).resolve().parents[3] / "ecobel-website" / "backend" / "app" / "promotions.py"
    if not other.exists():
        pytest.skip("ecobel-website checkout not next to this repository")
    assert here.read_bytes() == other.read_bytes(), "app/promotions.py differs between ecobel-accounting-system and ecobel-website"
