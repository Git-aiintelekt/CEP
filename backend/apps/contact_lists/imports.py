"""Uploading a file into a contact list, built for large files and many workspaces at once.

    accept(file)      in the request: the file is streamed to private storage (never read into memory), the first lines
                      are sampled for the column names, and the import is queued. That is all a web request does.
    stage()           worker: the stored file is read as a stream and staged in contact_list_import_row, a chunk of rows
                      per transaction (`raw` = the row as received). Then the file is deleted: nothing is kept of it.
    review()          worker: set-based SQL over the staged rows, a range of lines per transaction: which rows cannot be
                      imported, which repeat an earlier one, who is already known (loyalty ID, then email address), who
                      is new. Can be run again with another mapping; nothing outside the staging table changes.
    apply()           worker: a range of lines per transaction. New people become customer_master rows owned by CEP
                      (source_system CEP_UPLOAD, not a C360 copy), the list gets its members, and a consent date in the
                      file becomes an email opt-in for people CEP has no consent answer for (never over an unsubscribe).

The queue, the limits on how much runs at once and the workers are in jobs.py. Every transaction is short and runs under
the tenant's row-level security. COPY FROM is not available on tables with row-level security, so rows are staged with
INSERT ... SELECT FROM jsonb_array_elements.
"""
import csv
import io
import json
import re

from django.conf import settings
from django.core.files.storage import FileSystemStorage
from django.db import connections
from django.utils import timezone

from apps.delivery.engine import session
from apps.tenants import context

from .models import ContactList, ContactListImport

MAX_BYTES = 50 * 1024 * 1024
MAX_ROWS = 250_000
MAX_COLUMNS = 100
HEAD_BYTES = 256 * 1024                                   # what the request looks at: enough for the header and some sample values
SAMPLES = 3
ACTIVE = ("UPLOADED", "STAGING", "STAGED", "MATCHING", "REVIEW", "APPLYING")      # not finished, in whatever way

# property -> (label, required, what it is used for, header words that suggest it)
PROPERTIES = {
    "email": ("Email", True, "Who the person is. Rows without a usable address are held back.",
              ("email", "emailaddress", "e-mail", "mail", "emailid", "contactemail", "primaryemail")),
    "first_name": ("First name", False, "", ("firstname", "first", "fname", "givenname", "forename")),
    "last_name": ("Last name", False, "", ("lastname", "last", "lname", "surname", "familyname")),
    "mobile": ("Mobile number", False, "Kept for text campaigns. A number that is not recognised is dropped, the row is still imported.",
               ("mobile", "mobilenumber", "phone", "phonenumber", "cell", "cellphone", "msisdn", "telephone", "tel")),
    "postal_code": ("Postal code", False, "", ("postalcode", "postcode", "zip", "zipcode", "postal")),
    "loyalty_id": ("Loyalty ID", False, "Used first to recognise people CEP already knows.",
                   ("loyaltyid", "loyaltynumber", "loyaltyno", "memberid", "membernumber", "membershipid", "cardnumber")),
    "loyalty_tier": ("Loyalty tier", False, "", ("loyaltytier", "tier", "memberlevel", "level")),
    "last_order_date": ("Last order date", False, "", ("lastorderdate", "lastorder", "lastpurchase", "lastpurchasedate", "lastpurchaseat")),
    "consent_date": ("Consent date", False, "Recorded as an email opt-in for people CEP has no consent answer for. It never overrides an unsubscribe.",
                     ("consentdate", "optindate", "optin", "consent", "subscribedat", "subscribedate", "optindatetime")),
}
EMAIL_RE = r"^[a-z0-9._%+'-]+@[a-z0-9-]+(\.[a-z0-9-]+)+$"           # passed as a query parameter, applied to the lower-cased address
PARTY_ID = "'UPL-' || substr(encode(sha256(convert_to(r.tenant_id::text || ':' || lower({email}), 'UTF8')), 'hex'), 1, 32)"


