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
from . import access, catalog, clickhouse, compare, compiler, derived, external, fiscal, links, parameters, topn
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


def _dialect_of(dataset: dict, engine: dict) -> str:
    """a workspace's own dataset runs on its database, in that database's dialect; an uploaded file on PostgreSQL, where its rows
    are; the platform's on the workspace's engine"""
    return dataset["engine"] if dataset.get("external") or dataset.get("upload") else engine["dialect"]


def _execute(tenant_id, compiled: compiler.Compiled, timeout_ms: int, dialect: str = "postgresql", dataset: dict | None = None, zone: str | None = None) -> tuple[list, int]:
    """PostgreSQL: the query in a savepoint of its own: read-only, as the reporting role, with the statement timeout. The
    savepoint is rolled back on the way out (a read-only query loses nothing), so the role, the timeout and the read-only
    flag never outlive the query: the request's own transaction goes on as the app, writing its audit row and anything
    else. ClickHouse: one read-only HTTP query with max_execution_time; its timeout reads as a statement timeout."""
    started = time.monotonic()
    if dataset and dataset.get("external"):
        rows = [[_json_safe(v) for v in row] for row in external.query(dataset["connection"], compiled.sql, compiled.params, timeout_ms=timeout_ms, zone=zone)]
        return rows, int((time.monotonic() - started) * 1000)
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
    rows, _ = _execute(tenant_id, compiled, timeout_ms, dialect, dataset, zone)
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
        mask_pii: bool = False, totals_view: dict | None = None, params: dict | None = None) -> dict:
    """totals_view: the view to total for (a hierarchy or a pivot), else the definition's own view. params: the answers to the
    report's parameters (apps/insights/parameters.py); without them, the defaults."""
    engine = engine_of(tenant.pk)
    limits = engine["limits"]
    try:                                                              # the person's row access rules, before anything else
        definition, limited = access.restrict(tenant.pk, user, dataset, definition)
    except access.AccessError as exc:
        raise RunRefused("REFUSED", str(exc)) from None
    dataset = derived.augment(dataset, definition)
    definition = _bound(dataset, definition, params)
    calendar_ = fiscal.settings_of(tenant)
    definition = fiscal.prepared(tenant, definition)
    if engine["status"] == "MIGRATING" and not dataset.get("external") and not dataset.get("upload"):
        raise RunRefused("REFUSED", "This workspace's reports are moving to a new engine; try again shortly.")
    cap = limits["preview_rows"] if kind == "preview" else limits["run_rows"]
    page = min(limit or cap, cap)
    sets = None if definition.get("blend") else compiler.totals_sets(definition, totals_view or definition.get("view"))
    sig = signature({**definition, "limit": page, "offset": offset, "totals": [list(s) for s in sets] if sets else None,
                     **({"_upload": dataset["upload"]["version"]} if dataset.get("upload") else {}),     # a replaced or reviewed file is new rows
                     **({"_formulas": dataset["formulas_version"]} if dataset.get("formulas_version") else {})})
    cache_key = f"cep:insights:result:{tenant.pk}:{sig}:{'masked' if mask_pii else 'full'}"
    cached = cache.get(cache_key)
    if cached is not None:
        return {**cached, "cached": True}
    zone = reports.zone_of(tenant).key
    dialect = _dialect_of(dataset, engine)
    compared = _whole(definition)                                    # comparisons and Top N need every row up to the cap, then the page is cut from them
    compiled = compiler.compile(dataset, definition, str(tenant.pk), zone, limit=(cap + 1) if compared else page + 1, offset=0 if compared else offset, dialect=dialect)
    slot = _slot(tenant.pk, limits["concurrent"])
    try:
        try:
            rows, duration = _execute(tenant.pk, compiled, limits["statement_timeout_ms"], dialect, dataset, zone)
            out_columns, over = compiled.columns, False
            if compared:
                out_columns, rows, more, over = _compared(tenant.pk, dataset, definition, compiled.columns, rows, zone, limits["statement_timeout_ms"], cap, dialect, user=user)
                duration += more
            totals = _totals(tenant.pk, dataset, definition, sets, zone, limits["statement_timeout_ms"], limits["run_rows"], mask_pii, dialect) if sets else None
            totals = compare.expand_totals(definition, totals) if compared and totals is not None else totals
        except compare.CompareError as exc:
            _audit(tenant.pk, getattr(user, "pk", None), dataset["key"], kind, sig, "FAILED", report_id=report_id, report_version=report_version, detail=str(exc))
            raise RunRefused("FAILED", str(exc)) from None
        except Exception as exc:                                    # noqa: BLE001  the reason is classified, the query never reaches the client
            message = str(exc)
            outcome = "TIMEOUT" if "statement timeout" in message else "FAILED"
            _audit(tenant.pk, getattr(user, "pk", None), dataset["key"], kind, sig, outcome, report_id=report_id, report_version=report_version, detail=message)
            if outcome == "TIMEOUT":
                raise RunRefused(outcome, f"The report took longer than {limits['statement_timeout_ms'] // 1000} seconds and was stopped. Narrow it with a filter or a shorter period.") from None
            if dataset.get("external"):
                raise RunRefused(outcome, f"{dataset['database']['name']} did not answer: {message[:160]}") from None
            raise RunRefused(outcome, "The report could not be run. If it happens again, tell your administrator.") from None
    finally:
        _release(slot)
    if compared:
        truncated = over or len(rows) > offset + page
        rows = rows[offset:offset + page]
    else:
        truncated = len(rows) > page
        rows = rows[:page]
    columns, rows = mask(dataset, _fiscal_named(out_columns, calendar_), rows, mask_pii)
    _audit(tenant.pk, getattr(user, "pk", None), dataset["key"], kind, sig, "OK", report_id=report_id, report_version=report_version, duration_ms=duration, row_count=len(rows))
    result = {"columns": columns, "rows": rows, "row_count": len(rows), "duration_ms": duration, "truncated": truncated, "offset": offset, "limit": page,
              "freshness": "LIVE" if dataset.get("external") else engine["freshness_sla"], "cached": False, **({"totals": totals} if totals is not None else {}),
              **({"source": dataset["database"]["name"]} if dataset.get("external") else {}), **({"access": limited} if limited else {}),
              **({"upload": dataset["upload"]["file_name"]} if dataset.get("upload") else {}),
              **({"linked": _linked_words(dataset, definition)} if definition.get("blend") else {}),
              **({"parameters": parameters.words(definition)} if definition.get("_params") else {})}
    cache.set(cache_key, result, CACHE_SECONDS)
    return result


