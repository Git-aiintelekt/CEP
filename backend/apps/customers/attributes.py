"""Customer Attributes (docs/mockups/customer-attributes.html, option 1): a workspace's own customer fields, where each comes from,
and their values, one row per customer per source system.

    definitions        customer_attribute_definition: key (what a tag names), label, type, CUSTOMER or LIST, source and field, refresh
    sources            customer_attribute_source: a Report Database table read by an ID column (DATABASE), a file (FILE), the API (API)
    values             customer_attribute_values: {key: value} per customer per source; a full read of a source replaces its row,
                       a push of a few fields merges into it, and other sources' rows are never touched
    external IDs       customer_external_id: who a person is in another system. For the CRM (system ICRM) a person without an entry
                       is matched by the ID C360 already keeps: custom_attributes.party_id (an upload or Look Up), else C360's own
                       party ID (people synced from C360 carry the CRM's ID as their key)
    sync runs          customer_attribute_sync_run: nightly, Sync Now, an import, Fill From Database, an API push

At send (apps/delivery/engine/render.py) a tag reads, in order: the list entry's own value, the customer's attributes (newest source
first when two have the key), the customer record, the tag's default. A LIST attribute is a value of one list entry: it is kept on
contact_list_member.custom_attributes like any upload column, and the catalogue only describes it.

Reading a source's database: read-only sessions (apps/insights/external.connect), `attributes.sync_batch_ids` IDs a query by the ID
column, one source at a time per workspace, each batch its own transaction, so a stopped worker loses one batch at most.
"""
from __future__ import annotations

import json
import logging
import re
import time
from datetime import date, datetime
from decimal import Decimal

from django.conf import settings
from django.db import connections, transaction
from django.utils import timezone

from apps.delivery.engine import session
from apps.tenants import context

from .models import CustomerAttributeDefinition, CustomerAttributeSource, CustomerAttributeSyncRun

log = logging.getLogger("cep.attributes")
KEY_RE = re.compile(r"^[a-z][a-z0-9_]{0,59}$")
SYSTEM_RE = re.compile(r"^[A-Z][A-Z0-9_]{0,39}$")
IDENT_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_$]{0,127}$")
CRM_SYSTEMS = ("ICRM",)
ENGINES = ("mysql57", "mysql80", "postgresql")             # a source reads by primary key; ClickHouse is for reports
# keys a tag already reads elsewhere: the customer record and the per-message values
RESERVED = {"first_name", "last_name", "party_id", "email", "phone", "mobile", "unsubscribe_url", "preference_url", "current_year", "today",
            "campaign_name"}
TAG_TYPE = {"TEXT": "STRING", "NUMBER": "NUMBER", "DATE": "DATE", "BOOLEAN": "BOOLEAN"}
REFRESH_BY_KIND = {"DATABASE": ("NIGHTLY", "ON_IMPORT"), "FILE": ("ON_IMPORT",), "API": ("ON_CHANGE",)}
TRIGGER_WORDS = {"NIGHTLY": "Nightly", "MANUAL": "Sync Now", "IMPORT": "An upload", "FILL": "Fill From Database", "API": "API push"}
STALE = "5 minutes"
_present = False


class AttributeError_(Exception):
    """Something the administrator can fix: shown as is."""


def _conn():
    return connections[context.require().db_alias]


def _tenant() -> str:
    return str(context.require().tenant_id)


def present() -> bool:
    """Patch 0100 is on this database (the code may be deployed first: then there are simply no attributes)."""
    global _present
    if _present:
        return True
    try:
        with _conn().cursor() as cursor:
            cursor.execute("SELECT to_regclass('public.customer_attribute_values') IS NOT NULL")
            _present = bool(cursor.fetchone()[0])
    except Exception:                                     # noqa: BLE001
        return False
    return _present


def _setting(key: str, default: int) -> int:
    from apps.platform_ops import params
    try:
        return max(1, int(params.get(key, default)))
    except Exception:                                     # noqa: BLE001
        return default


def _json(value):
    if isinstance(value, str):
        try:
            return json.loads(value)
        except ValueError:
            return {}
    return value or {}


