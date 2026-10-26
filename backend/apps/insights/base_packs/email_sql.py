"""The Email Campaign Reports pack's SQL (docs/mockups/base-reports.html), ported from CmpReport: Postal's own MySQL tables
(messages, deliveries, loads, clicks, links) in one or more Postal databases on the workspace's connection. A marketing email has
an mkt_id in its tag and, where the tag names its kind (ept_id), is MKT_CAMP: e-receipts (ORDER_RECEIPT) carry an mkt_id too.

Each dataset is a UNION ALL of one branch per Postal database. A message's attempts, opens and clicks are counted by correlated
subqueries on message_id (Postal indexes it), so a report's Period, pushed down to messages.timestamp by MySQL, reads only the
messages in it instead of whole tables. Options, all checked before they reach the SQL:

    databases       the Postal databases, by name
    names           {"table": "db.table", "id": "column", "name": "column"} where campaign names live, or None: the subject and
                    the first send date, as CmpReport names them
    leave_out       words: a campaign whose name contains one (any case) is left out
    unsubscribe     what an unsubscribe link's URL contains; clicks on it count as unsubscribes, not clicks
"""
import re

IDENT = re.compile(r"^[A-Za-z0-9_][A-Za-z0-9_$-]{0,63}$")              # MySQL names as Postal makes them (txpostalprod-server-7)
WORD = re.compile(r"^[^'\"\\%_`;]{1,40}$")
MARKETING = ("m.scope = 'outgoing' AND JSON_VALID(m.tag) AND JSON_EXTRACT(m.tag, '$.mkt_id') IS NOT NULL "
             "AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(m.tag, '$.ept_id')), 'MKT_CAMP') = 'MKT_CAMP'")   # receipts carry an mkt_id too
DELIVERY_STATES = "('Sent', 'SoftFail', 'HardFail', 'Error', 'Bounced')"


class OptionError(ValueError):
    """An option that cannot go into the SQL; the message is for the person."""


def _q(name: str) -> str:
    if not IDENT.match(name or ""):
        raise OptionError(f"{name!r} is not a database, table or column name C360 can use.")
    return f"`{name}`"


def _lit(text: str) -> str:
    if not WORD.match(text or ""):
        raise OptionError(f"{text!r} cannot be used: up to 40 characters, without quotes, %, _ or backslashes.")
    return "'" + text + "'"


def checked(options: dict) -> dict:
    """the options normalised, or OptionError"""
    databases = [str(d) for d in (options.get("databases") or [])]
    if not databases:
        raise OptionError("Pick at least one Postal database.")
    if len(databases) > 8 or len(set(databases)) != len(databases):
        raise OptionError("Pick up to 8 different Postal databases.")
    for name in databases:
        _q(name)
    names = options.get("names") or None
    if names is not None:
        if not isinstance(names, dict) or not all(names.get(k) for k in ("table", "id", "name")):
            raise OptionError("Campaign names need a table, its campaign id column and its name column.")
        parts = str(names["table"]).split(".")
        if len(parts) > 2:
            raise OptionError("Name the campaign table as database.table.")
        for part in [*parts, names["id"], names["name"]]:
            _q(str(part))
        names = {"table": str(names["table"]), "id": str(names["id"]), "name": str(names["name"])}
    leave_out = [w.strip() for w in (options.get("leave_out") or []) if str(w).strip()]
    if len(leave_out) > 10:
        raise OptionError("Leave out campaigns by up to 10 words.")
    for word in leave_out:
        _lit(word.lower())
    unsubscribe = str(options.get("unsubscribe") or "unsubscribe").strip()
    _lit(unsubscribe)
    return {"databases": databases, "names": names, "leave_out": [w.lower() for w in leave_out], "unsubscribe": unsubscribe}


def _table(name: str) -> str:
    return ".".join(_q(p) for p in name.split("."))


def _unsub(o: dict) -> str:
    return "'%" + o["unsubscribe"] + "%'"


