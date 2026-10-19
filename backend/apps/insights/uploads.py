"""Uploaded files: a CSV or Excel file the workspace uploads becomes a dataset Insights reports on, like any other.

    GET, POST  /insights/uploads/                      the files; POST (multipart: file, name?) reads one and keeps it as a draft
    GET, PUT, DELETE /insights/uploads/<id>/           one file with its first rows; PUT reviews the columns (label, type, role) and
                                                       makes it a dataset (ready); DELETE when no report is built on it
    POST       /insights/uploads/<id>/replace/         new rows from a file with the same columns; the reports on it stay

Reading: a CSV in UTF-8 (or Windows-1252), its delimiter guessed; an .xlsx, its first sheet. The first row names the columns. Up to
100,000 rows, 50 columns, 20 MB. Each column's type is read from its values: true/false, a number (1,234.50 or 1.234,50, $12, 12%, (3) as
-3; 007 stays text), a date or a date and time (2026-10-19, 19/10/2026, 10/19/2026: day first when a day is over 12, else month first), else text.
A date and time without a zone is the workspace's time. The reviewer may make any column text, or a number a dimension.

Tables (patch 0063): report_upload (the file, its columns) and report_upload_row (each row as JSON under c1..cn), both under
row-level security. The dataset (upl_<slug>) is a query over the rows, cast by type, read as the reporting role on PostgreSQL
whatever the workspace's engine; its fields are the columns, plus Rows (a count).
"""
import csv
import io
import json
import re
from datetime import date, datetime, timezone as dt_timezone

from django.core.cache import cache
from django.utils.text import slugify
from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from api.exceptions import Conflict
from api.permissions import HasPermissionCode, SameTenant
from apps.delivery.engine import session
from apps.insights import catalog
from apps.insights.api import VIEW, _q, _tenant
from apps.reporting import reports
from apps.tenants import context

BUILDER = [IsAuthenticated, SameTenant, HasPermissionCode.for_("report.edit") | HasPermissionCode.for_("user.admin")]
MAX_BYTES = 20 * 1024 * 1024
MAX_ROWS = 100_000
MAX_COLUMNS = 50
MAX_TEXT = 1000
SAMPLE_ROWS = 20
TYPES = ("string", "number", "date", "datetime", "boolean")
CASTS = {"number": "::numeric", "date": "::date", "datetime": "::timestamptz", "boolean": "::boolean", "string": ""}
COUNT_KEY = "rows"


class FileError(ValueError):
    pass


# ---------------------------------------------------------------------------------------------------- reading a value
NUMBER = re.compile(r"^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$")
GROUPED = re.compile(r"^[-+]?\d{1,3}(,\d{3})+(\.\d+)?$")
GROUPED_COMMA = re.compile(r"^[-+]?\d{1,3}(\.\d{3})*(,\d+)?$")           # 1.234,50: a decimal comma
LEADING_ZERO = re.compile(r"^[-+]?0\d")                                 # 007, 02134: a code, kept as text
ISO = re.compile(r"^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?$")
DAY_MONTH = re.compile(r"^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?)?$")


def _number(value, comma: bool = False):
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return value if value == value and value not in (float("inf"), float("-inf")) else None
    text = str(value).strip().replace(" ", "").replace(" ", "")
    negative = text.startswith("(") and text.endswith(")")
    text = text.strip("()")
    text = text.lstrip("$€£¥₹").rstrip("%")
    if LEADING_ZERO.match(text):
        return None
    if comma and GROUPED_COMMA.match(text):
        text = text.replace(".", "").replace(",", ".")
    elif GROUPED.match(text):
        text = text.replace(",", "")
    if not NUMBER.match(text):
        return None
    number = float(text)
    if number.is_integer() and "." not in text and "e" not in text.lower() and abs(number) < 2 ** 53:
        number = int(number)
    return -number if negative else number