# ---------------------------------------------------------------------------------------------------- the catalogue
def definitions(active_only: bool = True) -> list[CustomerAttributeDefinition]:
    """Read in a transaction of the workspace's own (a worker outside one would see no rows under row-level security)."""
    if not present():
        return []
    found = CustomerAttributeDefinition.objects.select_related("source").order_by("label")
    with session.tx():
        return list(found.filter(is_active=True) if active_only else found)


def exists(key: str) -> bool:
    if not present():
        return False
    with session.tx():
        return CustomerAttributeDefinition.objects.filter(key=key, is_active=True).exists()


def points() -> list[dict]:
    """The workspace's attributes as data points a tag can read (Settings -> Tags -> Reads From: Customer attribute)."""
    return [{"path": d.key, "label": d.label, "data_type": TAG_TYPE.get(d.data_type, "STRING"), "prefix": False} for d in definitions()]


def typed(value, data_type: str):
    """A value as the definition's type says, JSON-safe: a number, an ISO date, true or false, or text of up to 500 characters."""
    if value is None:
        return None
    if isinstance(value, bytes):
        value = value.decode("utf-8", "replace")
    if isinstance(value, str):
        value = value.strip()
        if value == "":
            return None
    if data_type == "NUMBER":
        try:
            number = value if isinstance(value, (int, float, Decimal)) and not isinstance(value, bool) else Decimal(str(value).replace(",", ""))
            number = Decimal(str(number))
            return int(number) if number == number.to_integral_value() else float(number)
        except (ValueError, ArithmeticError):
            return None
    if data_type == "DATE":
        if isinstance(value, datetime):
            return value.date().isoformat()
        if isinstance(value, date):
            return value.isoformat()
        text = str(value)[:10]
        try:
            return date.fromisoformat(text).isoformat()
        except ValueError:
            return None
    if data_type == "BOOLEAN":
        if isinstance(value, bool):
            return value
        text = str(value).strip().lower()
        if text in ("y", "yes", "true", "1", "t"):
            return True
        if text in ("n", "no", "false", "0", "f"):
            return False
        return None
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return str(value)
    return str(value)[:500]


# ---------------------------------------------------------------------------------------------------- values at send
def values_of(party_ids: list[str]) -> dict[str, dict]:
    """{party: {key: value}} merged across sources, the most recently refreshed source winning a key both have."""
    ids = [p for p in dict.fromkeys(str(p) for p in party_ids if p)]
    if not ids or not present():
        return {}
    out: dict[str, dict] = {}
    with session.tx(), _conn().cursor() as cursor:
        cursor.execute("""SELECT party_id, data FROM customer_attribute_values WHERE tenant_id = %s AND party_id = ANY(%s)
                           ORDER BY party_id, refreshed_at""", [_tenant(), ids])
        for party, data in cursor.fetchall():
            out.setdefault(party, {}).update({k: v for k, v in _json(data).items() if v not in (None, "")})
    return out


class Lookup:
    """For one renderer: the workspace's attribute keys read once, each person's values once."""

    def __init__(self):
        self._keys: set[str] | None = None
        self._people: dict[str, dict] = {}

    def keys(self) -> set[str]:
        if self._keys is None:
            try:
                self._keys = {d.key for d in definitions() if d.scope == "CUSTOMER"}
            except Exception:                             # noqa: BLE001  (no tenant in scope: a preview without data)
                self._keys = set()
        return self._keys

    def get(self, party_id, key: str):
        if not party_id or key not in self.keys():
            return None
        party = str(party_id)
        if party not in self._people:
            if len(self._people) > 5000:
                self._people.clear()
            self._people[party] = values_of([party]).get(party, {})
        return self._people[party].get(key)


