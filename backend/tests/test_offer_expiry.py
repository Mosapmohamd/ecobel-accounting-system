"""Offer end dates follow the Cairo calendar day.

An admin who picks 15 October as an offer's last day means "through the
whole of 15 October in Egypt". The offer is stored with the exclusive end
instant (the start of 16 October, Cairo) and is running while now < end.
"""
import os
import sys
import tempfile
from datetime import date, datetime, timedelta, timezone

if "app.database" not in sys.modules:
    os.environ["DATABASE_URL"] = f"sqlite:///{os.path.join(tempfile.mkdtemp(), 'test.db')}"
    os.environ.pop("SECRET_KEY", None)

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app import auth, cairo_time, models  # noqa: E402
from app.database import SessionLocal  # noqa: E402
from app.main import app  # noqa: E402

client = TestClient(app)
H = {"Authorization": f"Bearer {auth.create_access_token({'sub': 'expiry_staff'})}"}
UTC = timezone.utc


def utc(*args):
    return datetime(*args, tzinfo=UTC)


@pytest.fixture(scope="module", autouse=True)
def seed():
    db = SessionLocal()
    db.add(models.User(username="expiry_staff", hashed_password=auth.hash_password("x")))
    db.add(models.Category(id="ex_cat", name="فئة انتهاء العروض"))
    for pid in ("ex_p1", "ex_p2", "ex_p3", "ex_p4", "ex_p5"):
        db.add(models.Product(id=pid, name=pid, category_id="ex_cat", sale_price=100, quantity=5))
    db.commit()
    db.close()


@pytest.fixture
def clock(monkeypatch):
    """Set the clock the offer rules use."""
    def set_now(instant):
        monkeypatch.setattr(cairo_time, "now_utc", lambda: instant)
    return set_now


# ---------------------------------------------------------------- the rule itself
@pytest.mark.parametrize("day,end", [
    (date(2026, 10, 15), utc(2026, 10, 15, 21)),  # summer time, UTC+3
    (date(2026, 12, 15), utc(2026, 12, 15, 22)),  # winter time, UTC+2
    (date(2026, 4, 23), utc(2026, 4, 23, 22)),    # next midnight skipped (clocks 00:00 → 01:00 on 24 Apr)
    (date(2026, 10, 29), utc(2026, 10, 29, 22)),  # 23:00 repeats that night; the date changes after it
])
def test_a_date_ends_when_the_next_cairo_day_starts(day, end):
    assert cairo_time.end_of_cairo_day(day) == end
    assert cairo_time.last_cairo_day(end) == day
    assert cairo_time.is_end_of_cairo_day(end)
    last_second = end - timedelta(seconds=1)
    assert last_second.astimezone(cairo_time.CAIRO).date() == day  # 23:59:59 Cairo on the chosen day
    assert cairo_time.not_ended(end, now=last_second)
    assert not cairo_time.not_ended(end, now=end)                  # exactly midnight → ended


def test_no_end_date_never_ends():
    assert cairo_time.not_ended(None, now=utc(2099, 1, 1))


# ---------------------------------------------------------------- through the admin API
def create(product_id, expires_at=None, **extra):
    body = {"product_id": product_id, "title": "عرض الصيف", "offer_price": 80, **extra}
    if expires_at is not None:
        body["expires_at"] = expires_at
    return client.post("/offers/", json=body, headers=H)


def listed(offer_id):
    return next(o for o in client.get("/offers/", headers=H).json() if o["id"] == offer_id)


def test_date_only_end_runs_through_the_whole_cairo_day(clock):
    clock(utc(2026, 10, 1))
    res = create("ex_p1", "2026-10-15")
    assert res.status_code == 201
    o = res.json()
    assert o["expires_at"].startswith("2026-10-15T21:00:00")
    assert o["ends_on"] == "2026-10-15" and o["ends_at_day_end"] is True

    clock(utc(2026, 10, 15, 20, 59, 59))  # 23:59:59 on 15 Oct, Cairo
    assert listed(o["id"])["is_running"] is True
    clock(utc(2026, 10, 15, 21))          # 00:00 on 16 Oct, Cairo
    assert listed(o["id"])["is_running"] is False


def test_explicit_timestamp_is_kept_as_given(clock):
    clock(utc(2026, 10, 1))
    o = create("ex_p2", "2026-10-15T10:30:00+00:00").json()
    assert o["expires_at"].startswith("2026-10-15T10:30:00")
    assert o["ends_on"] == "2026-10-15" and o["ends_at_day_end"] is False
    clock(utc(2026, 10, 15, 10, 29, 59))
    assert listed(o["id"])["is_running"] is True
    clock(utc(2026, 10, 15, 10, 30))
    assert listed(o["id"])["is_running"] is False


