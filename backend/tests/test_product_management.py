"""Product management — editing (incl. short/full descriptions), archive
instead of delete, staff-only access, and the additional-photo gallery
(add, main photo, order, replace, remove, safe file deletion). Storage is an
in-memory stand-in. Throwaway SQLite DB (tests/conftest.py).
"""
import io

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app import auth, models, product_images
from app.database import SessionLocal
from app.main import app

client = TestClient(app)
H = {"Authorization": f"Bearer {auth.create_access_token({'sub': 'pm_staff'})}"}
CUSTOMER = {"Authorization": f"Bearer {auth.create_access_token({'sub': 'cust_1', 'type': 'customer'})}"}


class MemoryStorage:
    def __init__(self):
        self.objects: dict[str, bytes] = {}
        # Runs while a file is "uploading" — lets a test commit another
        # request's change in exactly that window.
        self.during_upload = None

    def upload(self, key, data, content_type):
        assert key not in self.objects, "keys are never overwritten"
        self.objects[key] = data
        if self.during_upload:
            hook, self.during_upload = self.during_upload, None
            hook()

    def delete(self, keys):
        for k in keys:
            self.objects.pop(k, None)

    def list_keys(self, prefix="products/"):
        return [k for k in self.objects if k.startswith(prefix)]


storage = MemoryStorage()


@pytest.fixture(scope="module", autouse=True)
def seed():
    app.dependency_overrides[product_images.get_storage] = lambda: storage
    db = SessionLocal()
    db.add(models.User(username="pm_staff", hashed_password=auth.hash_password("x")))
    db.add_all([models.Category(id="pm_cat", name="فئة الإدارة"), models.Category(id="pm_cat2", name="فئة تانية")])
    db.add_all([
        models.Product(id="pm1", name="Serum", category_id="pm_cat", sale_price=100, quantity=5, description="قديم"),
        models.Product(id="pm_hist", name="Sold Before", category_id="pm_cat", sale_price=50, quantity=3),
    ])
    db.flush()
    db.add(models.InventoryMovement(product_id="pm_hist", type=models.MovementType.restock, quantity_change=3))
    db.commit()
    db.close()
    yield
    app.dependency_overrides.pop(product_images.get_storage, None)


def png(color=(181, 86, 107)):
    buf = io.BytesIO()
    Image.new("RGB", (400, 400), color).save(buf, format="PNG")
    return buf.getvalue()


def new_product(pid):
    db = SessionLocal()
    db.add(models.Product(id=pid, name=f"Gallery {pid}", category_id="pm_cat", sale_price=10, quantity=1))
    db.commit()
    db.close()


def add_photo(pid, headers=H):
    return client.post(f"/products/{pid}/images", files={"file": ("p.png", png(), "image/png")}, headers=headers)


def row(pid):
    db = SessionLocal()
    try:
        p = db.get(models.Product, pid)
        return p.image_key, [(i.id, i.image_key, i.position) for i in p.images], p.is_active
    finally:
        db.close()


# ---------------- Editing ----------------
def test_edit_updates_every_editable_field_including_both_descriptions():
    res = client.patch("/products/pm1", headers=H, json={
        "name": "  Glow Serum ", "category_id": "pm_cat2", "sale_price": 120, "low_stock_threshold": 2,
        "short_description": " سيروم خفيف بيرطّب البشرة. ",
        "description": "## المميزات\r\n- ترطيب عميق\r\n- امتصاص سريع\r\n\r\nفقرة تانية",
    })
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["name"] == "Glow Serum" and body["category_id"] == "pm_cat2" and body["category_name"] == "فئة تانية"
    assert body["sale_price"] == 120 and body["low_stock_threshold"] == 2
    assert body["short_description"] == "سيروم خفيف بيرطّب البشرة."
    assert body["description"] == "## المميزات\n- ترطيب عميق\n- امتصاص سريع\n\nفقرة تانية"
    assert client.get("/products/pm1", headers=H).json()["short_description"] == "سيروم خفيف بيرطّب البشرة."


def test_clearing_a_description_stores_null():
    res = client.patch("/products/pm1", headers=H, json={"short_description": "   "})
    assert res.status_code == 200 and res.json()["short_description"] is None


