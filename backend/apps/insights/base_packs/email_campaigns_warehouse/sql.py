"""The Email Campaign Reports (Warehouse) pack's SQL, ported from C360Report's email campaign suite: the marketing
warehouse's own tables (mailer_master, bi_campaign_report_by_domain, campaign_report_opened, campaign_report_clicked)
in one or more databases on the workspace's connection.

This reads the warehouse, not the sending platform's log. The two hold different things: the log has every message the
relay handled, mostly transactional, and no campaigns; the warehouse has the campaigns and who received them. A
workspace with both adds whichever pack matches the database it points at.

Three scope rules are applied here, in the SQL, rather than left to each report:

    one row per person per campaign   mailer_master holds several rows for one (campaign, party) - a different
                                      FROM_DATE each time - so SUM(SENT) reports a 75,000-recipient send as ~147,000.
                                      Every dataset groups to the person first, and reach is a distinct party count.
    list imports are not campaigns    a subscriber list loaded into the campaign tables carries years of engagement
                                      dated before its "send"; counting it wrecks every rate. Left out by name.
    tests are not sends               a campaign named as a test is left out unless the person asks for it.

Options, all checked before they reach the SQL:

    databases    the warehouse databases, by name
    leave_out    words: a campaign whose name contains one (any case) is left out. Absent means ("test",); an empty
                 list means leave nothing out.
    imports      words marking a list import rather than a campaign; absent means the usual three.
"""
from ..common import IDENT, WORD, OptionError  # noqa: F401  (named from here, as the Postal pack's sql is)
from ..common import lit as _lit
from ..common import q as _q

# A campaign row worth counting: it reached somebody, or it is a bounce that came back later (those carry no SENT_DATE).
A_CAMPAIGN = "(m.SENT > 0 OR m.BOUNCED > 0 OR m.UNSUBSCRIBED > 0 OR m.OPENED > 0)"
DEFAULT_LEAVE_OUT = ("test",)
DEFAULT_IMPORTS = ("listrak", "subscribe list", "import")
MAX_DATABASES = 8

# What fetched a tracking pixel. First match wins, and the order matters: the two proxies and the gateway signature
# are checked before anything is called a person. On the Citi warehouse these classes took 259,000 of 262,000 opens.
FETCHER = """CASE
             WHEN o.DEVICE IS NULL OR o.DEVICE = ''            THEN 'No agent recorded'
             WHEN o.DEVICE LIKE '%%GoogleImageProxy%%'          THEN 'Gmail image proxy'
             WHEN o.DEVICE LIKE '%%YahooMailProxy%%'            THEN 'Yahoo image proxy'
             WHEN o.DEVICE LIKE '%%ms-office%%'
               OR o.DEVICE LIKE '%%Microsoft Office%%'          THEN 'Outlook prefetch'
             WHEN o.DEVICE LIKE '%%Mozilla/%%Mozilla/%%'        THEN 'Security scanner'
             WHEN o.DEVICE LIKE '%%HeadlessChrome%%'
               OR o.DEVICE LIKE '%%crawler%%'
               OR o.DEVICE LIKE '%%bot%%'                       THEN 'Bot or headless browser'
             WHEN o.DEVICE = 'Mozilla/5.0'                      THEN 'Unidentified fetcher'
             ELSE 'Mail app or browser' END"""
HUMAN_FETCHER = "Mail app or browser"

