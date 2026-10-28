"""The platform's base packs (docs/mockups/base-reports.html): ready-made datasets, shared formulas, reports and dashboards a workspace
adds as its own copies (apps/insights/base_reports.py). A pack ships with the release; a change to one is a new version here.
A pack names the suite components it needs ("components"): a workspace is offered only the packs whose components it has, and the
back-office's Onboard a Tenant lists them for the components chosen there."""
from .email_campaigns import PACK as EMAIL_CAMPAIGNS

PACKS = {p["key"]: p for p in (EMAIL_CAMPAIGNS,)}


def needs(pack: dict) -> list[str]:
    return pack.get("components") or ["insights"]


def fitting(component_keys) -> list[dict]:
    """the packs a workspace with these components can add"""
    has = set(component_keys)
    return [p for p in PACKS.values() if set(needs(p)) <= has]