def _bound(dataset: dict, definition: dict, params: dict | None) -> dict:
    try:
        return parameters.bind(dataset, definition, params)
    except parameters.ParameterError as exc:
        raise RunRefused("REFUSED", str(exc)) from None


def _fiscal_named(columns: list[dict], calendar_: dict) -> list[dict]:
    """a fiscal quarter's or year's column carries how the workspace names it (FY2027 Q1)"""
    return [{**c, "fiscal": fiscal.label_of(calendar_)} if c.get("bucket") in fiscal.BUCKETS else c for c in columns]


def _whole(definition: dict) -> bool:
    """whether the rows are worked on as a whole after the query: comparisons, Top N with Others, or measures from a linked dataset"""
    return bool(compare.kinds_of(definition)) or bool(definition.get("top")) or bool(definition.get("blend"))


def _linked_words(dataset: dict, definition: dict) -> dict:
    """what the result says about the linked side: its name, and the rules that applied to the report's own dataset only"""
    link = next((l for l in dataset.get("links", []) if l["to"] == definition["blend"]["dataset"]), None)
    if link is None:
        return {"dataset": definition["blend"]["dataset"]}
    _, own = links.other_definition(dataset, definition)
    labels = {f["key"]: f["label"] for f in dataset["fields"]}
    return {"dataset": link["to"], "label": link["to_label"], "own_rules": list(dict.fromkeys(labels.get(k, k) for k in own))}


def _blended(tenant_id, user, dataset: dict, definition: dict, base_columns: list[dict], rows: list[list], zone: str, timeout_ms: int, cap: int,
             dialect: str) -> tuple[list[dict], list[list], int, bool]:
    """the report's rows with the linked dataset's measures (apps/insights/links.py), sorted when the sort is on one of them"""
    started = time.monotonic()
    over = len(rows) > cap
    rows = rows[:cap]
    other = catalog.dataset(tenant_id, definition["blend"]["dataset"], True)
    if other is None:
        raise compare.CompareError("The linked dataset is not available in this workspace.")
    other_definition, _ = links.other_definition(dataset, definition)
    if user is not None:
        try:
            other_definition, _ = access.restrict(tenant_id, user, other, other_definition)
        except access.AccessError as exc:
            raise compare.CompareError(str(exc)) from None
    other = derived.augment(other, other_definition)
    compiled = compiler.compile(other, other_definition, str(tenant_id), zone, limit=cap * 4, offset=0, dialect=dialect)
    other_rows, _ = _execute(tenant_id, compiled, timeout_ms, dialect, other, zone)
    merged = links.merge(definition, rows, other_rows)
    columns = [*base_columns, *links.columns(dataset, definition, other)]
    keys = [c["key"] for c in columns]
    for item in reversed(definition.get("orderBy") or []):
        if item["field"] in keys and "." in item["field"]:
            at = keys.index(item["field"])
            filled = [r for r in merged if r[at] is not None]
            empty = [r for r in merged if r[at] is None]
            merged = sorted(filled, key=lambda r: r[at], reverse=item["direction"] == "desc") + empty
    return columns, merged, int((time.monotonic() - started) * 1000), over


