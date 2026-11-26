"""The Results API's list of who must not be contacted (GET /results/suppressions/): everyone who unsubscribed or replied
STOP, and every customer whose address or number is blocked (a hard bounce, a complaint, a block by a person, an import or
a registry). What Settings -> Suppressions shows a person, for another system, by party ID: never the address or number.

Two tables feed it, as they feed that page. consent_suppression holds what the person decided (C rows);
contact_point_status holds what happened to an address or number (B rows). One fact is one row: a spam complaint is the
block it caused, a STOP reply is the opt-out it caused.

    the whole list      every row that holds now
    by change           changed_since: the rows that changed since that moment, with `active` false for one that was
                        lifted (the person asked for messages again, a block was removed), so the other system can
                        clear its flag

By default the list is what CEP learned first (ORIGIN_CEP): an unsubscribe link, a STOP reply, the preference centre, a
spam report, a bounce, a block made in CEP by a person or an import. What the customer system itself sent CEP (an opt-out
that arrived with the customer, a block marked C360) is left out, since that system is where it came from; origin=all
answers those too.

A blocked address with no customer behind it (an imported or registry address) has no party ID and so cannot be answered:
those are left out and counted (`left_out.without_party_id`).

Rows are read in the order they last changed, a page at a time by key. Both tables stamp a change with the moment its
transaction began, so as_of stops AS_OF_LAG_SECONDS behind the clock: longer than for messages, because an import that
blocks thousands of addresses is one long transaction. The list is small enough to read whole now and then as well.
"""
from datetime import datetime, timedelta

from django.utils import timezone

from apps.tenants.models import Tenant

from . import result_rows, results

PAGE, MAX_PAGE = 500, 1000
AS_OF_LAG_SECONDS = 300
SOURCES = ("C", "B")
CHANNELS = ("EMAIL", "SMS", "MMS", "WHATSAPP", "PHONE")
ORIGINS = ("CEP", "ALL")
FIELDS = ("id", "party_id", "channel", "reason", "source", "campaign_id", "since", "active", "changed_at")

# a re-subscribe clears every trace of the opt-out on the row itself: its consent record is what says one was lifted
# (the record was written in the same step as the row's change, so a day either side finds it in one month's partition, not all of them)
NEAR = "r.occurred_at BETWEEN {moment} - interval '1 day' AND {moment} + interval '1 day'"
LIFTED = ("(cs.last_consent_record_id IS NOT NULL AND EXISTS (SELECT 1 FROM consent_record r WHERE r.tenant_id = cs.tenant_id AND r.id = cs.last_consent_record_id "
          "AND r.action = 'RESUBSCRIBE' AND " + NEAR.format(moment="cs.updated_at") + "))")
HOLDS = {"C": {"CEP": "(cs.consent_status = 'OPTED_OUT' AND cs.opt_out_method IS NOT NULL)", "ALL": "(cs.consent_status = 'OPTED_OUT' OR cs.suppressed)"},
         "B": {"CEP": "(cps.blocked AND COALESCE(cps.block_source, '') <> 'C360')", "ALL": "cps.blocked"}}
WAS_LIFTED = {"C": f"(cs.consent_status <> 'OPTED_OUT' AND NOT cs.suppressed AND {LIFTED})", "B": "(NOT cps.blocked AND cps.unblocked_at IS NOT NULL)"}
SELECT = {
    "C": """SELECT cs.id::text, cs.party_id, cs.channel,
                   CASE WHEN cs.consent_status <> 'OPTED_OUT' AND cs.suppressed THEN 'SUPPRESSED' WHEN cs.opt_out_method = 'SMS_STOP' THEN 'OPTED_OUT' ELSE 'UNSUBSCRIBED' END,
                   cs.opt_out_method,
                   (SELECT r.campaign_id::text FROM consent_record r WHERE r.tenant_id = cs.tenant_id AND r.id = cs.last_consent_record_id AND r.action = 'OPT_OUT'
                       AND """ + NEAR.format(moment="COALESCE(cs.opted_out_at, cs.updated_at)") + """),
                   COALESCE(cs.opted_out_at, cs.updated_at), (cs.consent_status = 'OPTED_OUT' OR cs.suppressed), cs.updated_at
              FROM consent_suppression cs
             WHERE cs.tenant_id = %(tenant)s AND cs.opt_out_method IS DISTINCT FROM 'COMPLAINT'""",
    "B": """SELECT cps.id::text, cps.party_id, cps.contact_point_type, COALESCE(cps.block_reason, 'MANUAL'), cps.block_source, NULL,
                   COALESCE(cps.blocked_at, cps.updated_at), cps.blocked, cps.updated_at
              FROM contact_point_status cps
             WHERE cps.tenant_id = %(tenant)s AND cps.party_id IS NOT NULL AND cps.block_source IS DISTINCT FROM 'SMS_STOP'""",
}
ROW = {"C": "cs", "B": "cps"}


