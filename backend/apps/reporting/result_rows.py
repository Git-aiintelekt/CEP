"""The Results API's per-recipient rows (GET /results/messages/): one row a recipient a send, and one for each person a send
held back. A row names the customer by party ID only: no name, no address, no number, and a failure's reason has any
address or number in it masked.

Two ways to read, both a page at a time by key (never by offset, so a page costs the same at any depth):

    by send day     sent_from .. sent_to: the messages made in those days (results.SPAN_DAYS at most, KEEP_DAYS back), in
                    the order they were made. The first load, and a reload.
    by change       changed_since: the rows whose result moved since that moment, among the messages of the last
                    KEEP_DAYS, oldest change first. What an hourly pull asks. It needs the database's stamp on each
                    message (patch 0102, tracked()), and goes back no further than the moment stamping began.

The answer's as_of is what a consumer passes as its next changed_since, whichever way it read. It stops
AS_OF_LAG_SECONDS behind the clock, so a change being written while the read runs is picked up by the next read instead
of being missed.

Rows come from three places, read one after the other: emails (E), texts and WhatsApp (T), people held back (H). A row's
id carries the letter, so it is unique across them and stable: the key to upsert by.
"""
import base64
import json
import re
from datetime import date, datetime, timedelta

from django.core.cache import cache
from django.utils import timezone

from apps.delivery.engine import session
from apps.platform_ops import params
from apps.tenants.models import Tenant

from . import results

KEEP_DAYS = 90
PAGE, MAX_PAGE = 500, 1000
AS_OF_LAG_SECONDS = 60
SOURCES = ("E", "T", "H")
CHANNELS = ("EMAIL", "SMS", "MMS", "WHATSAPP")
STATUSES = ("QUEUED", "SENT", "DELIVERED", "OPENED", "CLICKED", "BOUNCED", "COMPLAINED", "REPLIED", "OPTED_OUT", "FAILED", "NOT_SENT", "HELD_BACK")
STATUSES_OF = {"E": {"QUEUED", "SENT", "DELIVERED", "OPENED", "CLICKED", "BOUNCED", "COMPLAINED", "FAILED", "NOT_SENT"},
               "T": {"QUEUED", "SENT", "DELIVERED", "OPENED", "REPLIED", "OPTED_OUT", "FAILED", "NOT_SENT"},
               "H": {"HELD_BACK"}}
FIELDS = ("id", "campaign_id", "campaign_code", "run_id", "channel", "party_id", "status", "reason", "sent_at", "delivered_at", "opened_at", "clicked_at",
          "bounced_at", "bounce_type", "complained_at", "unsubscribed_at", "replied_at", "failed_at", "variant", "changed_at")

# a message's status in the API's words; a WhatsApp message Meta reports as read is OPENED
STATUS = {"E": "CASE WHEN x.not_sent_reason IS NOT NULL THEN 'NOT_SENT' WHEN x.status = 'SUBMITTED' THEN 'SENT' ELSE x.status END",
          "T": """CASE WHEN x.not_sent_reason IS NOT NULL THEN 'NOT_SENT' WHEN x.status = 'SUBMITTED' THEN 'SENT' WHEN x.status = 'RESPONDED' THEN 'REPLIED'
                       WHEN x.status = 'DELIVERED' AND x.read_at IS NOT NULL THEN 'OPENED' ELSE x.status END"""}
LATEST_EVENT = {"E": "GREATEST(x.created_at, x.submitted_at, x.delivered_at, x.opened_at, x.clicked_at, x.bounced_at, x.complained_at)",
                "T": "GREATEST(x.created_at, x.submitted_at, x.delivered_at, x.responded_at, x.read_at, x.failed_at)"}
