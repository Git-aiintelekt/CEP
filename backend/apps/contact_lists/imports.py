"""Uploading a file into a contact list: read -> map -> review -> apply.

    read(file)      the file is parsed once and staged row by row in contact_list_import_row (`raw` = the row as received,
                    keyed by the file's own column names). Nothing is kept of the file itself.
    review(mapping) set-based SQL over the staged rows: which rows cannot be imported (no usable email address), which
                    repeat an earlier row, who is already known (loyalty ID, then email address) and who is new. Can be
                    run again with another mapping; nothing outside the staging table changes.
    apply()         new people become customer_master rows owned by CEP (source_system CEP_UPLOAD, not a C360 copy), the
                    list gets its members, and a consent date in the file becomes an email opt-in for people CEP has
                    no consent answer for. It never overrides an unsubscribe.

Everything runs inside the request's transaction, under the tenant's row-level security. COPY FROM is not available on
tables with row-level security, so rows are staged with INSERT ... SELECT FROM jsonb_array_elements in chunks.
"""
import csv
import io
import json
import re

from django.db import connections
from django.utils import timezone

from apps.tenants import context

from .models import ContactList, ContactListImport

MAX_BYTES = 50 * 1024 * 1024
MAX_ROWS = 250_000
CHUNK = 5_000
SAMPLES = 3

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


class ImportError_(Exception):
    """Something the operator can fix: the message is shown as is."""


def catalogue() -> list[dict]:
    return [{"key": key, "label": label, "required": required, "help": help_} for key, (label, required, help_, _) in PROPERTIES.items()]


def _conn():
    return connections[context.require().db_alias]


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


def _decode(data: bytes) -> str:
    for encoding in ("utf-8-sig", "cp1252"):
        try:
            return data.decode(encoding)
        except UnicodeDecodeError:
            continue
    raise ImportError_("The file is not text CEP can read. Save it as CSV (UTF-8) and try again.")


def _headers(first_row: list[str]) -> list[str]:
    headers, seen = [], set()
    for index, cell in enumerate(first_row, start=1):
        name = (cell or "").strip()[:120] or f"Column {index}"
        base, n = name, 2
        while name.lower() in seen:
            name = f"{base} ({n})"
            n += 1
        seen.add(name.lower())
        headers.append(name)
    return headers


def read(contact_list: ContactList, upload, user_id=None) -> ContactListImport:
    """Stages the file. Raises ImportError_ for a file the operator has to fix."""
    name = (getattr(upload, "name", "") or "upload.csv")[:255]
    if not name.lower().endswith(".csv"):
        raise ImportError_("Only CSV files can be uploaded. In Excel or Sheets choose “Save as CSV”.")
    size = getattr(upload, "size", None)
    if size is not None and size > MAX_BYTES:
        raise ImportError_("The file is larger than 50 MB. Split it and upload the parts as separate lists.")
    data = upload.read()
    if len(data) > MAX_BYTES:
        raise ImportError_("The file is larger than 50 MB. Split it and upload the parts as separate lists.")
    text = _decode(data).replace(chr(0), "")                                   # PostgreSQL text and jsonb cannot hold NUL
    if not text.strip():
        raise ImportError_("The file is empty.")
    try:
        dialect = csv.Sniffer().sniff(text[:8192], delimiters=",;\t|")
    except csv.Error:
        dialect = csv.excel
    reader = csv.reader(io.StringIO(text, newline=""), dialect)
    try:
        headers = _headers(next(reader))
    except StopIteration:
        raise ImportError_("The file is empty.") from None
    if len(headers) > 100:
        raise ImportError_("The file has more than 100 columns. Keep the columns you need and upload it again.")

    record = ContactListImport.objects.create(tenant_id=contact_list.tenant_id, contact_list=contact_list, file_name=name, file_size=len(data),
                                              status=ContactListImport.Status.UPLOADED, created_by_id=user_id)
    samples = {header: [] for header in headers}
    rows, total = [], 0
    with _conn().cursor() as cursor:
        def flush():
            cursor.execute("""INSERT INTO contact_list_import_row (import_id, tenant_id, row_number, raw)
                              SELECT %s, %s, (e ->> 'n')::int, e -> 'r' FROM jsonb_array_elements(%s::jsonb) e""",
                           [str(record.pk), str(contact_list.tenant_id), json.dumps(rows)])
            rows.clear()

        for line in reader:
            if not any((cell or "").strip() for cell in line):
                continue                                                       # blank line
            total += 1
            if total > MAX_ROWS:
                raise ImportError_("The file has more than 250,000 rows. Split it and upload the parts as separate lists.")
            raw = {header: (line[index].strip()[:500] if index < len(line) else "") for index, header in enumerate(headers)}
            for header, value in raw.items():
                if value and len(samples[header]) < SAMPLES and value not in samples[header]:
                    samples[header].append(value[:80])
            rows.append({"n": total + 1, "r": raw})                            # + 1: the header is line 1 of the file
            if len(rows) >= CHUNK:
                flush()
        if rows:
            flush()
    if total == 0:
        raise ImportError_("The file has a header row but no contacts.")

    guessed = guess(headers)
    by_column = {column: key for key, column in guessed.items()}
    record.row_count = total
    record.file_columns = [{"name": header, "samples": samples[header], "guess": by_column.get(header)} for header in headers]
    record.column_mapping = guessed
    record.save(update_fields=["row_count", "file_columns", "column_mapping"])
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