def _message_branch(db: str, o: dict) -> str:
    d, u = _q(db), _unsub(o)
    return f"""SELECT CONCAT('{db}:', m.id) AS message_key, m.id AS message_id, '{db}' AS postal_database,
         JSON_UNQUOTE(JSON_EXTRACT(m.tag, '$.mkt_id')) AS campaign_id, JSON_UNQUOTE(JSON_EXTRACT(m.tag, '$.party_id')) AS party_id,
         m.subject AS subject, m.rcpt_to AS recipient, LOWER(SUBSTRING_INDEX(m.rcpt_to, '@', -1)) AS domain, m.timestamp AS ts, m.status AS status,
         (SELECT COUNT(*) FROM {d}.deliveries x WHERE x.message_id = m.id AND x.status IN {DELIVERY_STATES}) AS attempts,
         (SELECT COUNT(*) FROM {d}.deliveries x WHERE x.message_id = m.id AND x.status IN ('SoftFail', 'Error')) AS soft_fails,
         (SELECT x.status FROM {d}.deliveries x WHERE x.message_id = m.id AND x.status IN {DELIVERY_STATES} ORDER BY x.id DESC LIMIT 1) AS last_status,
         (SELECT TRIM(CONCAT(COALESCE(x.details, ''), ' ', COALESCE(x.output, ''))) FROM {d}.deliveries x
           WHERE x.message_id = m.id AND x.status IN {DELIVERY_STATES} ORDER BY x.id DESC LIMIT 1) AS last_reply,
         CASE WHEN m.loaded IS NULL THEN 0 ELSE 1 END AS opened, (SELECT COUNT(*) FROM {d}.loads x WHERE x.message_id = m.id) AS opens,
         (SELECT COUNT(*) FROM {d}.clicks k JOIN {d}.links l ON l.id = k.link_id WHERE k.message_id = m.id AND l.url NOT LIKE {u}) AS clicks,
         (SELECT COUNT(*) FROM {d}.clicks k JOIN {d}.links l ON l.id = k.link_id WHERE k.message_id = m.id AND l.url LIKE {u}) AS unsubscribe_clicks
    FROM {d}.messages m
   WHERE {MARKETING}"""


def _named(inner: str, o: dict, alias: str = "u") -> tuple[str, str, str]:
    """the FROM with the campaign-name join, the name expression, and the leave-out condition"""
    if o["names"]:
        n = o["names"]
        join = f"LEFT JOIN {_table(n['table'])} c ON c.{_q(n['id'])} = {alias}.campaign_id"
        name = f"COALESCE(c.{_q(n['name'])}, CONCAT('Campaign ', {alias}.campaign_id))"
    else:
        join = (f"LEFT JOIN (SELECT campaign_id, MIN(subject) AS subject, MIN(ts) AS first_ts FROM ({inner}) s GROUP BY campaign_id) c "
                f"ON c.campaign_id = {alias}.campaign_id")
        name = (f"COALESCE(CONCAT(NULLIF(TRIM(c.subject), ''), ' - ', DATE_FORMAT(FROM_UNIXTIME(c.first_ts), '%d %b %Y')), "
                f"CONCAT('Campaign ', {alias}.campaign_id))")
    where = " AND ".join(f"LOCATE({_lit(w)}, LOWER({name})) = 0" for w in o["leave_out"]) or "1 = 1"
    return join, name, where


