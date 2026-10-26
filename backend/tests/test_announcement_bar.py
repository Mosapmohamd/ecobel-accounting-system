"""Announcement bar settings (/merchandising/announcement-bar): staff only,
defaults until saved, strict validation (plain text, named options, safe
links). Throwaway SQLite DB (tests/conftest.py)."""
import pytest
from fastapi.testclient import TestClient

from app import auth, models
from app.database import SessionLocal
from app.main import app

client = TestClient(app)
H = {"Authorization": f"Bearer {auth.create_access_token({'sub': 'bar_staff'})}"}
URL = "/merchandising/announcement-bar"


@pytest.fixture(scope="module", autouse=True)
def seed():
    db = SessionLocal()
    db.add(models.User(username="bar_staff", hashed_password=auth.hash_password("x")))
    db.commit()
    db.close()


@pytest.fixture(autouse=True)
def clean():
    yield
    db = SessionLocal()
    db.query(models.StorefrontSetting).delete()
    db.commit()
    db.close()


def settings(**kw):
    return {"enabled": True, "text_ar": "شحن مجاني فوق ١٠٠٠ ج.م", "text_en": "Free shipping over EGP 1000",
            "scrolling": True, "direction": "auto", "speed": "normal", "visibility": "all", "theme": "default",
            "link_url": "/products?offers=1", **kw}


def test_only_staff_can_read_or_change_it():
    assert client.get(URL).status_code == 401
    assert client.put(URL, json=settings()).status_code == 401
    customer = {"Authorization": f"Bearer {auth.create_access_token({'sub': 'bar_staff', 'type': 'customer'})}"}
    assert client.put(URL, headers=customer, json=settings()).status_code == 401


def test_defaults_until_saved_then_saved_values_persist():
    d = client.get(URL, headers=H).json()
    assert d["enabled"] is True and d["text_ar"] == "أهلاً بكم في EcoBel" and d["speed"] == "normal"
    res = client.put(URL, headers=H, json=settings(speed="fast", visibility="mobile", theme="brand", direction="left"))
    assert res.status_code == 200, res.text
    got = client.get(URL, headers=H).json()
    assert got["text_en"] == "Free shipping over EGP 1000" and got["speed"] == "fast" and got["visibility"] == "mobile"
    assert got["theme"] == "brand" and got["direction"] == "left" and got["link_url"] == "/products?offers=1"
    db = SessionLocal()
    row = db.get(models.StorefrontSetting, "announcement_bar")
    assert row.updated_by == "bar_staff"
    db.close()
    # disabling keeps the text for later
    client.put(URL, headers=H, json=settings(enabled=False))
    got = client.get(URL, headers=H).json()
    assert got["enabled"] is False and got["text_ar"] == "شحن مجاني فوق ١٠٠٠ ج.م"


@pytest.mark.parametrize("link", ["javascript:alert(1)", "//evil.example", "http://ecobel.com", "https://", "data:text/html,x",
                                  "/a b", "https://ecobel.com/<x>"])
def test_unsafe_links_are_rejected(link):
    assert client.put(URL, headers=H, json=settings(link_url=link)).status_code == 422


@pytest.mark.parametrize("bad", [
    {"text_ar": "<script>alert(1)</script>"},
    {"text_en": "<b>bold</b>"},
    {"text_ar": "x" * 201},
    {"speed": "warp"},
    {"direction": "up"},
    {"theme": "#ff0000"},
    {"visibility": "tv"},
    {"style": "color:red"},
])
def test_markup_free_css_and_unknown_options_are_rejected(bad):
    assert client.put(URL, headers=H, json=settings(**bad)).status_code == 422


def test_enabling_without_text_is_refused_but_a_disabled_empty_bar_is_fine():
    res = client.put(URL, headers=H, json=settings(text_ar="   ", text_en=None))
    assert res.status_code == 400 and "نص الإعلان" in res.json()["detail"]
    assert client.put(URL, headers=H, json=settings(enabled=False, text_ar=None, text_en=None)).status_code == 200


def test_https_and_site_links_are_kept():
    for link in ("https://www.instagram.com/ecobel", "/products/abc", None):
        assert client.put(URL, headers=H, json=settings(link_url=link)).json()["link_url"] == link


def test_the_settings_schema_is_identical_in_both_repositories():
    from pathlib import Path

    def block(path):
        text = path.read_text(encoding="utf-8")
        return text[text.index("# ---------------- Storefront settings: the announcement bar"):]

    here = Path(__file__).resolve().parents[1] / "app" / "schemas.py"
    other = Path(__file__).resolve().parents[3] / "ecobel-website" / "backend" / "app" / "schemas.py"
    if not other.exists():
        pytest.skip("ecobel-website checkout not next to this repository")
    assert block(here) == block(other), "AnnouncementBar schema differs between the two repositories"
