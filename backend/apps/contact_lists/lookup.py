"""Look Up in C360: a contact list from a file of IDs alone (docs/mockups/icrm-party-lookup.html, option A).

The file holds one ID per row (a Customer, Lead, Account or Contact ID: the party ID of the workspace's CRM). A worker reads each
person from the Report Databases ticked "Use for List Generation" (Settings → Report Databases), in the order the uploader picked
them: the first database that has the ID supplies the person. What it finds is written into the staged row under `c360:` keys,
with the reason when the row cannot be used, and the upload goes on as any other: the check (who C360 knows, governance), the
consent declaration, the review and the import. The ID becomes the person's key: someone C360 already has under that ID is
recognised by it, and a new person is created under a key made from it.

Load on the CRM: read-only sessions (external.connect), `lists.lookup_batch_ids` IDs a query (default 1,000) by primary key and
indexed columns, four queries a batch, one batch at a time, one upload at a time per workspace (jobs.py). A worker that stops
carries on after the last batch it wrote: every row it finished carries `c360:done`.

Rules (the CRM is an OFBiz-style party model: party, person, party_role, party_contact_mech[_purpose], telecom_number, contact_mech):
  every list   the ID is there and known; the party is not PARTY_DISABLED; with a role chosen, the party holds it
  texts        a current PRIMARY_PHONE; not ended (Thru Date); Phone Valid not N and 10 digits; not on DND; Allow Solicitation not N,
               except for a Customer, who comes in with no text consent (marketing texts then hold them back)
  email        a current PRIMARY_EMAIL, well formed; not ended; Email Valid not N; Allow Solicitation not N
  consent      Allow Solicitation Y is an opt-in dated by the solicitation change date, else the day the number or address was linked
"""
import json
import logging
import re
import time
from datetime import date, datetime

from django.db import connections
from django.utils import timezone

from apps.delivery.engine import session
from apps.tenants import context

log = logging.getLogger("cep.lists")
ENGINES = ("mysql57", "mysql80")
# role key -> (label, what the file's IDs are called, the CRM role types that count)
ROLES = {
    "CUSTOMER": ("Customer", "Customer ID", ("CUSTOMER",)),
    "LEAD": ("Lead", "Lead ID", ("LEAD", "PROSPECT")),
    "ACCOUNT": ("Account", "Account ID", ("ACCOUNT",)),
    "CONTACT": ("Account Primary Contact", "Contact ID", ("CONTACT",)),
}
ANY_ROLE_LABEL = "Party ID"
ID_HEADERS = {"partyid", "customerid", "custid", "accountid", "leadid", "contactid", "id", "icrmpartyid", "crmid"}
PREFIX = "c360:"
# the import's properties, read from the keys the lookup writes into each staged row
MAPPING = {key: PREFIX + key for key in ("party_id", "first_name", "last_name", "mobile", "email", "postal_code", "loyalty_id", "timezone", "sms_consent_date", "consent_date")}
FILLED = ("first_name", "mobile", "email", "loyalty_id", "postal_code", "timezone", "sms_consent_date", "consent_date")
EMAIL_RE = re.compile(r"^[a-z0-9._%+'-]+@[a-z0-9-]+(\.[a-z0-9-]+)+$")
QUERY_TIMEOUT_MS = 60_000


class LookupError_(Exception):
    """What the uploader asked for cannot be done (a database not offered, no ID column): shown as is."""


def id_label(role: str | None) -> str:
    return ROLES[role][1] if role in ROLES else ANY_ROLE_LABEL


# ---------------------------------------------------------------------------------------------------- in the request
def sources(tenant_id) -> list[dict]:
    """The Report Databases this workspace offers for list generation: ticked, MySQL, active, tested and usable."""
    from apps.insights import databases
    if not databases._present():
        return []
    out = []
    for row in databases.connections(tenant_id):
        if not row.get("use_for_lists") or row["engine"] not in ENGINES or row["status"] != "ACTIVE" or not row["password_enc"]:
            continue
        if row["read_only"] is None or (row["read_only"] is False and databases.read_only_required()):
            continue
        out.append({"id": row["id"], "name": row["name"], "database_name": row["database_name"], "last_tested_at": row["last_tested_at"]})
    return out