class ImportError_(Exception):
    """Something the operator can fix: the message is shown as is, and the job is not retried."""


class Cancelled(Exception):
    """The operator cancelled the upload while a worker was on it."""


def catalogue() -> list[dict]:
    return [{"key": key, "label": label, "required": required, "help": help_} for key, (label, required, help_, _) in PROPERTIES.items()]


def _conn():
    return connections[context.require().db_alias]


# ---------------------------------------------------------------- the file
def storage():
    """Private: never the public media storage. One object per import, deleted as soon as its rows are staged."""
    if settings.MEDIA_BUCKET:
        from apps.media.storage import TenantPrivateStorage
        return TenantPrivateStorage()                     # bound to the workspace in scope: a new one per use
    return FileSystemStorage(location=settings.LIST_IMPORT_DIR)


def _key(record: ContactListImport) -> str:
    return f"list-imports/{record.tenant_id}/{record.pk}.csv"


def discard_file(record: ContactListImport) -> None:
    if record.storage_key:
        try:
            storage().delete(record.storage_key)
        except Exception:                                 # noqa: BLE001  (a leftover file is swept later; never fail a job over it)
            pass


def _norm(header: str) -> str:
    return re.sub(r"[^a-z0-9]", "", header.lower())


def guess(headers: list[str]) -> dict:
    """{property: column} for the headers that clearly name a property; each column is used once."""
    mapping, used = {}, set()
    for key, (_, _, _, words) in PROPERTIES.items():
        for header in headers:
            if header not in used and _norm(header) in words:
                mapping[key] = header
                used.add(header)
                break
    return mapping


def _headers(first_row: list[str]) -> list[str]:
    headers, seen = [], set()
    for index, cell in enumerate(first_row, start=1):
        name = (cell or "").replace(chr(0), "").strip()[:120] or f"Column {index}"
        base, n = name, 2
        while name.lower() in seen:
            name = f"{base} ({n})"
            n += 1
        seen.add(name.lower())
        headers.append(name)
    return headers


def _sniff(head: bytes, complete: bool) -> tuple[str, str, list[list[str]]]:
    """(encoding, delimiter, the first lines) from the start of the file."""
    text = None
    for encoding in ("utf-8-sig", "cp1252"):
        try:
            text = head.decode(encoding)
            break
        except UnicodeDecodeError as exc:
            if encoding == "utf-8-sig" and not complete and exc.start >= len(head) - 4:
                text = head[:exc.start].decode(encoding)  # the head ended in the middle of a character
                break
    if text is None:
        raise ImportError_("The file is not text CEP can read. Save it as CSV (UTF-8) and try again.")
    text = text.replace(chr(0), "")
    if not text.strip():
        raise ImportError_("The file is empty.")
    try:
        delimiter = csv.Sniffer().sniff(text[:8192], delimiters=",;\t|").delimiter
    except csv.Error:
        delimiter = ","
    lines = list(csv.reader(io.StringIO(text, newline=""), delimiter=delimiter))
    if not complete and len(lines) > 1:
        lines = lines[:-1]                                # the last line of the head may be cut in the middle
    return encoding, delimiter, lines[:400]


