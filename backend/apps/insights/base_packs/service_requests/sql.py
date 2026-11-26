"""The Service Request Reports pack's SQL, ported from C360Report's Service Request suite: the CRM's own MySQL
tables (bi_service_request_master, cust_request_report, cust_request_history, tt_store_hierarchy_imp).

Three datasets. The master is the request as the CRM holds it - type, status, team, timing. The store view is the
same work seen from the shop it belongs to, which the master does not carry. The history is every status change,
for the question the other two cannot answer: how long did it sit at each step.

What is deliberately not read: the customer's name, mobile, email, address and coordinates are all columns on the
master, and none of them is a reporting figure. They never leave the database.

A note on the hierarchy. In this CRM, Region_Name holds a performance band - WARM, COOL, AVERAGE - and
District_Name holds a manager's name. They are the hierarchy the business uses here, and they are not the
geographic regions the analysis database uses for the same stores. Taken as given, not corrected.

Options:

    databases    the CRM databases, by name
"""
from ..common import q as _q
from ..sms_common import checked_databases
from ..sms_common import dbname as _dbname


def checked(options: dict) -> dict:
    """the options normalised, or OptionError"""
    return {"databases": checked_databases(options, "CRM database")}


def _store(db: str, column: str) -> str:
    """the store a request belongs to, from the hierarchy table"""
    return (f"LEFT JOIN {_q(db)}.tt_store_hierarchy_imp h ON h.Store_No = {column}")


# --------------------------------------------------------------------------
# Requests: the request as the CRM master holds it
# --------------------------------------------------------------------------

def _request_branch(db: str) -> str:
    d = _q(db)
    return f"""SELECT {_dbname(db)} AS crm_database, s.SR_ID AS request_key,
           COALESCE(NULLIF(s.SR_TYPE_NAME, ''), 'Not recorded') AS request_type,
           COALESCE(NULLIF(s.SR_STATUS_NAME, ''), 'Not recorded') AS status,
           COALESCE(NULLIF(s.SR_SUB_CATEGORY_NAME, ''), 'Not recorded') AS sub_category,
           COALESCE(NULLIF(s.SR_SOURCE_NAME, ''), 'Not recorded') AS source,
           COALESCE(NULLIF(s.PRIORITY_NAME, ''), 'Not recorded') AS priority,
           COALESCE(NULLIF(s.SR_OWNER_NAME, ''), 'Unassigned') AS owner,
           COALESCE(NULLIF(s.EMP_TEAM_NAME, ''), 'No team') AS team,
           COALESCE(NULLIF(s.SLA_STATUS, ''), 'Not recorded') AS sla_status,
           COALESCE(NULLIF(s.LOCATION_NAME, ''), 'Not recorded') AS location,
           COALESCE(NULLIF(s.CITY_NAME, ''), 'Not recorded') AS city,
           COALESCE(NULLIF(s.STATE_PROVINCE_GEO_ID, ''), 'Not recorded') AS state,
           COALESCE(NULLIF(s.FISCAL_PERIOD, ''), 'Not recorded') AS fiscal_period,
           s.OPEN_DATE AS opened_at, s.DUE_DATE AS due_at, s.CLOSED_ON AS closed_at,
           s.REOPENED_DATE AS reopened_at,
           1 AS requests,
           CASE WHEN s.CLOSED_ON IS NOT NULL THEN 1 ELSE 0 END AS closed,
           CASE WHEN s.CLOSED_ON IS NULL THEN 1 ELSE 0 END AS still_open,
           CASE WHEN s.REOPENED_DATE IS NOT NULL THEN 1 ELSE 0 END AS reopened,
           CASE WHEN s.CLOSED_ON IS NOT NULL AND s.DUE_DATE IS NOT NULL
                     AND s.CLOSED_ON > s.DUE_DATE THEN 1 ELSE 0 END AS closed_late,
           COALESCE(s.TAT_DAYS, 0) AS turnaround_days
      FROM {d}.bi_service_request_master s"""


