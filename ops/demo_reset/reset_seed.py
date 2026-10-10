"""Reset EcoBel business data and seed a small demo dataset — ONE transaction.

    # rehearsal on an isolated local copy (only 127.0.0.1/localhost accepted):
    python reset_seed.py --dsn "host=127.0.0.1 port=55432 user=postgres dbname=rehearsal" --mode reset-seed --expect-manifest m.json --execute
    # the shared Supabase database (target taken from backend/.env, checked against the project ref):
    python reset_seed.py --mode reset-seed --expect-manifest <fresh backup>/manifest.json --execute
    # re-apply the seed only (idempotent; adds nothing that already exists):
    python reset_seed.py --mode seed --execute

Without --execute everything runs and is validated, then ROLLED BACK (dry run).

Safety:
  * every public table is locked (ACCESS EXCLUSIVE) first, then — in reset-seed
    mode — every table's row count and content checksum must equal the backup
    manifest, i.e. nothing changed since the verified backup was taken;
  * each DELETE must remove exactly the rows counted under the lock;
  * all validations below must pass or the transaction is rolled back.

Preserved untouched: users, staff_users, alembic_version, shipping_rates,
customer login accounts (customers with a password), the schema, Storage.

Seeded values follow the applications' own rules (website checkout pricing in
ecobel-website/backend/app/{pricing,checkout}.py and routers/orders.py; B2B in
ecobel-accounting-system/backend/app/routers/b2b.py; stock via restock /
website_sale / b2b_sale movements as services.apply_stock_movement writes them).
"""
import argparse
import json
import sys
from datetime import datetime, timedelta, timezone
from urllib.parse import urlparse
from zoneinfo import ZoneInfo

import common

CAIRO = ZoneInfo("Africa/Cairo")
FREE_SHIPPING_THRESHOLD = 1000.0  # ecobel-website checkout.FREE_SHIPPING_THRESHOLD


def utc(s: str) -> datetime:
    return datetime.fromisoformat(s).replace(tzinfo=timezone.utc)


def end_of_cairo_day(y: int, m: int, d: int) -> datetime:
    """Same rule as app/cairo_time.end_of_cairo_day: the instant the next Cairo day starts."""
    nxt = datetime(y, m, d, tzinfo=CAIRO) + timedelta(days=1)
    return datetime(nxt.year, nxt.month, nxt.day, tzinfo=CAIRO).astimezone(timezone.utc)


# Delete order: children before parents. Every FK in the schema is covered.
RESET_DELETES = [
    ("featured_products", None),
    ("featured_routines", None),
    ("reviews", None),
    ("routine_items", None),
    ("order_items", None),
    ("inventory_movements", None),
    ("finance_entries", None),
    ("free_distribution_items", None),
    ("free_distributions", None),
    ("b2b_order_items", None),
    ("b2b_orders", None),
    ("b2b_customers", None),
    ("offers", None),
    ("orders", None),
    ("coupons", None),
    ("routines", None),
    ("customers", "hashed_password IS NULL"),  # guest profiles only; login accounts are kept
    ("products", None),
    ("categories", None),
    ("auth_throttle", None),
]
PRESERVED = ["users", "staff_users", "alembic_version", "shipping_rates"]