def accept(contact_list: ContactList, upload, user_id=None) -> ContactListImport:
    """In the request. Stores the file, samples its columns, queues the import. Raises ImportError_ for a file to fix."""
    from . import jobs
    name = (getattr(upload, "name", "") or "upload.csv")[:255]
    if not name.lower().endswith(".csv"):
        raise ImportError_("Only CSV files can be uploaded. In Excel or Sheets choose “Save as CSV”.")
    size = int(getattr(upload, "size", 0) or 0)
    if size > MAX_BYTES:
        raise ImportError_("The file is larger than 50 MB. Split it and upload the parts as separate lists.")
    if size == 0:
        raise ImportError_("The file is empty.")
    jobs.assert_room(contact_list.tenant_id)

    upload.seek(0)
    encoding, delimiter, lines = _sniff(upload.read(HEAD_BYTES), complete=size <= HEAD_BYTES)
    headers = _headers(lines[0])
    if len(headers) > MAX_COLUMNS:
        raise ImportError_("The file has more than 100 columns. Keep the columns you need and upload it again.")
    if not any(any((cell or "").strip() for cell in line) for line in lines[1:]):
        raise ImportError_("The file has a header row but no contacts.")
    samples = {header: [] for header in headers}
    for line in lines[1:]:
        for index, header in enumerate(headers):
            value = line[index].strip() if index < len(line) else ""
            if value and len(samples[header]) < SAMPLES and value not in samples[header]:
                samples[header].append(value[:80])
    guessed = guess(headers)
    by_column = {column: key for key, column in guessed.items()}

    record = ContactListImport(tenant_id=contact_list.tenant_id, contact_list=contact_list, file_name=name, file_size=size, created_by_id=user_id,
                               status=ContactListImport.Status.UPLOADED, file_encoding=encoding, file_delimiter=delimiter, column_mapping=guessed,
                               file_columns=[{"name": header, "samples": samples[header], "guess": by_column.get(header)} for header in headers],
                               progress_total=size)
    upload.seek(0)
    record.storage_key = storage().save(_key(record), upload)             # streamed in chunks by Django: the file is never held in memory
    record.save(force_insert=True)
    jobs.enqueue(record, "STAGE")
    return record


def clean_mapping(record: ContactListImport, mapping: dict) -> dict:
    columns = {column["name"] for column in record.file_columns}
    cleaned, used = {}, {}
    for key, column in (mapping or {}).items():
        if not column:
            continue
        if key not in PROPERTIES:
            raise ImportError_(f"Unknown property: {key}")
        if column not in columns:
            raise ImportError_(f"The file has no column named “{column}”.")
        if column in used:
            raise ImportError_(f"“{column}” is mapped to both {PROPERTIES[used[column]][0]} and {PROPERTIES[key][0]}. Use each column once.")
        used[column] = key
        cleaned[key] = column
    if "email" not in cleaned:
        raise ImportError_("Choose the column that holds the email address.")
    return cleaned


def confirm_mapping(record: ContactListImport, mapping: dict) -> ContactListImport:
    """In the request. The check itself is a job: queued now when the file has been read, otherwise right after the reading."""
    from . import jobs
    if record.status in ("APPLYING", "APPLIED"):
        raise ImportError_("This import was already added to the list.")
    if record.status in ("FAILED", "CANCELLED"):
        raise ImportError_("This upload did not finish. Upload the file again.")
    if record.status == "MATCHING":
        raise ImportError_("The file is being checked right now. Wait for it to finish, then change the mapping.")
    record.column_mapping = clean_mapping(record, mapping)
    record.mapping_confirmed = True
    record.save(update_fields=["column_mapping", "mapping_confirmed"])
    if record.status in ("STAGED", "REVIEW"):
        jobs.enqueue(record, "REVIEW")
    return record


def request_apply(record: ContactListImport) -> ContactListImport:
    from . import jobs
    if record.status in ("APPLYING", "APPLIED"):
        raise ImportError_("This import was already added to the list.")
    if record.status != "REVIEW" or record.next_action:
        raise ImportError_("Review the file before importing it.")
    if record.matched_count + record.unmatched_count == 0:
        raise ImportError_("No row in this file can be imported.")
    jobs.enqueue(record, "APPLY")
    return record


