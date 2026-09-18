from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import models
from .database import engine
from .routers import auth_router, products, inventory, b2b, free_distribution, finance

models.Base.metadata.create_all(bind=engine)

app = FastAPI(
    title="Eco Bel — Accounting & Inventory System",
    description="Backend API for inventory tracking, B2B wholesale sales, "
                "free sample distribution, finance entries, and reports.",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router.router)
app.include_router(products.router)
app.include_router(inventory.router)
app.include_router(b2b.router)
app.include_router(free_distribution.router)
app.include_router(finance.router)


@app.get("/")
def root():
    return {"status": "ok", "service": "ecobel-accounting-inventory-api"}
