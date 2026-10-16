"""Runs a compiled report under the engine's limits and records it. One short read-only transaction as the reporting
role, with the workspace's row-level setting, a statement timeout, a row cap and a per-workspace concurrency cap; the
rows of an interactive run are cached a minute by the definition's signature, so a page that re-renders does not query
again. A report that fails never touches anything else: the API answers with a plain reason.

    runner.run(tenant, user, dataset, definition, kind, *, limit, offset) -> {"columns": [...], "rows": [[...]], "row_count", "duration_ms", "truncated", "cached"}
    runner.stream_csv(tenant, user, dataset, definition) -> an iterator of CSV chunks (the export)
"""
import csv
import io
import time
from datetime import date, datetime
from decimal import Decimal

from django.conf import settings
from django.core.cache import cache
from django.db import connections, transaction
from django.utils import timezone

from apps.delivery.engine import session
from apps.reporting import reports
from . import clickhouse, compiler
from .catalog import engine_of
from .definition import signature

CACHE_SECONDS = 60
ROLE = "cep_reporting"


class RunRefused(Exception):
    """The engine will not run this now: busy, timed out, or its limits; `reason` is for the person."""
    def __init__(self, outcome: str, reason: str):
        super().__init__(reason)
        self.outcome, self.reason = outcome, reason


