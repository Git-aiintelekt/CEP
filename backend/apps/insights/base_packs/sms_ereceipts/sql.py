"""The SMS eReceipt Reports pack's SQL, ported from C360Report's SMS eReceipts suite: the analysis database's own
MySQL tables (sms_mailer_master, sms_mailer_summary) on the workspace's connection.

Scope is the receipt flow - the text sent at the till with a link to the receipt. It is named, not typed: the
warehouse files the same campaign under two campaign types, and the type it shares ('transactional') also carries
contact verification, which is not a receipt. So the campaign's own name is the scope, and the name is an option in
case a workspace calls it something else.

The store summary is the other half. sms_mailer_summary holds one row per store per day with the share of that
day's receipts that went out by text, which is the adoption figure the business steers by. Store 9999 is the
platform's default store rather than a shop, and the region column holds a few strays ('COOL', 'AVERAGE', 'Default
Region'); both are kept in their own buckets so a total still reconciles, and neither is ranked against a real store.

Options:

    databases    the analysis databases, by name
    campaign     the receipt campaign's name; default "API SMS Receipt"
"""
from ..common import OptionError
from ..common import lit as _lit
from ..common import q as _q
from ..sms_common import OUTBOUND, RECEIPT_CAMPAIGN
from ..sms_common import checked_databases
from ..sms_common import dbname as _dbname
from ..sms_common import region, store_label


def checked(options: dict) -> dict:
    """the options normalised, or OptionError"""
    databases = checked_databases(options, "analysis database")
    campaign = str(options.get("campaign") or RECEIPT_CAMPAIGN).strip()
    if not campaign:
        raise OptionError("Name the receipt campaign.")
    _lit(campaign)
    return {"databases": databases, "campaign": campaign}


def _scope(o: dict) -> str:
    return f"{OUTBOUND} AND m.CAMPAIGN_NAME = {_lit(o['campaign'])}"


# --------------------------------------------------------------------------
# Receipts: one row per receipt text
# --------------------------------------------------------------------------

def _receipt_branch(db: str, o: dict) -> str:
    d = _q(db)
    return f"""SELECT {_dbname(db)} AS analysis_database, m.SMS_MESSAGE_ID AS receipt_key,
           m.SENT_AT AS sent_at, m.STATUS AS status,
           COALESCE(NULLIF(m.CARRIER_NAME, ''), 'Not recorded') AS carrier,
           {store_label('m.STORE_NUMBER', 'm.STORE_NUMBER', 'm.STORE_NUMBER')} AS store,
           COALESCE(NULLIF(m.LINK_TYPE, ''), 'No link') AS link_type,
           CASE WHEN m.LINK_CLICKED = 'Yes' THEN COALESCE(NULLIF(m.DEVICE_TYPE, ''), 'unknown')
                ELSE 'Did not open' END AS device_type,
           COALESCE(NULLIF(m.ERROR_MESSAGE, ''), '') AS failure_reason,
           1 AS receipts,
           CASE WHEN m.STATUS = 'delivered' THEN 1 ELSE 0 END AS delivered,
           CASE WHEN m.STATUS = 'failed' THEN 1 ELSE 0 END AS failed,
           COALESCE(m.SEGMENT_COUNT, 0) AS segments,
           CASE WHEN m.LINK_CLICKED = 'Yes' THEN 1 ELSE 0 END AS opened,
           COALESCE(m.CLICK_COUNT, 0) AS views,
           CASE WHEN m.TRANS_ID IS NOT NULL AND m.TRANS_ID <> '' THEN 1 ELSE 0 END AS has_transaction
      FROM {d}.sms_mailer_master m
     WHERE {_scope(o)}"""


def receipts_sql(options: dict) -> str:
    """SMS Receipts: one row per receipt text sent at the till"""
    o = checked(options)
    return "\n   UNION ALL\n  ".join(_receipt_branch(db, o) for db in o["databases"])


# --------------------------------------------------------------------------
# Adoption: one row per store per day
# --------------------------------------------------------------------------

def _adoption_branch(db: str, o: dict) -> str:
    d = _q(db)
    return f"""SELECT {_dbname(db)} AS analysis_database, s.DATE AS day,
           {region('s.REGION_NAME')} AS region,
           COALESCE(NULLIF(s.DISTRICT_NAME, ''), 'No district') AS district,
           {store_label('s.STORE_NUMBER', 's.STORE_DISPLAY_NAME', 's.STORE_NAME')} AS store,
           COALESCE(NULLIF(s.CITY, ''), 'No city') AS city,
           COALESCE(s.TOTAL_SENT, 0) AS sent, COALESCE(s.TOTAL_DELIVERED, 0) AS delivered,
           COALESCE(s.TOTAL_FAILED, 0) AS failed,
           COALESCE(s.UNIQUE_CUSTOMERS, 0) AS customers, COALESCE(s.UNIQUE_PHONES, 0) AS phones,
           COALESCE(s.TOTAL_CLICKED, 0) AS views, COALESCE(s.UNIQUE_CLICKED, 0) AS viewers,
           COALESCE(s.TRANS_CNT, 0) AS transactions, COALESCE(s.TOTAL_SALES, 0) AS sales,
           COALESCE(s.SMS_RECEIPT_PCT, 0) AS receipt_share,
           COALESCE(s.NEW_CUSTOMERS, 0) AS new_customers,
           COALESCE(s.RETURNING_CUSTOMERS, 0) AS returning_customers,
           COALESCE(s.GUEST_CUSTOMERS, 0) AS guest_customers,
           COALESCE(s.PROFILE_COMPLETED_CNT, 0) AS profiles_completed
      FROM {d}.sms_mailer_summary s"""


def adoption_sql(options: dict) -> str:
    """Receipt Adoption: one row per store per day, with the share of receipts sent by text"""
    o = checked(options)
    return "\n   UNION ALL\n  ".join(_adoption_branch(db, o) for db in o["databases"])