# ---------------------------------------------------------------------------------------------------- writing values
def store(source_id, rows: dict[str, dict], run_id=None, *, replace: bool) -> int:
    """This source's row for each person: `replace` puts the values read in place of the row (a full read of the source), else they
    are merged in (a push of some fields). People C360 does not have are skipped. Returns how many rows changed."""
    payload = [{"p": party, "d": {k: v for k, v in data.items()}} for party, data in rows.items() if party]
    if not payload:
        return 0
    with _conn().cursor() as cursor:
        cursor.execute("""WITH incoming AS (
                                SELECT e ->> 'p' AS party_id, e -> 'd' AS data FROM jsonb_array_elements(%(rows)s::jsonb) e
                                 WHERE EXISTS (SELECT 1 FROM customer_master cm WHERE cm.tenant_id = %(tenant)s AND cm.party_id = e ->> 'p')),
                              before AS (
                                SELECT v.party_id, v.data FROM customer_attribute_values v
                                 WHERE v.tenant_id = %(tenant)s AND v.source_id = %(source)s AND v.party_id IN (SELECT party_id FROM incoming)),
                              written AS (
                                INSERT INTO customer_attribute_values (tenant_id, party_id, source_id, data, refreshed_at, sync_run_id)
                                SELECT %(tenant)s, i.party_id, %(source)s, jsonb_strip_nulls(i.data), now(), %(run)s FROM incoming i
                                ON CONFLICT (tenant_id, party_id, source_id) DO UPDATE
                                   SET data = CASE WHEN %(replace)s THEN EXCLUDED.data ELSE jsonb_strip_nulls(customer_attribute_values.data || EXCLUDED.data) END,
                                       refreshed_at = now(), sync_run_id = EXCLUDED.sync_run_id
                                RETURNING party_id, data)
                           SELECT count(*) FROM written w LEFT JOIN before b ON b.party_id = w.party_id WHERE b.data IS DISTINCT FROM w.data""",
                       {"rows": json.dumps(payload), "tenant": _tenant(), "source": str(source_id), "run": str(run_id) if run_id else None, "replace": replace})
        return int(cursor.fetchone()[0])


def remember_ids(system: str, pairs: list[tuple[str, str]]) -> None:
    """(external ID, party) pairs seen in `system`: the next read matches the person by it."""
    payload = [{"x": str(x)[:200], "p": str(p)} for x, p in pairs if x and p]
    if not payload:
        return
    with _conn().cursor() as cursor:
        cursor.execute("""INSERT INTO customer_external_id (tenant_id, system, external_id, party_id)
                          SELECT DISTINCT ON (e ->> 'x') %(tenant)s, %(system)s, e ->> 'x', e ->> 'p' FROM jsonb_array_elements(%(rows)s::jsonb) e
                           WHERE EXISTS (SELECT 1 FROM customer_master cm WHERE cm.tenant_id = %(tenant)s AND cm.party_id = e ->> 'p')
                          ON CONFLICT (tenant_id, system, external_id) DO UPDATE SET party_id = EXCLUDED.party_id, last_seen_at = now()""",
                       {"tenant": _tenant(), "system": system, "rows": json.dumps(payload)})


def id_sql(system: str, cm: str = "cm") -> str:
    """SQL for the person's ID in `system`, over customer_master `cm`; takes the parameter %(system)s."""
    own = (f"(SELECT x.external_id FROM customer_external_id x WHERE x.tenant_id = {cm}.tenant_id AND x.system = %(system)s "
           f"AND x.party_id = {cm}.party_id ORDER BY x.last_seen_at DESC LIMIT 1)")
    if system in CRM_SYSTEMS:
        return f"COALESCE({own}, NULLIF(btrim({cm}.custom_attributes ->> 'party_id'), ''), CASE WHEN {cm}.party_id !~ '^(UPL|SRC)-' THEN {cm}.party_id END)"
    return own