def messages_sql(options: dict) -> str:
    """Email Messages: one row per marketing email"""
    o = checked(options)
    inner = "\n   UNION ALL\n  ".join(_message_branch(db, o) for db in o["databases"])
    join, name, where = _named(inner, o)
    return f"""SELECT u.message_key, u.postal_database, u.campaign_id, {name} AS campaign_name, u.party_id, u.subject, u.recipient, u.domain,
       CASE WHEN u.domain IN ('gmail.com', 'googlemail.com') THEN 'Gmail'
            WHEN u.domain IN ('outlook.com', 'hotmail.com', 'live.com', 'msn.com') THEN 'Microsoft'
            WHEN u.domain LIKE 'yahoo.%' OR u.domain IN ('ymail.com', 'rocketmail.com') THEN 'Yahoo' ELSE 'Others' END AS provider,
       FROM_UNIXTIME(u.ts) AS sent_at, u.status AS final_status, 1 AS sent,
       CASE WHEN u.status = 'Sent' THEN 1 ELSE 0 END AS delivered,
       CASE WHEN u.status IN ('HardFail', 'Bounced') THEN 1 ELSE 0 END AS hard_fail,
       CASE WHEN u.status IN ('Sent', 'HardFail', 'Bounced') THEN 0 ELSE 1 END AS pending,
       CASE WHEN u.status = 'Sent' THEN 0 ELSE 1 END AS not_delivered,
       u.attempts, GREATEST(u.attempts - 1, 0) AS retry_attempts, CASE WHEN u.attempts > 1 THEN 1 ELSE 0 END AS retried,
       CASE WHEN u.status = 'Sent' AND u.attempts <= 1 THEN 1 ELSE 0 END AS delivered_first_attempt,
       CASE WHEN u.status = 'Sent' AND u.attempts > 1 THEN 1 ELSE 0 END AS delivered_after_retry,
       u.soft_fails,
       CASE WHEN u.status = 'Sent' THEN 'Delivered'
            WHEN LOCATE('No SMTP servers were available', u.last_reply) > 0 OR LOCATE(' 5.1.1', u.last_reply) > 0
              OR LOCATE('does not exist', LOWER(u.last_reply)) > 0 OR LOCATE('user unknown', LOWER(u.last_reply)) > 0 THEN 'Bad Email'
            WHEN LOCATE('5.7.1', u.last_reply) > 0 OR LOCATE('policy', LOWER(u.last_reply)) > 0
              OR LOCATE('blocked', LOWER(u.last_reply)) > 0 OR LOCATE('spam', LOWER(u.last_reply)) > 0 THEN 'Policy Rejected'
            WHEN u.last_status = 'Error' OR LOCATE('internal error', LOWER(u.last_reply)) > 0 THEN 'Postal Error'
            WHEN u.status IN ('HardFail', 'Bounced') THEN 'Hard Fail' ELSE 'Pending' END AS failure_category,
       CASE WHEN u.status = 'Sent' THEN NULL ELSE LEFT(NULLIF(u.last_reply, ''), 250) END AS bounce_reply,
       u.opened, u.opens, CASE WHEN u.clicks > 0 THEN 1 ELSE 0 END AS clicked, u.clicks,
       CASE WHEN u.unsubscribe_clicks > 0 THEN 1 ELSE 0 END AS unsubscribed
  FROM (
  {inner}
  ) u
  {join}
 WHERE {where}"""


def campaigns_sql(options: dict) -> str:
    """Email Campaigns: one row per campaign, its sending window and speed"""
    return f"""SELECT v.campaign_id, v.campaign_name, MIN(v.sent_at) AS send_start, MAX(v.sent_at) AS send_end,
       ROUND(TIMESTAMPDIFF(SECOND, MIN(v.sent_at), MAX(v.sent_at)) / 60, 2) AS duration_minutes,
       COUNT(*) AS emails_sent,
       ROUND(COUNT(*) / GREATEST(TIMESTAMPDIFF(SECOND, MIN(v.sent_at), MAX(v.sent_at)) / 60, 1), 2) AS emails_per_minute,
       ROUND(COUNT(*) / GREATEST(TIMESTAMPDIFF(SECOND, MIN(v.sent_at), MAX(v.sent_at)) / 3600, 1 / 60), 2) AS emails_per_hour,
       SUM(v.delivered_first_attempt) AS delivered_first_attempt, SUM(v.delivered_after_retry) AS delivered_after_retry,
       SUM(v.delivered) AS delivered, SUM(v.not_delivered) AS pending_or_failed,
       SUM(v.opened) AS opened, SUM(v.clicked) AS clicked, SUM(v.unsubscribed) AS unsubscribed, SUM(v.hard_fail) AS hard_fail
  FROM ({messages_sql(options)}) v
 GROUP BY v.campaign_id, v.campaign_name"""


