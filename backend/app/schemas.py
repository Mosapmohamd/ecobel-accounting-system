from datetime import datetime
from typing import Optional, List
from pydantic import BaseModel, ConfigDict, Field

from .models import MovementType, RecipientType, FinanceEntryType


# ---------------- Categories ----------------
class CategoryCreate(BaseModel):
    name: str


class CategoryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    name: str
    created_at: datetime


# ---------------- Auth ----------------
class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"


class UserCreate(BaseModel):
    username: str
    password: str
    full_name: Optional[str] = None


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    username: str
    full_name: Optional[str] = None


# ---------------- Products ----------------
class ProductCreate(BaseModel):
    name: str
    category_id: str
    sku: Optional[str] = None
    cost_price: float = 0
    sale_price: float = 0
    quantity: int = 0
    low_stock_threshold: int = 10


class ProductUpdate(BaseModel):
    name: Optional[str] = None
    category_id: Optional[str] = None
    sku: Optional[str] = None
    cost_price: Optional[float] = None
    sale_price: Optional[float] = None
    low_stock_threshold: Optional[int] = None
    is_active: Optional[bool] = None


class ProductOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    name: str
    category_id: str
    category_name: str
    sku: Optional[str]
    cost_price: float
    sale_price: float
    quantity: int
    low_stock_threshold: int
    is_active: bool
    stock_status: str
    created_at: datetime


# ---------------- Inventory movements ----------------
class StockAdjustment(BaseModel):
    product_id: str
    quantity_change: int = Field(..., description="Positive to add stock, negative to remove")
    note: Optional[str] = None


class InventoryMovementOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    product_id: str
    type: MovementType
    quantity_change: int
    reference_id: Optional[str]
    note: Optional[str]
    created_at: datetime


# ---------------- B2B ----------------
class B2BCustomerCreate(BaseModel):
    name: str
    phone: Optional[str] = None
    discount_percentage: float = 0
    notes: Optional[str] = None


class B2BCustomerUpdate(BaseModel):
    name: Optional[str] = None
    phone: Optional[str] = None
    discount_percentage: Optional[float] = None
    notes: Optional[str] = None


class B2BCustomerOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    name: str
    phone: Optional[str]
    discount_percentage: float
    notes: Optional[str]
    created_at: datetime


class B2BOrderItemIn(BaseModel):
    product_id: str
    quantity: int


class B2BOrderCreate(BaseModel):
    customer_id: str
    items: List[B2BOrderItemIn]
    note: Optional[str] = None


class B2BOrderItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    product_id: str
    quantity: int
    unit_price: float
    cost_price: float
    discount_percentage: float
    line_total: float
    line_profit: float


class B2BOrderOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    customer_id: str
    total_amount: float
    total_profit: float
    note: Optional[str]
    created_at: datetime
    items: List[B2BOrderItemOut]


# ---------------- Free distribution ----------------
class FreeDistributionItemIn(BaseModel):
    product_id: str
    quantity: int


class FreeDistributionCreate(BaseModel):
    recipient_name: str
    recipient_type: RecipientType
    items: List[FreeDistributionItemIn]
    note: Optional[str] = None


class FreeDistributionItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    product_id: str
    quantity: int


class FreeDistributionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    recipient_name: str
    recipient_type: RecipientType
    note: Optional[str]
    created_at: datetime
    items: List[FreeDistributionItemOut]


# ---------------- Finance ----------------
class FinanceEntryCreate(BaseModel):
    type: FinanceEntryType
    category: str
    amount: float
    description: Optional[str] = None
    entry_date: Optional[datetime] = None


class FinanceEntryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    type: FinanceEntryType
    category: str
    amount: float
    description: Optional[str]
    reference_id: Optional[str]
    entry_date: datetime


# ---------------- Reports ----------------
class DashboardSummary(BaseModel):
    period: str                       # echoes back the requested period
    total_products: int
    low_stock_count: int
    out_of_stock_count: int
    period_income: float
    period_expense: float
    period_b2b_sales: float
    period_profit: float              # gross profit from B2B sales in the period (revenue - cost of goods)
    free_distribution_events: int     # number of distribution records in the period
    free_distribution_pieces: int     # total units given away as samples in the period


class MonthlySalesPoint(BaseModel):
    month: str
    total: float