def match_ids(system: str, external_ids: list[str]) -> dict[str, str]:
    """{external ID: party} for the IDs C360 can place (an API push names people by another system's ID)."""
    ids = [str(x) for x in dict.fromkeys(external_ids) if x]
    if not ids:
        return {}
    out: dict[str, str] = {}
    with session.tx(), _conn().cursor() as cursor:
        cursor.execute("SELECT external_id, party_id FROM customer_external_id WHERE tenant_id = %s AND system = %s AND external_id = ANY(%s)",
                       [_tenant(), system, ids])
        out.update(dict(cursor.fetchall()))
        missing = [x for x in ids if x not in out]
        if missing and system in CRM_SYSTEMS:
            cursor.execute("""SELECT cm.party_id, cm.party_id FROM customer_master cm WHERE cm.tenant_id = %(tenant)s AND cm.party_id = ANY(%(ids)s)
                              UNION ALL
                              SELECT btrim(cm.custom_attributes ->> 'party_id'), cm.party_id FROM customer_master cm
                               WHERE cm.tenant_id = %(tenant)s AND btrim(cm.custom_attributes ->> 'party_id') = ANY(%(ids)s)""", {"tenant": _tenant(), "ids": missing})
            for external, party in cursor.fetchall():
                out.setdefault(external, party)
    return out


# ---------------------------------------------------------------------------------------------------- a source's database
def connection_row(source: CustomerAttributeSource) -> dict:
    from apps.insights import databases
    if not source.report_connection_id:
        raise AttributeError_("This source has no database.")
    try:
        row = databases.connection(source.tenant_id, source.report_connection_id)
    except Exception:                                     # noqa: BLE001
        raise AttributeError_("The Report Database of this source was removed. Choose another one.") from None
    if row["engine"] not in ENGINES:
        raise AttributeError_("Only MySQL and PostgreSQL Report Databases can be read for attributes.")
    if row["status"] != "ACTIVE" or not row["password_enc"]:
        raise AttributeError_(f"The Report Database “{row['name']}” is not active. Test it under Settings → Report Databases.")
    return row


def databases_offered() -> list[dict]:
    """The Report Databases a source may read: MySQL or PostgreSQL, active and tested."""
    from apps.insights import databases
    if not databases._present():
        return []
    return [{"id": str(row["id"]), "name": row["name"], "engine": row["engine"], "database_name": row["database_name"]}
            for row in databases.connections(_tenant()) if row["engine"] in ENGINES and row["status"] == "ACTIVE" and row["password_enc"]]


def tables(source_row: dict) -> list[dict]:
    from apps.insights import external
    try:
        return [{"name": t["name"], "kind": t["kind"]} for t in external.sources(source_row) if t.get("mappable")]
    except external.ExternalError as exc:
        raise AttributeError_(str(exc)) from None


def columns(source_row: dict, table: str) -> list[dict]:
    from apps.insights import external
    if not IDENT_RE.match(table or ""):
        raise AttributeError_("Choose a table or view named with letters, digits and underscores.")
    try:
        return [{"name": c["column"], "type": c.get("type"), "key": bool(c.get("key"))} for c in external.columns(source_row, table) if c.get("mappable")]
    except external.ExternalError as exc:
        raise AttributeError_(str(exc)) from None


def _select(source_row: dict, table: str, id_column: str, fields: list[str], count: int) -> str:
    from apps.insights import external
    for name in (table, id_column, *fields):
        if not IDENT_RE.match(name or ""):
            raise AttributeError_(f"“{name}” cannot be read: only names of letters, digits and underscores.")
    q = lambda name: external.quote(name, source_row)      # noqa: E731
    marks = ", ".join(["%s"] * count)
    picked = ", ".join(q(f) for f in dict.fromkeys(fields))
    return (f"SELECT {q(id_column)}, {picked} FROM {external.quote_schema(external.schema_of(source_row), source_row)}.{q(table)} "
            f"WHERE {q(id_column)} IN ({marks})")


def read(conn, source_row: dict, table: str, id_column: str, fields: list[str], ids: list[str]) -> dict[str, dict]:
    """One batch from one table: {ID: {field: value}}. The first row of an ID wins."""
    if not ids or not fields:
        return {}
    out: dict[str, dict] = {}
    names = list(dict.fromkeys(fields))
    with conn.cursor() as cursor:
        cursor.execute(_select(source_row, table, id_column, names, len(ids)), list(ids))
        for row in cursor.fetchall():
            key = str(row[0]).strip()
            if key and key not in out:
                out[key] = dict(zip(names, row[1:]))
    return out


