from datetime import datetime
from enum import Enum as PyEnum
from typing import Optional, List
from pydantic import BaseModel, ConfigDict, Field

from .models import MovementType, RecipientType, FinanceEntryType, CouponDiscountType, OrderStatus


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
    sale_price: float = Field(0, ge=0)
    quantity: int = Field(0, ge=0)
    low_stock_threshold: int = Field(10, ge=0)
    description: Optional[str] = None


class ProductUpdate(BaseModel):
    name: Optional[str] = None
    category_id: Optional[str] = None
    sku: Optional[str] = None
    sale_price: Optional[float] = Field(None, ge=0)
    low_stock_threshold: Optional[int] = Field(None, ge=0)
    is_active: Optional[bool] = None
    description: Optional[str] = None


class ProductOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    name: str
    category_id: str
    category_name: str
    sku: Optional[str]
    sale_price: float
    quantity: int
    low_stock_threshold: int
    is_active: bool
    stock_status: str
    image_url: Optional[str] = None
    description: Optional[str] = None
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
    discount_percentage: float = Field(0, ge=0, le=100)
    notes: Optional[str] = None


class B2BCustomerUpdate(BaseModel):
    name: Optional[str] = None
    phone: Optional[str] = None
    discount_percentage: Optional[float] = Field(None, ge=0, le=100)
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
    quantity: int = Field(..., gt=0)


class B2BOrderCreate(BaseModel):
    customer_id: str
    items: List[B2BOrderItemIn]
    note: Optional[str] = None


class B2BOrderItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    product_id: str
    quantity: int
    unit_price: float
    discount_percentage: float
    line_total: float


class B2BOrderOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    customer_id: str
    total_amount: float
    note: Optional[str]
    created_at: datetime
    items: List[B2BOrderItemOut]


# ---------------- Free distribution ----------------
class FreeDistributionItemIn(BaseModel):
    product_id: str
    quantity: int = Field(..., gt=0)


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
    amount: float = Field(..., gt=0)
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
    free_distribution_events: int     # number of distribution records in the period
    free_distribution_pieces: int     # total units given away as samples in the period


class MonthlySalesPoint(BaseModel):
    month: str
    total: float


# ---------------- Online store: product image ----------------
class ProductImageOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    name: str
    image_url: Optional[str] = None


# ---------------- Online store: coupons ----------------
class CouponLimitType(str, PyEnum):
    duration = "duration"
    count = "count"
    unlimited = "unlimited"


class CouponCreate(BaseModel):
    code: str
    discount_type: CouponDiscountType
    discount_value: float = Field(..., gt=0)
    min_order_amount: float = Field(0, ge=0)
    limit_type: CouponLimitType = CouponLimitType.unlimited
    max_uses: Optional[int] = Field(None, gt=0)
    expires_at: Optional[datetime] = None


class CouponUpdate(BaseModel):
    discount_value: Optional[float] = Field(None, gt=0)
    min_order_amount: Optional[float] = Field(None, ge=0)
    limit_type: Optional[CouponLimitType] = None
    max_uses: Optional[int] = Field(None, gt=0)
    expires_at: Optional[datetime] = None
    is_active: Optional[bool] = None


class CouponOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    code: str
    discount_type: CouponDiscountType
    discount_value: float
    min_order_amount: float
    max_uses: Optional[int]
    used_count: int
    is_active: bool
    expires_at: Optional[datetime]
    created_at: datetime


# ---------------- Online store: orders ----------------
class OnlineOrderItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    product_id: str
    product_name: str
    unit_price: float
    quantity: int
    line_total: float


class OnlineOrderOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    order_number: str
    customer_name: str
    customer_phone: str
    shipping_address: str
    status: OrderStatus
    payment_method: str
    subtotal: float
    discount_amount: float
    shipping_fee: float
    total_amount: float
    note: Optional[str]
    created_at: datetime
    items: List[OnlineOrderItemOut]


class OnlineOrderStatusUpdate(BaseModel):
    status: OrderStatus


# ---------------- Online store: sales analytics ----------------
class RevenuePoint(BaseModel):
    date: str
    total: float


class TopProduct(BaseModel):
    product_name: str
    quantity_sold: int
    revenue: float


class SalesAnalytics(BaseModel):
    source: str                       # echoes back "all" / "online" / "b2b"
    total_revenue: float
    total_orders: int
    orders_by_status: dict[str, int]
    revenue_last_30_days: List[RevenuePoint]
    top_products: List[TopProduct]


# ---------------- Online store: offers ----------------
class OfferCreate(BaseModel):
    product_id: str
    title: str
    offer_price: float = Field(..., gt=0)
    expires_at: Optional[datetime] = None


class OfferUpdate(BaseModel):
    title: Optional[str] = None
    offer_price: Optional[float] = Field(None, gt=0)
    is_active: Optional[bool] = None
    expires_at: Optional[datetime] = None


class OfferOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    product_id: str
    product_name: str
    original_price: float
    image_url: Optional[str] = None
    title: str
    offer_price: float
    is_active: bool
    expires_at: Optional[datetime]
    created_at: datetime


# ---------------- Online store: routines ----------------
class RoutineCreate(BaseModel):
    name: str
    description: Optional[str] = None
    product_ids: List[str] = Field(..., min_length=2, max_length=3)


class RoutineUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    is_active: Optional[bool] = None
    product_ids: Optional[List[str]] = Field(None, min_length=2, max_length=3)


class RoutineItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    product_id: str
    product_name: str
    sale_price: float
    image_url: Optional[str] = None


class RoutineOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    name: str
    description: Optional[str]
    is_active: bool
    items: List[RoutineItemOut]
    created_at: datetime