def roles() -> list[dict]:
    return [{"key": key, "label": label, "id_label": ids} for key, (label, ids, _) in ROLES.items()]


def plan(tenant_id, connection_ids: list[str], role: str | None) -> dict:
    """What a lookup upload is to do, checked: the databases in the order given, the role and what the IDs are called."""
    offered = {row["id"]: row for row in sources(tenant_id)}
    picked = [str(c).strip() for c in connection_ids if str(c).strip()]
    if not offered:
        raise LookupError_("No database is set up for list generation. An administrator ticks “Use for List Generation” on one under Settings → Report Databases.")
    if not picked and len(offered) == 1:
        picked = list(offered)
    if not picked:
        raise LookupError_("Choose the databases to look the IDs up in.")
    unknown = [c for c in picked if c not in offered]
    if unknown:
        raise LookupError_("One of the databases is not set up for list generation any more. Choose again.")
    role = (role or "").upper() or None
    if role and role not in ROLES:
        raise LookupError_("Choose a role from the list.")
    return {"connections": list(dict.fromkeys(picked)), "databases": [offered[c]["name"] for c in dict.fromkeys(picked)], "role": role, "id_label": id_label(role)}


def id_column(headers: list[str]) -> str:
    """The column that holds the IDs: the only column, or one named like an ID."""
    if len(headers) == 1:
        return headers[0]
    for header in headers:
        if re.sub(r"[^a-z0-9]", "", header.lower()) in ID_HEADERS:
            return header
    raise LookupError_("The file needs a column of IDs: name it “Customer ID” (or Party ID, Account ID, Lead ID, Contact ID), or keep it the only column.")


# ---------------------------------------------------------------------------------------------------- in the worker
def _day(value) -> str | None:
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    return None


def _ended(value) -> bool:
    if not isinstance(value, datetime):
        return False
    now = datetime.now(value.tzinfo) if value.tzinfo else datetime.now()
    return value <= now


def _in(ids: list[str]) -> str:
    return ", ".join(["%s"] * len(ids))