# every source answers the same columns: id, campaign, code, run, channel, party, status, why not sent, the engine's words, bounce
# type, sent, delivered, opened, clicked, bounced, complained, replied, failed, variant, changed
COLUMNS = {
    "E": """x.id, x.campaign_id::text, c.code, x.campaign_run_id::text, 'EMAIL', x.party_id, {status}, x.not_sent_reason, x.status_reason, x.bounce_type,
            x.submitted_at, x.delivered_at, x.opened_at, x.clicked_at, x.bounced_at, x.complained_at, NULL::timestamptz, NULL::timestamptz, x.variant_key, {changed}""",
    "T": """x.id, x.campaign_id::text, c.code, x.campaign_run_id::text, x.message_type, x.party_id, {status}, x.not_sent_reason, x.status_reason, NULL,
            x.submitted_at, x.delivered_at, x.read_at, NULL::timestamptz, NULL::timestamptz, NULL::timestamptz, x.responded_at, x.failed_at, NULL, {changed}""",
    "H": """m.id, l.campaign_id::text, c.code, l.campaign_run_id::text, c.channel, m.party_id, 'HELD_BACK', m.suppression_reason, NULL, NULL,
            NULL::timestamptz, NULL::timestamptz, NULL::timestamptz, NULL::timestamptz, NULL::timestamptz, NULL::timestamptz, NULL::timestamptz, NULL::timestamptz, NULL, m.created_at""",
}
FROM = {
    "E": "mailer_execution x JOIN campaign_run r ON r.id = x.campaign_run_id JOIN campaign c ON c.id = x.campaign_id WHERE x.tenant_id = %(tenant)s AND NOT r.test_mode",
    "T": "sms_execution x JOIN campaign_run r ON r.id = x.campaign_run_id JOIN campaign c ON c.id = x.campaign_id WHERE x.tenant_id = %(tenant)s AND NOT r.test_mode",
    "H": """campaign_list_member m JOIN campaign_list l ON l.id = m.campaign_list_id JOIN campaign c ON c.id = l.campaign_id LEFT JOIN campaign_run r ON r.id = l.campaign_run_id
            WHERE m.tenant_id = %(tenant)s AND m.suppression_reason IS NOT NULL AND NOT COALESCE(r.test_mode, FALSE)""",
}
CAMPAIGN_OF = {"E": "x.campaign_id", "T": "x.campaign_id", "H": "l.campaign_id"}
RUN_OF = {"E": "x.campaign_run_id", "T": "x.campaign_run_id", "H": "l.campaign_run_id"}
OPT_OUT_OF = {"E": "mailer_execution_id", "T": "sms_execution_id"}
ADDRESS = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
NUMBER = re.compile(r"\+?\d{8,}")


def scrubbed(words: str | None) -> str | None:
    """A sending engine's reason with any address or number in it masked: a reason is for a system to sort by, never a
    way for a customer's contact details to leave."""
    if not words:
        return None
    return NUMBER.sub("[number]", ADDRESS.sub("[address]", words))


def tracked() -> bool:
    """Patch 0102 is on this database: each message carries the moment its result last moved. A yes is remembered, a no is
    asked again, so the patch counts the moment it is applied."""
    key = "cep:results_api:changes-tracked"
    present = cache.get(key)
    if present is None:
        with session.connection().cursor() as cursor:
            cursor.execute("SELECT count(*) = 2 FROM information_schema.columns WHERE column_name = 'changed_at' AND table_name IN ('mailer_execution', 'sms_execution')")
            present = bool(cursor.fetchone()[0])
        if present:
            cache.set(key, True, 300)
    return present


def tracked_from() -> datetime | None:
    """The moment stamping began (the platform setting patch 0102 writes once)."""
    try:
        return datetime.fromisoformat(str(params.get("results.changes_tracked_from") or "").replace("Z", "+00:00"))
    except ValueError:
        return None


def encode(position: dict) -> str:
    return base64.urlsafe_b64encode(json.dumps(position, separators=(",", ":")).encode()).decode().rstrip("=")


def decode_raw(cursor: str) -> dict:
    """A cursor's position as it was written; what it may hold is the reader's to check."""
    try:
        position = json.loads(base64.urlsafe_b64decode(cursor + "=" * (-len(cursor) % 4)))
        if not isinstance(position, dict):
            raise ValueError
        return position
    except (ValueError, TypeError):
        raise results.ResultsError("cursor", "Follow the `next` address as it was given: this cursor cannot be read.") from None