def _decode(cursor: str) -> dict:
    position = result_rows.decode_raw(cursor)
    try:
        if position["s"] not in SOURCES:
            raise ValueError
        if position.get("k") is not None:
            position["k"] = [datetime.fromisoformat(position["k"][0]), str(position["k"][1])]
        position["a"] = datetime.fromisoformat(position["a"])
        return position
    except (ValueError, KeyError, TypeError, IndexError):
        raise results.ResultsError("cursor", "Follow the `next` address as it was given: this cursor cannot be read.") from None


def _sources(channel: str | None) -> list[str]:
    return ["B"] if channel == "PHONE" else list(SOURCES)


def _query(source: str, changes: bool, key, channel: str | None, origin: str) -> tuple[str, dict]:
    row, where, args = ROW[source], [], {}
    where.append(f"({HOLDS[source][origin]} OR {WAS_LIFTED[source]})" if changes else HOLDS[source][origin])
    where.append(f"{row}.updated_at <= %(as_of)s")
    if changes:
        where.append(f"{row}.updated_at >= %(changed_since)s")
    if key is not None:
        where.append(f"({row}.updated_at, {row}.id) > (%(key_at)s, %(key_id)s::uuid)")
        args.update(key_at=key[0], key_id=key[1])
    if channel:
        where.append("cs.channel = %(channel)s" if source == "C" else "cps.contact_point_type = %(point)s")
        args["point"] = "EMAIL" if channel == "EMAIL" else "PHONE"
    return f"{SELECT[source]} AND {' AND '.join(where)} ORDER BY {row}.updated_at, {row}.id LIMIT %(limit)s", args


def read(tenant, *, changed_since: datetime | None = None, channel: str | None = None, origin: str = "CEP", page_size: int = PAGE, cursor: str | None = None) -> dict:
    """{"as_of", ["changed_since"], ["left_out"], "results", "next_cursor"}: a page of the list, and where the next one
    starts (None after the last). left_out comes with the first page."""
    tenant = tenant if isinstance(tenant, Tenant) else Tenant.objects.get(pk=tenant)
    now = timezone.now()
    position = _decode(cursor) if cursor else None
    as_of = position["a"] if position else now - timedelta(seconds=AS_OF_LAG_SECONDS)
    args = {"tenant": str(tenant.pk), "channel": channel, "as_of": as_of, "changed_since": changed_since}
    wanted = _sources(channel)
    if position and position["s"] in wanted:
        wanted = wanted[wanted.index(position["s"]):]
    elif position:
        wanted = [source for source in wanted if SOURCES.index(source) > SOURCES.index(position["s"])]
    rows, following, left_out = [], None, None
    with results.time_limited() as db:
        for source in wanted:
            key = position.get("k") if position and position["s"] == source else None
            room = page_size - len(rows)
            sql, key_args = _query(source, changed_since is not None, key, channel, origin)
            db.execute(sql, {**args, **key_args, "limit": room + 1})
            found = db.fetchall()
            if room == 0:                                  # the page is full: the next one starts at this source's first row, if it has any
                if found:
                    following = {"s": source, "k": None, "a": as_of.isoformat()}
                    break
                continue
            for pk, party_id, row_channel, reason, how, campaign_id, since, active, changed_at in found[:room]:
                rows.append({"id": f"{source}-{pk}", "party_id": party_id, "channel": row_channel, "reason": reason, "source": how, "campaign_id": campaign_id, "since": since,
                             "active": bool(active), "changed_at": changed_at})
            if len(found) > room:
                last = found[room - 1]
                following = {"s": source, "k": [last[-1].isoformat(), last[0]], "a": as_of.isoformat()}
                break
        if position is None:
            point = "" if not channel else " AND contact_point_type = 'EMAIL'" if channel == "EMAIL" else " AND contact_point_type = 'PHONE'"
            db.execute(f"SELECT count(*) FROM contact_point_status WHERE tenant_id = %(tenant)s AND blocked AND party_id IS NULL{point}", args)
            left_out = {"without_party_id": int(db.fetchone()[0])}
    scope = {"changed_since": changed_since} if changed_since is not None else {}
    return {"as_of": as_of, **scope, **({"left_out": left_out} if left_out is not None else {}), "results": rows, "next_cursor": result_rows.encode(following) if following else None}