def _event_branch(db: str, o: dict, kind: str) -> str:
    d, u = _q(db), _unsub(o)
    if kind == "clicks":
        return f"""SELECT CONCAT('{db}:', k.id) AS event_key, JSON_UNQUOTE(JSON_EXTRACT(m.tag, '$.mkt_id')) AS campaign_id, m.subject AS subject,
         m.timestamp AS ts, m.rcpt_to AS recipient, CONCAT('{db}:', m.id) AS message_key, k.timestamp AS event_ts, l.url AS url,
         CASE WHEN l.url LIKE {u} THEN 1 ELSE 0 END AS unsubscribe_link, k.user_agent AS user_agent
    FROM {d}.clicks k JOIN {d}.links l ON l.id = k.link_id JOIN {d}.messages m ON m.id = k.message_id
   WHERE {MARKETING}"""
    return f"""SELECT CONCAT('{db}:', x.id) AS event_key, JSON_UNQUOTE(JSON_EXTRACT(m.tag, '$.mkt_id')) AS campaign_id, m.subject AS subject,
         m.timestamp AS ts, m.rcpt_to AS recipient, CONCAT('{db}:', m.id) AS message_key, x.timestamp AS event_ts, NULL AS url, 0 AS unsubscribe_link,
         x.user_agent AS user_agent
    FROM {d}.loads x JOIN {d}.messages m ON m.id = x.message_id
   WHERE {MARKETING}"""


def link_clicks_sql(options: dict) -> str:
    """Email Link Clicks: one row per click on a tracked link"""
    o = checked(options)
    inner = "\n   UNION ALL\n  ".join(_event_branch(db, o, "clicks") for db in o["databases"])
    join, name, where = _named(inner, o)
    return f"""SELECT u.event_key AS click_key, u.campaign_id, {name} AS campaign_name, u.recipient, u.message_key, FROM_UNIXTIME(u.ts) AS sent_at,
       FROM_UNIXTIME(u.event_ts) AS clicked_at, u.url, CASE WHEN u.unsubscribe_link = 1 THEN 'Unsubscribe' ELSE 'Content' END AS link_type, 1 AS clicks
  FROM (
  {inner}
  ) u
  {join}
 WHERE {where}"""


USER_AGENT = """CASE
            WHEN a.ua = '' THEN 'Unknown'
            WHEN a.ua LIKE '%yahoomailproxy%' OR a.ua LIKE '%googleimageproxy%' OR a.ua LIKE '%ggpht.com%' OR a.ua_raw REGEXP 'Chrome/42\\\\.0\\\\.2311\\\\.135.*Edge/12\\\\.246'
              OR a.ua IN ('mozilla/5.0', 'mozilla/4.0') OR a.ua LIKE 'mozilla/5.0 applewebkit/webkit_version%'
              OR a.ua REGEXP 'python-requests|apache-httpclient|ahc/|curl/|wget/|java/|okhttp|libwww|go-http-client|bot[^a-z]|bot$|crawler|spider|resizer|imageproxy|scanner|headless|preview|monitoring|uptime'
              THEN 'Proxy / Scanner'
            WHEN a.ua LIKE '%ms-office%' OR a.ua LIKE '%msoffice%' OR a.ua LIKE '%microsoft office outlook%' THEN 'Desktop'
            WHEN a.ua LIKE '%ipad%' OR (a.ua LIKE '%android%' AND a.ua NOT LIKE '%mobile%') OR a.ua LIKE '%tablet%' THEN 'Tablet'
            WHEN a.ua LIKE '%iphone%' OR a.ua LIKE '%ipod%' OR a.ua LIKE '%mobile%' OR a.ua LIKE '%windows phone%' OR a.ua LIKE '%android%' THEN 'Mobile'
            WHEN a.ua LIKE '%windows nt%' OR a.ua LIKE '%mac os x%' OR a.ua LIKE '%macintosh%' OR a.ua LIKE '%x11%' OR a.ua LIKE '%linux%' OR a.ua LIKE '%ubuntu%' THEN 'Desktop'
            ELSE 'Unknown' END"""
