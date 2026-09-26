"""Send-time optimisation (campaign.timezone_optimization, patch 0023).

A scheduled campaign names a wall-clock time in its own zone. With the option on, every queued message gets send_after:
that same wall-clock time in the recipient's zone, and the engine claims nothing before it. The zone comes from
customer_master.custom_attributes.timezone when a system put one there, otherwise from the address on file: the state
for the United States and Canada, the country where a country keeps one zone. Nobody's zone known = sent at the
campaign's own time; a local time already past when the run starts = sent now.
"""
from zoneinfo import ZoneInfo

US = {"AL": "America/Chicago", "AK": "America/Anchorage", "AZ": "America/Phoenix", "AR": "America/Chicago", "CA": "America/Los_Angeles", "CO": "America/Denver",
      "CT": "America/New_York", "DE": "America/New_York", "DC": "America/New_York", "FL": "America/New_York", "GA": "America/New_York", "HI": "Pacific/Honolulu",
      "ID": "America/Boise", "IL": "America/Chicago", "IN": "America/Indiana/Indianapolis", "IA": "America/Chicago", "KS": "America/Chicago", "KY": "America/New_York",
      "LA": "America/Chicago", "ME": "America/New_York", "MD": "America/New_York", "MA": "America/New_York", "MI": "America/Detroit", "MN": "America/Chicago",
      "MS": "America/Chicago", "MO": "America/Chicago", "MT": "America/Denver", "NE": "America/Chicago", "NV": "America/Los_Angeles", "NH": "America/New_York",
      "NJ": "America/New_York", "NM": "America/Denver", "NY": "America/New_York", "NC": "America/New_York", "ND": "America/Chicago", "OH": "America/New_York",
      "OK": "America/Chicago", "OR": "America/Los_Angeles", "PA": "America/New_York", "RI": "America/New_York", "SC": "America/New_York", "SD": "America/Chicago",
      "TN": "America/Chicago", "TX": "America/Chicago", "UT": "America/Denver", "VT": "America/New_York", "VA": "America/New_York", "WA": "America/Los_Angeles",
      "WV": "America/New_York", "WI": "America/Chicago", "WY": "America/Denver", "PR": "America/Puerto_Rico"}
CANADA = {"AB": "America/Edmonton", "BC": "America/Vancouver", "MB": "America/Winnipeg", "NB": "America/Moncton", "NL": "America/St_Johns", "NS": "America/Halifax",
          "NT": "America/Yellowknife", "NU": "America/Iqaluit", "ON": "America/Toronto", "PE": "America/Halifax", "QC": "America/Toronto", "SK": "America/Regina",
          "YT": "America/Whitehorse"}
COUNTRY = {"GB": "Europe/London", "IE": "Europe/Dublin", "FR": "Europe/Paris", "DE": "Europe/Berlin", "ES": "Europe/Madrid", "IT": "Europe/Rome", "NL": "Europe/Amsterdam",
           "BE": "Europe/Brussels", "PT": "Europe/Lisbon", "CH": "Europe/Zurich", "AT": "Europe/Vienna", "PL": "Europe/Warsaw", "SE": "Europe/Stockholm", "NO": "Europe/Oslo",
           "DK": "Europe/Copenhagen", "FI": "Europe/Helsinki", "CZ": "Europe/Prague", "HU": "Europe/Budapest", "GR": "Europe/Athens", "RO": "Europe/Bucharest",
           "TR": "Europe/Istanbul", "IL": "Asia/Jerusalem", "AE": "Asia/Dubai", "SA": "Asia/Riyadh", "QA": "Asia/Qatar", "IN": "Asia/Kolkata", "LK": "Asia/Colombo",
           "BD": "Asia/Dhaka", "PK": "Asia/Karachi", "SG": "Asia/Singapore", "MY": "Asia/Kuala_Lumpur", "TH": "Asia/Bangkok", "PH": "Asia/Manila", "HK": "Asia/Hong_Kong",
           "JP": "Asia/Tokyo", "KR": "Asia/Seoul", "NZ": "Pacific/Auckland", "ZA": "Africa/Johannesburg", "NG": "Africa/Lagos", "KE": "Africa/Nairobi", "EG": "Africa/Cairo",
           "AR": "America/Argentina/Buenos_Aires", "CO": "America/Bogota", "PE": "America/Lima", "CL": "America/Santiago", "JM": "America/Jamaica",
           "TT": "America/Port_of_Spain", "PR": "America/Puerto_Rico", "MX": "America/Mexico_City", "UK": "Europe/London", "USA": "*", "CAN": "*"}
ALIASES = {"USA": "US", "UNITED STATES": "US", "UNITED STATES OF AMERICA": "US", "CAN": "CA", "CANADA": "CA", "UK": "GB", "UNITED KINGDOM": "GB"}
TABLE = {"EMAIL": "mailer_execution", "SMS": "sms_execution"}


def zone_rows() -> list[tuple[str, str, str]]:
    """(country, region, zone) for the SQL lookup; region '*' = the whole country."""
    rows = [("US", state, zone) for state, zone in US.items()] + [("CA", province, zone) for province, zone in CANADA.items()]
    rows += [(country, "*", zone) for country, zone in COUNTRY.items() if zone != "*"]
    return rows