def _audit(tenant_id, user_id, dataset_key, kind, signature_, outcome, *, report_id=None, report_version=None, duration_ms=None, row_count=None, detail=None):
    with session.tenant_scope(tenant_id), session.tx(), session.connection().cursor() as cursor:
        cursor.execute("""INSERT INTO report_run_audit (tenant_id, report_id, report_version, user_id, dataset_key, kind, filter_signature, duration_ms, row_count, outcome, detail)
                          VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                       [str(tenant_id), str(report_id) if report_id else None, report_version, str(user_id) if user_id else None, dataset_key, kind, signature_,
                        duration_ms, row_count, outcome, (detail or "")[:300] or None])


def _slot(tenant_id, limit: int):
    """A concurrency slot: the count of running reports per workspace lives in the cache, never past the cap."""
    key = f"cep:insights:running:{tenant_id}"
    cache.add(key, 0, 120)
    try:
        running = cache.incr(key)
    except ValueError:
        cache.set(key, 1, 120)
        running = 1
    if running > limit:
        cache.decr(key)
        raise RunRefused("REFUSED", f"Insights is busy with {limit} reports for this workspace. Try again in a moment.")
    return key


def _release(key):
    try:
        if cache.decr(key) < 0:
            cache.set(key, 0, 120)
    except ValueError:
        pass


def _json_safe(value):
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    return value


def _execute(tenant_id, compiled: compiler.Compiled, timeout_ms: int, dialect: str = "postgresql") -> tuple[list, int]:
    """PostgreSQL: the query in a savepoint of its own: read-only, as the reporting role, with the statement timeout. The
    savepoint is rolled back on the way out (a read-only query loses nothing), so the role, the timeout and the read-only
    flag never outlive the query: the request's own transaction goes on as the app, writing its audit row and anything
    else. ClickHouse: one read-only HTTP query with max_execution_time; its timeout reads as a statement timeout."""
    started = time.monotonic()
    if dialect == "clickhouse":
        try:
            rows = [[_json_safe(v) for v in row] for row in clickhouse.query(compiled.sql, compiled.params, conn=clickhouse.connection_for(tenant_id), timeout_s=max(1, timeout_ms // 1000))]
        except clickhouse.ClickHouseError as exc:
            message = str(exc)
            raise RuntimeError(f"statement timeout: {message}" if "TIMEOUT_EXCEEDED" in message or "Timeout exceeded" in message else message) from None
        return rows, int((time.monotonic() - started) * 1000)
    with session.tenant_scope(tenant_id) as scope, session.tx():
        with session.connection().cursor() as cursor:
            cursor.execute("SET LOCAL transaction_read_only = on")
            cursor.execute("SET LOCAL statement_timeout = %s", [int(timeout_ms)])
            cursor.execute(f"SET LOCAL ROLE {ROLE}")
            cursor.execute(compiled.sql, compiled.params)
            rows = [[_json_safe(v) for v in row] for row in cursor.fetchall()]
        transaction.set_rollback(True, using=scope.db_alias)
    return rows, int((time.monotonic() - started) * 1000)


MASK = "•••••"


def mask(dataset: dict, columns: list[dict], rows: list[list], masked: bool) -> tuple[list[dict], list[list]]:
    """A reader without the right sees a PII column's values as the mask, and the column marked, so the grid can say so."""
    if not masked:
        return columns, rows
    pii = {f["key"] for f in dataset["fields"] if f["sensitivity"] == "PII"}
    hidden = [i for i, c in enumerate(columns) if c["key"] in pii]
    if not hidden:
        return columns, rows
    columns = [{**c, "masked": True} if i in hidden else c for i, c in enumerate(columns)]
    rows = [[MASK if i in hidden and v is not None else v for i, v in enumerate(row)] for row in rows]
    return columns, rows


def _totals(tenant_id, dataset: dict, definition: dict, sets, zone: str, timeout_ms: int, cap: int, mask_pii: bool, dialect: str = "postgresql") -> list[dict]:
    """The engine's totals for a hierarchy or a pivot: one entry per totalled row, its dimension keys (the ones kept) and its measures."""
    compiled = compiler.compile_totals(dataset, definition, str(tenant_id), zone, sets, limit=cap, dialect=dialect)
    rows, _ = _execute(tenant_id, compiled, timeout_ms, dialect)
    dims = [c for c in compiled.columns if "aggregate" not in c]
    pii = {f["key"] for f in dataset["fields"] if f["sensitivity"] == "PII"} if mask_pii else set()
    out = []
    for row in rows:
        mask_bits = int(row[-1])
        keys = {}
        for i, column in enumerate(dims):
            if not mask_bits & (1 << (len(dims) - 1 - i)):
                keys[column["key"]] = MASK if column["key"] in pii and row[i] is not None else row[i]
        out.append({"keys": keys, "values": [_json_safe(v) for v in row[len(dims):-1]]})
    return out


def run(tenant, user, dataset: dict, definition: dict, kind: str, *, limit: int | None = None, offset: int = 0, report_id=None, report_version=None,
        mask_pii: bool = False, totals_view: dict | None = None) -> dict:
    """totals_view: the view to total for (a hierarchy or a pivot), else the definition's own view."""
    engine = engine_of(tenant.pk)
    limits = engine["limits"]
    if engine["status"] == "MIGRATING":
        raise RunRefused("REFUSED", "This workspace's reports are moving to a new engine; try again shortly.")
    cap = limits["preview_rows"] if kind == "preview" else limits["run_rows"]
    page = min(limit or cap, cap)
    sets = compiler.totals_sets(definition, totals_view or definition.get("view"))
    sig = signature({**definition, "limit": page, "offset": offset, "totals": [list(s) for s in sets] if sets else None})
    cache_key = f"cep:insights:result:{tenant.pk}:{sig}:{'masked' if mask_pii else 'full'}"
    cached = cache.get(cache_key)
    if cached is not None:
        return {**cached, "cached": True}
    zone = reports.zone_of(tenant).key
    dialect = engine["dialect"]
    compiled = compiler.compile(dataset, definition, str(tenant.pk), zone, limit=page + 1, offset=offset, dialect=dialect)
    slot = _slot(tenant.pk, limits["concurrent"])
    try:
        try:
            rows, duration = _execute(tenant.pk, compiled, limits["statement_timeout_ms"], dialect)
            totals = _totals(tenant.pk, dataset, definition, sets, zone, limits["statement_timeout_ms"], limits["run_rows"], mask_pii, dialect) if sets else None
        except Exception as exc:                                    # noqa: BLE001  the reason is classified, the query never reaches the client
            message = str(exc)
            outcome = "TIMEOUT" if "statement timeout" in message else "FAILED"
            _audit(tenant.pk, getattr(user, "pk", None), dataset["key"], kind, sig, outcome, report_id=report_id, report_version=report_version, detail=message)
            if outcome == "TIMEOUT":
                raise RunRefused(outcome, f"The report took longer than {limits['statement_timeout_ms'] // 1000} seconds and was stopped. Narrow it with a filter or a shorter period.") from None
            raise RunRefused(outcome, "The report could not be run. If it happens again, tell your administrator.") from None
    finally:
        _release(slot)
    truncated = len(rows) > page
    columns, rows = mask(dataset, compiled.columns, rows[:page], mask_pii)
    _audit(tenant.pk, getattr(user, "pk", None), dataset["key"], kind, sig, "OK", report_id=report_id, report_version=report_version, duration_ms=duration, row_count=len(rows))
    result = {"columns": columns, "rows": rows, "row_count": len(rows), "duration_ms": duration, "truncated": truncated, "offset": offset, "limit": page,
              "freshness": engine["freshness_sla"], "cached": False, **({"totals": totals} if totals is not None else {})}
    cache.set(cache_key, result, CACHE_SECONDS)
    return result


def stream_csv(tenant, user, dataset: dict, definition: dict, *, report_id=None, report_version=None, mask_pii: bool = False):
    """The export: the rows in pages of 5,000 up to the export cap, as CSV text chunks, one audit row for the whole file."""
    engine = engine_of(tenant.pk)
    limits = engine["limits"]
    zone = reports.zone_of(tenant).key
    dialect = engine["dialect"]
    sig = signature(definition)
    slot = _slot(tenant.pk, limits["concurrent"])
    started = time.monotonic()
    total, columns = 0, None
    try:
        offset, page = 0, 5_000
        while offset < limits["export_rows"]:
            compiled = compiler.compile(dataset, definition, str(tenant.pk), zone, limit=min(page, limits["export_rows"] - offset), offset=offset, dialect=dialect)
            try:
                rows, _ = _execute(tenant.pk, compiled, limits["statement_timeout_ms"], dialect)
            except Exception as exc:                                # noqa: BLE001
                _audit(tenant.pk, getattr(user, "pk", None), dataset["key"], "export", sig, "FAILED", report_id=report_id, report_version=report_version, detail=str(exc))
                return
            page_columns, rows = mask(dataset, compiled.columns, rows, mask_pii)
            buffer = io.StringIO()
            writer = csv.writer(buffer)
            if columns is None:
                columns = page_columns
                writer.writerow([c["label"] + (" (masked)" if c.get("masked") else "") for c in columns])
            for row in rows:
                writer.writerow(["" if v is None else v for v in row])
            total += len(rows)
            yield buffer.getvalue()
            if len(rows) < page:
                break
            offset += page
    finally:
        _release(slot)
    _audit(tenant.pk, getattr(user, "pk", None), dataset["key"], "export", sig, "OK", report_id=report_id, report_version=report_version,
           duration_ms=int((time.monotonic() - started) * 1000), row_count=total)


def fetch_all(tenant, user, dataset: dict, definition: dict, *, report_id=None, report_version=None, mask_pii: bool = False, kind: str = "export") -> tuple[list[dict], list[list], list[dict] | None]:
    """Every row up to the export cap, in pages, for a file built in memory (the Excel export), with the engine's totals when the
    definition's view has them; one audit row for the whole."""
    engine = engine_of(tenant.pk)
    limits = engine["limits"]
    zone = reports.zone_of(tenant).key
    dialect = engine["dialect"]
    sig = signature(definition)
    slot = _slot(tenant.pk, limits["concurrent"])
    started = time.monotonic()
    columns, out, totals = None, [], None
    sets = compiler.totals_sets(definition, definition.get("view"))
    try:
        if sets:
            try:
                totals = _totals(tenant.pk, dataset, definition, sets, zone, limits["statement_timeout_ms"], limits["run_rows"], mask_pii, dialect)
            except Exception as exc:                                # noqa: BLE001
                _audit(tenant.pk, getattr(user, "pk", None), dataset["key"], kind, sig, "FAILED", report_id=report_id, report_version=report_version, detail=str(exc))
                raise RunRefused("FAILED", "The export could not be run. If it happens again, tell your administrator.") from None
        offset, page = 0, 5_000
        while offset < limits["export_rows"]:
            compiled = compiler.compile(dataset, definition, str(tenant.pk), zone, limit=min(page, limits["export_rows"] - offset), offset=offset, dialect=dialect)
            try:
                rows, _ = _execute(tenant.pk, compiled, limits["statement_timeout_ms"], dialect)
            except Exception as exc:                                # noqa: BLE001
                message = str(exc)
                outcome = "TIMEOUT" if "statement timeout" in message else "FAILED"
                _audit(tenant.pk, getattr(user, "pk", None), dataset["key"], kind, sig, outcome, report_id=report_id, report_version=report_version, detail=message)
                if outcome == "TIMEOUT":
                    raise RunRefused(outcome, f"The export took longer than {limits['statement_timeout_ms'] // 1000} seconds and was stopped. Narrow the report with a filter.") from None
                raise RunRefused(outcome, "The export could not be run. If it happens again, tell your administrator.") from None
            page_columns, rows = mask(dataset, compiled.columns, rows, mask_pii)
            if columns is None:
                columns = page_columns
            out.extend(rows)
            if len(rows) < page:
                break
            offset += page
    finally:
        _release(slot)
    _audit(tenant.pk, getattr(user, "pk", None), dataset["key"], kind, sig, "OK", report_id=report_id, report_version=report_version,
           duration_ms=int((time.monotonic() - started) * 1000), row_count=len(out))
    return columns or [], out, totals


def touch_last_run(report_id) -> None:
    with session.connection().cursor() as cursor:
        cursor.execute("UPDATE report SET last_run_at = %s WHERE id = %s", [timezone.now(), str(report_id)])


def healthy() -> bool:
    """The engine answers: the control plane's connection can run a trivial query as the reporting role."""
    try:
        with connections[settings.CONTROL_PLANE_ALIAS].cursor() as cursor:
            cursor.execute("SELECT 1")
        return True
    except Exception:                                               # noqa: BLE001
        return False