def read(conn, ids: list[str], role: str | None) -> dict[str, dict]:
    """One batch from one database: {party ID: what the CRM has}. Four indexed queries, newest current contact first."""
    found: dict[str, dict] = {}
    role_types = list(ROLES[role][2]) if role in ROLES else []
    with conn.cursor() as cursor:
        role_check = f"EXISTS (SELECT 1 FROM party_role r WHERE r.PARTY_ID = p.PARTY_ID AND r.ROLE_TYPE_ID IN ({_in(role_types)}))" if role_types else "1"
        cursor.execute(f"""SELECT p.PARTY_ID, p.STATUS_ID, pe.FIRST_NAME, pe.LAST_NAME, pe.LOYALTY_ID, pe.LOCAL_TIME_ZONE, {role_check},
                                  EXISTS (SELECT 1 FROM party_role r WHERE r.PARTY_ID = p.PARTY_ID AND r.ROLE_TYPE_ID = 'CUSTOMER')
                             FROM party p LEFT JOIN person pe ON pe.PARTY_ID = p.PARTY_ID
                            WHERE p.PARTY_ID IN ({_in(ids)})""", [*role_types, *ids])
        for party_id, status, first, last, loyalty, zone, has_role, customer in cursor.fetchall():
            found[str(party_id)] = {"status": status, "first_name": first, "last_name": last, "loyalty_id": loyalty, "timezone": zone,
                                    "has_role": bool(has_role), "customer": bool(customer), "phone": None, "email": None, "postal_code": None}
        known = [i for i in ids if i in found]
        if not known:
            return found
        cursor.execute(f"""SELECT pp.PARTY_ID, tn.AREA_CODE, tn.CONTACT_NUMBER, tn.PHONE_VALID_IND, tn.DND_STATUS,
                                  pcm.ALLOW_SOLICITATION, pcm.SOLICIT_CHANGE_DT, pcm.FROM_DATE, pcm.THRU_DATE
                             FROM party_contact_mech_purpose pp
                             JOIN telecom_number tn ON tn.CONTACT_MECH_ID = pp.CONTACT_MECH_ID
                             LEFT JOIN party_contact_mech pcm ON pcm.PARTY_ID = pp.PARTY_ID AND pcm.CONTACT_MECH_ID = pp.CONTACT_MECH_ID
                            WHERE pp.PARTY_ID IN ({_in(known)}) AND pp.CONTACT_MECH_PURPOSE_TYPE_ID = 'PRIMARY_PHONE'
                              AND (pp.THRU_DATE IS NULL OR pp.THRU_DATE > NOW())
                            ORDER BY pp.PARTY_ID, pp.FROM_DATE DESC, pcm.FROM_DATE DESC""", known)
        for party_id, area, number, valid, dnd, allow, changed, linked, ended in cursor.fetchall():
            person = found.get(str(party_id))
            if person is not None and person["phone"] is None:
                person["phone"] = {"digits": re.sub(r"\D", "", f"{area or ''}{number or ''}"), "valid": valid, "dnd": dnd, "allow": allow,
                                   "since": _day(changed) or _day(linked), "ended": _ended(ended)}
        cursor.execute(f"""SELECT pp.PARTY_ID, cm.INFO_STRING, COALESCE(pcm.EMAIL_VALID_IND, pp.EMAIL_VALID_IND), pcm.ALLOW_SOLICITATION,
                                  pcm.SOLICIT_CHANGE_DT, pcm.FROM_DATE, pcm.THRU_DATE
                             FROM party_contact_mech_purpose pp
                             JOIN contact_mech cm ON cm.CONTACT_MECH_ID = pp.CONTACT_MECH_ID
                             LEFT JOIN party_contact_mech pcm ON pcm.PARTY_ID = pp.PARTY_ID AND pcm.CONTACT_MECH_ID = pp.CONTACT_MECH_ID
                            WHERE pp.PARTY_ID IN ({_in(known)}) AND pp.CONTACT_MECH_PURPOSE_TYPE_ID = 'PRIMARY_EMAIL'
                              AND (pp.THRU_DATE IS NULL OR pp.THRU_DATE > NOW())
                            ORDER BY pp.PARTY_ID, pp.FROM_DATE DESC, pcm.FROM_DATE DESC""", known)
        for party_id, address, valid, allow, changed, linked, ended in cursor.fetchall():
            person = found.get(str(party_id))
            if person is not None and person["email"] is None:
                person["email"] = {"address": (address or "").strip().lower(), "valid": valid, "allow": allow, "since": _day(changed) or _day(linked), "ended": _ended(ended)}
        cursor.execute(f"""SELECT s.PARTY_ID, pa.POSTAL_CODE FROM party_supplemental_data s
                             JOIN postal_address pa ON pa.CONTACT_MECH_ID = s.PRIMARY_POSTAL_ADDRESS_ID
                            WHERE s.PARTY_ID IN ({_in(known)})""", known)
        for party_id, postal in cursor.fetchall():
            person = found.get(str(party_id))
            if person is not None and postal:
                person["postal_code"] = str(postal).strip()[:20]
    return found


