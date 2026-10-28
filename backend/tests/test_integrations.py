"""Settings → Integrations (app/integrations.py): the storefront check
reports only what the fetched page shows, never follows redirects, flags an
over-broad CSP; Purchase-eligible orders are exactly the delivered
cash-on-delivery ones; everything needs a signed-in admin. No network: the
storefront fetch is faked. Throwaway SQLite DB (tests/conftest.py)."""
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from app import auth, integrations, models
from app.database import SessionLocal
from app.main import app

client = TestClient(app)
H = {"Authorization": f"Bearer {auth.create_access_token({'sub': 'int_staff'})}"}
GOOD_CSP = ("default-src 'self'; script-src 'self' 'unsafe-inline' https://connect.facebook.net; "
            "img-src 'self' data: https://www.facebook.com; connect-src 'self' https://api.example https://www.facebook.com")
PAGE = '<html><head><meta name="ecobel-meta-pixel" content="1234567890123" data-consent="opt-in"/></head><body></body></html>'


def page(body=PAGE, csp=GOOD_CSP, status=200, location=None):
    return lambda url: integrations.Fetched(status, {"content-security-policy": csp} if csp else {}, body, location)


def by_name(result):
    return {c["name"]: c["status"] for c in result["checks"]}


@pytest.fixture(scope="module", autouse=True)
def seed():
    db = SessionLocal()
    db.add(models.User(username="int_staff", hashed_password=auth.hash_password("x")))
    db.commit()
    db.close()


def test_storefront_url_comes_only_from_server_config(monkeypatch):
    monkeypatch.delenv("STOREFRONT_URL", raising=False)
    assert integrations.storefront_url() is None
    for bad in ("ftp://x", "javascript:alert(1)", "https://user:pw@shop.example", "not a url"):
        monkeypatch.setenv("STOREFRONT_URL", bad)
        assert integrations.storefront_url() is None
    monkeypatch.setenv("STOREFRONT_URL", "https://shop.example/some/path?x=1")
    assert integrations.storefront_url() == "https://shop.example/"


def test_no_url_means_nothing_is_fetched():
    called = []
    r = integrations.check_storefront(None, fetcher=lambda u: called.append(u))
    assert called == [] and r["pixel_id"] is None and by_name(r) == {"عنوان المتجر": "info"}


def test_pixel_on_and_a_tight_csp_pass():
    r = integrations.check_storefront("https://shop.example/", fetcher=page())
    assert r["pixel_id"] == "1234567890123"
    assert set(by_name(r).values()) == {"ok"}


def test_consent_mode_and_beacons_that_bypass_consent_are_checked():
    no_optin = '<html><head><meta name="ecobel-meta-pixel" content="1234567890123"/></head></html>'
    assert by_name(integrations.check_storefront("https://shop.example/", fetcher=page(body=no_optin)))["موافقة الزائرة"] == "fail"
    beacon = PAGE + '<noscript><img src="https://www.facebook.com/tr?id=1234567890123&ev=PageView&noscript=1"/></noscript>'
    assert by_name(integrations.check_storefront("https://shop.example/", fetcher=page(body=beacon)))["مفيش إرسال من غير موافقة"] == "fail"
    r = integrations.check_storefront("https://shop.example/", fetcher=page())
    assert by_name(r)["موافقة الزائرة"] == "ok" and "مفيش إرسال من غير موافقة" not in by_name(r)


def test_pixel_off_is_reported_as_off_not_as_an_error():
    r = integrations.check_storefront("https://shop.example/", fetcher=page(body="<html></html>", csp="default-src 'self'; script-src 'self'"))
    assert r["pixel_id"] is None and by_name(r)["Meta Pixel على المتجر"] == "info"
    assert "CSP بيسمح للـ Pixel يشتغل" not in by_name(r)


