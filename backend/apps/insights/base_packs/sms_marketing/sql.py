"""The SMS Marketing Reports pack's SQL, ported from C360Report's SMS Marketing Intelligence Suite: the analysis
database's own MySQL tables (sms_mailer_master, sms_mailer_device_summary) on the workspace's connection.

Scope: outbound texts whose CAMPAIGN_TYPE is sms or mms. The same table carries the receipt flow, contact
verification, keywords and system traffic; those belong to other programmes and are not counted here.

One rule is worth saying out loud. A link in a text is followed by things that are not people - a carrier's scanner,
a handset's link preview - and they follow it at once. Of the clicks this table records, seven in eight land within
two minutes of the send and some are stamped before it. So a click is classified by how long it took: `human_click`
counts only those after a pause, and both figures are kept.

Options:

    databases    the analysis databases, by name
    leave_out    words: a campaign whose name contains one as a whole word is left out. Absent means ("test",).
                 Whole word, not substring - "Hottest Designer Deals" is a campaign, not a test.
    think_time   minutes a person needs before a click is theirs rather than a preview's; default 2.
"""
from ..common import OptionError
from ..common import lit as _lit
from ..common import q as _q
from ..sms_common import dbname as _dbname
from ..sms_common import checked_databases, marketing_scope, region, store_label

DEFAULT_LEAVE_OUT = ("test",)
DEFAULT_THINK_TIME = 2
CAMPAIGN_LINK = "campaign_sms_url"


def checked(options: dict) -> dict:
    """the options normalised, or OptionError"""
    databases = checked_databases(options, "analysis database")

    leave_out = options.get("leave_out")
    leave_out = list(DEFAULT_LEAVE_OUT) if leave_out is None else [str(w).strip() for w in leave_out if str(w).strip()]
    if len(leave_out) > 10:
        raise OptionError("Leave out campaigns by up to 10 words.")
    for w in leave_out:
        _lit(w.lower())

    think = options.get("think_time", DEFAULT_THINK_TIME)
    try:
        think = int(think)
    except (TypeError, ValueError):
        raise OptionError("Thinking time is a whole number of minutes.") from None
    if not 0 <= think <= 120:
        raise OptionError("Thinking time is between 0 and 120 minutes.")

    return {"databases": databases, "leave_out": leave_out, "think_time": think}


# --------------------------------------------------------------------------
# Messages: one row per outbound marketing text
# --------------------------------------------------------------------------

def _message_branch(db: str, o: dict) -> str:
    d = _q(db)
    think = o["think_time"]
    return f"""SELECT {_dbname(db)} AS analysis_database, m.SMS_MESSAGE_ID AS message_key,
           COALESCE(NULLIF(m.CAMPAIGN_NAME, ''), 'No campaign') AS campaign_name,
           UPPER(m.CAMPAIGN_TYPE) AS channel, m.SENT_AT AS sent_at, m.STATUS AS status,
           COALESCE(NULLIF(m.CARRIER_NAME, ''), 'Not recorded') AS carrier,
           COALESCE(NULLIF(m.LINK_TYPE, ''), 'No link') AS link_type,
           CASE WHEN m.LINK_CLICKED = 'Yes' THEN COALESCE(NULLIF(m.DEVICE_TYPE, ''), 'unknown')
                ELSE 'Did not click' END AS device_type,
           m.ERROR_CODE AS error_code, COALESCE(NULLIF(m.ERROR_MESSAGE, ''), '') AS error_message,
           CASE WHEN m.TIME_TO_CLICK_MINUTES IS NULL THEN 'Not recorded'
                WHEN m.TIME_TO_CLICK_MINUTES < 0 THEN 'Stamped before the send'
                WHEN m.TIME_TO_CLICK_MINUTES < {think} THEN 'Within {think} minutes'
                WHEN m.TIME_TO_CLICK_MINUTES < 60 THEN 'Within the hour'
                WHEN m.TIME_TO_CLICK_MINUTES < 1440 THEN 'Within the day'
                ELSE 'After a day' END AS click_delay,
           1 AS messages,
           CASE WHEN m.STATUS = 'delivered' THEN 1 ELSE 0 END AS delivered,
           CASE WHEN m.STATUS = 'failed' THEN 1 ELSE 0 END AS failed,
           COALESCE(m.SEGMENT_COUNT, 0) AS segments,
           CASE WHEN m.LINK_CLICKED = 'Yes' THEN 1 ELSE 0 END AS clicked,
           COALESCE(m.CLICK_COUNT, 0) AS click_events,
           CASE WHEN m.LINK_CLICKED = 'Yes' AND m.TIME_TO_CLICK_MINUTES >= {think} THEN 1 ELSE 0 END AS human_click,
           CASE WHEN m.LINK_CLICKED = 'Yes' AND (m.TIME_TO_CLICK_MINUTES < {think}
                     OR m.TIME_TO_CLICK_MINUTES IS NULL) THEN 1 ELSE 0 END AS instant_click,
           CASE WHEN m.TRANS_ID IS NOT NULL AND m.TRANS_ID <> '' THEN 1 ELSE 0 END AS purchased,
           COALESCE(m.TOTAL_SALES_AMOUNT, 0) AS sales
      FROM {d}.sms_mailer_master m
     WHERE {marketing_scope(o)}"""


