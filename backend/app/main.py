import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

from . import models
from .database import engine
from .schema_sync import ensure_columns
from .routers import (
    auth_router, categories, products, inventory, b2b, free_distribution,
    finance, reports, coupons, online_orders, web_analytics, offers, routines,
    shipping_rates, report_exports,
)
from .routers.auth_router import limiter

# Schema is created on startup (no Alembic — same approach as ecobel-website).
# create_all makes any missing tables without touching existing ones;
# ensure_columns adds any new columns (e.g. products.image_url) to tables
# that predate them.
models.Base.metadata.create_all(bind=engine)
ensure_columns(engine)

# Product images uploaded from the admin are stored/served here.
STATIC_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "static")
os.makedirs(os.path.join(STATIC_DIR, "products"), exist_ok=True)

app = FastAPI(
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

app.add_middleware(
    CORSMiddleware,
    allow_origins=FRONTEND_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

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


@app.get("/")
def root():
    return {"status": "ok", "service": "ecobel-accounting-inventory-api"}
