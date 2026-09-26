"""A/B subject lines (campaign.ab_config, patch 0023). Email only: texts have no subject.

At the send, a sample of the audience is split in two: half gets subject A (the template's), half subject B. The rest is
queued as HOLD and the engine leaves it alone. When campaign_run.ab_decide_at comes, decide() compares the two by the
chosen metric, marks the winner on campaign_run_variant, and turns the HOLD rows into the winner's subject, so the
next pass of the dispatcher sends them. A tie within one point goes to A: the template's subject is the safe choice.
"""
import logging

from django.conf import settings
from django.db import connections
from django.utils import timezone

from apps.campaigns.models import CampaignRun, CampaignRunVariant

from . import session

log = logging.getLogger("cep.delivery")
MIN_AUDIENCE = 20                                         # below this a split says nothing: everyone gets A
DEFAULTS = {"sample_pct": 20, "metric": "OPEN_RATE", "decide_after_minutes": 240}
METRICS = {"OPEN_RATE": "open rate", "CLICK_RATE": "click rate"}
SAMPLE_RANGE = (10, 50)
DECIDE_RANGE = (30, 7 * 24 * 60)
TIE_POINTS = 1.0


def config(campaign) -> dict | None:
    """The test as it will run, or None when there is none (off, no subject B, or not an email campaign)."""
    raw = campaign.ab_config or {}
    if not raw.get("enabled") or not (raw.get("subject_b") or "").strip() or campaign.channel != "EMAIL":
        return None
    return {**DEFAULTS, **{key: raw[key] for key in DEFAULTS if raw.get(key) is not None}, "subject_b": raw["subject_b"].strip()[:300]}


def validate(value) -> str | None:
    """A problem with the setting, in words; None when it is fine. An empty or switched-off setting is always fine."""
    if value is None:
        return None
    if not isinstance(value, dict):
        return "Send the subject line test as an object."
    if not value.get("enabled"):
        return None
    if not (value.get("subject_b") or "").strip():
        return "Enter the second subject line, or switch the test off."
    if len(value["subject_b"].strip()) > 300:
        return "Subject B can have up to 300 characters."
    sample = value.get("sample_pct", DEFAULTS["sample_pct"])
    if not isinstance(sample, int) or not SAMPLE_RANGE[0] <= sample <= SAMPLE_RANGE[1]:
        return f"The sample is a whole number from {SAMPLE_RANGE[0]} to {SAMPLE_RANGE[1]} percent of the audience."
    if value.get("metric", DEFAULTS["metric"]) not in METRICS:
        return "The winner is decided by open rate or click rate."
    minutes = value.get("decide_after_minutes", DEFAULTS["decide_after_minutes"])
    if not isinstance(minutes, int) or not DECIDE_RANGE[0] <= minutes <= DECIDE_RANGE[1]:
        return "Decide after 30 minutes to 7 days."
    return None