def _boolean(value):
    if isinstance(value, bool):
        return value
    text = str(value).strip().lower()
    return {"true": True, "false": False}.get(text)


def _when(value, day_first: bool | None):
    """(a date or a datetime, whether it has a time), or None; day_first None: either order may do"""
    if isinstance(value, datetime):
        return value, value.time() != datetime.min.time()
    if isinstance(value, date):
        return value, False
    text = str(value).strip()
    found = ISO.match(text)
    if found:
        y, m, d, hh, mm, ss = found.groups()
        order = (int(y), int(m), int(d))
    else:
        found = DAY_MONTH.match(text)
        if not found:
            return None
        a, b, y, hh, mm, ss, half = found.groups()
        a, b = int(a), int(b)
        order = (int(y), a, b) if day_first is False or (day_first is None and a <= 12) else (int(y), b, a)
        if hh is not None and half:
            hour = int(hh) % 12 + (12 if half.lower() == "pm" else 0)
            hh = str(hour)
    try:
        if hh is None:
            return date(*order), False
        return datetime(*order, int(hh), int(mm), int(ss or 0)), True
    except ValueError:
        return None


def _day_first(values) -> bool | None:
    """for a column of 03/04/2026 style dates: day first when a first part is over 12, month first when a second is; None when it cannot be both"""
    firsts, seconds = False, False
    for v in values:
        if isinstance(v, (date, datetime)):
            continue
        found = DAY_MONTH.match(str(v).strip())
        if found:
            firsts = firsts or int(found.group(1)) > 12
            seconds = seconds or int(found.group(2)) > 12
    if firsts and seconds:
        return None
    return firsts


# ---------------------------------------------------------------------------------------------------- reading a file
def read_file(name: str, data: bytes) -> tuple[str, list[str], list[list]]:
    """(csv | xlsx, the headers, the rows as cells), or FileError saying what is wrong"""
    if len(data) > MAX_BYTES:
        raise FileError("The file is over 20 MB. Split it, or leave out columns you do not need.")
    lower = (name or "").lower()
    if lower.endswith(".xls") or lower.endswith(".xlsb"):
        raise FileError("This is an older Excel file. Save it as .xlsx (Excel Workbook) or .csv and upload it again.")
    if lower.endswith(".xlsx") or lower.endswith(".xlsm") or data[:4] == b"PK\x03\x04":
        kind, table = "xlsx", _xlsx_rows(data)
    elif lower.endswith((".csv", ".txt", ".tsv")) or not lower:
        kind, table = "csv", _csv_rows(data)
    else:
        raise FileError("Upload a .csv or an .xlsx file.")
    table = [r for r in table if any(c not in (None, "") for c in r)]
    if not table:
        raise FileError("The file has no rows.")
    headers, rows = table[0], table[1:]
    width = max(len(r) for r in table)
    while width and all((len(r) < width or r[width - 1] in (None, "")) for r in table):
        width -= 1                                                     # empty columns at the right are not columns
    if width > MAX_COLUMNS:
        raise FileError(f"The file has {width} columns; the most is {MAX_COLUMNS}.")
    if not rows:
        raise FileError("The file has a header row but no rows under it.")
    if len(rows) > MAX_ROWS:
        raise FileError(f"The file has {len(rows):,} rows; the most is {MAX_ROWS:,}.")
    names, seen = [], set()
    for i in range(width):
        text = " ".join(str(headers[i]).split()) if i < len(headers) and headers[i] not in (None, "") else f"Column {i + 1}"
        text, base, n = text[:100], text[:96], 2
        while text.lower() in seen:
            text, n = f"{base} {n}", n + 1
        seen.add(text.lower())
        names.append(text)
    return kind, names, [[(r[i] if i < len(r) else None) for i in range(width)] for r in rows]