# Why a message bounced, from the text the mailbox returned. The reason itself carries the recipient's own address in
# the suppression messages, so only these classes leave the database.
BOUNCE_CLASS = """CASE
    WHEN d.BOUNCE_REASON LIKE '%%Maximum number of delivery attempts%%' THEN 'Retried to the limit, then suppressed'
    WHEN d.BOUNCE_REASON LIKE '%%does not exist%%'
      OR d.BOUNCE_REASON LIKE '%%mailbox not found%%'
      OR d.BOUNCE_REASON LIKE '%%user unknown%%'
      OR d.BOUNCE_REASON LIKE '%%5.1.1%%'                             THEN 'Address does not exist'
    WHEN d.BOUNCE_REASON LIKE '%%storage space%%'
      OR d.BOUNCE_REASON LIKE '%%mailbox is full%%'
      OR d.BOUNCE_REASON LIKE '%%over quota%%'                        THEN 'Mailbox full'
    WHEN d.BOUNCE_REASON LIKE '%%spam%%'
      OR d.BOUNCE_REASON LIKE '%%block%%'
      OR d.BOUNCE_REASON LIKE '%%reputation%%'
      OR d.BOUNCE_REASON LIKE '%%5.7.1%%'                             THEN 'Blocked as spam or by reputation'
    WHEN d.BOUNCE_REASON LIKE '%%temporarily deferred%%'
      OR d.BOUNCE_REASON LIKE '%%unexpected volume%%'                 THEN 'Temporarily deferred'
    WHEN d.BOUNCE_REASON LIKE '%%No SMTP servers%%'                   THEN 'Domain has no mail server'
    WHEN d.BOUNCE_REASON LIKE '%%Raw message has been removed%%'      THEN 'Expired before it could be sent'
    WHEN d.BOUNCE_REASON LIKE 'Undeliverable:%%'
      OR d.BOUNCE_REASON LIKE 'Undelivered Mail Returned%%'
      OR d.BOUNCE_REASON LIKE 'Failure Notice%%'
      OR d.BOUNCE_REASON LIKE 'Mail Delivery Failure%%'
      OR d.BOUNCE_REASON LIKE 'Delivery Status Notification%%'        THEN 'Returned, no detail given'
    WHEN d.BOUNCE_REASON LIKE 'Permanent SMTP delivery error%%'       THEN 'Refused permanently, no reason given'
    WHEN d.BOUNCE_REASON LIKE 'Temporary SMTP delivery error%%'       THEN 'Refused temporarily, no reason given'
    WHEN d.BOUNCE_REASON IS NULL OR d.BOUNCE_REASON = ''
      OR d.BOUNCE_REASON LIKE '%%no SMTP output captured%%'           THEN 'No reason recorded'
    ELSE 'Other reason' END"""

PROVIDER = """CASE
    WHEN LOWER(d.DOMAIN_NAME) IN ('gmail.com', 'googlemail.com')                                   THEN 'Gmail'
    WHEN LOWER(d.DOMAIN_NAME) IN ('yahoo.com', 'ymail.com', 'myyahoo.com', 'rocketmail.com',
                                  'aim.com', 'aol.com')                                            THEN 'Yahoo / AOL'
    WHEN LOWER(d.DOMAIN_NAME) IN ('hotmail.com', 'outlook.com', 'live.com', 'msn.com')             THEN 'Microsoft'
    WHEN LOWER(d.DOMAIN_NAME) IN ('icloud.com', 'me.com', 'mac.com')                               THEN 'Apple iCloud'
    WHEN d.DOMAIN_NAME IS NULL OR d.DOMAIN_NAME IN ('', '-')                                       THEN 'Not recorded'
    ELSE 'Other' END"""


def checked(options: dict) -> dict:
    """the options normalised, or OptionError"""
    databases = [str(d) for d in (options.get("databases") or [])]
    if not databases:
        raise OptionError("Pick at least one warehouse database.")
    if len(databases) > MAX_DATABASES or len(set(databases)) != len(databases):
        raise OptionError(f"Pick up to {MAX_DATABASES} different warehouse databases.")
    for name in databases:
        _q(name)

    leave_out = options.get("leave_out")
    leave_out = list(DEFAULT_LEAVE_OUT) if leave_out is None else [str(w).strip() for w in leave_out if str(w).strip()]
    if len(leave_out) > 10:
        raise OptionError("Leave out campaigns by up to 10 words.")
    for word in leave_out:
        _lit(word.lower())

    imports = options.get("imports")
    imports = list(DEFAULT_IMPORTS) if imports is None else [str(w).strip() for w in imports if str(w).strip()]
    if len(imports) > 10:
        raise OptionError("Mark list imports by up to 10 words.")
    for word in imports:
        _lit(word.lower())

    return {"databases": databases, "leave_out": leave_out, "imports": imports}


def _dbname(db: str) -> str:
    """The database's own name as a string literal, for the column that says which warehouse a row came from.
    `lit` is for words that go into a LIKE, where an underscore is a wildcard; a database name is not one, and
    `q` has already ruled out anything that could escape the quotes."""
    _q(db)
    return f"'{db}'"


def _roster(db: str) -> str:
    """One row per campaign, its name settled. The event tables carry a campaign id and no name, and mailer_master
    holds a row per recipient - joining an event straight to it would multiply every open by the campaign's whole
    audience, so the name is taken from this instead."""
    return (f"SELECT MARKETING_CAMPAIGN_ID AS campaign_id, MAX(MARKETING_CAMPAIGN_NAME) AS campaign_name "
            f"FROM {_q(db)}.mailer_master GROUP BY MARKETING_CAMPAIGN_ID")


