import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

from .routers import auth_router, categories, products, inventory, b2b, free_distribution, finance, reports
from .routers.auth_router import limiter

# Schema is now managed by Alembic migrations (see alembic/ and the README) —
# run `alembic upgrade head` before starting the server instead of relying
# on create_all, so existing tables get altered in place rather than
# silently skipped.

app = FastAPI(
    title="Eco Bel — Accounting & Inventory System",
    description="Backend API for inventory tracking, B2B wholesale sales, "
                "free sample distribution, finance entries, and reports.",
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

app.include_router(auth_router.router)
app.include_router(categories.router)
app.include_router(products.router)
app.include_router(inventory.router)
app.include_router(b2b.router)
app.include_router(free_distribution.router)
app.include_router(finance.router)
app.include_router(reports.router)


@app.get("/")
def root():
    return {"status": "ok", "service": "ecobel-accounting-inventory-api"}
