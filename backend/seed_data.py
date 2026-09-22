"""
Run once (after create_admin.py) to seed a realistic demo dataset:
    python seed_data.py

Creates:
  - 3 categories, 20 products spread across them
  - 5 B2B wholesale customers
  - ~18 months of B2B sale orders (3-6/month), each one properly:
      * discounted at the customer's fixed rate
      * deducting stock via an InventoryMovement
      * recording an income FinanceEntry
    ...so /reports/dashboard and /reports/monthly-sales have real history
    to show across every period filter (today/month/quarter/year).

Idempotent guard: if any product already exists, the script does nothing
(to avoid half-reseeding on top of real data). Delete the dev DB file first
if you want a fresh run.
"""
import random
from datetime import datetime, timezone

from dateutil.relativedelta import relativedelta

from app.database import SessionLocal, engine
from app import models

# Ensure tables exist even if the server hasn't been started yet.
models.Base.metadata.create_all(bind=engine)

random.seed(42)  # deterministic output — same data every run on an empty DB

CATEGORIES = ["عناية بالبشرة", "عناية بالشعر", "العناية بالجسم"]

# name, category, sale_price, final_quantity, low_stock_threshold
PRODUCTS = [
    ("سيروم نياسيناميد 5%",                      "عناية بالبشرة", 300, 45, 10),
    ("مرطب هايدرا جل للبشرة الدهنية",             "عناية بالبشرة", 200, 60, 10),
    ("غسول للبشرة الحساسة",                       "عناية بالبشرة", 175,  8, 10),
    ("كريم واقي شمس SPF50",                       "عناية بالبشرة", 280, 30,  8),
    ("ماسك طيني منقي للمسام",                     "عناية بالبشرة", 150,  0, 10),
    ("زيت الجوجوبا الطبيعي",                      "عناية بالبشرة", 220, 25,  6),
    ("تونر بالورد للبشرة الجافة",                 "عناية بالبشرة", 160, 55, 10),

    ("شامبو بدون سلفات — روز ماري وأرجان",         "عناية بالشعر",  175, 50, 10),
    ("هير ماسك بزبدة الشيا والأرجان",              "عناية بالشعر",  200,  5, 10),
    ("سيروم لمعان ونعومة للشعر",                  "عناية بالشعر",  160, 38,  8),
    ("زيت الخروع لتكثيف الشعر",                   "عناية بالشعر",  140, 20,  8),
    ("بلسم مرطب للشعر الجاف",                     "عناية بالشعر",  150, 42, 10),
    ("سبراي حماية من الحرارة",                    "عناية بالشعر",  130,  0, 10),
    ("زيت شعر بالأرجان والكيراتين",               "عناية بالشعر",  190, 28,  8),

    ("لوشن ترطيب الجسم بزبدة الشيا",              "العناية بالجسم", 210, 33, 10),
    ("سكراب قهوة للجسم",                          "العناية بالجسم", 140, 12, 10),
    ("زيت جسم بالورد الطبيعي",                    "العناية بالجسم", 220, 47, 10),
    ("صابون طبيعي بالعسل والزيوت",                "العناية بالجسم",  90, 70, 15),
    ("كريم يدين مغذي",                            "العناية بالجسم", 100, 60, 12),
    ("مزيل عرق طبيعي خالٍ من الألومنيوم",         "العناية بالجسم", 115,  3, 10),
]

# name, phone, fixed discount %
CUSTOMERS = [
    ("صيدلية النور",           "01001112223", 15),
    ("مركز جمال الأميرة",       "01112223334", 20),
    ("صيدلية الشفاء",          "01223334445", 12),
    ("سنتر العناية الطبيعية",   "01334445556", 18),
    ("صيدلية المستقبل",        "01445556667", 10),
]

SALES_MONTHS = 18
ORDERS_PER_MONTH_RANGE = (3, 6)
ITEMS_PER_ORDER_RANGE = (1, 2)
QTY_PER_ITEM_RANGE = (2, 15)