@pytest.mark.parametrize("payload,status", [
    ({"name": "   "}, 422),
    ({"short_description": "x" * 401}, 422),
    ({"description": "x" * 8001}, 422),
    ({"sale_price": -1}, 422),
    ({"category_id": "missing"}, 404),
])
def test_edit_validation(payload, status):
    assert client.patch("/products/pm1", headers=H, json=payload).status_code == status


def test_create_accepts_descriptions():
    res = client.post("/products/", headers=H, json={
        "name": "New One", "category_id": "pm_cat", "sale_price": 10, "quantity": 0,
        "short_description": "قصير", "description": "طويل",
    })
    assert res.status_code == 201, res.text
    assert res.json()["short_description"] == "قصير" and res.json()["images"] == []


# ---------------- Access control ----------------
@pytest.mark.parametrize("method,path,kwargs", [
    ("patch", "/products/pm1", {"json": {"name": "Hacked"}}),
    ("delete", "/products/pm1", {}),
    ("post", "/products/pm1/images", {"files": {"file": ("p.png", b"x", "image/png")}}),
    ("put", "/products/pm1/images/order", {"json": {"image_ids": []}}),
    ("put", "/products/pm1/images/any", {"files": {"file": ("p.png", b"x", "image/png")}}),
    ("delete", "/products/pm1/images/any", {}),
    ("post", "/products/pm1/images/any/primary", {}),
    ("get", "/products/?status=archived", {}),
])
@pytest.mark.parametrize("headers", [{}, CUSTOMER], ids=["anonymous", "customer-token"])
def test_product_changes_are_staff_only(method, path, kwargs, headers):
    assert getattr(client, method)(path, headers=headers, **kwargs).status_code == 401
    assert row("pm1")[2] is True  # nothing changed


# ---------------- Archive (the safe "delete") ----------------
def test_delete_archives_and_keeps_history_and_can_be_restored():
    assert client.delete("/products/pm_hist", headers=H).status_code == 204
    db = SessionLocal()
    try:
        p = db.get(models.Product, "pm_hist")
        assert p is not None and p.is_active is False  # row kept
        assert db.query(models.InventoryMovement).filter_by(product_id="pm_hist").count() == 1  # history untouched
    finally:
        db.close()
    active = {p["id"] for p in client.get("/products/", headers=H).json()}
    archived = {p["id"] for p in client.get("/products/?status=archived", headers=H).json()}
    assert "pm_hist" not in active and "pm_hist" in archived
    assert "pm_hist" in {p["id"] for p in client.get("/products/?status=all", headers=H).json()}
    res = client.patch("/products/pm_hist", headers=H, json={"is_active": True})
    assert res.status_code == 200 and res.json()["is_active"] is True
    assert client.delete("/products/missing", headers=H).status_code == 404


# ---------------- Gallery ----------------
def test_first_photo_becomes_main_then_additional_photos_append_in_order():
    new_product("g1")
    res = add_photo("g1")
    assert res.status_code == 200, res.text
    main, images, _ = row("g1")
    assert main and images == []
    add_photo("g1"), add_photo("g1")
    main2, images, _ = row("g1")
    assert main2 == main and [pos for _, _, pos in images] == [0, 1]
    body = client.get("/products/g1", headers=H).json()
    assert [i["id"] for i in body["images"]] == [i for i, _, _ in images]
    assert all(k in storage.objects for k in [main] + [k for _, k, _ in images])


def test_make_primary_swaps_without_copying_or_deleting_files():
    new_product("g2")
    add_photo("g2"), add_photo("g2")
    main, [(img_id, extra, _)], _ = row("g2")
    files_before = set(storage.objects)
    res = client.post(f"/products/g2/images/{img_id}/primary", headers=H)
    assert res.status_code == 200, res.text
    main2, [(img_id2, extra2, _)], _ = row("g2")
    assert (main2, extra2, img_id2) == (extra, main, img_id)
    assert set(storage.objects) == files_before


