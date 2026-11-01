"""Manual finance entries (CRUD audit, approved 2026-11-01): staff can enter
income and expenses under every section (website, B2B, general spending);
they're marked manual, never look like an order's automatic entry, and never
count as sales revenue or B2B sales — so an order's revenue is never counted
twice. Report totals are compared before/after (the throwaway SQLite DB is
shared by every test module — tests/conftest.py)."""
import pytest
from fastapi.testclient import TestClient

from app import auth, models, order_ledger, returns, revenue, services
from app.database import SessionLocal
from app.main import app

client = TestClient(app)
H = {"Authorization": f"Bearer {auth.create_access_token({'sub': 'fin_staff'})}"}


@pytest.fixture(scope="module", autouse=True)
def seed():
    db = SessionLocal()
    db.add(models.User(username="fin_staff", hashed_password=auth.hash_password("x")))
    db.add(models.Category(id="fin_cat", name="فئة الحسابات"))
    db.add(models.Product(id="fin_p", name="Fin Serum", category_id="fin_cat", sale_price=100, quantity=100))
    db.add(models.Customer(id="fin_cust", name="عميلة الحسابات", phone="01055551111"))
    db.add(models.B2BCustomer(id="fin_b2b", name="صيدلية الحسابات", discount_percentage=0))
    db.commit()
    # one website order, delivered (cash on delivery) → its revenue is recognized automatically
    db.add(models.Order(id="fin_o1", order_number="FIN-1", customer_id="fin_cust", customer_name="عميلة الحسابات",
                        customer_phone="01055551111", city="القاهرة", shipping_address="عنوان", subtotal=300,
                        shipping_fee=0, total_amount=300, payment_method="cash_on_delivery"))
    db.add(models.OrderItem(order_id="fin_o1", product_id="fin_p", product_name="Fin Serum", unit_price=100, quantity=3, line_total=300))
    services.apply_stock_movement(db, db.get(models.Product, "fin_p"), -3, models.MovementType.website_sale, reference_id="fin_o1")
    db.commit()
    db.close()


def reports() -> dict:
    d = client.get("/reports/dashboard", headers=H, params={"period": "year"}).json()
    a = client.get("/sales-analytics/", headers=H).json()
    m = client.get("/reports/monthly-sales", headers=H, params={"months": 36}).json()
    return {
        "revenue": d["period_revenue"], "b2b_sales": d["period_b2b_sales"], "other_income": d["period_other_income"],
        "income": d["period_income"], "expense": d["period_expense"],
        "analytics_revenue": a["total_revenue"], "analytics_b2b": a["b2b_sales"],
        "monthly_revenue": round(sum(p["total"] for p in m), 2),
    }


def delta(before: dict, after: dict) -> dict:
    return {k: round(after[k] - before[k], 2) for k in before if round(after[k] - before[k], 2)}


def manual(type_: str, source: str, amount: float, category: str = "قيد يدوي"):
    return client.post("/finance/entries", headers=H, json={"type": type_, "source": source, "category": category, "amount": amount})


def test_order_revenue_is_recorded_automatically_and_not_marked_manual():
    before = reports()
    assert client.patch("/online-orders/fin_o1/status", headers=H, json={"status": "shipped"}).status_code == 200
    assert client.patch("/online-orders/fin_o1/status", headers=H, json={"status": "delivered"}).status_code == 200
    assert delta(before, reports()) == {"revenue": 300, "income": 300, "analytics_revenue": 300, "monthly_revenue": 300}
    sale = [e for e in client.get("/finance/entries", headers=H, params={"source": "website"}).json() if e["reference_id"] == "fin_o1"]
    assert len(sale) == 1 and sale[0]["is_manual"] is False and sale[0]["category"] == order_ledger.SALE_CATEGORY


# Every supported source × type: kept, marked manual, and counted only as
# other income / operating expense — never as revenue or B2B sales.
@pytest.mark.parametrize("source", ["website", "b2b", "spending"])
@pytest.mark.parametrize("type_", ["income", "expense"])
def test_manual_entry_for_each_source_and_type(source, type_):
    before = reports()
    res = manual(type_, source, 125.5, category=f"يدوي {source} {type_}")
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["is_manual"] is True and body["source"] == source and body["type"] == type_ and body["reference_id"] is None
    listed = client.get("/finance/entries", headers=H, params={"source": source, "type": type_}).json()
    assert body["id"] in [e["id"] for e in listed]
    expected = {"other_income": 125.5, "income": 125.5} if type_ == "income" else {"expense": 125.5}
    assert delta(before, reports()) == expected  # revenue, B2B sales, analytics, monthly: unchanged


def test_manual_website_income_for_an_already_counted_order_is_not_double_counted():
    """Staff typing in a delivered order's money by hand: it's other income,
    the order's revenue still counts once."""
    before = reports()
    res = client.post("/finance/entries", headers=H, json={
        "type": "income", "source": "website", "category": "تحصيل طلب", "amount": 300, "description": "طلب FIN-1"})
    assert res.status_code == 201
    d = delta(before, reports())
    assert d == {"other_income": 300, "income": 300}
    assert "revenue" not in d and "analytics_revenue" not in d and "monthly_revenue" not in d


def test_b2b_sales_come_only_from_orders():
    before = reports()
    res = client.post("/b2b/orders", headers=H, json={"customer_id": "fin_b2b", "items": [{"product_id": "fin_p", "quantity": 2}]})
    assert res.status_code == 201
    after_order = reports()
    assert delta(before, after_order) == {"b2b_sales": 200, "analytics_b2b": 200}  # booked, not revenue
    assert manual("income", "b2b", 200, category="دفعة من صيدلية").status_code == 201
    assert delta(after_order, reports()) == {"other_income": 200, "income": 200}  # not B2B sales a second time


@pytest.mark.parametrize("category", sorted(revenue.AUTOMATIC_CATEGORIES))
def test_manual_entries_cannot_use_the_automatic_categories(category):
    before = len(client.get("/finance/entries", headers=H).json())
    for type_ in ("income", "expense"):
        res = manual(type_, "website", 50, category=f"  {category} ")  # spacing doesn't get around it
        assert res.status_code == 400, (category, res.text)
    assert len(client.get("/finance/entries", headers=H).json()) == before


def test_automatic_categories_cover_every_kind_of_order_entry():
    assert {order_ledger.SALE_CATEGORY, order_ledger.REVERSAL_CATEGORY, returns.RETURN_CATEGORY,
            revenue.B2B_SALE_CATEGORY, *revenue.B2B_REVERSAL_CATEGORIES} == revenue.AUTOMATIC_CATEGORIES


def test_manual_entry_validation():
    for bad in ({"category": "   "}, {"category": "x" * 101}, {"description": "x" * 501}, {"amount": 0}):
        body = {"type": "expense", "source": "spending", "category": "شحن", "amount": 10, **bad}
        assert client.post("/finance/entries", headers=H, json=body).status_code == 422, bad
    res = client.post("/finance/entries", headers=H, json={"type": "expense", "category": "  شحن   سريع ", "amount": 10})
    assert res.status_code == 201 and res.json()["category"] == "شحن سريع" and res.json()["source"] == "spending"