def split(cursor, *, tenant_id, run, campaign, content) -> dict | None:
    """Right after the audience is queued: labels the sample A and B, the rest HOLD, and plans the decision. None = no test."""
    cfg = config(campaign)
    if cfg is None:
        return None
    args = {"tenant": str(tenant_id), "run": str(run.pk)}
    cursor.execute("SELECT count(*) FROM mailer_execution WHERE tenant_id = %(tenant)s AND campaign_run_id = %(run)s AND status = 'QUEUED'", args)
    total = cursor.fetchone()[0]
    subject_a = (content.subject_line or campaign.name)[:300]
    if total < MIN_AUDIENCE:
        return {"skipped": f"only {total} people to send to: fewer than {MIN_AUDIENCE}, so everyone gets subject A", "total": total}
    sample = max(2, round(total * cfg["sample_pct"] / 100))
    half = sample // 2
    cursor.execute("""WITH numbered AS (SELECT id, row_number() OVER (ORDER BY md5(party_id || %(run)s)) AS n FROM mailer_execution
                                         WHERE tenant_id = %(tenant)s AND campaign_run_id = %(run)s AND status = 'QUEUED')
                      UPDATE mailer_execution x
                         SET variant_key = CASE WHEN r.n <= %(half)s THEN 'A' WHEN r.n <= %(sample)s THEN 'B' ELSE 'HOLD' END,
                             subject_line = CASE WHEN r.n > %(half)s AND r.n <= %(sample)s THEN %(subject_b)s ELSE %(subject_a)s END
                        FROM numbered r WHERE x.id = r.id AND x.tenant_id = %(tenant)s AND x.campaign_run_id = %(run)s""",
                   {**args, "half": half, "sample": sample, "subject_a": subject_a, "subject_b": cfg["subject_b"]})
    decide_at = timezone.now() + timezone.timedelta(minutes=int(cfg["decide_after_minutes"]))
    for key, subject, share in (("A", subject_a, half), ("B", cfg["subject_b"], sample - half)):
        CampaignRunVariant.objects.update_or_create(campaign_run=run, variant_key=key,
                                                    defaults={"subject_line": subject, "allocation_pct": round(share * 100 / total, 2), "winner_metric": cfg["metric"]})
    CampaignRun.objects.filter(pk=run.pk, tenant_id=tenant_id).update(ab_decide_at=decide_at)
    return {"total": total, "sample": sample, "a": half, "b": sample - half, "held": total - sample, "metric": cfg["metric"], "decide_at": decide_at}


def figures(tenant_id, run_id) -> dict[str, dict]:
    """Per variant: how many were sent, delivered, opened and clicked, and the two rates."""
    with session.connection().cursor() as cursor:
        cursor.execute("""SELECT variant_key, count(*) FILTER (WHERE status NOT IN ('QUEUED', 'FAILED')), count(*) FILTER (WHERE status IN ('DELIVERED', 'OPENED', 'CLICKED')),
                                 count(*) FILTER (WHERE status IN ('OPENED', 'CLICKED')), count(*) FILTER (WHERE status = 'CLICKED'), count(*)
                            FROM mailer_execution WHERE tenant_id = %s AND campaign_run_id = %s AND variant_key IS NOT NULL GROUP BY 1""", [str(tenant_id), str(run_id)])
        rows = {key: {"sent": int(sent), "delivered": int(delivered), "opened": int(opened), "clicked": int(clicked), "queued_or_held": int(total) - int(sent)}
                for key, sent, delivered, opened, clicked, total in cursor.fetchall()}
    for item in rows.values():
        base = item["sent"] or item["delivered"]           # per message sent: the two samples are the same size, and delivery callbacks may lag
        item["open_rate"] = round(item["opened"] * 100 / base, 1) if base else 0.0
        item["click_rate"] = round(item["clicked"] * 100 / base, 1) if base else 0.0
    return rows


def summary(run) -> list[dict]:
    """What the API shows on a run: each variant with its subject, share, figures and whether it won."""
    variants = list(run.campaign_run_variants.filter(deleted_at__isnull=True).order_by("variant_key"))
    if not variants:
        return []
    counts = figures(run.tenant_id, run.pk)
    held = counts.get("HOLD", {}).get("queued_or_held", 0)
    return [{"variant_key": v.variant_key, "subject_line": v.subject_line, "allocation_pct": float(v.allocation_pct), "is_winner": v.is_winner, "winner_metric": v.winner_metric,
             "metric_value": float(v.metric_value) if v.metric_value is not None else None, **counts.get(v.variant_key, {}), "waiting_for_winner": held, "decide_at": run.ab_decide_at}
            for v in variants]


def due(limit: int = 50) -> list[tuple[str, str]]:
    """(tenant_id, run_id) of runs whose decision time has come, across tenants."""
    with connections[settings.PLATFORM_ALIAS].cursor() as cursor:
        cursor.execute("""SELECT r.tenant_id, r.id FROM campaign_run r JOIN tenant t ON t.id = r.tenant_id
                           WHERE t.status = 'ACTIVE' AND r.status = 'SENDING' AND r.ab_decide_at IS NOT NULL AND r.ab_decide_at <= now()
                             AND NOT EXISTS (SELECT 1 FROM campaign_run_variant v WHERE v.campaign_run_id = r.id AND v.is_winner IS NOT NULL)
                           ORDER BY r.ab_decide_at LIMIT %s""", [limit])
        return [(str(a), str(b)) for a, b in cursor.fetchall()]


