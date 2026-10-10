import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

from .security import DOCS_SETTINGS, SecurityHeadersMiddleware, check_production_config
from .auth import SECRET_KEY
from .database import engine
from .migrations import upgrade_to_head
from .routers import (
    auth_router, categories, products, inventory, b2b, free_distribution,
    finance, reports, coupons, online_orders, web_analytics, offers, routines,
    shipping_rates, report_exports, reviews, merchandising,
)
from .routers.auth_router import limiter

# This service owns the shared database's one migration history
# (alembic/versions) — bring the schema to the latest revision on startup.
upgrade_to_head(engine)


app = FastAPI(
    **DOCS_SETTINGS,  # no public API docs in production
    title="Eco Bel — Accounting & Inventory System",
    description="Backend API for inventory tracking, B2B wholesale sales, "
                "free sample distribution, finance entries, reports, and "
                "online-store admin (products, coupons, online orders).",
    version="0.1.0",
)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(SlowAPIMiddleware)

# Comma-separated list of allowed frontend origins. Defaults cover the
# Vite dev server only — set FRONTEND_ORIGINS in production to the real
# deployed frontend URL(s) instead of leaving this wide open.
FRONTEND_ORIGINS = os.getenv(
    "FRONTEND_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
).split(",")
FRONTEND_ORIGINS = [o.strip() for o in FRONTEND_ORIGINS if o.strip()]
check_production_config(SECRET_KEY, FRONTEND_ORIGINS)

app.add_middleware(
    CORSMiddleware,
    allow_origins=FRONTEND_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(SecurityHeadersMiddleware)


app.include_router(auth_router.router)
app.include_router(categories.router)
app.include_router(products.router)
app.include_router(inventory.router)
app.include_router(b2b.router)
app.include_router(free_distribution.router)
app.include_router(finance.router)
app.include_router(reports.router)
app.include_router(coupons.router)
app.include_router(online_orders.router)
app.include_router(web_analytics.router)
app.include_router(offers.router)
app.include_router(routines.router)
app.include_router(shipping_rates.router)
app.include_router(report_exports.router)
app.include_router(reviews.router)
app.include_router(merchandising.router)


@app.get("/")
def root():
    return {"status": "ok", "service": "ecobel-accounting-inventory-api"}