PARTY_ID = "'UPL-' || substr(encode(sha256(convert_to(r.tenant_id::text || ':' || lower({email}), 'UTF8')), 'hex'), 1, 32)"


def review(record: ContactListImport, mapping: dict) -> ContactListImport:
    if record.status == ContactListImport.Status.APPLIED:
        raise ImportError_("This import was already added to the list.")
    mapping = clean_mapping(record, mapping)
    v, params = _expressions(mapping)
    params.update({"imp": str(record.pk), "tenant": str(record.tenant_id), "email_re": EMAIL_RE})
    mine = "r.tenant_id = %(tenant)s AND r.import_id = %(imp)s"
    with _conn().cursor() as cursor:
        cursor.execute(f"""UPDATE contact_list_import_row r SET match_status = 'PENDING', match_method = NULL, matched_party_id = NULL,
                                  error_message = NULL, warning = NULL WHERE {mine}""", params)
        # 1. rows that cannot be imported
        cursor.execute(f"""UPDATE contact_list_import_row r
                              SET match_status = 'REJECTED',
                                  error_message = CASE WHEN {v['email']} IS NULL THEN 'No email address'
                                                       WHEN length({v['email']}) > 254 THEN 'The email address is too long'
                                                       ELSE 'Not a valid email address' END
                            WHERE {mine} AND ({v['email']} IS NULL OR length({v['email']}) > 254 OR lower({v['email']}) !~ %(email_re)s)""", params)
        # 2. the same address again, further down the file
        cursor.execute(f"""UPDATE contact_list_import_row r
                              SET match_status = 'DUPLICATE', error_message = 'Same email address as line ' || d.first_line
                             FROM (SELECT r.id, row_number() OVER w AS n, first_value(r.row_number) OVER w AS first_line
                                     FROM contact_list_import_row r WHERE {mine} AND r.match_status = 'PENDING'
                                   WINDOW w AS (PARTITION BY lower({v['email']}) ORDER BY r.row_number)) d
                            WHERE {mine} AND r.id = d.id AND d.n > 1""", params)
        # 3. people CEP already knows: loyalty ID first, then email address
        if "loyalty_id" in mapping:
            cursor.execute(f"""UPDATE contact_list_import_row r
                                  SET match_status = 'MATCHED', match_method = 'LOYALTY_ID', matched_party_id = c.party_id,
                                      warning = 'Recognised by loyalty ID: the email address CEP has on file is used, not the one in the file'
                                 FROM (SELECT cm.custom_attributes ->> 'loyalty_id' AS loyalty_id, min(cm.party_id) AS party_id
                                         FROM customer_master cm WHERE cm.tenant_id = %(tenant)s AND cm.custom_attributes ? 'loyalty_id' GROUP BY 1) c
                                WHERE {mine} AND r.match_status = 'PENDING' AND upper({v['loyalty_id']}) = upper(c.loyalty_id)""", params)
            # ... unless the address in the file is one CEP has for that person anyway
            cursor.execute(f"""UPDATE contact_list_import_row r SET warning = NULL
                                WHERE {mine} AND r.match_method = 'LOYALTY_ID'
                                  AND EXISTS (SELECT 1 FROM customer_master cm, jsonb_array_elements(cm.emails) e
                                               WHERE cm.party_id = r.matched_party_id AND lower(e ->> 'address') = lower({v['email']}))""", params)
        cursor.execute(f"""UPDATE contact_list_import_row r
                              SET match_status = 'MATCHED', match_method = 'EMAIL', matched_party_id = c.party_id
                             FROM (SELECT lower(e ->> 'address') AS address, min(cm.party_id) AS party_id
                                     FROM customer_master cm, jsonb_array_elements(cm.emails) e
                                    WHERE cm.tenant_id = %(tenant)s AND COALESCE(e ->> 'address', '') <> '' GROUP BY 1) c
                            WHERE {mine} AND r.match_status = 'PENDING' AND lower({v['email']}) = c.address""", params)
        # 4. everyone else is new
        cursor.execute(f"""UPDATE contact_list_import_row r SET match_status = 'UNMATCHED', match_method = 'EMAIL', matched_party_id = {PARTY_ID.format(email=v['email'])}
                            WHERE {mine} AND r.match_status = 'PENDING'""", params)
        # 5. remarks on rows that ARE imported
        cursor.execute(f"""UPDATE contact_list_import_row r
                              SET warning = concat_ws('; ', r.warning,
                                    CASE WHEN {v['mobile']} IS NOT NULL AND ({v['mobile_e164']}) IS NULL THEN 'Mobile number not recognised: left out' END,
                                    CASE WHEN {v['last_order_date']} IS NOT NULL AND NOT {v['last_order_date_ok']} THEN 'Last order date not recognised: left out' END,
                                    CASE WHEN {v['consent_date']} IS NOT NULL AND NOT {v['consent_date_ok']} THEN 'Consent date not recognised: no consent recorded'
                                         WHEN {v['consent_date_ok']} AND ({v['consent_date']})::date > current_date THEN 'Consent date is in the future: no consent recorded' END)
                            WHERE {mine} AND r.match_status IN ('MATCHED', 'UNMATCHED')""", params)
        cursor.execute(f"UPDATE contact_list_import_row r SET warning = NULL WHERE {mine} AND r.warning = ''", params)
        cursor.execute(f"""SELECT count(*) FILTER (WHERE match_status = 'MATCHED'), count(*) FILTER (WHERE match_status = 'UNMATCHED'),
                                  count(*) FILTER (WHERE match_status = 'DUPLICATE'), count(*) FILTER (WHERE match_status = 'REJECTED'),
                                  count(*) FILTER (WHERE warning IS NOT NULL AND match_status IN ('MATCHED', 'UNMATCHED'))
                             FROM contact_list_import_row r WHERE {mine}""", params)
        matched, new, duplicate, rejected, warnings = cursor.fetchone()
    record.column_mapping = mapping
    record.matched_count, record.unmatched_count, record.duplicate_count = matched, new, duplicate
    record.rejected_count, record.warning_count = rejected, warnings
    record.status = ContactListImport.Status.REVIEW
    record.save(update_fields=["column_mapping", "matched_count", "unmatched_count", "duplicate_count", "rejected_count", "warning_count", "status"])
    return record


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