def decode(cursor: str) -> dict:
    position = decode_raw(cursor)
    try:
        if position["s"] not in SOURCES or not isinstance(position.get("k"), (int, list, type(None))):
            raise ValueError
        if isinstance(position["k"], list):
            position["k"] = [datetime.fromisoformat(position["k"][0]), int(position["k"][1])]
        return position
    except (ValueError, KeyError, TypeError, IndexError):
        raise results.ResultsError("cursor", "Follow the `next` address as it was given: this cursor cannot be read.") from None


def _sources(channel: str | None, status: str | None) -> list[str]:
    wanted = [source for source in SOURCES if not status or status in STATUSES_OF[source]]
    if channel == "EMAIL":
        wanted = [source for source in wanted if source != "T"]
    elif channel:
        wanted = [source for source in wanted if source != "E"]
    return wanted


def _query(source: str, mode: str, key, filters: dict, stamped: bool) -> tuple[str, dict]:
    """One source's next rows after `key`, in key order: by id for a message read by send day, by (moment, id) otherwise."""
    row = "m" if source == "H" else "x"
    moment = f"{row}.created_at" if source == "H" else f"{row}.changed_at"
    where, args = [], {}
    if mode == "DAYS":
        where.append(f"{row}.created_at >= %(since)s AND {row}.created_at < %(until)s")
    elif source == "H":
        where.append("m.created_at >= %(changed_since)s AND m.created_at <= %(as_of)s")
    else:
        where.append("x.created_at >= %(floor)s AND x.changed_at >= %(changed_since)s AND x.changed_at <= %(as_of)s")
    by_moment = source == "H" or mode == "CHANGES"
    if key is not None:
        if by_moment:
            where.append(f"({moment}, {row}.id) > (%(key_at)s, %(key_id)s)")
            args.update(key_at=key[0], key_id=key[1])
        else:
            where.append("x.id > %(key_id)s")
            args["key_id"] = key
    if filters.get("campaign"):
        where.append(f"{CAMPAIGN_OF[source]} = %(campaign)s::uuid")
    if filters.get("run"):
        where.append(f"{RUN_OF[source]} = %(run)s::uuid")
    if filters.get("channel"):
        where.append("c.channel = %(channel)s" if source == "H" else "x.message_type = %(channel)s" if source == "T" else "TRUE")
    if filters.get("status") and source != "H":
        where.append(f"({STATUS[source]}) = %(status)s")
    if source == "H":
        columns = COLUMNS["H"]
    else:
        changed = f"COALESCE(x.changed_at, {LATEST_EVENT[source]})" if stamped else LATEST_EVENT[source]
        columns = COLUMNS[source].format(status=STATUS[source], changed=changed)
    order = f"{moment}, {row}.id" if by_moment else "x.id"
    return f"SELECT {columns} FROM {FROM[source]} AND {' AND '.join(where)} ORDER BY {order} LIMIT %(limit)s", args


def _row(source: str, values: tuple) -> dict:
    (pk, campaign_id, code, run_id, channel, party_id, status, not_sent, engine_words, bounce_type, sent_at, delivered_at, opened_at, clicked_at, bounced_at, complained_at,
     replied_at, failed_at, variant, changed_at) = values
    reason = not_sent if status in ("NOT_SENT", "HELD_BACK") else scrubbed(engine_words) if status in ("FAILED", "BOUNCED") else None
    return {"id": f"{source}-{pk}", "campaign_id": campaign_id, "campaign_code": code, "run_id": run_id, "channel": channel, "party_id": party_id, "status": status,
            "reason": reason, "sent_at": sent_at, "delivered_at": delivered_at, "opened_at": opened_at, "clicked_at": clicked_at, "bounced_at": bounced_at,
            "bounce_type": bounce_type, "complained_at": complained_at, "unsubscribed_at": None, "replied_at": replied_at, "failed_at": failed_at, "variant": variant,
            "changed_at": changed_at}