def _excluded(o: dict, column: str = "m.MARKETING_CAMPAIGN_NAME") -> str:
    """the campaigns this pack does not count: list imports always, and the words the person left out"""
    words = [*o["leave_out"], *o["imports"]]
    return " AND ".join(f"LOCATE({_lit(w.lower())}, LOWER(COALESCE({column}, ''))) = 0" for w in words) or "1 = 1"


# --------------------------------------------------------------------------
# Campaigns: one row per campaign
# --------------------------------------------------------------------------

def _campaign_branch(db: str, o: dict) -> str:
    d = _q(db)
    return f"""SELECT {_dbname(db)} AS warehouse, m.MARKETING_CAMPAIGN_ID AS campaign_id,
           MAX(m.MARKETING_CAMPAIGN_NAME) AS campaign_name,
           MIN(COALESCE(m.SENT_DATE, m.FROM_DATE)) AS first_send,
           MAX(COALESCE(m.SENT_DATE, m.FROM_DATE)) AS last_send,
           COUNT(DISTINCT m.PARTY_ID) AS recipients,
           COUNT(DISTINCT CASE WHEN m.SENT > 0 THEN m.PARTY_ID END) AS reached,
           SUM(COALESCE(m.SENT, 0)) AS messages,
           COUNT(DISTINCT CASE WHEN m.OPENED > 0 THEN m.PARTY_ID END) AS openers,
           COUNT(DISTINCT CASE WHEN m.CLICKED > 0 THEN m.PARTY_ID END) AS clickers,
           COUNT(DISTINCT CASE WHEN m.BOUNCED > 0 THEN m.PARTY_ID END) AS bounced,
           COUNT(DISTINCT CASE WHEN m.UNSUBSCRIBED > 0 THEN m.PARTY_ID END) AS unsubscribed
      FROM {d}.mailer_master m
     WHERE {_excluded(o)} AND {A_CAMPAIGN}
     GROUP BY m.MARKETING_CAMPAIGN_ID"""


def campaigns_sql(options: dict) -> str:
    """Email Campaigns: one row per campaign, its window and its totals"""
    o = checked(options)
    return "\n   UNION ALL\n  ".join(_campaign_branch(db, o) for db in o["databases"])


# --------------------------------------------------------------------------
# Messages: one row per person per campaign - the grain the warehouse does not keep
# --------------------------------------------------------------------------

def _message_branch(db: str, o: dict) -> str:
    d = _q(db)
    return f"""SELECT {_dbname(db)} AS warehouse,
           CONCAT(m.MARKETING_CAMPAIGN_ID, ':', m.PARTY_ID) AS message_key,
           m.MARKETING_CAMPAIGN_ID AS campaign_id, MAX(m.MARKETING_CAMPAIGN_NAME) AS campaign_name,
           m.PARTY_ID AS party_id,
           MIN(COALESCE(m.SENT_DATE, m.FROM_DATE)) AS sent_at,
           MAX(m.BOUNCED_DATE) AS bounced_at,
           MAX(COALESCE(NULLIF(m.BOUNCED_STATUS, ''), '')) AS bounce_status,
           MAX(m.SENT > 0) AS sent,
           MAX(m.OPENED > 0) AS opened,
           SUM(COALESCE(m.OPENED, 0)) AS opens,
           MAX(m.CLICKED > 0) AS clicked,
           SUM(COALESCE(m.CLICKED_COUNT, 0)) AS clicks,
           MAX(m.BOUNCED > 0) AS bounced,
           MAX(m.UNSUBSCRIBED > 0) AS unsubscribed,
           MAX(m.NOT_OPEN > 0) AS not_opened
      FROM {d}.mailer_master m
     WHERE {_excluded(o)} AND {A_CAMPAIGN}
     GROUP BY m.MARKETING_CAMPAIGN_ID, m.PARTY_ID"""


def messages_sql(options: dict) -> str:
    """Email Messages: one row per person per campaign"""
    o = checked(options)
    return "\n   UNION ALL\n  ".join(_message_branch(db, o) for db in o["databases"])


# --------------------------------------------------------------------------
# Opens: one row per open event, by what fetched it
# --------------------------------------------------------------------------