def requests_sql(options: dict) -> str:
    """Service Requests: one row per request, as the CRM master holds it"""
    o = checked(options)
    return "\n   UNION ALL\n  ".join(_request_branch(db) for db in o["databases"])


# --------------------------------------------------------------------------
# By store: the same work, seen from the shop
# --------------------------------------------------------------------------

def _store_branch(db: str) -> str:
    d = _q(db)
    return f"""SELECT {_dbname(db)} AS crm_database, c.CUST_REQUEST_ID AS request_key,
           COALESCE(NULLIF(c.SR_TYPE_NAME, ''), 'Not recorded') AS request_type,
           COALESCE(NULLIF(c.STATUS_ID, ''), 'Not recorded') AS status,
           COALESCE(NULLIF(c.CATEGORY_DESCRIPTION, ''), 'Not recorded') AS category,
           COALESCE(NULLIF(c.RESPONSIBLE_PERSON, ''), 'Unassigned') AS responsible,
           CASE WHEN COALESCE(c.STORE_ID, '') = '' THEN 'No store recorded'
                WHEN c.STORE_ID = '9999' THEN 'Default store (9999)'
                ELSE CONCAT(COALESCE(NULLIF(c.STORE_NAME, ''), CONCAT('Store ', c.STORE_ID)),
                            ' (', c.STORE_ID, ')') END AS store,
           COALESCE(NULLIF(h.Region_Name, ''), 'Not recorded') AS region,
           COALESCE(NULLIF(h.District_Name, ''), 'Not recorded') AS district,
           COALESCE(NULLIF(h.LineOfBusiness, ''), 'Not recorded') AS line_of_business,
           c.CUST_REQUEST_DATE AS raised_at, c.CLOSED_BY_DATE AS closed_at,
           c.LAST_MODIFIED_DATE AS last_touched_at,
           1 AS requests,
           CASE WHEN c.CLOSED_BY_DATE IS NOT NULL THEN 1 ELSE 0 END AS closed,
           CASE WHEN c.CLOSED_BY_DATE IS NULL THEN 1 ELSE 0 END AS still_open,
           COALESCE(c.TAT_DAYS, 0) AS turnaround_days,
           COALESCE(c.ESCALATION_LEVEL, 0) AS escalation_level
      FROM {d}.cust_request_report c
      {_store(db, 'c.STORE_ID')}"""


def by_store_sql(options: dict) -> str:
    """Requests by Store: the same requests placed in the store hierarchy"""
    o = checked(options)
    return "\n   UNION ALL\n  ".join(_store_branch(db) for db in o["databases"])


# --------------------------------------------------------------------------
# History: every status change
# --------------------------------------------------------------------------

def _history_branch(db: str) -> str:
    d = _q(db)
    return f"""SELECT {_dbname(db)} AS crm_database,
           y.CUST_REQUEST_HISTORY_ID AS event_key, y.CUST_REQUEST_ID AS request_key,
           COALESCE(NULLIF(y.STATUS_ID, ''), 'Not recorded') AS status,
           COALESCE(NULLIF(y.PRIORITY, ''), 'Not recorded') AS priority,
           COALESCE(NULLIF(y.CUST_REQ_SR_SOURCE, ''), 'Not recorded') AS source,
           COALESCE(NULLIF(y.CREATED_BY_USER_LOGIN, ''), 'Not recorded') AS changed_by,
           y.CREATED_DATE AS changed_at, y.CLOSED_BY_DATE AS closed_at,
           1 AS events,
           CASE WHEN y.CLOSED_BY_DATE IS NOT NULL THEN 1 ELSE 0 END AS closing_events
      FROM {d}.cust_request_history y"""


def history_sql(options: dict) -> str:
    """Request History: one row per status change"""
    o = checked(options)
    return "\n   UNION ALL\n  ".join(_history_branch(db) for db in o["databases"])
