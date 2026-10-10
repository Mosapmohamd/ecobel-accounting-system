"""Production hardening: startup checks, docs switch, response headers."""
import importlib
import os
import sys
import tempfile

if "app.database" not in sys.modules:
    os.environ["DATABASE_URL"] = f"sqlite:///{os.path.join(tempfile.mkdtemp(), 'test.db')}"
    os.environ.pop("SECRET_KEY", None)

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app import security  # noqa: E402
from app.main import app  # noqa: E402

GOOD_SECRET = "x" * 48


@pytest.fixture
def production(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "production")
    importlib.reload(security)
    yield security
    monkeypatch.delenv("ENVIRONMENT")
    importlib.reload(security)


def test_development_is_the_default_and_keeps_docs():
    assert not security.IS_PRODUCTION and security.DOCS_SETTINGS == {}
    security.check_production_config("short", ["http://localhost:3000"])  # never blocks local work


def test_production_disables_api_docs(production):
    assert production.DOCS_SETTINGS == {"docs_url": None, "redoc_url": None, "openapi_url": None}


@pytest.mark.parametrize("secret,origins,fragment", [
    ("too-short", ["https://shop.example"], "SECRET_KEY"),
    (GOOD_SECRET, ["http://localhost:3000"], "FRONTEND_ORIGINS"),
    (GOOD_SECRET, ["http://shop.example"], "FRONTEND_ORIGINS"),
    (GOOD_SECRET, [], "FRONTEND_ORIGINS"),
])
def test_production_refuses_unsafe_settings(production, secret, origins, fragment):
    with pytest.raises(RuntimeError, match=fragment):
        production.check_production_config(secret, origins)


def test_production_accepts_safe_settings(production):
    production.check_production_config(GOOD_SECRET, ["https://shop.example"])


def test_every_response_carries_security_headers():
    res = TestClient(app).get("/")
    assert res.headers["x-content-type-options"] == "nosniff"
    assert res.headers["x-frame-options"] == "DENY"
    assert res.headers["referrer-policy"] == "no-referrer"
    assert res.headers["cache-control"] == "no-store"
