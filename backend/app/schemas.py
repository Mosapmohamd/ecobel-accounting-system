import re
from datetime import date, datetime
from enum import Enum as PyEnum
from typing import Optional, List, Literal
from pydantic import AliasPath, BaseModel, ConfigDict, Field, computed_field, field_validator

from . import cairo_time
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
SHORT_DESCRIPTION_MAX = 400
DESCRIPTION_MAX = 8000


def _clean_name(v: Optional[str]) -> Optional[str]:
    if v is None:
        return v
    v = v.strip()
    if not v:
        raise ValueError("اسم المنتج مطلوب")
    if len(v) > 200:
        raise ValueError("اسم المنتج طويل جدًا")
    return v


def _clean_text(v: Optional[str]) -> Optional[str]:
    """Descriptions are plain text: trimmed, Windows line endings normalized,
    and empty means "no description" (NULL), not an empty string."""
    if v is None:
        return None
    v = "\n".join(line.rstrip() for line in v.splitlines()).strip()
    return v or None


class ProductCreate(BaseModel):
    name: str
    category_id: str
    sku: Optional[str] = None
    sale_price: float = Field(0, ge=0)
    quantity: int = Field(0, ge=0)
    low_stock_threshold: int = Field(10, ge=0)
    short_description: Optional[str] = Field(None, max_length=SHORT_DESCRIPTION_MAX)
    description: Optional[str] = Field(None, max_length=DESCRIPTION_MAX)

    _name = field_validator("name")(classmethod(lambda cls, v: _clean_name(v)))
    _texts = field_validator("short_description", "description")(classmethod(lambda cls, v: _clean_text(v)))


class ProductUpdate(BaseModel):
    name: Optional[str] = None
    category_id: Optional[str] = None
    sku: Optional[str] = None
    sale_price: Optional[float] = Field(None, ge=0)
    low_stock_threshold: Optional[int] = Field(None, ge=0)
    is_active: Optional[bool] = None
    short_description: Optional[str] = Field(None, max_length=SHORT_DESCRIPTION_MAX)
    description: Optional[str] = Field(None, max_length=DESCRIPTION_MAX)

    _name = field_validator("name")(classmethod(lambda cls, v: _clean_name(v)))
    _texts = field_validator("short_description", "description")(classmethod(lambda cls, v: _clean_text(v)))

    # Leaving a field out keeps its value; sending null for one of these is
    # an error (422) — they can't be empty, and is_active null would store a
    # product every later read fails on. sku and the descriptions may be null.
    @field_validator("name", "category_id", "sale_price", "low_stock_threshold", "is_active", mode="before")
    @classmethod
    def _not_null(cls, v):
        if v is None:
            raise ValueError("الحقل ده مطلوب ومينفعش يبقى فاضي")
        return v


class ProductPhotoOut(BaseModel):
    """An additional product photo (the main one is `ProductOut.image_url`)."""
    model_config = ConfigDict(from_attributes=True)
    id: str
    image_url: Optional[str] = None
    position: int


