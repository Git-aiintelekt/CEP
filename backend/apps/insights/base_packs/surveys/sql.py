"""The Survey Reports pack's SQL, ported from C360Report's Survey suite: the CRM's own MySQL tables
(survey_master, tt_store_hierarchy_imp).

survey_master holds one row per question answered, so two datasets come out of it. `answers` keeps that grain -
the right one for "what did people say to question 5". `responses` folds each sitting back into one row, which is
the grain every rate needs: a survey answered by 18,906 people and a first question answered by 157,617 are not the
same denominator, and dividing one by the other is the mistake this pack exists to prevent.

The first question is the recommendation score, 0 to 10, and it is asked of everyone; the rest are asked of those
who carry on. So `responses` marks a sitting as `completed` only when it got past the first question, and the
satisfaction ratings are averaged over those.

A note on the hierarchy: in this CRM, Region_Name holds a performance band - WARM, COOL, AVERAGE - and
District_Name a manager's name. Taken as given.

Options:

    databases    the CRM databases, by name
    survey       the survey's id; default "10000", the customer survey
"""
from ..common import OptionError
from ..common import lit as _lit
from ..common import q as _q
from ..sms_common import checked_databases
from ..sms_common import dbname as _dbname

DEFAULT_SURVEY = "10000"
# The question numbers the suite's figures are written against (SEQUENCE_NUMBER).
RECOMMEND, SATISFACTION, CLEAN, STYLES, IN_STOCK, FRIENDLINESS, COMMENT, CONTACT = 1, 2, 3, 4, 5, 6, 7, 8
CONTACT_WANTED = "CONTACTME"

# The recommendation score read the usual way: 9 and 10 are promoters, 7 and 8 passives, the rest detractors.
PROMOTER = "CAST(a.RESPONSE_VALUE AS SIGNED) >= 9"
PASSIVE = "CAST(a.RESPONSE_VALUE AS SIGNED) BETWEEN 7 AND 8"
DETRACTOR = "CAST(a.RESPONSE_VALUE AS SIGNED) <= 6"
NUMERIC = "a.RESPONSE_VALUE REGEXP '^[0-9]+$'"

# The channel a sitting arrived through. The e-receipt channel carries the store in its own value
# ("Ereceipt for -150"), which is noise in a channel breakdown, so it is folded to one name.
CHANNEL = """CASE WHEN a.CHANNEL IS NULL OR a.CHANNEL = '' THEN 'Not recorded'
                  WHEN a.CHANNEL LIKE 'Ereceipt%%' THEN 'eReceipt'
                  ELSE a.CHANNEL END"""


def checked(options: dict) -> dict:
    """the options normalised, or OptionError"""
    databases = checked_databases(options, "CRM database")
    survey = str(options.get("survey") or DEFAULT_SURVEY).strip()
    if not survey:
        raise OptionError("Name the survey's id.")
    _lit(survey)
    return {"databases": databases, "survey": survey}


def _scope(o: dict) -> str:
    return f"a.SURVEY_ID = {_lit(o['survey'])}"


def _store(column: str) -> str:
    return (f"CASE WHEN COALESCE({column}, '') = '' THEN 'No store recorded' "
            f"WHEN {column} = '9999' THEN 'Default store (9999)' "
            f"ELSE CONCAT('Store ', {column}) END")


# --------------------------------------------------------------------------
# Answers: one row per question answered
# --------------------------------------------------------------------------

def _answer_branch(db: str, o: dict) -> str:
    d = _q(db)
    return f"""SELECT {_dbname(db)} AS crm_database,
           CONCAT(a.RESPONSE_ID, ':', a.SEQUENCE_NUMBER) AS answer_key,
           a.RESPONSE_ID AS response_key, a.RESPONSE_DATETIME AS answered_at,
           a.SEQUENCE_NUMBER AS question_number,
           COALESCE(NULLIF(a.Q_SHORT, ''), CONCAT('Question ', a.SEQUENCE_NUMBER)) AS question,
           COALESCE(NULLIF(a.RESPONSE_TYPE, ''), 'Not recorded') AS answer_type,
           COALESCE(NULLIF(a.RESPONSE_VALUE, ''), 'No answer') AS answer,
           {CHANNEL.replace('%%', '%')} AS channel,
           {_store('a.STORE_ID')} AS store,
           COALESCE(NULLIF(h.Region_Name, ''), 'Not recorded') AS region,
           COALESCE(NULLIF(h.District_Name, ''), 'Not recorded') AS district,
           COALESCE(NULLIF(a.DEVICE_TYPE, ''), 'Not recorded') AS device_type,
           COALESCE(NULLIF(a.TRANSACTION_TYPE, ''), 'Not recorded') AS transaction_type,
           1 AS answers
      FROM {d}.survey_master a
      LEFT JOIN {d}.tt_store_hierarchy_imp h ON h.Store_No = a.STORE_ID
     WHERE {_scope(o)}"""


