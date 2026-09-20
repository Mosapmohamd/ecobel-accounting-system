"""
Run once (after create_admin.py) to seed sample data for demos/testing:
    python seed_data.py
"""
from app.database import SessionLocal, engine
from app import models

models.Base.metadata.create_all(bind=engine)


CATEGORIES = ["عناية بالبشرة", "عناية بالشعر"]

PRODUCTS = [
    # name, category, cost_price, sale_price, quantity, low_stock_threshold
    ("سيروم نياسيناميد 5%", "عناية بالبشرة", 120, 300, 45, 10),
    ("مرطب هايدرا جل للبشرة الدهنية", "عناية بالبشرة", 90, 200, 60, 10),
    ("غسول للبشرة الحساسة", "عناية بالبشرة", 70, 175, 8, 10),
    ("كريم واقي شمس SPF50", "عناية بالبشرة", 110, 280, 30, 8),
    ("ماسك طيني منقي للمسام", "عناية بالبشرة", 60, 150, 0, 10),
    ("زيت الجوجوبا الطبيعي", "عناية بالبشرة", 95, 220, 25, 6),
    ("شامبو بدون سلفات — روز ماري وأرجان", "عناية بالشعر", 70, 175, 50, 10),
    ("هير ماسك بزبدة الشيا والأرجان", "عناية بالشعر", 80, 200, 5, 10),
    ("سيروم لمعان ونعومة للشعر", "عناية بالشعر", 65, 160, 38, 8),
    ("زيت الخروع لتكثيف الشعر", "عناية بالشعر", 55, 140, 20, 8),
]


def main():
    db = SessionLocal()
    try:
        category_by_name = {}
        for name in CATEGORIES:
            existing = db.query(models.Category).filter(models.Category.name == name).first()
            if not existing:
                existing = models.Category(name=name)
                db.add(existing)
                db.flush()
            category_by_name[name] = existing

        created = 0
        for name, cat_name, cost, price, qty, threshold in PRODUCTS:
            if db.query(models.Product).filter(models.Product.name == name).first():
                continue
            db.add(models.Product(
                name=name,
                category_id=category_by_name[cat_name].id,
                cost_price=cost,
                sale_price=price,
                quantity=qty,
                low_stock_threshold=threshold,
            ))
            created += 1

        db.commit()
        print(f"Seeded {len(CATEGORIES)} categories and {created} new products "
              f"({len(PRODUCTS) - created} already existed).")
    finally:
        db.close()


if __name__ == "__main__":
    main()
