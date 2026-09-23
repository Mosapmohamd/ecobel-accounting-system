import enum
import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    Column, String, Integer, Float, DateTime, ForeignKey, Enum, Text, Boolean
)
from sqlalchemy.orm import relationship

from .database import Base


def gen_id() -> str:
    return str(uuid.uuid4())


def now() -> datetime:
    return datetime.now(timezone.utc)


# ---------------------------------------------------------------------------
# Auth (single-role: every logged-in user has full access — per project scope)
# ---------------------------------------------------------------------------
class User(Base):
    __tablename__ = "users"

    id = Column(String, primary_key=True, default=gen_id)
    username = Column(String, unique=True, nullable=False, index=True)
    hashed_password = Column(String, nullable=False)
    full_name = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), default=now)


# ---------------------------------------------------------------------------
# Products & Inventory
# ---------------------------------------------------------------------------
class Category(Base):
    """Dynamic product categories — the client can add new ones from the
    dashboard (originally fixed to skincare/haircare, opened up on request)."""
    __tablename__ = "categories"

    id = Column(String, primary_key=True, default=gen_id)
    name = Column(String, unique=True, nullable=False)
    created_at = Column(DateTime(timezone=True), default=now)

    products = relationship("Product", back_populates="category")


class Product(Base):
    __tablename__ = "products"

    id = Column(String, primary_key=True, default=gen_id)
    name = Column(String, nullable=False)
    category_id = Column(String, ForeignKey("categories.id"), nullable=False)
    sku = Column(String, unique=True, nullable=True)
    sale_price = Column(Float, nullable=False, default=0)      # سعر البيع للمستهلك
    quantity = Column(Integer, nullable=False, default=0)      # الكمية الحالية بالمخزن
    low_stock_threshold = Column(Integer, nullable=False, default=10)
    is_active = Column(Boolean, default=True)
    image_url = Column(String, nullable=True)  # product photo, shown on the website
    description = Column(Text, nullable=True)  # shown on the website's product page
    created_at = Column(DateTime(timezone=True), default=now)
    updated_at = Column(DateTime(timezone=True), default=now, onupdate=now)

    category = relationship("Category", back_populates="products")
    movements = relationship("InventoryMovement", back_populates="product")

    @property
    def stock_status(self) -> str:
        if self.quantity <= 0:
            return "out"
        if self.quantity <= self.low_stock_threshold:
            return "low"
        return "ok"

    @property
    def category_name(self) -> str:
        return self.category.name if self.category else ""


class MovementType(str, enum.Enum):
    restock = "restock"                    # وارد جديد للمخزون
    adjustment = "adjustment"               # تسوية يدوية (+/-)
    website_sale = "website_sale"           # بيع عادي (سيتكامل مع الموقع في مرحلة لاحقة)
    b2b_sale = "b2b_sale"                   # بيع جملة B2B
    free_distribution = "free_distribution"  # توزيع مجاني (عينات)


class InventoryMovement(Base):
    """Every change to stock quantity is logged here — the single source of truth
    for current stock (Product.quantity is a cached/denormalized value kept in
    sync by the service layer whenever a movement is created)."""
    __tablename__ = "inventory_movements"

    id = Column(String, primary_key=True, default=gen_id)
    product_id = Column(String, ForeignKey("products.id"), nullable=False)
    type = Column(Enum(MovementType), nullable=False)
    quantity_change = Column(Integer, nullable=False)  # negative = stock out, positive = stock in
    reference_id = Column(String, nullable=True)        # e.g. B2BOrder.id or FreeDistribution.id
    note = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), default=now)

    product = relationship("Product", back_populates="movements")


# ---------------------------------------------------------------------------
# B2B (wholesale) customers & orders
# ---------------------------------------------------------------------------
class B2BCustomer(Base):
    __tablename__ = "b2b_customers"

    id = Column(String, primary_key=True, default=gen_id)
    name = Column(String, nullable=False)               # e.g. "صيدلية النور"
    phone = Column(String, nullable=True)
    discount_percentage = Column(Float, nullable=False, default=0)  # fixed, pre-agreed
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), default=now)

    orders = relationship("B2BOrder", back_populates="customer")