def test_reorder_requires_exactly_the_current_photos():
    new_product("g3")
    for _ in range(4):
        add_photo("g3")
    _, images, _ = row("g3")
    ids = [i for i, _, _ in images]
    assert client.put("/products/g3/images/order", headers=H, json={"image_ids": ids[::-1]}).status_code == 200
    assert [i for i, _, _ in row("g3")[1]] == ids[::-1]
    for bad in (ids[:-1], ids + ids[:1], ids[:-1] + ["foreign"]):
        assert client.put("/products/g3/images/order", headers=H, json={"image_ids": bad}).status_code == 400
    assert [i for i, _, _ in row("g3")[1]] == ids[::-1]


def test_replace_keeps_position_and_removes_the_old_file():
    new_product("g4")
    add_photo("g4"), add_photo("g4"), add_photo("g4")
    _, images, _ = row("g4")
    img_id, old_key, pos = images[1]
    res = client.put(f"/products/g4/images/{img_id}", headers=H, files={"file": ("n.png", png((10, 20, 30)), "image/png")})
    assert res.status_code == 200, res.text
    _, after, _ = row("g4")
    assert after[1][0] == img_id and after[1][2] == pos and after[1][1] != old_key
    assert old_key not in storage.objects and after[1][1] in storage.objects


def test_remove_additional_photo_renumbers_and_deletes_its_file():
    new_product("g5")
    for _ in range(4):
        add_photo("g5")
    _, images, _ = row("g5")
    img_id, key, _ = images[1]
    assert client.delete(f"/products/g5/images/{img_id}", headers=H).status_code == 200
    _, after, _ = row("g5")
    assert [i for i, _, _ in after] == [images[0][0], images[2][0]] and [p for _, _, p in after] == [0, 1]
    assert key not in storage.objects


def test_removing_the_main_photo_promotes_the_first_additional_one():
    new_product("g6")
    add_photo("g6"), add_photo("g6"), add_photo("g6")
    main, images, _ = row("g6")
    assert client.delete("/products/g6/image", headers=H).status_code == 200
    main2, after, _ = row("g6")
    assert main2 == images[0][1] and [k for _, k, _ in after] == [images[1][1]]
    assert main not in storage.objects


def test_a_file_still_referenced_elsewhere_is_never_deleted():
    new_product("g7")
    new_product("g7b")
    add_photo("g7"), add_photo("g7")
    _, [(img_id, shared_key, _)], _ = row("g7")
    db = SessionLocal()
    db.get(models.Product, "g7b").image_key = shared_key  # e.g. set by hand in the database
    db.commit()
    db.close()
    assert client.delete(f"/products/g7/images/{img_id}", headers=H).status_code == 200
    assert shared_key in storage.objects


def test_photo_limit_and_unknown_ids():
    new_product("g8")
    for _ in range(models.PRODUCT_IMAGES_MAX + 1):
        assert add_photo("g8").status_code == 200
    res = add_photo("g8")
    assert res.status_code == 400 and "للحد الأقصى" in res.json()["detail"]
    assert len(row("g8")[1]) == models.PRODUCT_IMAGES_MAX
    _, [(other_id, _, _)], _ = row("g2")
    assert client.delete(f"/products/g8/images/{other_id}", headers=H).status_code == 404  # another product's photo
    assert client.post("/products/g8/images/nope/primary", headers=H).status_code == 404
    assert add_photo("missing").status_code == 404


def test_invalid_upload_is_rejected_and_nothing_stored():
    new_product("g9")
    before = set(storage.objects)
    res = client.post("/products/g9/images", headers=H, files={"file": ("p.png", b"not an image" * 20, "image/png")})
    assert res.status_code == 400
    assert set(storage.objects) == before and row("g9")[:2] == (None, [])


def test_find_orphans_counts_additional_photos_as_referenced():
    new_product("g10")
    add_photo("g10"), add_photo("g10")
    storage.objects["products/g10/stale.png"] = b"x"
    db = SessionLocal()
    try:
        orphans = product_images.find_orphans(db, storage)
    finally:
        db.close()
    assert orphans == ["products/g10/stale.png"]
    storage.objects.pop("products/g10/stale.png")