OPERATING_SYSTEM = """CASE
            WHEN a.ua LIKE '%windows nt%' OR a.ua LIKE '%windows phone%' OR a.ua LIKE '%ms-office%' OR a.ua LIKE '%msoffice%' THEN 'Windows'
            WHEN a.ua LIKE '%android%' THEN 'Android'
            WHEN a.ua LIKE '%iphone%' OR a.ua LIKE '%ipad%' OR a.ua LIKE '%ipod%' OR a.ua LIKE '% ios%' OR a.ua LIKE '%cpu os%' THEN 'iOS'
            WHEN a.ua LIKE '%mac os x%' OR a.ua LIKE '%macintosh%' THEN 'macOS'
            WHEN a.ua LIKE '%x11%' OR a.ua LIKE '%linux%' OR a.ua LIKE '%ubuntu%' THEN 'Linux' ELSE 'Unknown' END"""
EMAIL_CLIENT = """CASE
            WHEN a.ua LIKE '%yahoomailproxy%' THEN 'Yahoo Mail'
            WHEN a.ua LIKE '%googleimageproxy%' OR a.ua LIKE '%ggpht.com%' THEN 'Gmail'
            WHEN a.ua_raw REGEXP 'Chrome/42\\\\.0\\\\.2311\\\\.135.*Edge/12\\\\.246' THEN 'Microsoft Scanner'
            WHEN a.ua IN ('mozilla/5.0', 'mozilla/4.0') OR a.ua LIKE 'mozilla/5.0 applewebkit/webkit_version%' THEN 'Apple Mail Privacy Protection'
            WHEN a.ua REGEXP 'python-requests|apache-httpclient|ahc/|curl/|wget/|java/|okhttp|libwww|go-http-client|bot[^a-z]|bot$|crawler|spider|resizer|imageproxy|scanner|headless|preview|monitoring|uptime' THEN 'Automated Fetch'
            WHEN a.ua LIKE '%oneoutlook%' OR a.ua LIKE '%msoffice%' OR a.ua LIKE '%ms-office%' OR a.ua LIKE '%outlook%' THEN 'Outlook'
            WHEN a.ua LIKE '%thunderbird%' THEN 'Thunderbird'
            WHEN (a.ua LIKE '%iphone%' OR a.ua LIKE '%ipad%' OR a.ua LIKE '%ipod%' OR a.ua LIKE '%mac os x%' OR a.ua LIKE '%macintosh%')
              AND a.ua NOT LIKE '%chrome%' AND a.ua NOT LIKE '%firefox%' THEN 'Apple Mail'
            WHEN a.ua LIKE '%edg/%' OR a.ua LIKE '%edge/%' THEN 'Webmail (Edge)'
            WHEN a.ua LIKE '%firefox/%' THEN 'Webmail (Firefox)'
            WHEN a.ua LIKE '%chrome/%' OR a.ua LIKE '%crios%' THEN 'Webmail (Chrome)'
            WHEN a.ua LIKE '%safari/%' AND a.ua LIKE '%version/%' THEN 'Webmail (Safari)'
            ELSE 'Unknown' END"""


def opens_sql(options: dict) -> str:
    """Email Opens: one row per open of the tracking pixel, sorted by device, system and client as CmpReport does; machine
    fetches (Apple Mail Privacy Protection, Gmail's and Yahoo's proxies, Microsoft's scanner, scripts) flagged"""
    o = checked(options)
    inner = "\n   UNION ALL\n  ".join(_event_branch(db, o, "opens") for db in o["databases"])
    join, name, where = _named(inner, o, alias="a")
    return f"""SELECT a.event_key AS open_key, a.campaign_id, {name} AS campaign_name, a.recipient, a.message_key, FROM_UNIXTIME(a.ts) AS sent_at,
       FROM_UNIXTIME(a.event_ts) AS opened_at,
       {USER_AGENT} AS device_type,
       {OPERATING_SYSTEM} AS operating_system,
       {EMAIL_CLIENT} AS email_client,
       CASE WHEN ({USER_AGENT}) = 'Proxy / Scanner' THEN 1 ELSE 0 END AS machine_open,
       CASE WHEN ({USER_AGENT}) = 'Proxy / Scanner' THEN 0 ELSE 1 END AS human_open, 1 AS opens
  FROM (SELECT u.*, LOWER(TRIM(COALESCE(u.user_agent, ''))) AS ua, TRIM(COALESCE(u.user_agent, '')) AS ua_raw FROM (
  {inner}
  ) u) a
  {join}
 WHERE {where}"""