def _csv_rows(data: bytes) -> list[list]:
    for encoding in ("utf-8-sig", "cp1252"):
        try:
            text = data.decode(encoding)
            break
        except UnicodeDecodeError:
            continue
    else:
        raise FileError("The file's text could not be read. Save it as CSV UTF-8 and upload it again.")
    sample = text[:8192]
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=",;\t|")
    except csv.Error:
        dialect = csv.excel
    try:
        return [[c.strip() if isinstance(c, str) else c for c in row] for row in csv.reader(io.StringIO(text, newline=""), dialect)][:MAX_ROWS + 2]
    except csv.Error as exc:
        raise FileError(f"The file is not a CSV this can read ({exc}).") from None


def _xlsx_rows(data: bytes) -> list[list]:
    import openpyxl
    try:
        book = openpyxl.load_workbook(io.BytesIO(data), read_only=True, data_only=True)
    except Exception:                                                  # noqa: BLE001
        raise FileError("The Excel file could not be opened. Save it again as .xlsx and upload it.") from None
    try:
        sheet = book.worksheets[0]
        out = []
        for row in sheet.iter_rows(values_only=True):
            out.append([c.strip() if isinstance(c, str) else c for c in row])
            if len(out) > MAX_ROWS + 2:
                break
        return out
    finally:
        book.close()


def decimal_comma(values: list) -> bool:
    """a column of numbers written 1.234,50 (every value reads that way, and not every one reads as 1,234.50)"""
    present = [v for v in values if v not in (None, "")]
    return bool(present) and any(_number(v) is None for v in present) and all(_number(v, True) is not None for v in present)


def infer(values: list) -> str:
    """the narrowest type every value in the column reads as"""
    present = [v for v in values if v not in (None, "")]
    if not present:
        return "string"
    if all(_boolean(v) is not None for v in present):
        return "boolean"
    if all(_number(v) is not None for v in present) or decimal_comma(present):
        return "number"
    order = _day_first(present)
    if order is not None or not any(isinstance(v, str) and DAY_MONTH.match(v.strip()) for v in present):
        read = [_when(v, order) for v in present]
        if all(r is not None for r in read):
            return "datetime" if any(r[1] for r in read) else "date"
    return "string"


def normalise(value, type_: str, zone, day_first: bool | None, comma: bool = False):
    """a cell as stored: a number, an ISO date, an ISO date and time in UTC, true or false, text; None when empty. ValueError when it does not fit."""
    if value in (None, ""):
        return None
    if type_ == "number":
        number = _number(value, comma)
        if number is None:
            raise ValueError("not a number")
        return number
    if type_ == "boolean":
        flag = _boolean(value)
        if flag is None:
            raise ValueError("not true or false")
        return flag
    if type_ in ("date", "datetime"):
        read = _when(value, day_first)
        if read is None:
            raise ValueError("not a date")
        when = read[0]
        if type_ == "date":
            return (when.date() if isinstance(when, datetime) else when).isoformat()
        moment = when if isinstance(when, datetime) else datetime(when.year, when.month, when.day)
        if moment.tzinfo is None:
            moment = moment.replace(tzinfo=zone)
        return moment.astimezone(dt_timezone.utc).isoformat()
    if isinstance(value, float) and value.is_integer():
        value = int(value)
    if isinstance(value, datetime):
        value = value.isoformat(sep=" ")
    elif isinstance(value, date):
        value = value.isoformat()
    return str(value)[:MAX_TEXT]


def columns_of(names: list[str], rows: list[list]) -> list[dict]:
    keys, out = set(), []
    for i, name in enumerate(names):
        key = slugify(name).replace("-", "_")[:40].strip("_") or f"column_{i + 1}"
        if key[0].isdigit():
            key = f"f_{key}"[:40]
        base, n = key[:36], 2
        while key in keys or key == COUNT_KEY:
            key, n = f"{base}_{n}", n + 1
        keys.add(key)
        values = [r[i] for r in rows]
        type_ = infer(values)
        out.append({"key": key, "label": name, "column": f"c{i + 1}", "source": name, "type": type_, "inferred": type_,
                    "role": "measure" if type_ == "number" else "dimension", **({"day_first": _day_first(values)} if type_ in ("date", "datetime") else {}),
                    **({"comma": True} if type_ == "number" and decimal_comma(values) else {})})
    return out