def apply(record: ContactListImport, user_id=None) -> ContactListImport:
    if record.status == ContactListImport.Status.APPLIED:
        raise ImportError_("This import was already added to the list.")
    if record.status != ContactListImport.Status.REVIEW:
        raise ImportError_("Review the file before importing it.")
    if record.matched_count + record.unmatched_count == 0:
        raise ImportError_("No row in this file can be imported.")
    v, params = _expressions(record.column_mapping)
    contact_list = record.contact_list
    params.update({"imp": str(record.pk), "tenant": str(record.tenant_id), "list": str(contact_list.pk), "file": record.file_name})
    mine = "r.tenant_id = %(tenant)s AND r.import_id = %(imp)s"
    with _conn().cursor() as cursor:
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
                             FROM contact_list_import_row r WHERE {mine} AND r.match_status = 'UNMATCHED'
                           ON CONFLICT (party_id) DO NOTHING""", params)
        created = cursor.rowcount
        cursor.execute(f"""INSERT INTO contact_list_member (contact_list_id, tenant_id, party_id, custom_attributes, membership_source, matched_by, import_id)
                           SELECT DISTINCT ON (r.matched_party_id) %(list)s, r.tenant_id, r.matched_party_id,
                                  jsonb_strip_nulls(jsonb_build_object('first_name', {v['first_name']}, 'last_name', {v['last_name']}, 'postal_code', {v['postal_code']},
                                        'loyalty_tier', {v['loyalty_tier']},
                                        'last_order_date', CASE WHEN {v['last_order_date_ok']} THEN ({v['last_order_date']})::date END)),
                                  'UPLOAD', r.match_method, r.import_id
                             FROM contact_list_import_row r WHERE {mine} AND r.match_status IN ('MATCHED', 'UNMATCHED')
                            ORDER BY r.matched_party_id, r.row_number
                           ON CONFLICT (tenant_id, contact_list_id, party_id) DO NOTHING""", params)
        added = cursor.rowcount
        consents = 0
        if "consent_date" in record.column_mapping:
            cursor.execute(f"""WITH given AS (
                                    SELECT DISTINCT ON (r.matched_party_id) r.matched_party_id AS party_id, r.row_number, ({v['consent_date']})::date AS given_on
                                      FROM contact_list_import_row r
                                     WHERE {mine} AND r.match_status IN ('MATCHED', 'UNMATCHED') AND {v['consent_date_ok']} AND ({v['consent_date']})::date <= current_date
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
            consents = cursor.rowcount
        cursor.execute("SELECT count(*) FROM contact_list_member WHERE tenant_id = %s AND contact_list_id = %s", [params["tenant"], params["list"]])
        members = cursor.fetchone()[0]
    now = timezone.now()
    ContactList.objects.filter(pk=contact_list.pk).update(member_count=members, status=ContactList.Status.ACTIVE if contact_list.status == ContactList.Status.DRAFT else contact_list.status,
                                                           last_refreshed_at=now, source_reference=contact_list.source_reference or record.file_name,
                                                           updated_by_id=user_id or contact_list.updated_by_id)
    record.status, record.applied_count, record.completed_at = ContactListImport.Status.APPLIED, added, now
    record.save(update_fields=["status", "applied_count", "completed_at"])
    record.new_customers, record.consents = created, consents                  # for the response only
    return record