def verdict(person: dict | None, channel: str, role: str | None) -> dict:
    """What goes into the staged row: the person's values, or `held` with the reason; `warning` for a remark."""
    label = id_label(role)
    if person is None:
        return {"held": f"{label} not found"}
    if person["status"] == "PARTY_DISABLED":
        return {"held": "Disabled in the source database"}
    if role and not person["has_role"]:
        return {"held": f"Not a {ROLES[role][0]}"}
    out = {key: (str(person[key]).strip()[:120] if person[key] else None) for key in ("first_name", "last_name", "loyalty_id", "timezone", "postal_code")}
    warning = None
    phone, email = person["phone"], person["email"]
    phone_ok = bool(phone) and not phone["ended"] and phone["valid"] != "N" and len(phone["digits"]) == 10 and phone["dnd"] != "Y"
    email_ok = bool(email) and not email["ended"] and email["valid"] != "N" and bool(EMAIL_RE.match(email["address"]))
    if channel in ("SMS", "BOTH"):
        if not phone:
            return {"held": "No primary phone"}
        if phone["ended"]:
            return {"held": "Number no longer in use"}
        if phone["valid"] == "N" or len(phone["digits"]) != 10:
            return {"held": "Number not valid"}
        if phone["dnd"] == "Y":
            return {"held": "On Do Not Disturb"}
        if phone["allow"] == "N":
            if not person["customer"]:
                return {"held": "Phone not open to solicitation"}
            warning = "Customer not open to solicitation: imported with no text consent"
    if channel in ("EMAIL", "BOTH"):
        if not email or not email["address"]:
            return {"held": "No email"}
        if email["ended"] or email["valid"] == "N" or not EMAIL_RE.match(email["address"]):
            return {"held": "Email not valid"}
        if email["allow"] == "N":
            return {"held": "Email not open to solicitation"}
    if phone_ok:
        out["mobile"] = phone["digits"]
        if phone["allow"] == "Y" and phone["since"]:
            out["sms_consent_date"] = phone["since"]
    if email_ok and email["allow"] != "N":
        out["email"] = email["address"]
        if email["allow"] == "Y" and email["since"]:
            out["consent_date"] = email["since"]
    if warning:
        out["warning"] = warning
    return {k: v for k, v in out.items() if v}


def _setting(key: str, default: int) -> int:
    from apps.platform_ops import params
    try:
        return max(1, int(params.get(key, default)))
    except Exception:                                     # noqa: BLE001
        return default


def _conn():
    return connections[context.require().db_alias]


def run(record, beat, *, batch: int | None = None, reader=None) -> None:
    """Looks every staged row up, a batch at a time, then sets the import's mapping to the looked-up values. `reader(row, ids, role)`
    stands in for the databases in tests."""
    from apps.insights import databases, external
    cfg = dict(record.lookup or {})
    tenant, pk = str(record.tenant_id), str(record.pk)
    from . import imports
    channel = imports.channel_of(record.contact_list)
    role, column = cfg.get("role"), cfg["id_column"]
    batch = batch or min(5000, _setting("lists.lookup_batch_ids", 1000))
    with session.tx():
        rows = [databases.connection(tenant, c) for c in cfg["connections"]]
    opened: dict[str, object] = {}
    started = time.monotonic()

    def lookup(ids: list[str]) -> dict[str, dict]:
        found: dict[str, dict] = {}
        for row in rows:
            missing = [i for i in ids if i not in found]
            if not missing:
                break
            if reader is not None:
                got = reader(row, missing, role)
            else:
                if row["id"] not in opened:
                    opened[row["id"]] = external.connect(row, timeout_ms=QUERY_TIMEOUT_MS)
                got = read(opened[row["id"]], missing, role)
            for key, person in got.items():
                found.setdefault(key, {**person, "database": row["name"]})
        return found

    try:
        with session.tx(), _conn().cursor() as cursor:
            cursor.execute(f"""SELECT COALESCE(max(row_number), 1), count(*) FROM contact_list_import_row
                                WHERE tenant_id = %s AND import_id = %s AND raw ? '{PREFIX}done'""", [tenant, pk])
            after, done = cursor.fetchone()
        total = record.row_count
        while True:
            with session.tx(), _conn().cursor() as cursor:
                cursor.execute("""SELECT row_number, btrim(raw ->> %s) FROM contact_list_import_row
                                   WHERE tenant_id = %s AND import_id = %s AND row_number > %s ORDER BY row_number LIMIT %s""", [column, tenant, pk, after, batch])
                page = cursor.fetchall()
            if not page:
                break
            ids = list(dict.fromkeys(value for _, value in page if value))
            found = lookup(ids) if ids else {}
            updates = []
            for line, value in page:
                if not value:
                    values = {"held": f"No {id_label(role)} in this row"}
                else:
                    person = found.get(value)
                    values = verdict(person, channel, role)
                    values["party_id"] = value
                    if person is not None:
                        values["source"] = person["database"]
                values["done"] = "1"
                updates.append({"n": line, "v": {PREFIX + key: val for key, val in values.items()}})
            with session.tx(), _conn().cursor() as cursor:
                cursor.execute("""UPDATE contact_list_import_row r SET raw = r.raw || u.v
                                    FROM (SELECT (e ->> 'n')::int AS n, e -> 'v' AS v FROM jsonb_array_elements(%s::jsonb) e) u
                                   WHERE r.tenant_id = %s AND r.import_id = %s AND r.row_number = u.n""", [json.dumps(updates), tenant, pk])
            after, done = page[-1][0], done + len(page)
            beat(min(done, total), total)
    finally:
        for conn in opened.values():
            try:
                conn.close()
            except Exception:                             # noqa: BLE001
                pass
    _finish(record, cfg, time.monotonic() - started)