# ---------------------------------------------------------------- worker: read the file
def stage(record: ContactListImport, chunk_rows: int, beat) -> None:
    """Streams the stored file into the staging table, `chunk_rows` rows per transaction. `beat(done, total)` reports
    progress, keeps the claim alive and raises Cancelled when the operator gave up."""
    tenant, pk = str(record.tenant_id), str(record.pk)
    for encoding in dict.fromkeys([record.file_encoding or "utf-8-sig", "cp1252"]):
        with session.tx(), _conn().cursor() as cursor:                     # a retry, or the other encoding: start clean
            cursor.execute("DELETE FROM contact_list_import_row WHERE tenant_id = %s AND import_id = %s", [tenant, pk])
        try:
            total = _stage_as(record, encoding, chunk_rows, beat)
            break
        except UnicodeDecodeError:
            continue
    else:
        raise ImportError_("The file is not text CEP can read. Save it as CSV (UTF-8) and try again.")
    if total == 0:
        raise ImportError_("The file has a header row but no contacts.")
    discard_file(record)
    record.row_count, record.storage_key, record.file_encoding = total, None, encoding
    record.progress_done = record.progress_total = total
    with session.tx():
        record.save(update_fields=["row_count", "storage_key", "file_encoding", "progress_done", "progress_total"])


def _stage_as(record: ContactListImport, encoding: str, chunk_rows: int, beat) -> int:
    tenant, pk = str(record.tenant_id), str(record.pk)
    size = record.file_size or 0
    with storage().open(record.storage_key, "rb") as opened:
        binary = getattr(opened, "file", opened)                                # the real buffered stream under Django's File
        text = io.TextIOWrapper(binary, encoding=encoding, errors="strict", newline="")
        reader = csv.reader((line.replace(chr(0), "") for line in text), delimiter=record.file_delimiter or ",")
        try:
            headers = _headers(next(reader))
        except StopIteration:
            raise ImportError_("The file is empty.") from None
        rows, total = [], 0

        def flush():
            with session.tx(), _conn().cursor() as cursor:
                cursor.execute("""INSERT INTO contact_list_import_row (import_id, tenant_id, row_number, raw)
                                  SELECT %s, %s, (e ->> 'n')::int, e -> 'r' FROM jsonb_array_elements(%s::jsonb) e""", [pk, tenant, json.dumps(rows)])
            rows.clear()
            try:
                position = binary.tell()
            except (OSError, ValueError):
                position = 0
            beat(min(position, size) if position else 0, size)

        for line in reader:
            if not any((cell or "").strip() for cell in line):
                continue                                                       # blank line
            total += 1
            if total > MAX_ROWS:
                raise ImportError_("The file has more than 250,000 rows. Split it and upload the parts as separate lists.")
            rows.append({"n": total + 1,                                        # + 1: the header is line 1 of the file
                         "r": {header: (line[index].strip()[:500] if index < len(line) else "") for index, header in enumerate(headers)}})
            if len(rows) >= chunk_rows:
                flush()
        if rows:
            flush()
        text.detach()                                     # the `with` closes the stream; the wrapper must not try again
    return total


# ---------------------------------------------------------------- worker: check the rows
def _expressions(mapping: dict) -> tuple[dict, dict]:
    """SQL expressions over contact_list_import_row r for every property, and their parameters."""
    params, value = {}, {}
    for key in PROPERTIES:
        if key in mapping:
            params[f"col_{key}"] = mapping[key]
            value[key] = f"NULLIF(btrim(r.raw ->> %(col_{key})s), '')"
        else:
            value[key] = "NULL::text"
    digits = f"regexp_replace({value['mobile']}, '[^0-9]', '', 'g')"
    value["mobile_e164"] = f"""CASE WHEN {value['mobile']} IS NULL THEN NULL
                                    WHEN {value['mobile']} LIKE '+%%' AND length({digits}) BETWEEN 8 AND 15 THEN '+' || {digits}
                                    WHEN length({digits}) = 10 THEN '+1' || {digits}
                                    WHEN length({digits}) = 11 AND {digits} LIKE '1%%' THEN '+' || {digits}
                                    ELSE NULL END"""
    for key in ("last_order_date", "consent_date"):
        value[f"{key}_ok"] = f"({value[key]} IS NOT NULL AND pg_input_is_valid({value[key]}, 'date'))"
    return value, params