def _open_branch(db: str, o: dict) -> str:
    d = _q(db)
    fetcher = FETCHER.replace("%%", "%")
    return f"""SELECT {_dbname(db)} AS warehouse,
           CONCAT(o.CAMPAIGN_ID, ':', o.PARTY_ID, ':', UNIX_TIMESTAMP(o.OPENED_TIMESTAMP)) AS open_key,
           o.CAMPAIGN_ID AS campaign_id, MAX(c.campaign_name) AS campaign_name,
           o.PARTY_ID AS party_id, o.OPENED_TIMESTAMP AS opened_at,
           COALESCE(NULLIF(o.DEVICE_TYPE, ''), 'Not recorded') AS device_type,
           {fetcher} AS opened_by,
           COUNT(*) AS opens,
           SUM(CASE WHEN {fetcher} = {_lit(HUMAN_FETCHER)} THEN 1 ELSE 0 END) AS human_open,
           SUM(CASE WHEN {fetcher} = {_lit(HUMAN_FETCHER)} THEN 0 ELSE 1 END) AS machine_open
      FROM {d}.campaign_report_opened o
      JOIN ({_roster(db)}) c ON c.campaign_id = o.CAMPAIGN_ID
     WHERE {_excluded(o, 'c.campaign_name')}
     GROUP BY o.CAMPAIGN_ID, o.PARTY_ID, o.OPENED_TIMESTAMP, o.DEVICE_TYPE, o.DEVICE"""


def opens_sql(options: dict) -> str:
    """Email Opens: one row per open event, machine fetches apart from people"""
    o = checked(options)
    return "\n   UNION ALL\n  ".join(_open_branch(db, o) for db in o["databases"])


# --------------------------------------------------------------------------
# Clicks: one row per click event
# --------------------------------------------------------------------------

def _click_branch(db: str, o: dict) -> str:
    d = _q(db)
    return f"""SELECT {_dbname(db)} AS warehouse,
           CONCAT(k.CAMPAIGN_ID, ':', k.PARTY_ID, ':', UNIX_TIMESTAMP(k.CLICKED_TIMESTAMP)) AS click_key,
           k.CAMPAIGN_ID AS campaign_id, MAX(c.campaign_name) AS campaign_name,
           k.PARTY_ID AS party_id, k.CLICKED_TIMESTAMP AS clicked_at,
           COALESCE(NULLIF(k.DEVICE_TYPE, ''), 'Not recorded') AS device_type,
           COUNT(*) AS clicks
      FROM {d}.campaign_report_clicked k
      JOIN ({_roster(db)}) c ON c.campaign_id = k.CAMPAIGN_ID
     WHERE {_excluded(o, 'c.campaign_name')}
     GROUP BY k.CAMPAIGN_ID, k.PARTY_ID, k.CLICKED_TIMESTAMP, k.DEVICE_TYPE"""


def clicks_sql(options: dict) -> str:
    """Email Link Clicks: one row per click event"""
    o = checked(options)
    return "\n   UNION ALL\n  ".join(_click_branch(db, o) for db in o["databases"])


# --------------------------------------------------------------------------
# Delivery by domain: the mailbox provider and why a message bounced
# --------------------------------------------------------------------------

def _domain_branch(db: str, o: dict) -> str:
    d = _q(db)
    return f"""SELECT {_dbname(db)} AS warehouse,
           CONCAT(d.MARKETING_CAMPAIGN_ID, ':', d.CAMPAIGN_TEMPLATE_ID, ':', d.PARTY_ID) AS delivery_key,
           d.MARKETING_CAMPAIGN_ID AS campaign_id, d.MARKETING_CAMPAIGN_NAME AS campaign_name,
           LOWER(COALESCE(NULLIF(TRIM(d.DOMAIN_NAME), ''), '-')) AS domain,
           {PROVIDER.replace('%%', '%')} AS provider,
           d.SENT_TIMESTAMP AS sent_at, d.BOUNCED_TIMESTAMP AS bounced_at,
           COALESCE(NULLIF(d.BOUNCED_TYPE, ''), 'Not stated') AS bounce_type,
           {BOUNCE_CLASS.replace('%%', '%')} AS bounce_class,
           CASE WHEN d.SENT_TIMESTAMP IS NOT NULL THEN 1 ELSE 0 END AS sent,
           CASE WHEN d.OPEN_COUNT > 0 THEN 1 ELSE 0 END AS opened,
           CASE WHEN d.CLICK_COUNT > 0 THEN 1 ELSE 0 END AS clicked,
           CASE WHEN d.BOUNCED_TIMESTAMP IS NOT NULL THEN 1 ELSE 0 END AS bounced,
           CASE WHEN d.UNSUBSCRIBED_TIMESTAMP IS NOT NULL THEN 1 ELSE 0 END AS unsubscribed
      FROM {d}.bi_campaign_report_by_domain d
     WHERE {_excluded(o, 'd.MARKETING_CAMPAIGN_NAME')}"""


def domains_sql(options: dict) -> str:
    """Delivery by Domain: the mailbox provider each message went to, and why it bounced"""
    o = checked(options)
    return "\n   UNION ALL\n  ".join(_domain_branch(db, o) for db in o["databases"])