def sample(source_row: dict, table: str, field: str, limit: int = 3) -> list:
    """A few values of a field, for the Add Attribute form."""
    from apps.insights import external
    try:
        rows = external.sample(source_row, table, [field], limit=20)
    except (external.ExternalError, RuntimeError) as exc:
        raise AttributeError_(str(exc)) from None
    seen: list = []
    for (value,) in rows:
        shown = typed(value, "TEXT")
        if shown is not None and shown not in seen:
            seen.append(shown)
        if len(seen) >= limit:
            break
    return seen


class Reader:
    """Reads sources' tables a batch at a time on one session per source; `fake(source, ids, fields)` stands in for databases in tests."""

    def __init__(self, fake=None):
        self.fake = fake
        self.opened: dict[str, tuple] = {}

    def __call__(self, source: CustomerAttributeSource, ids: list[str], fields: list[str]) -> dict[str, dict]:
        if self.fake is not None:
            return self.fake(source, ids, fields)
        from apps.insights import external
        key = str(source.pk)
        if key not in self.opened:
            row = connection_row(source)
            try:
                self.opened[key] = (external.connect(row, timeout_ms=_setting("attributes.source_timeout_ms", 60_000)), row)
            except external.ExternalError as exc:
                raise AttributeError_(str(exc)) from None
        conn, row = self.opened[key]
        try:
            return read(conn, row, source.table_name, source.id_column, fields, ids)
        except AttributeError_:
            raise
        except Exception as exc:                          # noqa: BLE001
            raise AttributeError_(f"{source.name}: {str(exc)[:300]}") from None

    def close(self):
        for conn, _ in self.opened.values():
            try:
                conn.close()
            except Exception:                             # noqa: BLE001
                pass
        self.opened.clear()


def read_people(source: CustomerAttributeSource, attributes: list[CustomerAttributeDefinition], people: list[tuple[str, str]], reader) -> dict[str, dict]:
    """{party: {key: typed value}} for (party, external ID) pairs, read from the source's table."""
    fields = list(dict.fromkeys(a.source_field for a in attributes if a.source_field))
    ids = list(dict.fromkeys(x for _, x in people if x))
    found = reader(source, ids, fields) if ids and fields else {}
    out: dict[str, dict] = {}
    for party, external_id in people:
        row = found.get(str(external_id)) if external_id else None
        if row is None:
            continue
        out[party] = {a.key: typed(row.get(a.source_field), a.data_type) for a in attributes if a.source_field}
    return out


# ---------------------------------------------------------------------------------------------------- runs
def queue(source: CustomerAttributeSource | None, trigger: str, *, params: dict | None = None, user_id=None) -> CustomerAttributeSyncRun:
    """A run waits for the worker; a source with one already waiting or running gets that one back."""
    if source is not None and trigger != "FILL":
        waiting = CustomerAttributeSyncRun.objects.filter(source=source, status__in=("QUEUED", "RUNNING")).order_by("-queued_at").first()
        if waiting is not None:
            return waiting
    run = CustomerAttributeSyncRun.objects.create(tenant_id=_tenant(), source=source, trigger=trigger, params=params or {}, created_by_id=user_id)
    transaction.on_commit(kick, using=context.require().db_alias)
    return run


def kick() -> None:
    """Hands the queue to a worker: Celery in production, a thread in development (the list uploads' runner setting)."""
    runner = getattr(settings, "LIST_IMPORT_RUNNER", "celery")
    if runner == "celery":
        try:
            from workers.lists import sync_attributes
            sync_attributes.apply_async(retry=False)
        except Exception:                                 # noqa: BLE001
            log.warning("attribute sync could not be handed to Celery; beat picks it up")
    elif runner == "thread":
        import threading
        threading.Thread(target=_thread_main, name="attribute-sync", daemon=True).start()


def _thread_main() -> None:
    try:
        run_pending()
    except Exception:                                     # noqa: BLE001
        log.exception("attribute sync thread stopped")
    finally:
        connections.close_all()