def encoded(columns: list[dict], rows: list[list], zone) -> list[dict]:
    """every row as stored, or FileError naming the first cell that does not fit its column"""
    out = []
    for n, row in enumerate(rows, start=2):
        data = {}
        for i, column in enumerate(columns):
            try:
                value = normalise(row[i], column["inferred"], zone, column.get("day_first"), column.get("comma", False))
            except ValueError as exc:
                raise FileError(f"Row {n}, {column['source']}: {exc}.") from None
            if value is not None:
                data[column["column"]] = value
        out.append(data)
    return out


# ---------------------------------------------------------------------------------------------------- the rows
def present() -> bool:
    return bool(_q("SELECT to_regclass('public.report_upload') IS NOT NULL AS present")[0]["present"])


BATCH = 5_000


def _write_rows(tenant_id, upload_id, data: list[dict]) -> None:
    """the rows in batches, each one INSERT over a JSON array (COPY is refused on a table under row-level security)"""
    with session.connection().cursor() as cursor:
        cursor.execute("DELETE FROM report_upload_row WHERE upload_id = %s", [str(upload_id)])
        for at in range(0, len(data), BATCH):
            cursor.execute("""INSERT INTO report_upload_row (tenant_id, upload_id, row_no, data)
                              SELECT %s, %s, (e.n + %s)::int, e.value FROM jsonb_array_elements(%s::jsonb) WITH ORDINALITY AS e(value, n)""",
                           [str(tenant_id), str(upload_id), at, json.dumps(data[at:at + BATCH], separators=(",", ":"))])


UPLOAD_COLUMNS = "id::text, key, name, description, file_name, file_kind, columns, row_count, status, created_by::text, created_at, updated_at, replaced_at, row_version"


def uploads(tenant_id) -> list[dict]:
    rows = _q(f"SELECT {UPLOAD_COLUMNS} FROM report_upload WHERE tenant_id = %s AND deleted_at IS NULL ORDER BY name", [str(tenant_id)])
    for row in rows:
        row["columns"] = json.loads(row["columns"]) if isinstance(row["columns"], str) else (row["columns"] or [])
    return rows


def _row(tenant_id, upload_id) -> dict:
    found = [u for u in uploads(tenant_id) if u["id"] == str(upload_id)]
    if not found:
        raise NotFound("No such file.")
    return found[0]


# ---------------------------------------------------------------------------------------------------- the dataset
def _field(column: dict) -> dict:
    type_ = column["type"]
    measure = column["role"] == "measure" and type_ == "number"
    return {"key": column["key"], "label": column["label"], "column": column["column"], "table": "t0", "type": type_, "role": "measure" if measure else "dimension",
            "aggregates": ["sum", "avg", "min", "max", "count"] if measure else [], "operators": catalog.OPERATORS[type_],
            "buckets": catalog.BUCKETS if type_ in ("date", "datetime") else [], "format": None, "sensitivity": "NORMAL"}


