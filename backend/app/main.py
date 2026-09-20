from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .routers import auth_router, categories, products, inventory, b2b, free_distribution, finance, reports

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

# Dev CORS — tighten to the actual frontend origin(s) before production.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
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