class B2BOrder(Base):
    __tablename__ = "b2b_orders"

    id = Column(String, primary_key=True, default=gen_id)
    customer_id = Column(String, ForeignKey("b2b_customers.id"), nullable=False)
    total_amount = Column(Float, nullable=False, default=0)  # after customer's discount
    extra_discount_percentage = Column(Float, nullable=False, default=0)  # one-time, entered manually per order — on top of the customer's standing discount
    note = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), default=now)

    customer = relationship("B2BCustomer", back_populates="orders")
    items = relationship("B2BOrderItem", back_populates="order", cascade="all, delete-orphan")


class B2BOrderItem(Base):
    __tablename__ = "b2b_order_items"

    id = Column(String, primary_key=True, default=gen_id)
    order_id = Column(String, ForeignKey("b2b_orders.id"), nullable=False)
    product_id = Column(String, ForeignKey("products.id"), nullable=False)
    quantity = Column(Integer, nullable=False)
    unit_price = Column(Float, nullable=False)          # product.sale_price at time of order
    discount_percentage = Column(Float, nullable=False)  # copied from customer at time of order
    line_total = Column(Float, nullable=False)           # unit_price * qty * (1 - discount)

    order = relationship("B2BOrder", back_populates="items")
    product = relationship("Product")


# ---------------------------------------------------------------------------
# Free distribution (samples to pharmacies / potential customers)
# ---------------------------------------------------------------------------
class RecipientType(str, enum.Enum):
    pharmacy = "pharmacy"                   # صيدلية
    potential_customer = "potential_customer"  # عميل محتمل


class FreeDistribution(Base):
    __tablename__ = "free_distributions"

    id = Column(String, primary_key=True, default=gen_id)
    recipient_name = Column(String, nullable=False)
    recipient_type = Column(Enum(RecipientType), nullable=False)
    note = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), default=now)

    items = relationship("FreeDistributionItem", back_populates="distribution", cascade="all, delete-orphan")


class FreeDistributionItem(Base):
    __tablename__ = "free_distribution_items"

    id = Column(String, primary_key=True, default=gen_id)
    distribution_id = Column(String, ForeignKey("free_distributions.id"), nullable=False)
    product_id = Column(String, ForeignKey("products.id"), nullable=False)
    quantity = Column(Integer, nullable=False)

    distribution = relationship("FreeDistribution", back_populates="items")
    product = relationship("Product")


# ---------------------------------------------------------------------------
# Finance — expenses & income
# ---------------------------------------------------------------------------
class FinanceEntryType(str, enum.Enum):
    income = "income"
    expense = "expense"


class FinanceEntry(Base):
    __tablename__ = "finance_entries"

    id = Column(String, primary_key=True, default=gen_id)
    type = Column(Enum(FinanceEntryType), nullable=False)
    category = Column(String, nullable=False)   # e.g. "مبيعات الموقع", "مواد خام", "شحن", "أخرى"
    amount = Column(Float, nullable=False)
    description = Column(Text, nullable=True)
    reference_id = Column(String, nullable=True)  # links to a B2BOrder id, website Order id, etc.
    source = Column(String, nullable=True)  # "website" | "b2b" | "spending" — NULL (old rows) is treated as "spending"
    entry_date = Column(DateTime(timezone=True), default=now)
    created_at = Column(DateTime(timezone=True), default=now)


# ===========================================================================
# WEBSITE-SHARED TABLES — mirrored exactly from ecobel-website's models.
# Both services read/write these same rows. Keep byte-for-byte in sync.
# Online (b2c) orders originate on the website; the admin manages them here.
# ===========================================================================

class Customer(Base):
    __tablename__ = "customers"

    id = Column(String, primary_key=True, default=gen_id)
    name = Column(String, nullable=False)
    phone = Column(String, nullable=False, index=True)
    email = Column(String, nullable=True)
    address = Column(Text, nullable=True)
    hashed_password = Column(String, nullable=True)  # nullable = guest checkout
    created_at = Column(DateTime(timezone=True), default=now)

    orders = relationship("Order", back_populates="customer")


class CouponDiscountType(str, enum.Enum):
    percentage = "percentage"
    fixed = "fixed"


class Coupon(Base):
    __tablename__ = "coupons"

    id = Column(String, primary_key=True, default=gen_id)
    code = Column(String, unique=True, nullable=False, index=True)
    discount_type = Column(Enum(CouponDiscountType), nullable=False)
    discount_value = Column(Float, nullable=False)
    min_order_amount = Column(Float, nullable=False, default=0)
    max_uses = Column(Integer, nullable=True)
    used_count = Column(Integer, nullable=False, default=0)
    is_active = Column(Boolean, default=True)
    expires_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=now)