def test_missing_csp_hosts_and_over_broad_csp_are_flagged():
    r = integrations.check_storefront("https://shop.example/", fetcher=page(csp="script-src 'self'; connect-src 'self'"))
    assert by_name(r)["CSP بيسمح للـ Pixel يشتغل"] == "fail"
    r = integrations.check_storefront("https://shop.example/", fetcher=page(csp="script-src 'self' https://*.facebook.net https:; img-src *"))
    assert by_name(r)["CSP مش أوسع من اللازم"] == "fail"


def test_redirects_errors_and_unreachable_are_reported_not_followed():
    r = integrations.check_storefront("https://shop.example/", fetcher=page(status=301, location="https://elsewhere.example/"))
    assert by_name(r) == {"الوصول للمتجر": "warn"} and r["pixel_id"] is None
    assert by_name(integrations.check_storefront("https://shop.example/", fetcher=page(status=503))) == {"الوصول للمتجر": "fail"}

    def boom(url):
        raise TimeoutError()
    r = integrations.check_storefront("https://shop.example/", fetcher=boom)
    assert r["reachable"] is False and by_name(r) == {"الوصول للمتجر": "fail"}


def test_purchase_eligible_counts_only_delivered_cash_on_delivery_orders():
    now = datetime.now(timezone.utc)
    db = SessionLocal()
    before = integrations.purchase_eligible(db, now)
    rows = [("int_d1", "delivered", "cash_on_delivery", 300, 2), ("int_d2", "delivered", "cash_on_delivery", 200, 20),
            ("int_old", "delivered", "cash_on_delivery", 100, 60), ("int_card", "delivered", "card", 900, 1),
            ("int_pend", "pending", "cash_on_delivery", 500, 1), ("int_cxl", "cancelled", "cash_on_delivery", 400, 1)]
    for oid, status, method, total, days_ago in rows:
        db.add(models.Order(id=oid, order_number=oid.upper(), customer_name="x", customer_phone="01000000000", shipping_address="a",
                            subtotal=total, total_amount=total, status=models.OrderStatus(status), payment_method=method))
        db.flush()
        if status == "delivered":
            db.add(models.OrderStatusChange(order_id=oid, from_status="shipped", to_status="delivered", changed_by="int_staff",
                                            created_at=now - timedelta(days=days_ago)))
    db.commit()
    after = integrations.purchase_eligible(db, now)
    db.close()
    assert after["last_7_days"]["orders"] - before["last_7_days"]["orders"] == 1
    assert round(after["last_7_days"]["value"] - before["last_7_days"]["value"], 2) == 300
    assert after["last_30_days"]["orders"] - before["last_30_days"]["orders"] == 2
    assert after["all_time"]["orders"] - before["all_time"]["orders"] == 3  # card, pending, cancelled excluded
    assert after["last_delivered_at"] is not None


def test_endpoints_need_the_admin_and_never_claim_meta_data(monkeypatch):
    for headers in ({}, {"Authorization": "Bearer nope"}):
        assert client.get("/integrations/meta-pixel", headers=headers).status_code == 401
        assert client.post("/integrations/meta-pixel/check", headers=headers).status_code == 401
    monkeypatch.setattr(integrations, "fetch", page())
    monkeypatch.setenv("STOREFRONT_URL", "https://shop.example")
    s = client.get("/integrations/meta-pixel", headers=H).json()
    assert s["browser_events_measured"] is False and s["meta_received_measured"] is False
    assert [e["name"] for e in s["events"]] == ["PageView", "ViewContent", "Search", "AddToCart", "InitiateCheckout", "Purchase"]
    assert s["storefront_url"] == "https://shop.example/" and s["events_manager_url"].startswith("https://business.facebook.com/")
    r = client.post("/integrations/meta-pixel/check", headers=H).json()
    assert r["pixel_id"] == "1234567890123"
    assert client.get("/integrations/meta-pixel", headers=H).json()["last_check"]["pixel_id"] == "1234567890123"
    assert "token" not in str(s).lower()
