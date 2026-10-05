"""Monthly partitions do not depend on the session's time zone (patch 0034).

The dev server's months up to December 2026 had been made in a US Eastern session, so they end at 04:00 or 05:00 UTC; the job,
running in UTC with plain dates, could not make the next month ("would overlap"). This rebuilds that situation from the current
month on, shows the old way fails, and checks that fn_ensure_monthly_partitions makes each new month meet its neighbours.

Partitions belong to the database owner, so the test uses the owner login (OWNER_DATABASE_URL, as tenant operations do) in one
transaction that is rolled back. Without that login it is skipped.
"""
import os
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import psycopg
import pytest
from django.conf import settings

TENANT = "a0000000-0000-4000-8000-000000000001"
UTC = timezone.utc
EASTERN = ZoneInfo("America/New_York")


def month(offset: int) -> date:
    today = datetime.now(UTC).date().replace(day=1)
    total = today.year * 12 + today.month - 1 + offset
    return date(total // 12, total % 12 + 1, 1)


def suffix(day: date) -> str:
    return day.strftime("%Y_%m")


def utc_midnight(day: date) -> datetime:
    return datetime(day.year, day.month, day.day, tzinfo=UTC)


@pytest.fixture
def owner():
    if not (os.environ.get("OWNER_DATABASE_URL") or getattr(settings, "OWNER_DATABASE_URL", "")):
        pytest.skip("OWNER_DATABASE_URL is not set: dropping and making partitions needs the database owner's login.")
    from apps.platform_ops.tenant_ops import owner_connection
    conn = owner_connection()
    conn.autocommit = False
    try:
        yield conn
    finally:
        conn.rollback()
        conn.close()


def test_partition_bounds(check, owner):
    """Each new month meets its neighbours' bounds, else runs 00:00 to 00:00 UTC, whatever the session's zone."""
    cur = owner.cursor()
    cur.execute("SELECT fn_tenant_partition_name('campaign_list_member', %s)", [TENANT])
    part = cur.fetchone()[0]
    cur.execute("SELECT fn_tenant_partition_name(table_name, %s) FROM partition_retention_policy WHERE is_active AND tenant_partitioned AND sub_method = 'RANGE_MONTHLY'",
                [TENANT])
    parts = [row[0] for row in cur.fetchall() if row[0]]
    months = [month(i) for i in range(-1, 7)]               # months[1] is this month
    this, later = months[1], months[2:]

    def bounds(child):
        cur.execute("SELECT fn_partition_bound(%s, 'FROM'), fn_partition_bound(%s, 'TO')", [child, child])
        return cur.fetchone()

    def holder(at: datetime) -> list[str]:
        cur.execute("""SELECT c.relname FROM pg_class c JOIN pg_inherits i ON i.inhrelid = c.oid WHERE i.inhparent = to_regclass(%s)
                         AND %s >= fn_partition_bound(c.relname, 'FROM') AND %s < fn_partition_bound(c.relname, 'TO')""", [part, at, at])
        return [row[0] for row in cur.fetchall()]

    # ---- this month and the next two made the old way, in a US Eastern session
    cur.execute("SET TIME ZONE 'America/New_York'")
    for p in parts:
        for day in [this, *later]:
            cur.execute(f'DROP TABLE IF EXISTS "{p}_{suffix(day)}"')
        for day, nxt in ((this, later[0]), (later[0], later[1]), (later[1], later[2])):
            cur.execute(f"CREATE TABLE \"{p}_{suffix(day)}\" PARTITION OF \"{p}\" FOR VALUES FROM ('{day}') TO ('{nxt}')")
    cur.execute("SET TIME ZONE 'UTC'")
    third = later[1]
    end_eastern = datetime(later[2].year, later[2].month, 1, tzinfo=EASTERN).astimezone(UTC)
    _, end = bounds(f"{part}_{suffix(third)}")
    check("reproduced: a month made in a US Eastern session ends at Eastern midnight, 4 or 5 hours into the next UTC day", end == end_eastern, f"{end}")

    cur.execute("SAVEPOINT old_way")
    try:
        cur.execute(f"CREATE TABLE \"{part}_{suffix(later[2])}\" PARTITION OF \"{part}\" FOR VALUES FROM ('{later[2]}') TO ('{later[3]}')")
        failed = ""
    except psycopg.errors.InvalidObjectDefinition as exc:
        failed = str(exc).splitlines()[0]
    cur.execute("ROLLBACK TO SAVEPOINT old_way")
    check("the old way (plain dates in a UTC session) fails as it did on the server", "would overlap" in failed, failed)

    # ---- the new function
    cur.execute("SELECT fn_ensure_monthly_partitions(5, %s)", [TENANT])
    created = cur.fetchone()[0]
    check("the function makes the three missing months for every monthly table", created == 3 * len(parts), f"{created} for {len(parts)} tables")
    first_new, second_new, third_new = (bounds(f"{part}_{suffix(day)}") for day in later[2:5])
    check("the first new month starts exactly where the Eastern month ends", first_new[0] == end, f"{first_new[0]} vs {end}")
    check("it ends, and later months run, at 00:00 UTC", first_new[1] == utc_midnight(later[3]) and second_new == (first_new[1], third_new[0])
          and third_new[1] == utc_midnight(later[5]), f"{first_new} {second_new} {third_new}")

    cur.execute(f'DROP TABLE "{part}_{suffix(later[3])}"')
    cur.execute("SET TIME ZONE 'Asia/Kolkata'")
    cur.execute("SELECT fn_ensure_monthly_partitions(5, %s)", [TENANT])
    refilled = bounds(f"{part}_{suffix(later[3])}")
    check("a missing month between two others is made to meet both, from any session zone", refilled == (first_new[1], third_new[0]), str(refilled))
    cur.execute("SELECT fn_ensure_monthly_partitions(5, %s)", [TENANT])
    check("a second run makes nothing", cur.fetchone()[0] == 0)
    cur.execute("SET TIME ZONE 'UTC'")

    boundary = utc_midnight(later[2])
    check("two hours after UTC midnight still belongs to the Eastern month, six hours after to the new one",
          holder(boundary + timedelta(hours=2)) == [f"{part}_{suffix(third)}"] and holder(boundary + timedelta(hours=6)) == [f"{part}_{suffix(later[2])}"])
    cur.execute("SELECT count(*) FROM information_schema.table_privileges WHERE table_name = %s AND grantee = 'cep_app'", [f"{part}_{suffix(later[2])}"])
    check("a new month is reachable through its parent only (no direct grant to cep_app)", cur.fetchone()[0] == 0)
    check("the bound reader gives NULL for a partition that does not exist", bounds(f"{part}_1999_01") == (None, None))

    # ---- a tenant with no months at all: plain UTC months
    cur.execute("SET TIME ZONE 'America/Los_Angeles'")
    for p in parts:
        for day in months:
            cur.execute(f'DROP TABLE IF EXISTS "{p}_{suffix(day)}"')
    cur.execute("SELECT fn_ensure_monthly_partitions(3, %s)", [TENANT])
    cur.execute("SET TIME ZONE 'UTC'")
    fresh = bounds(f"{part}_{suffix(this)}")
    check("with no neighbours a month runs 00:00 UTC to 00:00 UTC, even from a Pacific session", fresh == (utc_midnight(this), utc_midnight(later[0])), str(fresh))
    check.done()