def claim(alias: str | None = None, tenant_id=None):
    """(run id, tenant) of one run to do, never two of a workspace at once; None when there is none."""
    alias = alias or settings.PLATFORM_ALIAS
    fresh = f"o.status = 'RUNNING' AND o.heartbeat_at >= now() - interval '{STALE}'"
    with transaction.atomic(using=alias), connections[alias].cursor() as cursor:
        cursor.execute("SELECT pg_advisory_xact_lock(hashtext('cep.customer_attribute_sync_run.claim'))")
        cursor.execute(f"""UPDATE customer_attribute_sync_run r SET status = 'RUNNING', started_at = COALESCE(r.started_at, now()), heartbeat_at = now()
                            WHERE r.id = (SELECT c.id FROM customer_attribute_sync_run c JOIN tenant t ON t.id = c.tenant_id
                                           WHERE t.status = 'ACTIVE' AND (%(tenant)s::uuid IS NULL OR c.tenant_id = %(tenant)s::uuid)
                                             AND (c.status = 'QUEUED' OR (c.status = 'RUNNING' AND c.heartbeat_at < now() - interval '{STALE}'))
                                             AND NOT EXISTS (SELECT 1 FROM customer_attribute_sync_run o WHERE o.tenant_id = c.tenant_id AND o.id <> c.id AND {fresh})
                                           ORDER BY c.queued_at LIMIT 1 FOR UPDATE OF c SKIP LOCKED)
                        RETURNING r.id, r.tenant_id""", {"tenant": str(tenant_id) if tenant_id else None})
        return cursor.fetchone()


def run_pending(max_runs: int = 20, alias: str | None = None, tenant_id=None, reader=None) -> dict:
    done = failed = 0
    for _ in range(max_runs):
        job = claim(alias, tenant_id)
        if job is None:
            break
        run_id, tenant = job
        with session.tenant_scope(str(tenant)):
            ok = run_one(str(run_id), reader=reader)
        done, failed = done + int(ok), failed + int(not ok)
    return {"done": done, "failed": failed}


def run_one(run_id: str, reader=None) -> bool:
    """Runs a claimed run in the tenant's scope. False when it failed (the reason is on the run)."""
    with session.tx():
        run = CustomerAttributeSyncRun.objects.select_related("source").get(pk=run_id)
    the_reader = reader if isinstance(reader, Reader) else Reader(reader)
    started = time.monotonic()
    totals = {"people_read": 0, "people_matched": 0, "values_changed": 0}

    def beat(read_: int, matched: int, changed: int) -> None:
        totals["people_read"] += read_
        totals["people_matched"] += matched
        totals["values_changed"] += changed
        with session.tx():
            CustomerAttributeSyncRun.objects.filter(pk=run_id).update(heartbeat_at=timezone.now(), **totals)

    try:
        if run.trigger == "FILL":
            fill(run, the_reader, beat)
        else:
            if run.source is None:
                raise AttributeError_("The source of this run was removed.")
            sync_source(run, run.source, the_reader, beat)
        status, error = "DONE", None
    except AttributeError_ as exc:
        status, error = "FAILED", str(exc)[:500]
    except Exception as exc:                              # noqa: BLE001
        log.exception("attribute sync %s failed", run_id)
        status, error = "FAILED", f"The run stopped: {str(exc)[:400]}"
    finally:
        if not isinstance(reader, Reader):
            the_reader.close()
    now = timezone.now()
    with session.tx():
        CustomerAttributeSyncRun.objects.filter(pk=run_id).update(status=status, error=error, finished_at=now, heartbeat_at=now, **totals)
        if run.source_id and status == "DONE":
            CustomerAttributeSource.objects.filter(pk=run.source_id).update(last_sync_at=now, last_sync_run_id=run_id)
    log.info("attribute run %s %s in %.1f s: %s", run_id, status, time.monotonic() - started, totals)
    return status == "DONE"


def source_attributes(source: CustomerAttributeSource) -> list[CustomerAttributeDefinition]:
    with session.tx():
        return list(CustomerAttributeDefinition.objects.filter(source=source, is_active=True, scope="CUSTOMER").exclude(source_field__isnull=True).exclude(source_field=""))