# ---------------------------------------------------------------- demo data
T0 = utc("2026-09-20T09:00:00")
CATEGORIES = [
    ("seed_cat_skin", "العناية بالبشرة"),
    ("seed_cat_hair", "العناية بالشعر"),
]
PRODUCTS = [  # id, name, category, sku, sale_price, description
    ("seed_prod_cleanser", "غسول منظّف لطيف للوجه 200 مل", "seed_cat_skin", "ECO-DEMO-001", 180.0,
     "غسول يومي خفيف بدون صابون، بينظّف البشرة من غير ما يسيبها جافة. مناسب لكل أنواع البشرة."),
    ("seed_prod_serum", "سيروم فيتامين سي 30 مل", "seed_cat_skin", "ECO-DEMO-002", 320.0,
     "سيروم بتركيز فيتامين سي لتوحيد لون البشرة وإشراقتها. يُستخدم الصبح قبل واقي الشمس."),
    ("seed_prod_moist", "كريم مرطّب يومي بالهيالورونيك 50 مل", "seed_cat_skin", "ECO-DEMO-003", 240.0,
     "مرطّب خفيف سريع الامتصاص بحمض الهيالورونيك، بيحافظ على ترطيب البشرة طول اليوم."),
    ("seed_prod_shampoo", "شامبو الأرجان للشعر الجاف 400 مل", "seed_cat_hair", "ECO-DEMO-004", 210.0,
     "شامبو لطيف بزيت الأرجان بيغذّي الشعر الجاف والمجهد ويقلّل التقصف."),
]
OPENING_STOCK = 50
OFFERS = [  # id, product, title, offer_price, ends (last Cairo day)
    ("seed_offer_serum", "seed_prod_serum", "عرض الخريف على سيروم فيتامين سي", 270.0, (2026, 12, 31)),
    ("seed_offer_shampoo", "seed_prod_shampoo", "خصم شامبو الأرجان لفترة محدودة", 175.0, (2026, 11, 30)),
]
OFFERS_CREATED = utc("2026-09-25T09:00:00")
COUPONS = [  # id, code, type, value, min_order, max_uses, expires(last Cairo day)
    ("seed_coupon_welcome", "WELCOME10", "percentage", 10.0, 300.0, 100, None),
    ("seed_coupon_save50", "SAVE50", "fixed", 50.0, 500.0, None, (2026, 12, 31)),
]
CUSTOMERS = [  # guest profiles, as the website creates them: name + phone only
    ("seed_cust_1", "عميلة تجريبية (1)", "01000000001"),
    ("seed_cust_2", "عميل تجريبي (2)", "01000000002"),
]
ORDERS = [  # id, number, customer, city, address, lines[(product, qty)], coupon, status, created, updated
    ("seed_order_1", "EBDEMXSEEDA2", "seed_cust_1", "القاهرة", "عنوان تجريبي — شارع التجربة 1، القاهرة",
     [("seed_prod_serum", 1), ("seed_prod_moist", 2)], "WELCOME10", "delivered",
     utc("2026-10-01T10:00:00"), utc("2026-10-04T14:00:00")),
    ("seed_order_2", "EBDEMXSEEDB3", "seed_cust_2", "الإسكندرية", "عنوان تجريبي — شارع التجربة 2، الإسكندرية",
     [("seed_prod_cleanser", 1), ("seed_prod_shampoo", 1)], None, "pending",
     utc("2026-10-08T12:00:00"), utc("2026-10-08T12:00:00")),
]
B2B_CUSTOMERS = [  # id, name, standing discount %, notes
    ("seed_b2b_1", "صيدلية تجريبية — مصر الجديدة", 15.0, "عميل جملة تجريبي (بيانات عرض)"),
    ("seed_b2b_2", "متجر تجميل تجريبي — المعادي", 10.0, "عميل جملة تجريبي (بيانات عرض)"),
]
B2B_ORDERS = [  # id, customer, extra discount %, lines[(product, qty)], created
    ("seed_b2bord_1", "seed_b2b_1", 0.0, [("seed_prod_cleanser", 5), ("seed_prod_moist", 3)], utc("2026-10-02T11:00:00")),
    ("seed_b2bord_2", "seed_b2b_2", 5.0, [("seed_prod_shampoo", 6)], utc("2026-10-06T11:00:00")),
]
ROUTINES = [  # id, name, description, product ids (positions from 0, as routers/routines.py)
    ("seed_routine_skin", "روتين البشرة اليومي", "خطوتين بسيطتين للصبح: تنظيف لطيف وبعده ترطيب.",
     ["seed_prod_cleanser", "seed_prod_moist"]),
    ("seed_routine_hair", "روتين الشعر الجاف", "عناية أساسية للشعر الجاف بزيت الأرجان.", ["seed_prod_shampoo"]),
]
FEATURED_PRODUCTS = ["seed_prod_serum", "seed_prod_moist", "seed_prod_shampoo"]
FEATURED_ROUTINES = ["seed_routine_skin"]