def read(tenant, *, sent_from: date | None = None, sent_to: date | None = None, changed_since: datetime | None = None, campaign: str | None = None, run: str | None = None,
         channel: str | None = None, status: str | None = None, page_size: int = PAGE, cursor: str | None = None) -> dict:
    """{"as_of", "window" | "changed_since", "results", "next_cursor"}: a page of rows, and where the next one starts
    (None after the last)."""
    tenant = tenant if isinstance(tenant, Tenant) else Tenant.objects.get(pk=tenant)
    now = timezone.now()
    position = decode(cursor) if cursor else None
    stamped = tracked()
    args = {"tenant": str(tenant.pk), "campaign": campaign, "run": run, "channel": channel, "status": status}
    if changed_since is not None:
        if sent_from or sent_to:
            raise results.ResultsError("changed_since", "Read by change (changed_since) or by send day (sent_from, sent_to), not both in one call.")
        if not stamped:
            raise results.ResultsError("changed_since", "This installation does not yet record when a message's result changes (database patch 0102). Read by send day meanwhile.")
        floor = now - timedelta(days=KEEP_DAYS)
        began = tracked_from()
        if began and changed_since < began:
            raise results.ResultsError("changed_since", f"Changes are recorded from {began.strftime('%Y-%m-%dT%H:%M:%SZ')}: read anything earlier by send day.")
        if changed_since < floor:
            raise results.ResultsError("changed_since", f"Recipient rows go back {KEEP_DAYS} days: no earlier than {floor.strftime('%Y-%m-%dT%H:%M:%SZ')}.")
        as_of = datetime.fromisoformat(position["a"]) if position and position.get("a") else now - timedelta(seconds=AS_OF_LAG_SECONDS)
        mode, scope = "CHANGES", {"changed_since": changed_since}
        args.update(floor=floor, changed_since=changed_since, as_of=as_of)
    else:
        zone = results.zone_of(tenant)
        since, until, first_day, last_day, earliest = results.window(sent_from, sent_to, zone, keep_days=KEEP_DAYS)
        as_of = now - timedelta(seconds=AS_OF_LAG_SECONDS)        # the same safe moment: what moved after it comes with the next read by change
        mode, scope = "DAYS", {"window": {"sent_from": first_day, "sent_to": last_day, "timezone": zone.key, "earliest": earliest, "max_days": results.SPAN_DAYS}}
        args.update(since=since, until=until)
    wanted = _sources(channel, status)
    if position and position["s"] in wanted:
        wanted = wanted[wanted.index(position["s"]):]
    elif position:
        wanted = [source for source in wanted if SOURCES.index(source) > SOURCES.index(position["s"])]
    rows, following, opt_out_ids = [], None, {"E": [], "T": []}
    with results.time_limited() as db:
        for source in wanted:
            key = position["k"] if position and position["s"] == source else None
            room = page_size - len(rows)
            sql, key_args = _query(source, mode, key, args, stamped)
            db.execute(sql, {**args, **key_args, "limit": room + 1})
            found = db.fetchall()
            by_moment = source == "H" or mode == "CHANGES"
            if room == 0:                                  # the page is full: the next one starts at this source's first row, if it has any
                if found:
                    following = {"s": source, "k": None, **({"a": as_of.isoformat()} if mode == "CHANGES" else {})}
                    break
                continue
            for values in found[:room]:
                rows.append(_row(source, values))
                if source != "H":
                    opt_out_ids[source].append(values[0])
            if len(found) > room:
                last = found[room - 1]
                following = {"s": source, "k": [last[-1].isoformat(), last[0]] if by_moment else last[0], **({"a": as_of.isoformat()} if mode == "CHANGES" else {})}
                break
        opted_out = {}
        for source, ids in opt_out_ids.items():
            if ids:
                column = OPT_OUT_OF[source]
                db.execute(f"""SELECT {column}, min(occurred_at) FROM consent_record
                                WHERE tenant_id = %(tenant)s AND action = 'OPT_OUT' AND {column} = ANY(%(ids)s) GROUP BY 1""", {"tenant": str(tenant.pk), "ids": ids})
                opted_out.update({f"{source}-{pk}": at for pk, at in db.fetchall()})
    for row in rows:
        row["unsubscribed_at"] = opted_out.get(row["id"])
    return {"as_of": as_of, **scope, "results": rows, "next_cursor": encode(following) if following else None}