def _compared(tenant_id, dataset: dict, definition: dict, base_columns: list[dict], rows: list[list], zone: str, timeout_ms: int, cap: int,
              dialect: str, user=None) -> tuple[list[dict], list[list], int, bool]:
    """The rows with their time comparisons (apps/insights/compare.py): the earlier periods from a second run with the date rules
    moved back, the share of the total from the rows (or the engine's grand total when the rows were capped). Returns the
    columns, the rows (up to the cap), the extra milliseconds and whether there were more rows than the cap."""
    from zoneinfo import ZoneInfo
    if definition.get("blend"):
        return _blended(tenant_id, user, dataset, definition, base_columns, rows, zone, timeout_ms, cap, dialect)
    started = time.monotonic()
    kinds = set(compare.kinds_of(definition))
    over = len(rows) > cap
    rows = rows[:cap]
    found = compare.axis(dataset, definition["columns"])
    earlier = {}
    if found:
        today = timezone.now().astimezone(ZoneInfo(zone)).date()
        for group in sorted({compare.GROUP[kind] for kind in kinds if kind in compare.GROUP}):
            months, days = compare.offset(group, found[2])
            moved = compare.shifted(definition, found[1], months, days, today)
            if moved is None:
                earlier[group] = rows
            else:
                earlier[group], _ = _execute(tenant_id, compiler.compile(dataset, moved, str(tenant_id), zone, limit=cap, offset=0, dialect=dialect), timeout_ms, dialect, dataset, zone)
    grand = None
    if "percent_of_total" in kinds:
        wanted = [m for m, c in enumerate(definition["columns"]) if "percent_of_total" in c.get("compare", [])]
        if not over:
            grand = {m: sum(float(r[m]) for r in rows if r[m] is not None and not isinstance(r[m], bool)) for m in wanted}
        else:
            measures = [m for m, c in enumerate(definition["columns"]) if "aggregate" in c]
            whole, _ = _execute(tenant_id, compiler.compile_totals(dataset, definition, str(tenant_id), zone, [()], limit=1, dialect=dialect), timeout_ms, dialect, dataset, zone)
            first = whole[0] if whole else None
            grand = {m: (float(first[measures.index(m)]) if first and first[measures.index(m)] is not None else None) for m in wanted}
    reached = None
    if found and kinds & set(compare.REACH_BACK):                    # year and quarter to date, the moving average: rows from before the report's first date
        today = timezone.now().astimezone(ZoneInfo(zone)).date()
        wide = compare.widened(definition, found[1], compare.reach_back(kinds, found[2], definition.get("_fiscal", 1)), today)
        if wide is not None:
            reached, _ = _execute(tenant_id, compiler.compile(dataset, wide, str(tenant_id), zone, limit=cap, offset=0, dialect=dialect), timeout_ms, dialect, dataset, zone)
    columns = compare.columns(dataset, definition, base_columns)
    worked = topn.apply(definition, columns, compare.apply(dataset, definition, rows, earlier, grand, reached))
    return columns, worked, int((time.monotonic() - started) * 1000), over