def test_paused_offer_is_never_running(clock):
    clock(utc(2026, 10, 1))
    o = create("ex_p3", "2026-12-31").json()
    assert client.patch(f"/offers/{o['id']}", json={"is_active": False}, headers=H).status_code == 200
    assert listed(o["id"])["is_running"] is False


def test_editing_the_end_date_uses_the_same_rule(clock):
    clock(utc(2026, 10, 1))
    o = create("ex_p4").json()
    assert o["expires_at"] is None and o["ends_on"] is None and o["is_running"] is True
    res = client.patch(f"/offers/{o['id']}", json={"expires_at": "2026-12-15"}, headers=H)
    assert res.status_code == 200 and res.json()["expires_at"].startswith("2026-12-15T22:00:00")


def test_offer_blocks_a_new_one_until_its_cairo_day_is_over(clock):
    clock(utc(2026, 10, 1))
    assert create("ex_p5", "2026-10-15").status_code == 201
    clock(utc(2026, 10, 15, 20, 59, 59))  # still the 15th in Cairo → still running
    assert create("ex_p5", "2026-11-30", title="عرض تاني").status_code == 400
    clock(utc(2026, 10, 15, 21))          # the 16th in Cairo → ended, a new offer is allowed
    assert create("ex_p5", "2026-11-30", title="عرض تاني").status_code == 201


# ---------------------------------------------------------------- end dates saved before this rule
# Two shapes exist in real data and are kept exactly as stored (their
# intent can't be told apart from an explicit time, so nothing guesses):
#   * the old admin date picker sent the picked date at 00:00:00 UTC;
#   * imported offers end at 23:59:59 UTC.
LEGACY = {
    "ex_old_picker": utc(2026, 10, 31, 0, 0, 0),
    "ex_imported": utc(2026, 11, 20, 23, 59, 59),
}


@pytest.fixture(scope="module", autouse=True)
def seed_legacy(seed):
    db = SessionLocal()
    for oid, end in LEGACY.items():
        db.add(models.Product(id=f"p_{oid}", name=oid, category_id="ex_cat", sale_price=100, quantity=5))
        db.add(models.Offer(id=oid, product_id=f"p_{oid}", title="عرض قديم", offer_price=80, expires_at=end))
    db.commit()
    db.close()


def stored_end(oid):
    db = SessionLocal()
    try:
        return cairo_time.as_utc(db.get(models.Offer, oid).expires_at)
    finally:
        db.close()


@pytest.mark.parametrize("oid,ends_on", [("ex_old_picker", "2026-10-31"), ("ex_imported", "2026-11-21")])
def test_saved_end_times_keep_their_exact_meaning(clock, oid, ends_on):
    end = LEGACY[oid]
    o = listed(oid)
    assert o["ends_at_day_end"] is False and o["ends_on"] == ends_on  # shown as date + time in the admin
    clock(end - timedelta(seconds=1))
    assert listed(oid)["is_running"] is True
    clock(end)
    assert listed(oid)["is_running"] is False


def test_unrelated_edits_never_reinterpret_a_saved_end(clock):
    clock(utc(2026, 10, 1))
    for oid in LEGACY:
        assert client.patch(f"/offers/{oid}", json={"is_active": False}, headers=H).status_code == 200
        assert client.patch(f"/offers/{oid}", json={"is_active": True}, headers=H).status_code == 200
        assert client.patch(f"/offers/{oid}", json={"title": "عرض قديم بعنوان جديد"}, headers=H).status_code == 200
        assert stored_end(oid) == LEGACY[oid]


def test_offer_without_end_date_runs_until_paused(clock):
    db = SessionLocal()
    db.add(models.Product(id="p_no_end", name="p_no_end", category_id="ex_cat", sale_price=100, quantity=5))
    db.commit()
    db.close()
    clock(utc(2026, 10, 1))
    o = create("p_no_end").json()
    assert o["expires_at"] is None and o["ends_on"] is None and o["ends_at_day_end"] is False
    clock(utc(2099, 1, 1))
    assert listed(o["id"])["is_running"] is True
    client.patch(f"/offers/{o['id']}", json={"is_active": False}, headers=H)
    assert listed(o["id"])["is_running"] is False
