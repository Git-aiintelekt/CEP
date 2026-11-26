"""What both SMS packs' SQL shares: the same three tables serve SMS Marketing and SMS eReceipts, told apart by
campaign type, and they place every row in the same Region > District > Store hierarchy.

SMS Marketing reads the campaigns a marketer sends (CAMPAIGN_TYPE sms / mms). SMS eReceipts reads the receipt flow -
a text sent at the till with a link to the receipt. They are different programmes in one table, so each pack scopes
itself here rather than leaving a report to remember.
"""
from .common import lit as _lit
from .common import q as _q
from .common import word as _word

# The marketing channels, and the receipt flow's own campaign. The receipt campaign appears under two campaign types
# ('transactional' and 'api.transaction.created'), and 'transactional' also carries contact verification, which is
# not a receipt - so the receipt flow is named, not typed.
MARKETING_TYPES = ("sms", "mms")
RECEIPT_CAMPAIGN = "API SMS Receipt"
OUTBOUND = "m.DIRECTION = 'outbound' AND m.SENT_AT IS NOT NULL"

# Store 9999 is the platform's default store, not a shop: 1.6M rows on the message table carry it. It is kept in its
# own bucket rather than dropped, so a total still reconciles, and never ranked against a real store.
DEFAULT_STORE = "9999"
# The regions the business actually runs. Anything else the table holds - 'COOL', 'AVERAGE', 'Default Region',
# 'WARM', empty - is a stray value, not a region, and goes to one bucket.
CANONICAL_REGIONS = ("SOUTHEAST", "MID-ATLANTIC", "MIDWEST/NORTHEAST")
UNMAPPED = "Unmapped"


def marketing_scope(o: dict, column: str = "m.CAMPAIGN_NAME") -> str:
    """outbound marketing texts, with the campaigns the person left out taken away

    The campaign type is compared as it is, not through LOWER(COALESCE(...)). The column's collation already
    matches without regard to case, and wrapping it in a function costs the optimiser the column: on 8.2M rows
    that one wrapper was the difference between 26 seconds and 4.
    """
    types = ", ".join(_lit(t) for t in MARKETING_TYPES)
    left_out = " AND ".join(f"NOT {_word(column, w)}" for w in o["leave_out"])
    return f"{OUTBOUND} AND m.CAMPAIGN_TYPE IN ({types})" + (f" AND {left_out}" if left_out else "")


def receipt_scope() -> str:
    """outbound texts of the receipt flow, whichever campaign type they were filed under"""
    return f"{OUTBOUND} AND m.CAMPAIGN_NAME = {_lit(RECEIPT_CAMPAIGN)}"


def region(column: str = "REGION_NAME") -> str:
    """the region, or the one bucket for everything that is not one"""
    listed = ", ".join(_lit(r) for r in CANONICAL_REGIONS)
    return f"CASE WHEN UPPER(COALESCE({column}, '')) IN ({listed}) THEN UPPER({column}) ELSE {_lit(UNMAPPED)} END"


def store_label(number="STORE_NUMBER", name="STORE_DISPLAY_NAME", fallback="STORE_NAME") -> str:
    """the store as a person names it, and the default store said plainly"""
    return (f"CASE WHEN COALESCE({number}, '') = {_lit(DEFAULT_STORE)} THEN 'Default store (9999)' "
            f"WHEN COALESCE({number}, '') = '' THEN 'No store recorded' "
            f"ELSE CONCAT(COALESCE(NULLIF({name}, ''), NULLIF({fallback}, ''), CONCAT('Store ', {number})), "
            f"' (', {number}, ')') END")


def checked_databases(options: dict, what: str, maximum: int = 8) -> list[str]:
    databases = [str(d) for d in (options.get("databases") or [])]
    from .common import OptionError
    if not databases:
        raise OptionError(f"Pick at least one {what}.")
    if len(databases) > maximum or len(set(databases)) != len(databases):
        raise OptionError(f"Pick up to {maximum} different {what}s.")
    for name in databases:
        _q(name)
    return databases


def dbname(db: str) -> str:
    """the database's own name as a literal, for the column that says which one a row came from"""
    _q(db)
    return f"'{db}'"