def build_plan(shipping_fees: dict) -> dict:
    """Every row to insert, with derived values computed by the apps' rules."""
    rows = {k: [] for k in ["categories", "products", "inventory_movements", "offers", "coupons", "customers", "orders",
                            "order_items", "finance_entries", "b2b_customers", "b2b_orders", "b2b_order_items",
                            "routines", "routine_items", "featured_products", "featured_routines"]}
    price = {p[0]: p[4] for p in PRODUCTS}
    name = {p[0]: p[1] for p in PRODUCTS}
    stock = {p[0]: OPENING_STOCK for p in PRODUCTS}
    rows["categories"] = [dict(id=i, name=n, created_at=T0) for i, n in CATEGORIES]
    for pid, *_ in PRODUCTS:
        rows["inventory_movements"].append(dict(id=f"seed_mv_open_{pid[10:]}", product_id=pid, type="restock",
                                                quantity_change=OPENING_STOCK, reference_id=None,
                                                note="رصيد افتتاحي — بيانات عرض تجريبية", created_at=T0))
    offers = {}
    for oid, pid, title, oprice, end in OFFERS:
        assert oprice < price[pid]  # routers/offers.py: offer price must be below the regular price
        rows["offers"].append(dict(id=oid, product_id=pid, title=title, offer_price=oprice, is_active=True,
                                   expires_at=end_of_cairo_day(*end), created_at=OFFERS_CREATED))
        offers[pid] = (oprice, end_of_cairo_day(*end))
    coupons = {}
    for cid, code, ctype, value, minimum, max_uses, end in COUPONS:
        coupons[code] = dict(id=cid, code=code, discount_type=ctype, discount_value=value, min_order_amount=minimum,
                             max_uses=max_uses, used_count=0, is_active=True,
                             expires_at=end_of_cairo_day(*end) if end else None, created_at=OFFERS_CREATED)
    rows["customers"] = [dict(id=i, name=n, phone=ph, email=None, address=None, hashed_password=None,
                              created_at=next(o[8] for o in ORDERS if o[2] == i)) for i, n, ph in CUSTOMERS]

    for oid, number, cust, city, address, lines, code, status, created, updated in ORDERS:
        items, subtotal = [], 0.0
        for n, (pid, qty) in enumerate(lines, 1):
            o = offers.get(pid)  # pricing.unit_price: live offer below sale_price wins
            unit = o[0] if o and OFFERS_CREATED <= created < o[1] and o[0] < price[pid] else price[pid]
            line_total = unit * qty  # routers/orders._lock_and_price
            subtotal += line_total
            items.append(dict(id=f"{oid}_item{n}", order_id=oid, product_id=pid, product_name=name[pid],
                              unit_price=unit, quantity=qty, line_total=line_total))
            stock[pid] -= qty
            assert stock[pid] >= 0
            rows["inventory_movements"].append(dict(id=f"{oid}_mv{n}", product_id=pid, type="website_sale",
                                                    quantity_change=-qty, reference_id=oid,
                                                    note=f"طلب موقع #{number}", created_at=created))
        discount, coupon_id = 0.0, None
        if code:  # checkout.coupon_discount
            c = coupons[code]
            assert subtotal >= c["min_order_amount"] and (c["max_uses"] is None or c["used_count"] < c["max_uses"])
            raw = subtotal * (c["discount_value"] / 100) if c["discount_type"] == "percentage" else c["discount_value"]
            discount, coupon_id = round(min(raw, subtotal), 2), c["id"]
            c["used_count"] += 1
        fee = shipping_fees[city]  # checkout.city_fee (active rate required)
        if subtotal - discount >= FREE_SHIPPING_THRESHOLD:
            fee = 0.0
        total = round(subtotal - discount + fee, 2)  # checkout.Totals.total
        rows["orders"].append(dict(id=oid, order_number=number, customer_id=cust,
                                   customer_name=next(c[1] for c in CUSTOMERS if c[0] == cust),
                                   customer_phone=next(c[2] for c in CUSTOMERS if c[0] == cust),
                                   shipping_address=address, city=city, status=status, payment_method="cash_on_delivery",
                                   subtotal=subtotal, coupon_id=coupon_id, discount_amount=discount, shipping_fee=fee,
                                   total_amount=total, note=None, client_ip_hash=None, created_at=created, updated_at=updated))
        rows["order_items"] += items
        rows["finance_entries"].append(dict(id=f"{oid}_income", type="income", category="مبيعات الموقع", amount=total,
                                            description=f"طلب موقع #{number}", reference_id=oid, source="website",
                                            entry_date=created, created_at=created))
    rows["coupons"] = list(coupons.values())

    b2b = {c[0]: c for c in B2B_CUSTOMERS}
    rows["b2b_customers"] = [dict(id=i, name=n, phone=None, discount_percentage=d, notes=nt, created_at=T0)
                             for i, n, d, nt in B2B_CUSTOMERS]
    for oid, cust, extra, lines, created in B2B_ORDERS:
        combined = min(100, b2b[cust][2] + extra)  # routers/b2b.create_order
        total = 0.0
        for n, (pid, qty) in enumerate(lines, 1):
            line_total = price[pid] * qty * (1 - combined / 100)
            total += line_total
            rows["b2b_order_items"].append(dict(id=f"{oid}_item{n}", order_id=oid, product_id=pid, quantity=qty,
                                                unit_price=price[pid], discount_percentage=combined, line_total=line_total))
            stock[pid] -= qty
            assert stock[pid] >= 0
            rows["inventory_movements"].append(dict(id=f"{oid}_mv{n}", product_id=pid, type="b2b_sale", quantity_change=-qty,
                                                    reference_id=oid, note=f"B2B order to {b2b[cust][1]}", created_at=created))
        rows["b2b_orders"].append(dict(id=oid, customer_id=cust, total_amount=total, note=None, created_at=created,
                                       extra_discount_percentage=extra))
        rows["finance_entries"].append(dict(id=f"{oid}_income", type="income", category="مبيعات جملة B2B", amount=total,
                                            description=f"أوردر B2B — {b2b[cust][1]}", reference_id=oid, source="b2b",
                                            entry_date=created, created_at=created))

    rows["products"] = [dict(id=pid, name=n, category_id=cat, sku=sku, sale_price=sp, quantity=stock[pid],
                             low_stock_threshold=10, is_active=True, image_key=None, description=desc,
                             created_at=T0, updated_at=T0) for pid, n, cat, sku, sp, desc in PRODUCTS]
    for rid, rname, desc, pids in ROUTINES:
        rows["routines"].append(dict(id=rid, name=rname, description=desc, is_active=True, created_at=T0))
        rows["routine_items"] += [dict(id=f"{rid}_item{i}", routine_id=rid, product_id=pid, position=i) for i, pid in enumerate(pids)]
    rows["featured_products"] = [dict(position=i, product_id=pid, created_at=T0) for i, pid in enumerate(FEATURED_PRODUCTS, 1)]
    rows["featured_routines"] = [dict(position=i, routine_id=rid, created_at=T0) for i, rid in enumerate(FEATURED_ROUTINES, 1)]
    return rows