class OrderStatus(str, enum.Enum):
    pending = "pending"        # قيد التجهيز
    shipped = "shipped"        # في الطريق
    delivered = "delivered"    # تم التوصيل
    cancelled = "cancelled"    # ملغي


class Order(Base):
    __tablename__ = "orders"

    id = Column(String, primary_key=True, default=gen_id)
    order_number = Column(String, unique=True, nullable=False, index=True)
    customer_id = Column(String, ForeignKey("customers.id"), nullable=True)

    customer_name = Column(String, nullable=False)
    customer_phone = Column(String, nullable=False)
    city = Column(String, nullable=True)
    shipping_address = Column(Text, nullable=False)

    status = Column(Enum(OrderStatus), nullable=False, default=OrderStatus.pending)
    payment_method = Column(String, nullable=False, default="cash_on_delivery")

    subtotal = Column(Float, nullable=False, default=0)
    coupon_id = Column(String, ForeignKey("coupons.id"), nullable=True)
    discount_amount = Column(Float, nullable=False, default=0)
    shipping_fee = Column(Float, nullable=False, default=0)
    total_amount = Column(Float, nullable=False, default=0)

    note = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), default=now)
    updated_at = Column(DateTime(timezone=True), default=now, onupdate=now)

    customer = relationship("Customer", back_populates="orders")
    coupon = relationship("Coupon")
    items = relationship("OrderItem", back_populates="order", cascade="all, delete-orphan")


class OrderItem(Base):
    __tablename__ = "order_items"

    id = Column(String, primary_key=True, default=gen_id)
    order_id = Column(String, ForeignKey("orders.id"), nullable=False)
    product_id = Column(String, ForeignKey("products.id"), nullable=False)
    product_name = Column(String, nullable=False)
    unit_price = Column(Float, nullable=False)
    quantity = Column(Integer, nullable=False)
    line_total = Column(Float, nullable=False)

    order = relationship("Order", back_populates="items")
    product = relationship("Product")


# ===========================================================================
# WEBSITE MERCHANDISING — offers (single-product discounts shown on the
# homepage) and routines (curated 2-3 product bundles). Owned and managed
# here; the website only reads these to render its homepage sections and
# to price them correctly at checkout.
# ===========================================================================

class Offer(Base):
    __tablename__ = "offers"

    id = Column(String, primary_key=True, default=gen_id)
    product_id = Column(String, ForeignKey("products.id"), nullable=False)
    title = Column(String, nullable=False)          # e.g. "خصم الصيف"
    offer_price = Column(Float, nullable=False)      # the discounted price, shown alongside the original
    is_active = Column(Boolean, default=True)
    expires_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=now)

    product = relationship("Product")

    @property
    def product_name(self) -> str:
        return self.product.name if self.product else ""

    @property
    def original_price(self) -> float:
        return self.product.sale_price if self.product else 0

    @property
    def image_url(self) -> str | None:
        return self.product.image_url if self.product else None


class Routine(Base):
    __tablename__ = "routines"

    id = Column(String, primary_key=True, default=gen_id)
    name = Column(String, nullable=False)            # e.g. "روتين العناية الصباحي"
    description = Column(Text, nullable=True)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), default=now)

    items = relationship("RoutineItem", back_populates="routine", cascade="all, delete-orphan", order_by="RoutineItem.position")


class RoutineItem(Base):
    __tablename__ = "routine_items"

    id = Column(String, primary_key=True, default=gen_id)
    routine_id = Column(String, ForeignKey("routines.id"), nullable=False)
    product_id = Column(String, ForeignKey("products.id"), nullable=False)
    position = Column(Integer, nullable=False, default=0)

    routine = relationship("Routine", back_populates="items")
    product = relationship("Product")

    @property
    def product_name(self) -> str:
        return self.product.name if self.product else ""

    @property
    def sale_price(self) -> float:
        return self.product.sale_price if self.product else 0

    @property
    def image_url(self) -> str | None:
        return self.product.image_url if self.product else None


class ShippingRate(Base):
    """City -> delivery fee, set by the admin. Looked up at checkout on the
    website; a city with no row here falls back to a default fee there."""
    __tablename__ = "shipping_rates"

    id = Column(String, primary_key=True, default=gen_id)
    city = Column(String, unique=True, nullable=False)
    fee = Column(Float, nullable=False)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), default=now)