def stream_csv(tenant, user, dataset: dict, definition: dict, *, report_id=None, report_version=None, mask_pii: bool = False, params: dict | None = None):
    """The export: the rows in pages of 5,000 up to the export cap, as CSV text chunks, one audit row for the whole file."""
    try:
        definition, _ = access.restrict(tenant.pk, user, dataset, definition)
    except access.AccessError as exc:
        yield f"{exc}\n"                                              # the file says why it is empty
        return
    definition = fiscal.prepared(tenant, _bound(derived.augment(dataset, definition), definition, params))
    engine = engine_of(tenant.pk)
    limits = engine["limits"]
    zone = reports.zone_of(tenant).key
    dialect = _dialect_of(dataset, engine)
    sig = signature(definition)
    slot = _slot(tenant.pk, limits["concurrent"])
    started = time.monotonic()
    dataset = derived.augment(dataset, definition)
    total, columns = 0, None
    try:
        if _whole(definition):
            try:
                compiled = compiler.compile(dataset, definition, str(tenant.pk), zone, limit=limits["export_rows"], offset=0, dialect=dialect)
                rows, _ = _execute(tenant.pk, compiled, limits["statement_timeout_ms"], dialect, dataset, zone)
                cols, rows, _, _ = _compared(tenant.pk, dataset, definition, compiled.columns, rows, zone, limits["statement_timeout_ms"], limits["export_rows"], dialect, user=user)
            except Exception as exc:                                # noqa: BLE001
                _audit(tenant.pk, getattr(user, "pk", None), dataset["key"], "export", sig, "FAILED", report_id=report_id, report_version=report_version, detail=str(exc))
                return
            columns, rows = mask(dataset, cols, rows, mask_pii)
            buffer = io.StringIO()
            writer = csv.writer(buffer)
            writer.writerow([c["label"] + (" (masked)" if c.get("masked") else "") for c in columns])
            for row in rows:
                writer.writerow(["" if v is None else v for v in row])
            total = len(rows)
            yield buffer.getvalue()
        offset, page = (limits["export_rows"], 5_000) if _whole(definition) else (0, 5_000)
        while offset < limits["export_rows"]:
            compiled = compiler.compile(dataset, definition, str(tenant.pk), zone, limit=min(page, limits["export_rows"] - offset), offset=offset, dialect=dialect)
            try:
                rows, _ = _execute(tenant.pk, compiled, limits["statement_timeout_ms"], dialect, dataset, zone)
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


def fetch_all(tenant, user, dataset: dict, definition: dict, *, report_id=None, report_version=None, mask_pii: bool = False, kind: str = "export",
              params: dict | None = None) -> tuple[list[dict], list[list], list[dict] | None]:
    """Every row up to the export cap, in pages, for a file built in memory (the Excel export), with the engine's totals when the
    definition's view has them; one audit row for the whole."""
    try:
        definition, _ = access.restrict(tenant.pk, user, dataset, definition)
    except access.AccessError as exc:
        raise RunRefused("REFUSED", str(exc)) from None
    definition = fiscal.prepared(tenant, _bound(derived.augment(dataset, definition), definition, params))
    engine = engine_of(tenant.pk)
    limits = engine["limits"]
    zone = reports.zone_of(tenant).key
    dialect = _dialect_of(dataset, engine)
    sig = signature(definition)
    slot = _slot(tenant.pk, limits["concurrent"])
    started = time.monotonic()
    columns, out, totals = None, [], None
    sets = None if definition.get("blend") else compiler.totals_sets(definition, definition.get("view"))
    dataset = derived.augment(dataset, definition)
    compared = _whole(definition)
    try:
        if sets:
            try:
                totals = _totals(tenant.pk, dataset, definition, sets, zone, limits["statement_timeout_ms"], limits["run_rows"], mask_pii, dialect)
                totals = compare.expand_totals(definition, totals) if compared and totals is not None else totals
            except Exception as exc:                                # noqa: BLE001
                _audit(tenant.pk, getattr(user, "pk", None), dataset["key"], kind, sig, "FAILED", report_id=report_id, report_version=report_version, detail=str(exc))
                raise RunRefused("FAILED", "The export could not be run. If it happens again, tell your administrator.") from None
        if compared:
            try:
                compiled = compiler.compile(dataset, definition, str(tenant.pk), zone, limit=limits["export_rows"], offset=0, dialect=dialect)
                rows, _ = _execute(tenant.pk, compiled, limits["statement_timeout_ms"], dialect, dataset, zone)
                cols, rows, _, _ = _compared(tenant.pk, dataset, definition, compiled.columns, rows, zone, limits["statement_timeout_ms"], limits["export_rows"], dialect, user=user)
            except compare.CompareError as exc:
                _audit(tenant.pk, getattr(user, "pk", None), dataset["key"], kind, sig, "FAILED", report_id=report_id, report_version=report_version, detail=str(exc))
                raise RunRefused("FAILED", str(exc)) from None
            except Exception as exc:                                # noqa: BLE001
                _audit(tenant.pk, getattr(user, "pk", None), dataset["key"], kind, sig, "FAILED", report_id=report_id, report_version=report_version, detail=str(exc))
                raise RunRefused("FAILED", "The export could not be run. If it happens again, tell your administrator.") from None
            columns, out = mask(dataset, cols, rows, mask_pii)
        offset, page = (limits["export_rows"], 5_000) if compared else (0, 5_000)
        while offset < limits["export_rows"]:
            compiled = compiler.compile(dataset, definition, str(tenant.pk), zone, limit=min(page, limits["export_rows"] - offset), offset=offset, dialect=dialect)
            try:
                rows, _ = _execute(tenant.pk, compiled, limits["statement_timeout_ms"], dialect, dataset, zone)
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
    return _fiscal_named(columns or [], fiscal.settings_of(tenant)), out, totals


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
