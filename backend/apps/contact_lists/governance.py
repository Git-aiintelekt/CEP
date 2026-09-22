"""How a marketing EMAIL send would judge a contact today, as SQL: one definition for the upload check and the list page.

Same rules, same order as the send engine (apps/delivery/engine/audience.py), so a number shown at upload means what the
same word means in a campaign's results. First match wins:

    HARD_BOUNCE / SOFT_BOUNCE / COMPLAINT / BLOCKED   contact_point_status.blocked, by its block_reason
    INVALID_ADDRESS                                   contact_point_status.is_valid = false
    SUPPRESSED                                        consent_suppression.suppressed
    UNSUBSCRIBED                                      consent_status = OPTED_OUT
    NO_CONSENT                                        no OPTED_IN answer for email
    MARKETABLE                                        none of the above

The check is a picture of today. It does not decide who is imported: a list is an audience, and people resubscribe or
are unblocked. The send engine makes the decision again, for real, every time a campaign builds its list.
"""

# code -> (label, can a marketing email reach them today)
STATUSES = {
    "MARKETABLE": ("Can receive marketing email", True),
    "UNSUBSCRIBED": ("Unsubscribed", False),
    "HARD_BOUNCE": ("Bounced: the address does not exist", False),
    "SOFT_BOUNCE": ("Bounced repeatedly", False),
    "COMPLAINT": ("Marked a message as spam", False),
    "BLOCKED": ("Blocked address", False),
    "INVALID_ADDRESS": ("Invalid address", False),
    "SUPPRESSED": ("Suppressed", False),
    "NO_CONSENT": ("No consent on record", False),
}

# needs the aliases cs (consent_suppression, channel EMAIL) and cps (contact_point_status of the address that would be used)
STATUS_SQL = """CASE WHEN cps.blocked AND cps.block_reason = 'HARD_BOUNCE' THEN 'HARD_BOUNCE'
                     WHEN cps.blocked AND cps.block_reason = 'SOFT_BOUNCE_THRESHOLD' THEN 'SOFT_BOUNCE'
                     WHEN cps.blocked AND cps.block_reason = 'COMPLAINT' THEN 'COMPLAINT'
                     WHEN cps.blocked THEN 'BLOCKED'
                     WHEN cps.is_valid = FALSE THEN 'INVALID_ADDRESS'
                     WHEN cs.suppressed THEN 'SUPPRESSED'
                     WHEN cs.consent_status = 'OPTED_OUT' THEN 'UNSUBSCRIBED'
                     WHEN {consent_from_file} THEN 'MARKETABLE'
                     WHEN COALESCE(cs.consent_status, 'UNKNOWN') <> 'OPTED_IN' THEN 'NO_CONSENT'
                     ELSE 'MARKETABLE' END"""

# the address a send would use for a known customer: their primary valid one (as the send engine picks it)
PRIMARY_EMAIL_SQL = """(SELECT lower(e ->> 'address') FROM jsonb_array_elements(cm.emails) e
                         WHERE COALESCE((e ->> 'is_valid')::boolean, TRUE) AND COALESCE(e ->> 'address', '') <> ''
                         ORDER BY COALESCE((e ->> 'is_primary')::boolean, FALSE) DESC LIMIT 1)"""


def status_sql(consent_from_file: str = "FALSE") -> str:
    return STATUS_SQL.format(consent_from_file=consent_from_file)


def breakdown(counts: dict) -> list[dict]:
    """Every status, in a fixed order, zero included: a report that always has the same lines is easy to compare."""
    return [{"code": code, "label": label, "sendable": sendable, "count": int(counts.get(code, 0))} for code, (label, sendable) in STATUSES.items()]


def label(code: str | None) -> str | None:
    return STATUSES[code][0] if code in STATUSES else None