# ---------------- Null fields (regression: used to answer 500) ----------------
@pytest.mark.parametrize("field", ["name", "category_id", "sale_price", "low_stock_threshold", "is_active"])
def test_null_for_a_required_field_is_a_422_and_changes_nothing(field):
    before = client.get("/products/pm1", headers=H).json()
    res = client.patch("/products/pm1", headers=H, json={field: None})
    assert res.status_code == 422, res.text
    assert res.json()["detail"][0]["loc"][-1] == field
    assert client.get("/products/pm1", headers=H).json() == before


def test_nullable_fields_accept_null_and_omitted_fields_are_kept():
    client.patch("/products/pm1", headers=H, json={"sku": "PM-SKU", "short_description": "قصير"})
    res = client.patch("/products/pm1", headers=H, json={"sku": None, "short_description": None})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["sku"] is None and body["short_description"] is None
    assert body["name"] and body["is_active"] is True  # untouched


# ---------------- Concurrency: another request commits during this upload ----------------
def _fill_gallery_to_the_limit(pid):
    db = SessionLocal()
    have = db.query(models.ProductImage).filter_by(product_id=pid).count()
    for n in range(have, models.PRODUCT_IMAGES_MAX):
        key = f"products/{pid}/concurrent{n}.png"
        storage.objects[key] = b"x"
        db.add(models.ProductImage(product_id=pid, image_key=key, position=n))
    db.commit()
    db.close()


def test_limit_holds_when_other_uploads_finish_during_this_one():
    new_product("c1")
    add_photo("c1")  # main photo
    add_photo("c1")  # 1 additional
    before = set(storage.objects)
    storage.during_upload = lambda: _fill_gallery_to_the_limit("c1")
    res = add_photo("c1")
    assert res.status_code == 400 and "للحد الأقصى" in res.json()["detail"]
    _, images, _ = row("c1")
    assert len(images) == models.PRODUCT_IMAGES_MAX  # never 9
    # this request's file was removed again — no orphan
    assert set(storage.objects) - before == {f"products/c1/concurrent{n}.png" for n in range(1, models.PRODUCT_IMAGES_MAX)}


def test_first_photo_race_never_overwrites_the_other_main_photo():
    new_product("c2")
    other_main = "products/c2/other-request-main.png"

    def other_request_sets_main():
        storage.objects[other_main] = b"x"
        db = SessionLocal()
        db.get(models.Product, "c2").image_key = other_main
        db.commit()
        db.close()

    storage.during_upload = other_request_sets_main
    assert add_photo("c2").status_code == 200
    main, images, _ = row("c2")
    assert main == other_main  # kept, not overwritten
    assert len(images) == 1 and images[0][1] in storage.objects  # this upload became an additional photo


def test_replacing_a_photo_removed_meanwhile_is_404_without_an_orphan():
    new_product("c3")
    add_photo("c3"), add_photo("c3")
    _, [(img_id, _, _)], _ = row("c3")

    def other_request_removes_it():
        db = SessionLocal()
        db.query(models.ProductImage).filter_by(id=img_id).delete()
        db.commit()
        db.close()

    before = set(storage.objects)
    storage.during_upload = other_request_removes_it
    res = client.put(f"/products/c3/images/{img_id}", headers=H, files={"file": ("n.png", png((1, 2, 3)), "image/png")})
    assert res.status_code == 404
    assert set(storage.objects) == before


def test_gallery_changes_lock_the_product_row():
    """Every photo change reads the product FOR UPDATE (PostgreSQL row lock;
    SQLite ignores it, so the request itself is what's checked here)."""
    from sqlalchemy import event

    new_product("c4")
    add_photo("c4"), add_photo("c4"), add_photo("c4")
    _, images, _ = row("c4")
    locked = []

    def spy(state):
        if state.is_select and state.statement._for_update_arg is not None:
            locked.append(state.statement.column_descriptions[0]["entity"])

    from sqlalchemy.orm import Session
    event.listen(Session, "do_orm_execute", spy)
    try:
        calls = [
            lambda: add_photo("c4"),
            lambda: client.put("/products/c4/images/order", headers=H, json={"image_ids": [i for i, _, _ in row("c4")[1]][::-1]}),
            lambda: client.put(f"/products/c4/images/{images[0][0]}", headers=H, files={"file": ("n.png", png(), "image/png")}),
            lambda: client.post(f"/products/c4/images/{images[0][0]}/primary", headers=H),
            lambda: client.delete(f"/products/c4/images/{images[1][0]}", headers=H),
            lambda: client.post("/products/c4/image", headers=H, files={"file": ("m.png", png(), "image/png")}),
            lambda: client.delete("/products/c4/image", headers=H),
        ]
        for call in calls:
            locked.clear()
            res = call()
            assert res.status_code == 200, res.text
            assert models.Product in locked
    finally:
        event.remove(Session, "do_orm_execute", spy)


