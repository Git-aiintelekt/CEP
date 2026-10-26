"""The platform's base packs (docs/mockups/base-reports.html): ready-made datasets, shared formulas, reports and dashboards a workspace
adds as its own copies (apps/insights/base_reports.py). A pack ships with the release; a change to one is a new version here."""
from .email_campaigns import PACK as EMAIL_CAMPAIGNS

PACKS = {p["key"]: p for p in (EMAIL_CAMPAIGNS,)}