def answers_sql(options: dict) -> str:
    """Survey Answers: one row per question answered"""
    o = checked(options)
    return "\n   UNION ALL\n  ".join(_answer_branch(db, o) for db in o["databases"])


# --------------------------------------------------------------------------
# Responses: one row per sitting, the grain every rate needs
# --------------------------------------------------------------------------

def _response_branch(db: str, o: dict) -> str:
    d = _q(db)

    def rating(number):
        return (f"AVG(CASE WHEN a.SEQUENCE_NUMBER = {number} AND {NUMERIC} "
                f"THEN CAST(a.RESPONSE_VALUE AS SIGNED) END)")

    return f"""SELECT {_dbname(db)} AS crm_database, a.RESPONSE_ID AS response_key,
           MIN(a.RESPONSE_DATETIME) AS answered_at,
           MAX({CHANNEL.replace('%%', '%')}) AS channel,
           MAX({_store('a.STORE_ID')}) AS store,
           MAX(COALESCE(NULLIF(h.Region_Name, ''), 'Not recorded')) AS region,
           MAX(COALESCE(NULLIF(h.District_Name, ''), 'Not recorded')) AS district,
           MAX(COALESCE(NULLIF(a.DEVICE_TYPE, ''), 'Not recorded')) AS device_type,
           MAX(COALESCE(NULLIF(a.TRANSACTION_TYPE, ''), 'Not recorded')) AS transaction_type,
           CASE WHEN MAX(CASE WHEN a.SEQUENCE_NUMBER = {RECOMMEND} AND {PROMOTER} THEN 1 ELSE 0 END) = 1 THEN 'Promoter'
                WHEN MAX(CASE WHEN a.SEQUENCE_NUMBER = {RECOMMEND} AND {PASSIVE} THEN 1 ELSE 0 END) = 1 THEN 'Passive'
                WHEN MAX(CASE WHEN a.SEQUENCE_NUMBER = {RECOMMEND} AND {DETRACTOR} THEN 1 ELSE 0 END) = 1 THEN 'Detractor'
                ELSE 'No score' END AS recommendation,
           1 AS responses,
           MAX(CASE WHEN a.SEQUENCE_NUMBER = {RECOMMEND} AND {NUMERIC} THEN 1 ELSE 0 END) AS scored,
           MAX(CASE WHEN a.SEQUENCE_NUMBER = {RECOMMEND} AND {PROMOTER} THEN 1 ELSE 0 END) AS promoters,
           MAX(CASE WHEN a.SEQUENCE_NUMBER = {RECOMMEND} AND {PASSIVE} THEN 1 ELSE 0 END) AS passives,
           MAX(CASE WHEN a.SEQUENCE_NUMBER = {RECOMMEND} AND {DETRACTOR} THEN 1 ELSE 0 END) AS detractors,
           MAX(CASE WHEN a.SEQUENCE_NUMBER > {RECOMMEND} THEN 1 ELSE 0 END) AS completed,
           MAX(CASE WHEN a.SEQUENCE_NUMBER = {COMMENT} AND COALESCE(a.RESPONSE_VALUE, '') <> '' THEN 1 ELSE 0 END) AS commented,
           MAX(CASE WHEN a.SEQUENCE_NUMBER = {CONTACT} AND a.RESPONSE_VALUE = {_lit(CONTACT_WANTED)} THEN 1 ELSE 0 END) AS contact_wanted,
           {rating(RECOMMEND)} AS recommend_score,
           {rating(SATISFACTION)} AS satisfaction,
           {rating(CLEAN)} AS store_clean,
           {rating(STYLES)} AS styles_found,
           {rating(IN_STOCK)} AS in_stock,
           {rating(FRIENDLINESS)} AS friendliness
      FROM {d}.survey_master a
      LEFT JOIN {d}.tt_store_hierarchy_imp h ON h.Store_No = a.STORE_ID
     WHERE {_scope(o)}
     GROUP BY a.RESPONSE_ID"""


def responses_sql(options: dict) -> str:
    """Survey Responses: one row per sitting, with its score and ratings"""
    o = checked(options)
    return "\n   UNION ALL\n  ".join(_response_branch(db, o) for db in o["databases"])