def zone_for(address: dict | None, attributes: dict | None = None) -> str | None:
    """The same rule in Python, for a preview or a test."""
    named = (attributes or {}).get("timezone")
    if named:
        try:
            ZoneInfo(named)
            return named
        except Exception:                                  # noqa: BLE001
            pass
    if not address:
        return None
    country = (address.get("country") or "").strip().upper()
    country = ALIASES.get(country, country)
    region = (address.get("state") or address.get("region") or "").strip().upper()
    if country == "US":
        return US.get(region)
    if country == "CA":
        return CANADA.get(region)
    zone = COUNTRY.get(country)
    return None if zone == "*" else zone


ZONE_CTE = """zones(country, region, zone) AS (VALUES {values}),
        located AS (
            SELECT x.id, COALESCE(n.name, zz.zone) AS zone
              FROM {table} x JOIN customer_master cm ON cm.tenant_id = x.tenant_id AND cm.party_id = x.party_id
              LEFT JOIN pg_timezone_names n ON n.name = NULLIF(cm.custom_attributes ->> 'timezone', '')
              LEFT JOIN LATERAL (
                  SELECT z.zone FROM zones z
                   WHERE z.country = COALESCE((SELECT a.alias FROM (VALUES {aliases}) a(name, alias) WHERE a.name = upper(trim(cm.primary_address ->> 'country'))),
                                              upper(trim(cm.primary_address ->> 'country')))
                     AND (z.region = upper(trim(COALESCE(cm.primary_address ->> 'state', cm.primary_address ->> 'region', ''))) OR z.region = '*')
                   ORDER BY (z.region = '*') LIMIT 1) zz ON TRUE
             WHERE x.tenant_id = %(tenant)s AND x.campaign_run_id = %(run)s AND x.status = 'QUEUED')"""


def _values(rows) -> str:
    return ", ".join("('" + "', '".join(item.replace("'", "''") for item in row) + "')" for row in rows)


def apply(cursor, *, tenant_id, run_id, family: str, scheduled_at, campaign_zone: ZoneInfo) -> dict:
    """Stamps send_after on the run's queued messages. Returns how many got a local time and how many go at the campaign's time."""
    wall = scheduled_at.astimezone(campaign_zone).replace(tzinfo=None)
    table = TABLE[family]
    sql = f"""WITH {ZONE_CTE.format(values=_values(zone_rows()), aliases=_values(ALIASES.items()), table=table)}
              UPDATE {table} x SET send_after = GREATEST(now(), (%(wall)s::timestamp AT TIME ZONE p.zone))
                FROM located p WHERE x.id = p.id AND x.tenant_id = %(tenant)s AND x.campaign_run_id = %(run)s AND p.zone IS NOT NULL"""
    cursor.execute(sql, {"tenant": str(tenant_id), "run": str(run_id), "wall": wall})
    localised = cursor.rowcount
    cursor.execute(f"SELECT count(*), min(send_after), max(send_after) FROM {table} WHERE tenant_id = %s AND campaign_run_id = %s AND status = 'QUEUED'", [str(tenant_id), str(run_id)])
    total, first, last = cursor.fetchone()
    return {"localised": localised, "unknown_zone": total - localised, "first_at": first, "last_at": last, "zone": campaign_zone.key, "wall_clock": wall.isoformat(timespec="minutes")}


def coverage(cursor, *, tenant_id, include: list[str], exclude: list[str]) -> dict:
    """Before the send: how many of the people on the attached lists have a zone CEP can work out."""
    cursor.execute(f"""WITH picked AS (SELECT DISTINCT m.party_id FROM contact_list_member m WHERE m.tenant_id = %(tenant)s AND m.contact_list_id::text = ANY(%(include)s)),
                            dropped AS (SELECT DISTINCT m.party_id FROM contact_list_member m WHERE m.tenant_id = %(tenant)s AND m.contact_list_id::text = ANY(%(exclude)s)),
                            kept AS (SELECT p.party_id FROM picked p WHERE NOT EXISTS (SELECT 1 FROM dropped d WHERE d.party_id = p.party_id)),
                            zones(country, region, zone) AS (VALUES {_values(zone_rows())})
                       SELECT count(*), count(*) FILTER (WHERE n.name IS NOT NULL OR zz.zone IS NOT NULL)
                         FROM kept k LEFT JOIN customer_master cm ON cm.tenant_id = %(tenant)s AND cm.party_id = k.party_id
                         LEFT JOIN pg_timezone_names n ON n.name = NULLIF(cm.custom_attributes ->> 'timezone', '')
                         LEFT JOIN LATERAL (
                             SELECT z.zone FROM zones z
                              WHERE z.country = COALESCE((SELECT a.alias FROM (VALUES {_values(ALIASES.items())}) a(name, alias) WHERE a.name = upper(trim(cm.primary_address ->> 'country'))),
                                                         upper(trim(cm.primary_address ->> 'country')))
                                AND (z.region = upper(trim(COALESCE(cm.primary_address ->> 'state', cm.primary_address ->> 'region', ''))) OR z.region = '*')
                              ORDER BY (z.region = '*') LIMIT 1) zz ON TRUE""",
                   {"tenant": str(tenant_id), "include": include or [""], "exclude": exclude or [""]})
    total, known = cursor.fetchone()
    return {"people": int(total), "local_time_known": int(known)}
