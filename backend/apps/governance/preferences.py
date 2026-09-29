"""The preference centre: what a person chooses to receive, and the workspace's page that lets them choose.

A workspace switches it on under Settings -> Preference Centre. While it is off nothing changes: the unsubscribe link is the
only opt-out, {{preference_url}} in a template resolves to the unsubscribe link, and topic choices people made earlier are
kept but not applied. While it is on:

    channels   email / texts on or off — the existing per-channel consent (consent_suppression), recorded with source
               PREFERENCE_CENTER; opting in again is allowed when the workspace says so
    topics     subscription_topic rows the workspace defines; a person's opt-outs live in party_topic_preference, and a
               campaign filed under a topic leaves out everyone who opted out of it (TOPIC_OPTED_OUT in the audience build)

The page itself is public and server-rendered (api/v1/preferences_public.py); its link carries the same signed token as
the unsubscribe link. The settings live in tenant.settings["preference_center"].
"""
from datetime import timedelta

from django.utils import timezone

from apps.delivery.engine import session, unsubscribe
from apps.platform_ops import params

KEY = "preference_center"
CHANNELS = ("EMAIL", "SMS")
DEFAULTS = {
    "enabled": False,
    "brand_name": "",                                     # blank: the workspace's name
    "heading": "Choose what you receive",
    "email_description": "Offers, news and events by email.",
    "sms_description": "Offers and reminders by text. Message and data rates may apply.",
    "footer": "",
    "privacy_url": "",
    "allow_opt_in": True,
}
LIMITS = {"brand_name": 80, "heading": 120, "email_description": 200, "sms_description": 200, "footer": 300, "privacy_url": 300}


class PreferenceError(ValueError):
    def __init__(self, field: str, message: str):
        super().__init__(message)
        self.field = field


# ------------------------------------------------------------------------------------------------------------ settings
def settings_of(tenant) -> dict:
    stored = (tenant.settings or {}).get(KEY) or {}
    return {**DEFAULTS, **{key: stored[key] for key in DEFAULTS if key in stored}}


def enabled(tenant) -> bool:
    return bool(settings_of(tenant)["enabled"])


def save(tenant, data: dict) -> dict:
    current = settings_of(tenant)
    for key in ("enabled", "allow_opt_in"):
        if key in data:
            if not isinstance(data[key], bool):
                raise PreferenceError(key, "On or off.")
            current[key] = data[key]
    for key, limit in LIMITS.items():
        if key in data:
            value = " ".join(str(data[key] or "").split())
            if len(value) > limit:
                raise PreferenceError(key, f"Use {limit} characters or fewer.")
            current[key] = value
    if current["privacy_url"] and not current["privacy_url"].lower().startswith(("https://", "http://")):
        raise PreferenceError("privacy_url", "A full address, starting with https://.")
    if not current["heading"]:
        raise PreferenceError("heading", "Give the page a heading.")
    tenant.settings = {**(tenant.settings or {}), KEY: current}
    tenant.save(update_fields=["settings"])
    return current


def brand_name(tenant) -> str:
    return settings_of(tenant)["brand_name"] or tenant.name


# ------------------------------------------------------------------------------------------------------------ the link
def url_for(token: str) -> str:
    return f"{params.public_api_url()}/api/v1/public/preferences/?t={token}"


def link_for(tenant, token: str) -> str:
    """What {{preference_url}} becomes: the preference page, or the unsubscribe link while the centre is off."""
    return url_for(token) if enabled(tenant) else unsubscribe.url_for(token)


# ------------------------------------------------------------------------------------------------------------ topics
def topics(tenant_id, *, shown_only: bool = False, channel: str | None = None) -> list:
    from .models import SubscriptionTopic
    rows = SubscriptionTopic.objects.filter(tenant_id=tenant_id, deleted_at__isnull=True).order_by("sort_order", "name")
    if shown_only:
        rows = rows.filter(is_shown=True)
    if channel:
        rows = rows.filter(channels__contains=[channel])
    return list(rows)


def topic_filter(campaign):
    """The topic the audience build leaves opt-outs of: the campaign's, while the workspace's preference centre is on."""
    if getattr(campaign, "topic_id", None) is None or campaign.solicitation_type != "MARKETING":
        return None
    return str(campaign.topic_id) if enabled(campaign.tenant) else None


def opted_out(tenant_id, party_id: str) -> set[str]:
    with session.connection().cursor() as cursor:
        cursor.execute("SELECT topic_id::text FROM party_topic_preference WHERE tenant_id = %s AND party_id = %s AND opted_out", [str(tenant_id), party_id])
        return {row[0] for row in cursor.fetchall()}


def set_topics(tenant_id, party_id: str, shown: list, opted_out_ids: set[str], evidence: dict | None = None) -> int:
    """Records the person's choice for every topic on the page. Returns how many changed."""
    import json
    before = opted_out(tenant_id, party_id)
    now = timezone.now()
    with session.connection().cursor() as cursor:
        for topic in shown:
            out = str(topic.pk) in opted_out_ids
            cursor.execute("""INSERT INTO party_topic_preference (tenant_id, party_id, topic_id, opted_out, evidence, updated_at)
                              VALUES (%s, %s, %s, %s, %s::jsonb, %s)
                              ON CONFLICT (tenant_id, party_id, topic_id) DO UPDATE
                                 SET opted_out = EXCLUDED.opted_out, evidence = EXCLUDED.evidence, updated_at = EXCLUDED.updated_at
                               WHERE party_topic_preference.opted_out <> EXCLUDED.opted_out""",
                           [str(tenant_id), party_id, str(topic.pk), out, json.dumps(evidence or {}, default=str), now])
    shown_ids = {str(topic.pk) for topic in shown}
    return len(((before & shown_ids) ^ (opted_out_ids & shown_ids)))


def opt_out_counts(tenant_id) -> dict[str, int]:
    with session.connection().cursor() as cursor:
        cursor.execute("SELECT topic_id::text, count(*) FROM party_topic_preference WHERE tenant_id = %s AND opted_out GROUP BY 1", [str(tenant_id)])
        return dict(cursor.fetchall())


# ------------------------------------------------------------------------------------------------------------ figures
def stats(tenant_id, days: int = 30) -> dict:
    since = timezone.now() - timedelta(days=days)
    with session.connection().cursor() as cursor:
        cursor.execute("SELECT count(*) FROM tracking_event WHERE tenant_id = %s AND event_type = 'PREFERENCE_VIEW' AND occurred_at >= %s", [str(tenant_id), since])
        opened = cursor.fetchone()[0]
        cursor.execute("""SELECT action, count(*) FROM consent_record WHERE tenant_id = %s AND source = 'PREFERENCE_CENTER' AND occurred_at >= %s GROUP BY 1""",
                       [str(tenant_id), since])
        actions = dict(cursor.fetchall())
        cursor.execute("SELECT count(*) FROM party_topic_preference WHERE tenant_id = %s AND opted_out AND updated_at >= %s", [str(tenant_id), since])
        topics_unticked = cursor.fetchone()[0]
    return {"days": days, "opened": opened, "unsubscribed": int(actions.get("OPT_OUT", 0)), "opted_in": int(actions.get("RESUBSCRIBE", 0)), "topics_unticked": topics_unticked}