INSERT_ORDER = ["categories", "products", "inventory_movements", "offers", "coupons", "customers", "orders",
                "order_items", "finance_entries", "b2b_customers", "b2b_orders", "b2b_order_items",
                "routines", "routine_items", "featured_products", "featured_routines"]


def insert(cur, table: str, rows: list[dict]) -> int:
    n = 0
    for r in rows:
        cols = list(r)
        cur.execute(f'INSERT INTO public."{table}" ({", ".join(cols)}) VALUES ({", ".join(["%s"] * len(cols))}) '
                    "ON CONFLICT DO NOTHING", [r[c] for c in cols])
        n += cur.rowcount
    return n


def one(cur, sql, *args):
    cur.execute(sql, args)
    return cur.fetchone()[0]


def validate(cur, plan: dict, preserved_before: dict, revision_before: str, expect_exact: bool) -> list[str]:
    """Returns the failures (empty = valid)."""
    fail = []
    # 1. every foreign key resolves
    cur.execute("""SELECT c.conrelid::regclass::text, a.attname, c.confrelid::regclass::text, af.attname
                   FROM pg_constraint c JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=c.conkey[1]
                   JOIN pg_attribute af ON af.attrelid=c.confrelid AND af.attnum=c.confkey[1]
                   WHERE c.contype='f' AND c.connamespace='public'::regnamespace""")
    for child, col, parent, pcol in cur.fetchall():
        n = one(cur, f"SELECT count(*) FROM {child} x WHERE x.{col} IS NOT NULL AND NOT EXISTS (SELECT 1 FROM {parent} p WHERE p.{pcol} = x.{col})")
        if n:
            fail.append(f"{n} orphan {child}.{col}")
    # 2. every seed row exists with its id
    for table, rows in plan.items():
        if table.startswith("featured"):
            continue
        ids = [r["id"] for r in rows]
        if one(cur, f'SELECT count(*) FROM public."{table}" WHERE id = ANY(%s)', ids) != len(ids):
            fail.append(f"{table}: seed rows missing (a non-seed row may hold the same unique value)")
    # 3. whole-table counts after a reset = exactly the demo dataset
    if expect_exact:
        for table, rows in plan.items():
            if table == "customers":
                n = one(cur, "SELECT count(*) FROM customers WHERE hashed_password IS NULL")
            else:
                n = one(cur, f'SELECT count(*) FROM public."{table}"')
            if n != len(rows):
                fail.append(f"{table}: {n} rows, expected {len(rows)}")
        for table in ("reviews", "free_distributions", "free_distribution_items", "auth_throttle"):
            if one(cur, f'SELECT count(*) FROM public."{table}"'):
                fail.append(f"{table} not empty")
    # 4. stock = sum of movements, never negative
    n = one(cur, """SELECT count(*) FROM products p WHERE p.quantity < 0 OR p.quantity <>
                    coalesce((SELECT sum(quantity_change) FROM inventory_movements m WHERE m.product_id=p.id), 0)""")
    if n:
        fail.append(f"{n} products whose stock differs from their movements")
    # 5. order arithmetic, a movement per line, and one income entry per order
    checks = {
        "order subtotal = Σ lines": """SELECT count(*) FROM orders o WHERE abs(o.subtotal - coalesce((SELECT sum(line_total) FROM order_items i WHERE i.order_id=o.id), 0)) > 0.005""",
        "line total = unit × qty": "SELECT count(*) FROM order_items WHERE abs(line_total - unit_price*quantity) > 0.005",
        "order total = subtotal − discount + shipping": "SELECT count(*) FROM orders WHERE abs(total_amount - round((subtotal - discount_amount + shipping_fee)::numeric, 2)) > 0.005",
        "website sale movement per line": """SELECT count(*) FROM order_items i JOIN orders o ON o.id=i.order_id WHERE NOT EXISTS (SELECT 1 FROM inventory_movements m
              WHERE m.reference_id=o.id AND m.product_id=i.product_id AND m.type='website_sale' AND m.quantity_change=-i.quantity)""",
        "income entry = order total": """SELECT count(*) FROM orders o WHERE (SELECT count(*) FROM finance_entries f WHERE f.reference_id=o.id AND f.type='income'
              AND f.source='website' AND abs(f.amount - o.total_amount) < 0.005) <> 1""",
        "coupon used_count = live orders using it": """SELECT count(*) FROM coupons c WHERE c.used_count <> (SELECT count(*) FROM orders o WHERE o.coupon_id=c.id AND o.status <> 'cancelled')""",
        "b2b total = Σ lines": """SELECT count(*) FROM b2b_orders b WHERE abs(b.total_amount - coalesce((SELECT sum(line_total) FROM b2b_order_items i WHERE i.order_id=b.id), 0)) > 0.005""",
        "b2b sale movement per line": """SELECT count(*) FROM b2b_order_items i WHERE NOT EXISTS (SELECT 1 FROM inventory_movements m
              WHERE m.reference_id=i.order_id AND m.product_id=i.product_id AND m.type='b2b_sale' AND m.quantity_change=-i.quantity)""",
        "b2b income entry = order total": """SELECT count(*) FROM b2b_orders b WHERE (SELECT count(*) FROM finance_entries f WHERE f.reference_id=b.id AND f.type='income'
              AND f.source='b2b' AND abs(f.amount - b.total_amount) < 0.005) <> 1""",
        "one active offer per product, below its price": """SELECT count(*) FROM (SELECT o.product_id FROM offers o JOIN products p ON p.id=o.product_id
              WHERE o.is_active AND (o.offer_price >= p.sale_price) UNION ALL SELECT product_id FROM offers WHERE is_active GROUP BY 1 HAVING count(*) > 1) x""",
        "featured items sellable": """SELECT (SELECT count(*) FROM featured_products f JOIN products p ON p.id=f.product_id WHERE NOT p.is_active OR p.quantity <= 0)
              + (SELECT count(*) FROM featured_routines f JOIN routines r ON r.id=f.routine_id WHERE NOT r.is_active)""",
        "order cities have an active shipping rate": """SELECT count(*) FROM orders o WHERE NOT EXISTS (SELECT 1 FROM shipping_rates s WHERE s.city=o.city AND s.is_active)""",
    }
    for label, sql in checks.items():
        n = one(cur, sql)
        if n:
            fail.append(f"{label}: {n} violations")
    # 6. preserved tables byte-for-byte unchanged, revision unchanged
    after = common.table_checksums(cur, [("public", t) for t in PRESERVED])
    for k, v in preserved_before.items():
        if after[k] != v:
            fail.append(f"preserved table changed: {k}")
    if one(cur, "SELECT version_num FROM alembic_version") != revision_before:
        fail.append("alembic revision changed")
    return fail


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--mode", choices=["reset-seed", "seed"], required=True)
    ap.add_argument("--dsn", help="isolated local database only (127.0.0.1/localhost)")
    ap.add_argument("--env", default=common.DEFAULT_ENV)
    ap.add_argument("--expect-manifest", help="backup manifest.json; required for reset-seed")
    ap.add_argument("--execute", action="store_true", help="COMMIT (otherwise everything is rolled back)")
    a = ap.parse_args()

    if a.dsn:
        host = dict(kv.split("=", 1) for kv in a.dsn.split()).get("host") if "://" not in a.dsn else urlparse(a.dsn).hostname
        if host not in ("127.0.0.1", "localhost"):
            raise SystemExit("--dsn is only for an isolated local database")
        import psycopg2
        conn, target = psycopg2.connect(a.dsn, application_name="ecobel-demo-reset"), f"LOCAL {host}"
    else:
        url = common.database_url(a.env)
        common.assert_target(url)
        conn, target = common.connect(url), f"SUPABASE {common.PROJECT_REF}"
    if a.mode == "reset-seed" and not a.expect_manifest:
        raise SystemExit("reset-seed needs --expect-manifest (the verified backup taken just before)")

    cur = conn.cursor()
    cur.execute("SET lock_timeout = '15s'; SET statement_timeout = '120s'")
    cur.execute("SELECT current_database(), current_user, (SELECT version_num FROM alembic_version)")
    dbname, role, revision = cur.fetchone()
    print(f"target: {target} | database {dbname} | role {role} | revision {revision} | mode {a.mode} | {'EXECUTE' if a.execute else 'DRY RUN'}")

    tables = [t for _, t in common.public_tables(cur)]
    cur.execute("LOCK TABLE " + ", ".join(f'public."{t}"' for t in tables) + " IN ACCESS EXCLUSIVE MODE")
    before = common.table_checksums(cur, [("public", t) for t in tables])
    if a.expect_manifest:
        man = json.load(open(a.expect_manifest, encoding="utf-8"))["tables"]
        drift = [k for k, v in before.items() if man.get(k) != v]
        if drift:
            conn.rollback()
            raise SystemExit(f"ABORT: data changed since the backup in {drift} — take a fresh backup first. Nothing was changed.")
        print(f"backup manifest matches the live data in all {len(before)} tables (under lock)")
    preserved_before = {f"public.{t}": before[f"public.{t}"] for t in PRESERVED}

    cur.execute("SELECT city, fee FROM shipping_rates WHERE is_active")
    fees = dict(cur.fetchall())
    plan = build_plan(fees)

    deleted = {}
    if a.mode == "reset-seed":
        for table, where in RESET_DELETES:
            cond = f" WHERE {where}" if where else ""
            expected = one(cur, f'SELECT count(*) FROM public."{table}"{cond}')
            cur.execute(f'DELETE FROM public."{table}"{cond}')
            if cur.rowcount != expected:
                conn.rollback()
                raise SystemExit(f"ABORT: {table} deleted {cur.rowcount}, expected {expected}. Rolled back.")
            deleted[table] = cur.rowcount
    inserted = {t: insert(cur, t, plan[t]) for t in INSERT_ORDER}

    failures = validate(cur, plan, preserved_before, revision, expect_exact=a.mode == "reset-seed")
    if failures:
        conn.rollback()
        print("VALIDATION FAILED — rolled back, nothing changed:")
        for f in failures:
            print("  -", f)
        sys.exit(1)
    if deleted:
        print("deleted:", ", ".join(f"{t} {n}" for t, n in deleted.items()))
    print("inserted:", ", ".join(f"{t} {n}" for t, n in inserted.items()))
    print("all validations passed")
    if a.execute:
        conn.commit()
        print("COMMITTED")
    else:
        conn.rollback()
        print("dry run — rolled back")
    conn.close()


if __name__ == "__main__":
    main()