# ---------------- Row-lock waits stay off the event loop (regression) ----------------
def test_row_locks_are_never_taken_on_the_event_loop():
    """On PostgreSQL a FOR UPDATE wait blocks its thread. Taken on the event
    loop, it froze every request of that process — including the one holding
    the lock, which needed the loop to finish: a deadlock found by the
    PostgreSQL concurrency run. Every gallery change must lock off the loop."""
    import asyncio

    from sqlalchemy import event
    from sqlalchemy.orm import Session

    new_product("ev1")
    add_photo("ev1"), add_photo("ev1"), add_photo("ev1")
    _, images, _ = row("ev1")
    on_loop = []

    def spy(state):
        if state.is_select and state.statement._for_update_arg is not None:
            try:
                asyncio.get_running_loop()
                on_loop.append(True)
            except RuntimeError:
                on_loop.append(False)

    event.listen(Session, "do_orm_execute", spy)
    try:
        calls = [
            lambda: add_photo("ev1"),
            lambda: client.post("/products/ev1/image", headers=H, files={"file": ("m.png", png(), "image/png")}),
            lambda: client.put(f"/products/ev1/images/{images[0][0]}", headers=H, files={"file": ("n.png", png(), "image/png")}),
            lambda: client.put("/products/ev1/images/order", headers=H, json={"image_ids": [i for i, _, _ in row("ev1")[1]][::-1]}),
            lambda: client.post(f"/products/ev1/images/{images[0][0]}/primary", headers=H),
            lambda: client.delete(f"/products/ev1/images/{images[1][0]}", headers=H),
            lambda: client.delete("/products/ev1/images/missing-id", headers=H),  # 404 after locking
            lambda: client.delete("/products/ev1/image", headers=H),
        ]
        for call in calls:
            on_loop.clear()
            call()
            assert on_loop and not any(on_loop), "a row lock was taken on the event loop"
    finally:
        event.remove(Session, "do_orm_execute", spy)


def test_an_error_under_the_lock_ends_the_transaction_immediately():
    """The lock must not wait for the request's teardown to be released."""
    from fastapi import HTTPException

    from app.routers.products import _locked_product

    new_product("ev2")
    db = SessionLocal()
    try:
        with pytest.raises(HTTPException):
            with _locked_product(db, "ev2"):
                assert db.in_transaction()
                raise HTTPException(404, "gone")
        assert not db.in_transaction()
    finally:
        db.close()


# ---------------- Upload cleanup vs. committed rows (regression) ----------------
def test_cancellation_after_commit_never_deletes_the_committed_file():
    """If a cancellation surfaces after the change committed a row pointing
    at the new file, the file must stay (worst case: an orphan, never a
    product photo whose file is gone)."""
    import asyncio

    from app.routers.products import _apply_upload

    new_product("hx1")
    key = "products/hx1/committed.png"
    storage.objects[key] = b"x"

    def change():
        db = SessionLocal()
        db.get(models.Product, "hx1").image_key = key
        db.commit()
        db.close()
        raise asyncio.CancelledError()  # delivered only after the commit

    with pytest.raises(asyncio.CancelledError):
        asyncio.run(_apply_upload(storage, key, change))
    assert row("hx1")[0] == key and key in storage.objects


def test_an_ordinary_failure_still_removes_the_new_file():
    import asyncio

    from fastapi import HTTPException

    from app.routers.products import _apply_upload

    key = "products/hx2/rejected.png"
    storage.objects[key] = b"x"

    def change():
        raise HTTPException(400, "full")

    with pytest.raises(HTTPException):
        asyncio.run(_apply_upload(storage, key, change))
    assert key not in storage.objects
