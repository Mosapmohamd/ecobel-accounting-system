"""Calendar dates in the shop's own timezone, Africa/Cairo.

Admins pick dates ("the offer's last day is 15 October"); the database
stores instants (timestamptz). This module is the one place that turns a
Cairo calendar date into the instant it ends, using the real tz rules
(Egypt's summer time included) — never a fixed UTC offset.

`now_utc()` is the clock everything here uses, so tests can replace it.
"""
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

CAIRO = ZoneInfo("Africa/Cairo")


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def cairo_today(now: datetime | None = None) -> date:
    """Today's date in Cairo."""
    return (now or now_utc()).astimezone(CAIRO).date()


def end_of_cairo_day(day: date) -> datetime:
    """The exclusive end of `day` in Cairo — the instant the next Cairo
    calendar day starts — in UTC. Something valid "through `day`" is valid
    while now < this instant.

    On a summer-time change midnight can be skipped (24 Apr 2026: 00:00 →
    01:00) or follow a repeated hour (29 Oct 2026: 23:00 happens twice);
    the later of the two readings is the moment the new date really begins.
    """
    nxt = datetime.combine(day + timedelta(days=1), time(0), tzinfo=CAIRO)
    return max(nxt.replace(fold=f).astimezone(timezone.utc) for f in (0, 1))


def last_cairo_day(boundary: datetime) -> date:
    """The last Cairo calendar date before an exclusive end instant."""
    return (boundary - timedelta(microseconds=1)).astimezone(CAIRO).date()


def is_end_of_cairo_day(boundary: datetime) -> bool:
    """True when the instant is exactly the end of a Cairo calendar day
    (i.e. it was set from a date, not an explicit time)."""
    boundary = as_utc(boundary)
    return boundary == end_of_cairo_day(last_cairo_day(boundary))


def as_utc(value: datetime) -> datetime:
    """Stored instants come back naive from SQLite (tests) and aware from
    PostgreSQL; both are UTC."""
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def not_ended(end: datetime | None, now: datetime | None = None) -> bool:
    """Still running at `now`: no end, or now is before the exclusive end."""
    return end is None or (now or now_utc()) < as_utc(end)
