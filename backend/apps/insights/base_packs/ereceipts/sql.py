"""The eReceipt Reports pack's SQL, ported from C360Report's E-Receipt Intelligence Suite: the analysis database's
own MySQL tables (ereceipt_report, ereceipt_summary_report, tt_store_imp_1).

Two questions, two datasets. ereceipt_report is the mail itself - one row per e-receipt email, whether it arrived,
whether it was opened. ereceipt_summary_report is the till: one row per store per day with every invoice split by
how the customer took their receipt, which is the adoption figure the business steers by.

The two are not the same population and should not be added together. On this warehouse the summary counts 14.6M
invoices of which 6,232 took an email receipt and 3.3M took a text, while the mail table holds 1,365 rows - it
covers a pilot, not the programme. Each dataset says what it counts, and the pack keeps them apart.

Options:

    databases    the analysis databases, by name
"""
from ..common import q as _q
from ..sms_common import checked_databases
from ..sms_common import dbname as _dbname


def checked(options: dict) -> dict:
    """the options normalised, or OptionError"""
    return {"databases": checked_databases(options, "analysis database")}


# --------------------------------------------------------------------------
# Receipts: one row per e-receipt email
# --------------------------------------------------------------------------

def _receipt_branch(db: str) -> str:
    d = _q(db)
    return f"""SELECT {_dbname(db)} AS analysis_database, r.ORDER_ID AS receipt_key,
           r.SENT_TIMESTAMP AS sent_at, r.OPENED_TIMESTAMP AS opened_at, r.CLICKED_TIMESTAMP AS clicked_at,
           r.BOUNCED_TIMESTAMP AS bounced_at,
           COALESCE(NULLIF(r.RECEIPT_TYPE, ''), 'Not recorded') AS receipt_type,
           COALESCE(NULLIF(r.MAIL_STATUS, ''), 'Not recorded') AS mail_status,
           COALESCE(NULLIF(r.STORE_NAME, ''), 'No store recorded') AS store,
           COALESCE(NULLIF(r.LEVEL_2, ''), 'Not recorded') AS region,
           COALESCE(NULLIF(r.LEVEL_3, ''), 'Not recorded') AS district,
           COALESCE(NULLIF(r.OPENED_DEVICE, ''), 'Not recorded') AS opened_device,
           COALESCE(NULLIF(r.CLICKED_DEVICE, ''), 'Not recorded') AS clicked_device,
           COALESCE(NULLIF(r.BOUNCE_REASON, ''), '') AS bounce_reason,
           1 AS receipts,
           CASE WHEN r.OPENED_TIMESTAMP IS NOT NULL THEN 1 ELSE 0 END AS opened,
           COALESCE(r.OPENED_COUNT, 0) AS opens,
           CASE WHEN r.CLICKED_TIMESTAMP IS NOT NULL THEN 1 ELSE 0 END AS clicked,
           COALESCE(r.CLICKED_COUNT, 0) AS clicks,
           CASE WHEN r.BOUNCED_TIMESTAMP IS NOT NULL THEN 1 ELSE 0 END AS bounced,
           CASE WHEN r.UNSUBBED_TIMESTAMP IS NOT NULL THEN 1 ELSE 0 END AS unsubscribed,
           COALESCE(r.TRIES_COUNT, 0) AS tries
      FROM {d}.ereceipt_report r"""


def receipts_sql(options: dict) -> str:
    """eReceipt Emails: one row per e-receipt sent, and what became of it"""
    o = checked(options)
    return "\n   UNION ALL\n  ".join(_receipt_branch(db) for db in o["databases"])


# --------------------------------------------------------------------------
# Adoption: one row per store per invoice date, by how the receipt was taken
# --------------------------------------------------------------------------

def _adoption_branch(db: str) -> str:
    d = _q(db)
    return f"""SELECT {_dbname(db)} AS analysis_database, s.INVOICE_DATE AS day,
           CONCAT(COALESCE(NULLIF(s.STORE_NAME, ''), CONCAT('Store ', s.STORE_NUMBER)),
                  ' (', s.STORE_NUMBER, ')') AS store,
           COALESCE(NULLIF(s.LEVEL_2, ''), 'Not recorded') AS region,
           COALESCE(NULLIF(s.LEVEL_3, ''), 'Not recorded') AS district,
           COALESCE(NULLIF(t.City, ''), 'Not recorded') AS city,
           COALESCE(NULLIF(t.State, ''), 'Not recorded') AS state,
           COALESCE(NULLIF(t.Brand, ''), 'Not recorded') AS brand,
           COALESCE(NULLIF(t.StoreStatus, ''), 'Not recorded') AS store_status,
           COALESCE(s.INVOICE_COUNT, 0) AS invoices,
           COALESCE(s.EMAIL, 0) AS email_receipts,
           COALESCE(s.SMS, 0) AS text_receipts,
           COALESCE(s.BOTH_COUNT, 0) AS both_receipts,
           COALESCE(s.PRINT, 0) AS printed,
           COALESCE(s.NO_PRINT, 0) AS no_receipt,
           COALESCE(s.CUSTOMER_COUNT, 0) AS customers,
           COALESCE(s.GUEST_COUNT, 0) AS guests
      FROM {d}.ereceipt_summary_report s
      LEFT JOIN {d}.tt_store_imp_1 t ON t.StoreNumber = s.STORE_NUMBER"""


def adoption_sql(options: dict) -> str:
    """Receipt Adoption: one row per store per day, every invoice split by how the receipt was taken"""
    o = checked(options)
    return "\n   UNION ALL\n  ".join(_adoption_branch(db) for db in o["databases"])