def messages_sql(options: dict) -> str:
    """SMS Messages: one row per outbound marketing text"""
    o = checked(options)
    return "\n   UNION ALL\n  ".join(_message_branch(db, o) for db in o["databases"])


# --------------------------------------------------------------------------
# Campaigns: one row per campaign
# --------------------------------------------------------------------------

def _campaign_branch(db: str, o: dict) -> str:
    d = _q(db)
    think = o["think_time"]
    return f"""SELECT {_dbname(db)} AS analysis_database,
           COALESCE(NULLIF(m.CAMPAIGN_NAME, ''), 'No campaign') AS campaign_name,
           UPPER(m.CAMPAIGN_TYPE) AS channel,
           MIN(m.SENT_AT) AS first_send, MAX(m.SENT_AT) AS last_send,
           COUNT(*) AS messages,
           COUNT(DISTINCT m.CONTACT_ID) AS recipients,
           SUM(CASE WHEN m.STATUS = 'delivered' THEN 1 ELSE 0 END) AS delivered,
           SUM(CASE WHEN m.STATUS = 'failed' THEN 1 ELSE 0 END) AS failed,
           SUM(COALESCE(m.SEGMENT_COUNT, 0)) AS segments,
           SUM(CASE WHEN m.LINK_CLICKED = 'Yes' THEN 1 ELSE 0 END) AS clicked,
           SUM(CASE WHEN m.LINK_CLICKED = 'Yes' AND m.TIME_TO_CLICK_MINUTES >= {think} THEN 1 ELSE 0 END) AS human_click,
           SUM(COALESCE(m.CLICK_COUNT, 0)) AS click_events,
           SUM(CASE WHEN m.TRANS_ID IS NOT NULL AND m.TRANS_ID <> '' THEN 1 ELSE 0 END) AS purchased,
           SUM(COALESCE(m.TOTAL_SALES_AMOUNT, 0)) AS sales
      FROM {d}.sms_mailer_master m
     WHERE {marketing_scope(o)}
     GROUP BY m.CAMPAIGN_NAME, m.CAMPAIGN_TYPE"""


def campaigns_sql(options: dict) -> str:
    """SMS Campaigns: one row per campaign, its window and its totals"""
    o = checked(options)
    return "\n   UNION ALL\n  ".join(_campaign_branch(db, o) for db in o["databases"])


# --------------------------------------------------------------------------
# Failures: why a text did not arrive
# --------------------------------------------------------------------------