class ProductImagesOrder(BaseModel):
    """Every additional photo id of the product, in the new display order."""
    image_ids: List[str] = Field(..., max_length=50)


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
    images: List[ProductPhotoOut] = []
    short_description: Optional[str] = None
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
    name: Optional[str] = Field(None, max_length=200)
    phone: Optional[str] = Field(None, max_length=40)
    discount_percentage: Optional[float] = Field(None, ge=0, le=100)
    notes: Optional[str] = Field(None, max_length=2000)

    # Leaving a field out keeps it; name and discount can't be emptied
    # (phone and notes can be cleared with null).
    @field_validator("name", "discount_percentage", mode="before")
    @classmethod
    def _not_null(cls, v):
        if v is None:
            raise ValueError("الحقل ده مطلوب ومينفعش يبقى فاضي")
        return v

    @field_validator("name")
    @classmethod
    def _name(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("اسم العميل مطلوب")
        return v

    @field_validator("phone", "notes")
    @classmethod
    def _blank_is_none(cls, v: Optional[str]) -> Optional[str]:
        return (v.strip() or None) if v is not None else None


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
    extra_discount_percentage: float = Field(0, ge=0, le=100, description="One-time extra discount for this order only — entered manually, on top of the customer's standing discount")


class B2BOrderUpdate(BaseModel):
    """The editable part of an order: its products and quantities, note and
    one-time extra discount (the customer can't change)."""
    items: List[B2BOrderItemIn] = Field(..., min_length=1, max_length=100)
    note: Optional[str] = Field(None, max_length=2000)
    extra_discount_percentage: float = Field(0, ge=0, le=100)


class B2BOrderItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    product_id: str
    product_name: Optional[str] = Field(None, validation_alias=AliasPath("product", "name"))
    quantity: int
    unit_price: float
    discount_percentage: float
    line_total: float


class B2BOrderOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    customer_id: str
    # The customer's name, so a list of orders needs no customer lookup.
    customer_name: Optional[str] = Field(None, validation_alias=AliasPath("customer", "name"))
    total_amount: float
    extra_discount_percentage: float
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
    source: Literal["website", "b2b", "spending"] = "spending"


class FinanceEntryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    type: FinanceEntryType
    category: str
    amount: float
    description: Optional[str]
    reference_id: Optional[str]
    source: Optional[str] = None
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


# The order lifecycle. Cancelling releases stock and reverses revenue, so a
# cancelled order can't be revived (that would sell stock it no longer
# holds); delivered is final too.
ORDER_TRANSITIONS: dict[OrderStatus, List[OrderStatus]] = {
    OrderStatus.pending: [OrderStatus.shipped, OrderStatus.cancelled],
    OrderStatus.shipped: [OrderStatus.delivered, OrderStatus.cancelled],
    OrderStatus.delivered: [],
    OrderStatus.cancelled: [],
}


class OnlineOrderOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    order_number: str
    customer_name: str
    customer_phone: str
    city: Optional[str] = None
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

    @computed_field
    @property
    def next_statuses(self) -> List[OrderStatus]:
        """Where staff can move this order from its current status."""
        return ORDER_TRANSITIONS[self.status]


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
_DATE_ONLY = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _offer_end(value):
    """`expires_at` may be sent as a date ("2026-10-15": the offer's last
    day) or as an explicit timestamp. A date means the offer runs through
    that whole day in Cairo, so it's stored as the instant that day ends
    (the start of the next Cairo day — see app/cairo_time.py). An explicit
    timestamp is kept exactly as given."""
    if isinstance(value, date) and not isinstance(value, datetime):
        return cairo_time.end_of_cairo_day(value)
    if isinstance(value, str) and _DATE_ONLY.match(value.strip()):
        return cairo_time.end_of_cairo_day(date.fromisoformat(value.strip()))
    return value


class OfferCreate(BaseModel):
    product_id: str
    title: str
    offer_price: float = Field(..., gt=0)
    expires_at: Optional[datetime] = None

    _end_of_day = field_validator("expires_at", mode="before")(_offer_end)


class OfferUpdate(BaseModel):
    title: Optional[str] = None
    offer_price: Optional[float] = Field(None, gt=0)
    is_active: Optional[bool] = None
    expires_at: Optional[datetime] = None

    _end_of_day = field_validator("expires_at", mode="before")(_offer_end)


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

    @computed_field
    @property
    def is_running(self) -> bool:
        """Switched on and not past its end — the same rule the storefront
        uses to show and charge it (ecobel-website app/pricing.py)."""
        return self.is_active and cairo_time.not_ended(self.expires_at)

    @computed_field
    @property
    def ends_on(self) -> Optional[date]:
        """The last Cairo calendar day the offer runs (None: no end date)."""
        return cairo_time.last_cairo_day(cairo_time.as_utc(self.expires_at)) if self.expires_at else None

    @computed_field
    @property
    def ends_at_day_end(self) -> bool:
        """True when it ends with that whole day (set from a date); False
        for an explicit time of day, e.g. offers saved before dates meant
        "through the whole day"."""
        return bool(self.expires_at) and cairo_time.is_end_of_cairo_day(cairo_time.as_utc(self.expires_at))


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


# ---------------- Shipping rates (delivery fee by city) ----------------
class ShippingRateCreate(BaseModel):
    city: str
    fee: float = Field(..., ge=0)


class ShippingRateUpdate(BaseModel):
    fee: Optional[float] = Field(None, ge=0)
    is_active: Optional[bool] = None


class ShippingRateOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    city: str
    fee: float
    is_active: bool
    created_at: datetime


# ---------------- Reviews moderation ----------------
class ReviewAdminOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    product_id: str
    product_name: str
    customer_name: str
    rating: int
    comment: Optional[str]
    is_approved: bool
    created_at: datetime


# ---------------- Online store: homepage merchandising ----------------
class FeaturedProductsUpdate(BaseModel):
    """The complete homepage selection, in display order (first = position 1)."""
    product_ids: List[str] = Field(..., max_length=8)


class FeaturedRoutinesUpdate(BaseModel):
    routine_ids: List[str] = Field(..., max_length=2)


class FeaturedProductSlot(BaseModel):
    position: int
    product: ProductOut
    # False when the product stopped being sellable after it was featured
    # (deactivated / out of stock) — the storefront skips the slot.
    is_visible: bool
    issue: Optional[str] = None


class FeaturedRoutineSlot(BaseModel):
    position: int
    routine: RoutineOut
    is_visible: bool
    issue: Optional[str] = None