def sync_source(run: CustomerAttributeSyncRun, source: CustomerAttributeSource, reader, beat) -> None:
    """A full read of a DATABASE source for every person C360 can match in its system, a batch at a time: the values read replace the
    source's row, and the IDs matched are remembered."""
    if source.kind != "DATABASE":
        raise AttributeError_("Only a Report Database source is read by a sync; files and the API bring their values themselves.")
    if not source.is_active:
        raise AttributeError_("This source is switched off.")
    attributes = source_attributes(source)
    if not attributes:
        raise AttributeError_("No attribute reads this source yet. Add one with Add Attribute.")
    batch = min(5000, _setting("attributes.sync_batch_ids", 1000))
    limit = _setting("attributes.nightly_max_people", 2_000_000)
    only = [str(p) for p in (run.params or {}).get("party_ids") or []]
    after, seen = "", 0
    while seen < limit:
        with session.tx(), _conn().cursor() as cursor:
            cursor.execute(f"""SELECT cm.party_id, {id_sql(source.system)} FROM customer_master cm
                                WHERE cm.tenant_id = %(tenant)s AND cm.party_id > %(after)s {"AND cm.party_id = ANY(%(only)s)" if only else ""}
                                ORDER BY cm.party_id LIMIT %(batch)s""",
                           {"tenant": _tenant(), "after": after, "batch": min(batch, limit - seen), "system": source.system, "only": only})
            page = cursor.fetchall()
        if not page:
            break
        after = page[-1][0]
        seen += len(page)
        people = [(party, str(external).strip()) for party, external in page if external and str(external).strip()]
        found = read_people(source, attributes, people, reader)
        with session.tx():
            changed = store(source.pk, found, run.pk, replace=True)
            remember_ids(source.system, [(x, p) for p, x in people if p in found])
        beat(len(people), len(found), changed)
    if seen >= limit:
        with session.tx():
            CustomerAttributeSyncRun.objects.filter(pk=run.pk).update(params={**(run.params or {}), "capped_at": limit})