def dataset_of(row: dict) -> dict:
    selects = ", ".join(f"(r.data->>'{c['column']}'){CASTS[c['type']]} AS {c['column']}" for c in row["columns"])
    query = f"SELECT r.tenant_id, r.row_no, {selects} FROM public.report_upload_row r WHERE r.upload_id = '{row['id']}'"
    fields = [_field(c) for c in row["columns"]]
    fields.append({"key": COUNT_KEY, "label": "Rows", "column": "row_no", "table": "t0", "type": "number", "role": "measure", "aggregates": ["count"],
                   "operators": catalog.OPERATORS["number"], "buckets": [], "format": "integer", "sensitivity": "NORMAL"})
    time_field = next((c["key"] for c in row["columns"] if c["type"] in ("date", "datetime")), None)
    return {"key": row["key"], "label": row["name"], "description": row["description"] or f"Uploaded from {row['file_name']}", "component": {"key": "cep", "name": "Engagement"},
            "primary_key": None, "time_field": time_field, "freshness": "LIVE", "source": "upload", "joins": [], "query": query, "kind": "upload",
            "workspace_field": "tenant_id", "engine": "postgresql", "fields": fields,
            "upload": {"id": row["id"], "file_name": row["file_name"], "row_count": row["row_count"], "updated_at": (row["replaced_at"] or row["created_at"]).isoformat(),
                       "version": row["row_version"]}}


def custom_datasets(tenant_id) -> list[dict]:
    """the workspace's ready uploads in the catalogue's shape, cached a minute (catalog.TTL)"""
    key = f"cep:insights:uploads:{tenant_id}"
    data = cache.get(key)
    if data is not None:
        return data
    if context.current() is None or context.is_platform() or not present():
        return []
    data = [dataset_of(row) for row in uploads(tenant_id) if row["status"] == "READY"]
    cache.set(key, data, catalog.TTL)
    return data


def invalidate(tenant_id) -> None:
    cache.delete(f"cep:insights:uploads:{tenant_id}")


# ---------------------------------------------------------------------------------------------------- words
def _sample(upload_id) -> list[dict]:
    rows = _q("SELECT data FROM report_upload_row WHERE upload_id = %s ORDER BY row_no LIMIT %s", [str(upload_id), SAMPLE_ROWS])
    return [json.loads(r["data"]) if isinstance(r["data"], str) else r["data"] for r in rows]


def _report_count(tenant_id, key: str) -> int:
    return int(_q("SELECT count(*) AS n FROM report WHERE tenant_id = %s AND dataset_key = %s AND deleted_at IS NULL", [str(tenant_id), key])[0]["n"])


def serialize(row: dict, *, sample: bool = False) -> dict:
    columns = [{k: c[k] for k in ("key", "label", "column", "source", "type", "inferred", "role")} | {"types": [c["inferred"], "string"] if c["inferred"] != "string" else ["string"]}
               for c in row["columns"]]
    out = {"id": row["id"], "key": row["key"], "name": row["name"], "description": row["description"], "file_name": row["file_name"], "file_kind": row["file_kind"],
           "columns": columns, "row_count": row["row_count"], "status": row["status"], "created_at": row["created_at"], "updated_at": row["updated_at"],
           "replaced_at": row["replaced_at"], "row_version": row["row_version"]}
    if sample:
        out["sample"] = _sample(row["id"])
        out["reports"] = _report_count(_tenant().pk, row["key"])
    return out


def _unique_key(tenant_id, name: str) -> str:
    base = ("upl_" + slugify(name).replace("-", "_"))[:38].rstrip("_")
    base = base if len(base) > 4 else "upl_file"
    taken = {r["key"] for r in _q("SELECT key FROM report_upload WHERE tenant_id = %s AND deleted_at IS NULL", [str(tenant_id)])}
    key, n = base, 2
    while key in taken:
        key, n = f"{base[:36]}_{n}", n + 1
    return key


def _file_of(request):
    upload = request.FILES.get("file")
    if upload is None:
        raise ValidationError({"file": "Choose a .csv or .xlsx file."})
    if upload.size > MAX_BYTES:
        raise ValidationError({"file": "The file is over 20 MB. Split it, or leave out columns you do not need."})
    return upload.name, upload.read()