def _finish(record, cfg: dict, seconds: float) -> None:
    """The counts the review shows, the virtual columns and the fixed mapping."""
    tenant, pk = str(record.tenant_id), str(record.pk)
    with session.tx(), _conn().cursor() as cursor:
        cursor.execute(f"""SELECT raw ->> '{PREFIX}held', count(*) FROM contact_list_import_row
                            WHERE tenant_id = %s AND import_id = %s AND raw ? '{PREFIX}held' GROUP BY 1 ORDER BY 2 DESC""", [tenant, pk])
        held = [{"reason": reason, "count": int(n)} for reason, n in cursor.fetchall()]
        fills = ", ".join(f"count(*) FILTER (WHERE COALESCE(raw ->> '{PREFIX}{key}', '') <> '')" for key in FILLED)
        cursor.execute(f"""SELECT count(*), count(*) FILTER (WHERE raw ? '{PREFIX}source'), count(*) FILTER (WHERE raw ? '{PREFIX}warning'), {fills}
                             FROM contact_list_import_row WHERE tenant_id = %s AND import_id = %s""", [tenant, pk])
        total, found, warned, *filled = cursor.fetchone()
        cursor.execute(f"""SELECT raw ->> '{PREFIX}warning', count(*) FROM contact_list_import_row
                            WHERE tenant_id = %s AND import_id = %s AND raw ? '{PREFIX}warning' GROUP BY 1 ORDER BY 2 DESC""", [tenant, pk])
        warnings = [{"reason": reason, "count": int(n)} for reason, n in cursor.fetchall()]
    usable = total - sum(item["count"] for item in held)
    cfg["result"] = {"ids": int(total), "found": int(found), "held": held, "warnings": warnings, "usable": int(usable),
                     "filled": {key: int(n) for key, n in zip(FILLED, filled)}, "seconds": round(seconds, 1), "finished_at": timezone.now().isoformat()}
    names = {column["name"] for column in record.file_columns}
    record.file_columns = [*record.file_columns, *({"name": name, "samples": [], "guess": key, "virtual": True} for key, name in MAPPING.items() if name not in names)]
    record.column_mapping = dict(MAPPING)
    record.mapping_confirmed = True
    record.lookup = cfg
    with session.tx():
        record.save(update_fields=["file_columns", "column_mapping", "mapping_confirmed", "lookup"])