def _failure_branch(db: str, o: dict) -> str:
    d = _q(db)
    return f"""SELECT {_dbname(db)} AS analysis_database,
           COALESCE(NULLIF(m.CAMPAIGN_NAME, ''), 'No campaign') AS campaign_name,
           m.SENT_AT AS sent_at,
           COALESCE(NULLIF(m.CARRIER_NAME, ''), 'Not recorded') AS carrier,
           COALESCE(m.ERROR_CODE, 0) AS error_code,
           COALESCE(NULLIF(m.ERROR_MESSAGE, ''), 'No reason recorded') AS failure_reason,
           CASE WHEN m.ERROR_MESSAGE LIKE '%%invalid%%' OR m.ERROR_MESSAGE LIKE '%%malformed%%'
                     OR m.ERROR_MESSAGE LIKE '%%unallocated%%'                 THEN 'Not a working number'
                WHEN m.ERROR_MESSAGE LIKE '%%unavailable%%'                     THEN 'Handset unreachable'
                WHEN m.ERROR_MESSAGE LIKE '%%volume-violation%%'
                     OR m.ERROR_MESSAGE LIKE '%%rejected-message%%'             THEN 'Carrier refused the message'
                WHEN m.ERROR_MESSAGE LIKE '%%rejected-handset%%'                THEN 'Handset refused it'
                WHEN m.ERROR_MESSAGE LIKE '%%forbidden-country%%'               THEN 'Outside the allowed countries'
                ELSE 'Other reason' END AS failure_class,
           1 AS failures
      FROM {d}.sms_mailer_master m
     WHERE {marketing_scope(o)} AND m.STATUS = 'failed'""".replace("%%", "%")


def failures_sql(options: dict) -> str:
    """SMS Failures: one row per text that did not arrive, by why"""
    o = checked(options)
    return "\n   UNION ALL\n  ".join(_failure_branch(db, o) for db in o["databases"])


# --------------------------------------------------------------------------
# Stores: the campaign summary the warehouse keeps per store and device
# --------------------------------------------------------------------------

def _store_branch(db: str, o: dict) -> str:
    d = _q(db)
    left_out = " AND ".join(f"NOT {w}" for w in _store_left_out(o)) or "1 = 1"
    return f"""SELECT {_dbname(db)} AS analysis_database,
           s.DATE AS day, COALESCE(NULLIF(s.CAMPAIGN_NAME, ''), 'No campaign') AS campaign_name,
           UPPER(COALESCE(s.CAMPAIGN_TYPE, '')) AS channel,
           {region('s.REGION_NAME')} AS region,
           COALESCE(NULLIF(s.DISTRICT_NAME, ''), 'No district') AS district,
           {store_label('s.STORE_NUMBER', 's.STORE_DISPLAY_NAME', 's.STORE_NAME')} AS store,
           COALESCE(NULLIF(s.CITY, ''), 'No city') AS city,
           COALESCE(NULLIF(s.DEVICE_TYPE, ''), 'unknown') AS device_type,
           COALESCE(s.TOTAL_SENT, 0) AS sent, COALESCE(s.TOTAL_DELIVERED, 0) AS delivered,
           COALESCE(s.TOTAL_FAILED, 0) AS failed, COALESCE(s.UNIQUE_CUSTOMERS, 0) AS customers,
           COALESCE(s.TOTAL_CLICKED, 0) AS clicks, COALESCE(s.UNIQUE_CLICKED, 0) AS clickers,
           COALESCE(s.CAMP_TRANS_CNT, 0) AS transactions, COALESCE(s.CAMP_SLS_AMT, 0) AS sales,
           COALESCE(s.ENGAGEMENT_SCORE, 0) AS engagement_score, COALESCE(s.CAOV, 0) AS average_order_value
      FROM {d}.sms_mailer_device_summary s
     WHERE UPPER(COALESCE(s.CAMPAIGN_TYPE, '')) IN ('SMS', 'MMS') AND {left_out}"""


def _store_left_out(o: dict) -> list[str]:
    from ..common import word as _word
    return [_word("s.CAMPAIGN_NAME", w) for w in o["leave_out"]]


def stores_sql(options: dict) -> str:
    """SMS by Store: the warehouse's own campaign summary, by region, district, store and device"""
    o = checked(options)
    return "\n   UNION ALL\n  ".join(_store_branch(db, o) for db in o["databases"])