def decide(tenant_id, run_id, *, chosen: str | None = None, user=None) -> dict:
    """Marks the winner and releases the held messages with its subject. `chosen` = a person picked instead of the metric.
    Must run inside session.tenant_scope(tenant_id)."""
    from apps.campaigns import service
    from apps.platform_ops import notifications
    notice = None
    with session.tx():
        run = CampaignRun.objects.select_related("campaign__owner_user", "campaign__tenant").get(pk=run_id, tenant_id=tenant_id)
        variants = {v.variant_key: v for v in run.campaign_run_variants.filter(deleted_at__isnull=True)}
        if not {"A", "B"} <= set(variants):
            raise ValueError("This run has no subject line test.")
        if any(v.is_winner is not None for v in variants.values()):
            raise ValueError("The winner was already chosen.")
        if chosen is not None and chosen not in ("A", "B"):
            raise ValueError("Choose A or B.")
        counts = figures(tenant_id, run_id)
        metric = variants["A"].winner_metric or "OPEN_RATE"
        rate = "open_rate" if metric == "OPEN_RATE" else "click_rate"
        a, b = counts.get("A", {}).get(rate, 0.0), counts.get("B", {}).get(rate, 0.0)
        winner = chosen or ("B" if b > a + TIE_POINTS else "A")
        how = "chosen by " + (getattr(user, "display_name", None) or getattr(user, "email", None) or "a person") if chosen else f"by {METRICS[metric]}"
        now = timezone.now()
        for key, variant in variants.items():
            CampaignRunVariant.objects.filter(pk=variant.pk).update(is_winner=key == winner, metric_value=counts.get(key, {}).get(rate, 0.0), updated_at=now)
        with session.connection().cursor() as cursor:
            cursor.execute("""UPDATE mailer_execution SET variant_key = %s, subject_line = %s
                               WHERE tenant_id = %s AND campaign_run_id = %s AND status = 'QUEUED' AND variant_key = 'HOLD'""",
                           [winner, variants[winner].subject_line, str(tenant_id), str(run_id)])
            released = cursor.rowcount
        CampaignRun.objects.filter(pk=run.pk, tenant_id=tenant_id).update(ab_decide_at=now)
        message = (f"Subject line test: {winner} wins {how} (A {a}%, B {b}%" + (", a tie goes to A" if not chosen and abs(b - a) <= TIE_POINTS else "") + f"). "
                   f"{released:,} more people get \"{variants[winner].subject_line}\".")
        service.record_run_event(tenant_id, run.campaign_id, run.pk, "AB_WINNER", message, detail={"winner": winner, "metric": metric, "a": counts.get("A"), "b": counts.get("B"), "released": released})
        campaign = run.campaign
        try:
            notice = {"config": notifications.prepare(campaign.tenant), "title": f"{campaign.name}: subject line {winner} won",
                      "lines": [f"A \"{variants['A'].subject_line}\": {a}% {METRICS[metric]}.", f"B \"{variants['B'].subject_line}\": {b}% {METRICS[metric]}.",
                                f"{released:,} more people now get the winner."],
                      "link": notifications.campaign_link(campaign.pk), "link_label": "Open the Campaign", "owner_email": campaign.owner_user.email if campaign.owner_user else None}
        except Exception:                                  # noqa: BLE001
            log.exception("A/B notification not prepared")
    if notice:
        try:
            notifications.deliver(notice.pop("config"), tenant_id, "ab_winner", **notice)
        except Exception:                                  # noqa: BLE001
            log.exception("A/B notification not delivered")
    return {"winner": winner, "metric": metric, "a": a, "b": b, "released": released}
