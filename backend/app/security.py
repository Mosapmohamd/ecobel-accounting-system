"""Production hardening shared by the app: environment switch, startup
checks, and security headers on every response.

ENVIRONMENT=production (backend/.env) turns on the strict behaviour; the
default ("development") keeps local work unchanged.
"""
import os

from starlette.middleware.base import BaseHTTPMiddleware

ENVIRONMENT = os.getenv("ENVIRONMENT", "development").strip().lower()
IS_PRODUCTION = ENVIRONMENT == "production"

_LOCAL_HOSTS = ("localhost", "127.0.0.1", "[::1]", "0.0.0.0")


def check_production_config(secret_key: str, origins: list[str]) -> None:
    """Refuse to start in production with settings that are only safe locally."""
    if not IS_PRODUCTION:
        return
    problems = []
    if len(secret_key) < 32:
        problems.append("SECRET_KEY must be a random value of at least 32 characters")
    if not origins or any(not o.startswith("https://") or any(h in o for h in _LOCAL_HOSTS) for o in origins):
        problems.append("FRONTEND_ORIGINS must list the public https origin(s) only (no localhost)")
    if problems:
        raise RuntimeError("Refusing to start in production: " + "; ".join(problems) + ".")


# OpenAPI docs describe every endpoint — useful locally, not public in production.
DOCS_SETTINGS = {"docs_url": None, "redoc_url": None, "openapi_url": None} if IS_PRODUCTION else {}


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Headers for a JSON API: never sniffed, framed or cached by shared
    caches (responses can contain personal/order data)."""

    async def dispatch(self, request, call_next):
        response = await call_next(request)
        h = response.headers
        h.setdefault("X-Content-Type-Options", "nosniff")
        h.setdefault("X-Frame-Options", "DENY")
        h.setdefault("Referrer-Policy", "no-referrer")
        h.setdefault("Cache-Control", "no-store")
        if IS_PRODUCTION:
            h.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
        return response