def build_order_plan(period_start: datetime):
    """Decide every historical order up front so we know total demand per
    product before creating it (lets us size the opening stock correctly)."""
    plan = []
    product_names = [p[0] for p in PRODUCTS]
    customer_names = [c[0] for c in CUSTOMERS]

    for i in range(SALES_MONTHS):
        month_date = period_start + relativedelta(months=i)
        for _ in range(random.randint(*ORDERS_PER_MONTH_RANGE)):
            day = random.randint(1, 27)
            hour = random.randint(9, 19)
            minute = random.choice([0, 15, 30, 45])
            order_date = month_date.replace(day=day, hour=hour, minute=minute, second=0, microsecond=0)
            customer_name = random.choice(customer_names)
            chosen = random.sample(product_names, random.randint(*ITEMS_PER_ORDER_RANGE))
            items = [(name, random.randint(*QTY_PER_ITEM_RANGE)) for name in chosen]
            plan.append((order_date, customer_name, items))

    plan.sort(key=lambda row: row[0])
    return plan


def main():
    db = SessionLocal()
    try:
        if db.query(models.Product).count() > 0:
            print("Products already exist — skipping (delete the dev DB file first to reseed from scratch).")
            return

        # ---- categories ----
        category_by_name = {}
        for name in CATEGORIES:
            category = models.Category(name=name)
            db.add(category)
            db.flush()
            category_by_name[name] = category

        # ---- B2B customers ----
        customer_by_name = {}
        for name, phone, discount in CUSTOMERS:
            customer = models.B2BCustomer(name=name, phone=phone, discount_percentage=discount)
            db.add(customer)
            db.flush()
            customer_by_name[name] = customer

        now = datetime.now(timezone.utc)
        period_start = (now - relativedelta(months=SALES_MONTHS)).replace(
            day=1, hour=9, minute=0, second=0, microsecond=0
        )

        # ---- plan every sale first, so opening stock can be sized correctly ----
        order_plan = build_order_plan(period_start)
        total_sold = {name: 0 for name, *_ in PRODUCTS}
        for _, _, items in order_plan:
            for name, qty in items:
                total_sold[name] += qty

        # ---- create products with opening stock = total later sold + target ending stock ----
        product_by_name = {}
        for name, cat_name, price, final_qty, threshold in PRODUCTS:
            opening_qty = total_sold[name] + final_qty
            product = models.Product(
                name=name,
                category_id=category_by_name[cat_name].id,
                sale_price=price,
                quantity=opening_qty,
                low_stock_threshold=threshold,
                created_at=period_start,
            )
            db.add(product)
            db.flush()
            product_by_name[name] = product
            db.add(models.InventoryMovement(
                product_id=product.id,
                type=models.MovementType.restock,
                quantity_change=opening_qty,
                note="رصيد افتتاحي (بداية فترة المحاكاة)",
                created_at=period_start,
            ))

        # ---- replay the sale orders chronologically ----
        for order_date, customer_name, items in order_plan:
            customer = customer_by_name[customer_name]
            order = models.B2BOrder(customer_id=customer.id, total_amount=0, created_at=order_date)
            db.add(order)
            db.flush()

            total = 0.0
            for name, qty in items:
                product = product_by_name[name]
                discount = customer.discount_percentage
                line_total = product.sale_price * qty * (1 - discount / 100)
                total += line_total

                db.add(models.B2BOrderItem(
                    order_id=order.id,
                    product_id=product.id,
                    quantity=qty,
                    unit_price=product.sale_price,
                    discount_percentage=discount,
                    line_total=line_total,
                ))
                product.quantity -= qty
                db.add(models.InventoryMovement(
                    product_id=product.id,
                    type=models.MovementType.b2b_sale,
                    quantity_change=-qty,
                    reference_id=order.id,
                    note=f"B2B order to {customer.name}",
                    created_at=order_date,
                ))

            order.total_amount = total
            db.add(models.FinanceEntry(
                type=models.FinanceEntryType.income,
                category="مبيعات جملة B2B",
                amount=total,
                description=f"أوردر B2B — {customer.name}",
                reference_id=order.id,
                entry_date=order_date,
                created_at=order_date,
            ))

        db.commit()
        print(
            f"Seeded {len(CATEGORIES)} categories, {len(PRODUCTS)} products, "
            f"{len(CUSTOMERS)} B2B customers, and {len(order_plan)} B2B orders "
            f"spanning {SALES_MONTHS} months."
        )
    finally:
        db.close()


if __name__ == "__main__":
    main()