def _reviewed(current: list[dict], raw) -> list[dict]:
    """the columns as the reviewer left them: a label, text or the type read, a number as a measure or a dimension"""
    if raw is None:
        return current
    if not isinstance(raw, list):
        raise ValidationError({"columns": "The columns are a list."})
    by_key = {c.get("key"): c for c in raw if isinstance(c, dict)}
    out, labels = [], set()
    for column in current:
        change = by_key.get(column["key"], {})
        label = " ".join(str(change.get("label", column["label"]) or "").split())[:100] or column["source"]
        if label.lower() in labels:
            raise ValidationError({f"columns.{column['key']}.label": f"Two columns are called {label}."})
        labels.add(label.lower())
        type_ = change.get("type", column["type"])
        if type_ not in (column["inferred"], "string"):
            raise ValidationError({f"columns.{column['key']}.type": f"{label} can be {column['inferred']} or text."})
        role = change.get("role", column["role"])
        if role not in ("measure", "dimension") or (role == "measure" and type_ != "number"):
            raise ValidationError({f"columns.{column['key']}.role": "Only a number can be a measure."})
        out.append({**column, "label": label, "type": type_, "role": role})
    return out


# ---------------------------------------------------------------------------------------------------- the API
class UploadsView(APIView):
    def get_permissions(self):
        return [p() for p in (VIEW if self.request.method == "GET" else BUILDER)]

    @extend_schema(responses={200: None})
    def get(self, request, version=None):
        tenant = _tenant()
        if not present():
            return Response({"uploads": [], "ready": False})
        counts = {r["dataset_key"]: int(r["n"]) for r in _q("SELECT dataset_key, count(*) AS n FROM report WHERE tenant_id = %s AND deleted_at IS NULL AND dataset_key LIKE 'upl\\_%%' GROUP BY dataset_key", [str(tenant.pk)])}
        return Response({"uploads": [{**serialize(u), "reports": counts.get(u["key"], 0)} for u in uploads(tenant.pk)], "ready": True,
                         "limits": {"bytes": MAX_BYTES, "rows": MAX_ROWS, "columns": MAX_COLUMNS}})

    @extend_schema(request=None, responses={201: None})
    def post(self, request, version=None):
        tenant = _tenant()
        if not present():
            raise Conflict("Uploading files needs a database update (patch 0063). Ask your administrator.")
        file_name, data = _file_of(request)
        try:
            kind, names, rows = read_file(file_name, data)
            columns = columns_of(names, rows)
            stored = encoded(columns, rows, reports.zone_of(tenant))
        except FileError as exc:
            raise ValidationError({"file": str(exc)}) from None
        name = " ".join(str(request.data.get("name") or re.sub(r"\.(csv|txt|tsv|xlsx|xlsm)$", "", file_name, flags=re.I)).split())[:100] or "Uploaded file"
        with session.tx():
            made = _q("""INSERT INTO report_upload (tenant_id, key, name, file_name, file_kind, columns, row_count, created_by, updated_by)
                         VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id::text""",
                      [str(tenant.pk), _unique_key(tenant.pk, name), name, file_name[:200], kind, json.dumps(columns), len(stored), str(request.user.pk), str(request.user.pk)])
            _write_rows(tenant.pk, made[0]["id"], stored)
        return Response(serialize(_row(tenant.pk, made[0]["id"]), sample=True), status=status.HTTP_201_CREATED)