# ---------------------------------------------------------------------------------------------------- Fill From Database (the Tag Check)
def fill(run: CustomerAttributeSyncRun, reader, beat) -> None:
    """For the people of a campaign's lists: reads the chosen attributes' database sources afresh (merged into each source's row), then
    copies each tag's value onto the list entries that have none, where the send finds it. params: {include, exclude, tags: [{tag,
    attribute}]}."""
    from apps.campaigns import service
    params = run.params or {}
    include, exclude = [str(i) for i in params.get("include") or []], [str(i) for i in params.get("exclude") or []]
    wanted = [(str(t.get("tag") or ""), str(t.get("attribute") or "")) for t in params.get("tags") or []]
    by_key = {d.key: d for d in definitions()}
    wanted = [(tag, by_key[attribute]) for tag, attribute in wanted if tag and attribute in by_key]
    if not include or not wanted:
        raise AttributeError_("Nothing to fill: choose the tags and their attributes.")
    sources: dict[str, tuple[CustomerAttributeSource, list[CustomerAttributeDefinition]]] = {}
    for _, attribute in wanted:
        if attribute.source is not None and attribute.source.kind == "DATABASE" and attribute.source.is_active and attribute.source_field:
            entry = sources.setdefault(str(attribute.source.pk), (attribute.source, []))
            if attribute not in entry[1]:
                entry[1].append(attribute)
    batch = min(5000, _setting("attributes.sync_batch_ids", 1000))
    base = {"tenant": _tenant(), "include": include, "exclude": exclude or [""]}
    after = ""
    while True:
        with session.tx(), _conn().cursor() as cursor:
            cursor.execute(service.AUDIENCE_BASE + " SELECT k.party_id FROM kept k WHERE k.party_id > %(after)s ORDER BY k.party_id LIMIT %(batch)s",
                           {**base, "after": after, "batch": batch})
            parties = [p for (p,) in cursor.fetchall()]
        if not parties:
            break
        after = parties[-1]
        changed = matched = 0
        for source, attributes in sources.values():
            with session.tx(), _conn().cursor() as cursor:
                cursor.execute(f"SELECT cm.party_id, {id_sql(source.system)} FROM customer_master cm WHERE cm.tenant_id = %(tenant)s AND cm.party_id = ANY(%(ids)s)",
                               {"tenant": _tenant(), "ids": parties, "system": source.system})
                people = [(party, str(x).strip()) for party, x in cursor.fetchall() if x and str(x).strip()]
            found = read_people(source, attributes, people, reader)
            with session.tx():
                changed += store(source.pk, found, run.pk, replace=False)
                remember_ids(source.system, [(x, p) for p, x in people if p in found])
            matched = max(matched, len(found))
        stored = values_of(parties) if present() else {}
        copies = []
        for party in parties:
            mine = stored.get(party, {})
            for tag, attribute in wanted:
                value = mine.get(attribute.key)
                if value not in (None, ""):
                    copies.append({"p": party, "t": tag, "v": value if isinstance(value, (str, int, float, bool)) else str(value)})
        if copies:
            with session.tx(), _conn().cursor() as cursor:
                # only the keys an entry has no value for: a value the entry already had (from its file) stays
                cursor.execute("""UPDATE contact_list_member m
                                     SET custom_attributes = COALESCE(m.custom_attributes, '{}'::jsonb)
                                         || (SELECT jsonb_object_agg(k, c.vals -> k) FROM jsonb_object_keys(c.vals) k WHERE COALESCE(m.custom_attributes ->> k, '') = '')
                                    FROM (SELECT e ->> 'p' AS party_id, jsonb_object_agg(e ->> 't', e -> 'v') AS vals
                                            FROM jsonb_array_elements(%(rows)s::jsonb) e GROUP BY 1) c
                                   WHERE m.tenant_id = %(tenant)s AND m.contact_list_id::text = ANY(%(include)s) AND m.party_id = c.party_id
                                     AND EXISTS (SELECT 1 FROM jsonb_object_keys(c.vals) k WHERE COALESCE(m.custom_attributes ->> k, '') = '')""",
                               {"rows": json.dumps(copies), "tenant": _tenant(), "include": include})
        beat(len(parties), matched, changed)


# ---------------------------------------------------------------------------------------------------- nightly
def due_nightly() -> list[tuple[str, str]]:
    """(tenant, source) of DATABASE sources with a nightly attribute whose read for today has not been queued, once the hour has come."""
    hour = _setting("attributes.nightly_hour_utc", 2) % 24
    now = timezone.now()
    if now.hour < hour:
        return []
    with connections[settings.PLATFORM_ALIAS].cursor() as cursor:
        cursor.execute("SELECT to_regclass('public.customer_attribute_source') IS NOT NULL")
        if not cursor.fetchone()[0]:
            return []
        cursor.execute("""SELECT s.tenant_id, s.id FROM customer_attribute_source s JOIN tenant t ON t.id = s.tenant_id AND t.status = 'ACTIVE'
                           WHERE s.kind = 'DATABASE' AND s.is_active
                             AND EXISTS (SELECT 1 FROM customer_attribute_definition d WHERE d.source_id = s.id AND d.is_active AND d.refresh = 'NIGHTLY')
                             AND NOT EXISTS (SELECT 1 FROM customer_attribute_sync_run r WHERE r.source_id = s.id AND r.trigger = 'NIGHTLY'
                                                AND r.queued_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')""")
        return [(str(t), str(s)) for t, s in cursor.fetchall()]


def queue_nightly() -> int:
    queued = 0
    for tenant_id, source_id in due_nightly():
        try:
            with session.tenant_scope(tenant_id), session.tx():
                source = CustomerAttributeSource.objects.get(pk=source_id)
                queue(source, "NIGHTLY")
            queued += 1
        except Exception:                                 # noqa: BLE001  one workspace's trouble must not stop the others
            log.exception("nightly attribute read not queued for source %s", source_id)
    return queued