def _ranges(last_line: int, chunk_rows: int):
    """(from, to) line numbers, inclusive; line 1 is the header."""
    start = 2
    while start <= last_line:
        yield start, min(start + chunk_rows - 1, last_line)
        start += chunk_rows


def review(record: ContactListImport, chunk_rows: int, beat) -> None:
    mapping = clean_mapping(record, record.column_mapping)
    v, base = _expressions(mapping)
    base.update({"imp": str(record.pk), "tenant": str(record.tenant_id), "email_re": EMAIL_RE})
    mine = "r.tenant_id = %(tenant)s AND r.import_id = %(imp)s"
    span = mine + " AND r.row_number BETWEEN %(a)s AND %(b)s"
    last_line = record.row_count + 1
    ranges = list(_ranges(last_line, chunk_rows))
    steps, done = len(ranges) * 2 + 2, 0

    def tick():
        nonlocal done
        done += 1
        beat(min(record.row_count, record.row_count * done // steps), record.row_count)

    connection = _conn()
    try:
        # who CEP knows, once per job and indexed, instead of scanning the customer master for every range of lines.
        # Temporary tables are private to this database session; the worker keeps the connection for the whole job.
        with session.tx(), connection.cursor() as cursor:
            cursor.execute("DROP TABLE IF EXISTS cep_known_email, cep_known_loyalty")
            cursor.execute("""CREATE TEMP TABLE cep_known_email AS
                              SELECT lower(e ->> 'address') AS address, min(cm.party_id) AS party_id
                                FROM customer_master cm, jsonb_array_elements(cm.emails) e
                               WHERE cm.tenant_id = %(tenant)s AND COALESCE(e ->> 'address', '') <> '' GROUP BY 1""", base)
            cursor.execute("CREATE UNIQUE INDEX ON cep_known_email (address)")
            cursor.execute("""CREATE TEMP TABLE cep_known_loyalty AS
                              SELECT upper(cm.custom_attributes ->> 'loyalty_id') AS loyalty_id, min(cm.party_id) AS party_id
                                FROM customer_master cm WHERE cm.tenant_id = %(tenant)s AND cm.custom_attributes ? 'loyalty_id' GROUP BY 1""", base)
            cursor.execute("CREATE UNIQUE INDEX ON cep_known_loyalty (loyalty_id)")
            cursor.execute("ANALYZE cep_known_email")
        tick()

        for a, b in ranges:                               # 1. start clean; rows that cannot be imported
            params = {**base, "a": a, "b": b}
            with session.tx(), connection.cursor() as cursor:
                cursor.execute(f"""UPDATE contact_list_import_row r SET match_status = 'PENDING', match_method = NULL, matched_party_id = NULL,
                                          error_message = NULL, warning = NULL WHERE {span}""", params)
                cursor.execute(f"""UPDATE contact_list_import_row r
                                      SET match_status = 'REJECTED',
                                          error_message = CASE WHEN {v['email']} IS NULL THEN 'No email address'
                                                               WHEN length({v['email']}) > 254 THEN 'The email address is too long'
                                                               ELSE 'Not a valid email address' END
                                    WHERE {span} AND ({v['email']} IS NULL OR length({v['email']}) > 254 OR lower({v['email']}) !~ %(email_re)s)""", params)
            tick()

        with session.tx(), connection.cursor() as cursor:                 # 2. the same address again, anywhere further down the file
            cursor.execute(f"""UPDATE contact_list_import_row r
                                  SET match_status = 'DUPLICATE', error_message = 'Same email address as line ' || d.first_line
                                 FROM (SELECT r.id, row_number() OVER w AS n, first_value(r.row_number) OVER w AS first_line
                                         FROM contact_list_import_row r WHERE {mine} AND r.match_status = 'PENDING'
                                       WINDOW w AS (PARTITION BY lower({v['email']}) ORDER BY r.row_number)) d
                                WHERE {mine} AND r.id = d.id AND d.n > 1""", base)
        tick()

        for a, b in ranges:                               # 3. known (loyalty ID, then address)  4. new  5. remarks
            params = {**base, "a": a, "b": b}
            with session.tx(), connection.cursor() as cursor:
                if "loyalty_id" in mapping:
                    cursor.execute(f"""UPDATE contact_list_import_row r
                                          SET match_status = 'MATCHED', match_method = 'LOYALTY_ID', matched_party_id = k.party_id,
                                              warning = CASE WHEN EXISTS (SELECT 1 FROM cep_known_email e WHERE e.party_id = k.party_id AND e.address = lower({v['email']})) THEN NULL
                                                             ELSE 'Recognised by loyalty ID: the email address CEP has on file is used, not the one in the file' END
                                         FROM cep_known_loyalty k
                                        WHERE {span} AND r.match_status = 'PENDING' AND upper({v['loyalty_id']}) = k.loyalty_id""", params)
                cursor.execute(f"""UPDATE contact_list_import_row r SET match_status = 'MATCHED', match_method = 'EMAIL', matched_party_id = k.party_id
                                     FROM cep_known_email k WHERE {span} AND r.match_status = 'PENDING' AND lower({v['email']}) = k.address""", params)
                cursor.execute(f"""UPDATE contact_list_import_row r SET match_status = 'UNMATCHED', match_method = 'EMAIL',
                                          matched_party_id = {PARTY_ID.format(email=v['email'])}
                                    WHERE {span} AND r.match_status = 'PENDING'""", params)
                cursor.execute(f"""UPDATE contact_list_import_row r
                                      SET warning = NULLIF(concat_ws('; ', r.warning,
                                            CASE WHEN {v['mobile']} IS NOT NULL AND ({v['mobile_e164']}) IS NULL THEN 'Mobile number not recognised: left out' END,
                                            CASE WHEN {v['last_order_date']} IS NOT NULL AND NOT {v['last_order_date_ok']} THEN 'Last order date not recognised: left out' END,
                                            CASE WHEN {v['consent_date']} IS NOT NULL AND NOT {v['consent_date_ok']} THEN 'Consent date not recognised: no consent recorded'
                                                 WHEN {v['consent_date_ok']} AND ({v['consent_date']})::date > current_date THEN 'Consent date is in the future: no consent recorded' END), '')
                                    WHERE {span} AND r.match_status IN ('MATCHED', 'UNMATCHED')""", params)
            tick()

        with session.tx(), connection.cursor() as cursor:
            cursor.execute(f"""SELECT count(*) FILTER (WHERE match_status = 'MATCHED'), count(*) FILTER (WHERE match_status = 'UNMATCHED'),
                                      count(*) FILTER (WHERE match_status = 'DUPLICATE'), count(*) FILTER (WHERE match_status = 'REJECTED'),
                                      count(*) FILTER (WHERE warning IS NOT NULL AND match_status IN ('MATCHED', 'UNMATCHED'))
                                 FROM contact_list_import_row r WHERE {mine}""", base)
            matched, new, duplicate, rejected, warnings = cursor.fetchone()
    finally:
        try:
            with connection.cursor() as cursor:
                cursor.execute("DROP TABLE IF EXISTS cep_known_email, cep_known_loyalty")
        except Exception:                                 # noqa: BLE001  (the session ends with the job anyway)
            pass
    record.column_mapping = mapping
    record.matched_count, record.unmatched_count, record.duplicate_count = matched, new, duplicate
    record.rejected_count, record.warning_count = rejected, warnings
    record.progress_done = record.progress_total = record.row_count
    with session.tx():
        record.save(update_fields=["column_mapping", "matched_count", "unmatched_count", "duplicate_count", "rejected_count", "warning_count", "progress_done", "progress_total"])


def issues(record: ContactListImport, limit: int = 50) -> list[dict]:
    """The first rows that are held back or carry a remark, for the review step."""
    with _conn().cursor() as cursor:
        cursor.execute("""SELECT row_number, match_status, COALESCE(error_message, warning), raw
                            FROM contact_list_import_row
                           WHERE tenant_id = %s AND import_id = %s AND (match_status IN ('REJECTED', 'DUPLICATE') OR warning IS NOT NULL)
                           ORDER BY (match_status IN ('REJECTED', 'DUPLICATE')) DESC, row_number LIMIT %s""", [str(record.tenant_id), str(record.pk), limit])
        email_column = (record.column_mapping or {}).get("email")
        found = []
        for line, status, message, raw in cursor.fetchall():
            raw = json.loads(raw) if isinstance(raw, str) else (raw or {})          # Django leaves jsonb from a raw cursor as text
            found.append({"line": line, "kind": "error" if status in ("REJECTED", "DUPLICATE") else "warning", "message": message,
                          "value": raw.get(email_column, "") if email_column else ""})
        return found


# ---------------------------------------------------------------- worker: add to the list
def apply(record: ContactListImport, chunk_rows: int, beat, user_id=None) -> None:
    """A range of lines per transaction. Safe to run again after a crash: every insert skips what is already there."""
    v, base = _expressions(record.column_mapping)
    contact_list = record.contact_list
    base.update({"imp": str(record.pk), "tenant": str(record.tenant_id), "list": str(contact_list.pk), "file": record.file_name})
    span = "r.tenant_id = %(tenant)s AND r.import_id = %(imp)s AND r.row_number BETWEEN %(a)s AND %(b)s"
    created = added = consents = 0
    for a, b in _ranges(record.row_count + 1, chunk_rows):
        params = {**base, "a": a, "b": b}
        with session.tx(), _conn().cursor() as cursor:
            # people CEP did not know: its own customer rows (not a C360 copy), addressed by a key derived from workspace + address
            cursor.execute(f"""INSERT INTO customer_master (party_id, tenant_id, first_name, last_name, emails, phones, primary_address, custom_attributes, source_system, is_synced_copy)
                               SELECT r.matched_party_id, r.tenant_id, left({v['first_name']}, 120), left({v['last_name']}, 120),
                                      jsonb_build_array(jsonb_build_object('address', lower({v['email']}), 'is_primary', TRUE, 'is_valid', TRUE)),
                                      CASE WHEN ({v['mobile_e164']}) IS NULL THEN '[]'::jsonb
                                           ELSE jsonb_build_array(jsonb_build_object('number', {v['mobile_e164']}, 'type', 'MOBILE', 'is_primary', TRUE)) END,
                                      CASE WHEN {v['postal_code']} IS NULL THEN NULL ELSE jsonb_build_object('postal_code', {v['postal_code']}) END,
                                      jsonb_strip_nulls(jsonb_build_object('loyalty_id', {v['loyalty_id']}, 'loyalty_tier', {v['loyalty_tier']},
                                            'last_purchase_at', CASE WHEN {v['last_order_date_ok']} THEN ({v['last_order_date']})::date END,
                                            'first_seen_in', %(file)s)),
                                      'CEP_UPLOAD', FALSE
                                 FROM contact_list_import_row r WHERE {span} AND r.match_status = 'UNMATCHED'
                               ON CONFLICT (party_id) DO NOTHING""", params)
            created += cursor.rowcount
            cursor.execute(f"""INSERT INTO contact_list_member (contact_list_id, tenant_id, party_id, custom_attributes, membership_source, matched_by, import_id)
                               SELECT DISTINCT ON (r.matched_party_id) %(list)s, r.tenant_id, r.matched_party_id,
                                      jsonb_strip_nulls(jsonb_build_object('first_name', {v['first_name']}, 'last_name', {v['last_name']}, 'postal_code', {v['postal_code']},
                                            'loyalty_tier', {v['loyalty_tier']},
                                            'last_order_date', CASE WHEN {v['last_order_date_ok']} THEN ({v['last_order_date']})::date END)),
                                      'UPLOAD', r.match_method, r.import_id
                                 FROM contact_list_import_row r WHERE {span} AND r.match_status IN ('MATCHED', 'UNMATCHED')
                                ORDER BY r.matched_party_id, r.row_number
                               ON CONFLICT (tenant_id, contact_list_id, party_id) DO NOTHING""", params)
            added += cursor.rowcount
            if "consent_date" in record.column_mapping:
                cursor.execute(f"""WITH given AS (
                                        SELECT DISTINCT ON (r.matched_party_id) r.matched_party_id AS party_id, r.row_number, ({v['consent_date']})::date AS given_on
                                          FROM contact_list_import_row r
                                         WHERE {span} AND r.match_status IN ('MATCHED', 'UNMATCHED') AND {v['consent_date_ok']} AND ({v['consent_date']})::date <= current_date
                                           AND NOT EXISTS (SELECT 1 FROM consent_suppression cs WHERE cs.tenant_id = r.tenant_id AND cs.party_id = r.matched_party_id
                                                              AND cs.channel = 'EMAIL' AND cs.consent_status <> 'UNKNOWN')
                                         ORDER BY r.matched_party_id, r.row_number),
                                      recorded AS (
                                        INSERT INTO consent_record (tenant_id, party_id, channel, action, source, evidence, contact_list_id, occurred_at)
                                        SELECT %(tenant)s, g.party_id, 'EMAIL', 'OPT_IN', 'IMPORT',
                                               jsonb_build_object('file', %(file)s, 'line', g.row_number, 'import_id', %(imp)s, 'consent_date', g.given_on),
                                               %(list)s, now()          -- consent_record is partitioned by month on occurred_at: the day it was GIVEN is in the evidence
                                          FROM given g RETURNING id, party_id, (evidence ->> 'consent_date')::date AS given_on)
                                   INSERT INTO consent_suppression (tenant_id, party_id, channel, consent_status, opted_in_at, marketable, last_consent_record_id, source_system, updated_at)
                                   SELECT %(tenant)s, party_id, 'EMAIL', 'OPTED_IN', given_on, TRUE, id, 'CEP', now() FROM recorded
                                   ON CONFLICT (tenant_id, party_id, channel) DO UPDATE
                                      SET consent_status = 'OPTED_IN', opted_in_at = EXCLUDED.opted_in_at, marketable = NOT consent_suppression.suppressed,
                                          marketable_reason = NULL, last_consent_record_id = EXCLUDED.last_consent_record_id, updated_at = now()
                                    WHERE consent_suppression.consent_status = 'UNKNOWN'""", params)
                consents += cursor.rowcount
        beat(min(b - 1, record.row_count), record.row_count)

    now = timezone.now()
    with session.tx(), _conn().cursor() as cursor:
        cursor.execute("SELECT count(*), count(*) FILTER (WHERE import_id = %s) FROM contact_list_member WHERE tenant_id = %s AND contact_list_id = %s",
                       [base["imp"], base["tenant"], base["list"]])
        members, from_this_file = cursor.fetchone()                           # counted, not summed: right after a retry too
        ContactList.objects.filter(pk=contact_list.pk).update(
            member_count=members, status=ContactList.Status.ACTIVE if contact_list.status == ContactList.Status.DRAFT else contact_list.status,
            last_refreshed_at=now, source_reference=contact_list.source_reference or record.file_name, updated_by_id=user_id or contact_list.updated_by_id)
    record.applied_count = from_this_file
    record.new_customer_count = (record.new_customer_count or 0) + created
    record.consent_count = (record.consent_count or 0) + consents
    record.completed_at = now
    with session.tx():
        record.save(update_fields=["applied_count", "new_customer_count", "consent_count", "completed_at"])