class UploadView(APIView):
    def get_permissions(self):
        return [p() for p in (VIEW if self.request.method == "GET" else BUILDER)]

    @extend_schema(responses={200: None})
    def get(self, request, version=None, upload_id=None):
        tenant = _tenant()
        return Response(serialize(_row(tenant.pk, upload_id), sample=True))

    @extend_schema(request=None, responses={200: None})
    def put(self, request, version=None, upload_id=None):
        tenant = _tenant()
        current = _row(tenant.pk, upload_id)
        body = request.data if isinstance(request.data, dict) else {}
        if body.get("row_version") is not None and int(body["row_version"]) != current["row_version"]:
            raise Conflict("The file changed since you opened it. Reload and try again.")
        name = " ".join(str(body.get("name", current["name"]) or "").split())[:100]
        if not name:
            raise ValidationError({"name": "Give the dataset a name."})
        description = " ".join(str(body.get("description", current["description"]) or "").split())[:300] or None
        columns = _reviewed(current["columns"], body.get("columns"))
        ready = "READY" if body.get("ready", current["status"] == "READY") else current["status"]
        if current["status"] == "READY" and _report_count(tenant.pk, current["key"]):
            changed = [c["label"] for c, was in zip(columns, current["columns"]) if c["type"] != was["type"] or c["role"] != was["role"]]
            if changed and not body.get("confirm"):
                raise Conflict(f"Reports are built on this file. Changing {', '.join(changed)} can stop them running; send confirm to go ahead.")
        with session.tx():
            _q("""UPDATE report_upload SET name = %s, description = %s, columns = %s, status = %s, updated_by = %s, updated_at = now(), row_version = row_version + 1
                   WHERE tenant_id = %s AND id = %s""", [name, description, json.dumps(columns), ready, str(request.user.pk), str(tenant.pk), str(upload_id)])
        invalidate(tenant.pk)
        return Response(serialize(_row(tenant.pk, upload_id), sample=True))

    @extend_schema(responses={204: None})
    def delete(self, request, version=None, upload_id=None):
        tenant = _tenant()
        current = _row(tenant.pk, upload_id)
        used = _report_count(tenant.pk, current["key"])
        if used:
            raise Conflict(f"{used} report{'' if used == 1 else 's'} {'is' if used == 1 else 'are'} built on this file. Delete {'it' if used == 1 else 'them'} first, or replace the file instead.")
        with session.tx():
            _q("DELETE FROM report_upload_row WHERE upload_id = %s", [str(upload_id)])
            _q("UPDATE report_upload SET deleted_at = now(), updated_by = %s, row_version = row_version + 1 WHERE tenant_id = %s AND id = %s",
               [str(request.user.pk), str(tenant.pk), str(upload_id)])
        invalidate(tenant.pk)
        return Response(status=status.HTTP_204_NO_CONTENT)


class UploadReplaceView(APIView):
    """New rows for a file: the same columns by name (in any order, extra ones left out), each value fitting its column's type."""
    permission_classes = BUILDER

    @extend_schema(request=None, responses={200: None})
    def post(self, request, version=None, upload_id=None):
        tenant = _tenant()
        current = _row(tenant.pk, upload_id)
        file_name, data = _file_of(request)
        try:
            kind, names, rows = read_file(file_name, data)
            where = {n.lower(): i for i, n in enumerate(names)}
            missing = [c["source"] for c in current["columns"] if c["source"].lower() not in where]
            if missing:
                raise FileError(f"The new file has no {', '.join(missing[:5])} column{'s' if len(missing) > 1 else ''}. A replacement keeps the columns the reports read.")
            ordered = [[r[where[c["source"].lower()]] for c in current["columns"]] for r in rows]
            for i, c in enumerate(current["columns"]):
                if c["inferred"] in ("date", "datetime"):
                    c["day_first"] = _day_first([r[i] for r in ordered])
                if c["inferred"] == "number":
                    c["comma"] = decimal_comma([r[i] for r in ordered])
            stored = encoded(current["columns"], ordered, reports.zone_of(tenant))
        except FileError as exc:
            raise ValidationError({"file": str(exc)}) from None
        with session.tx():
            _write_rows(tenant.pk, upload_id, stored)
            _q("""UPDATE report_upload SET file_name = %s, file_kind = %s, columns = %s, row_count = %s, replaced_at = now(), updated_by = %s, updated_at = now(),
                         row_version = row_version + 1 WHERE tenant_id = %s AND id = %s""",
               [file_name[:200], kind, json.dumps(current["columns"]), len(stored), str(request.user.pk), str(tenant.pk), str(upload_id)])
        invalidate(tenant.pk)
        return Response(serialize(_row(tenant.pk, upload_id), sample=True))
