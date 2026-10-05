"""Test Publish + Approve (phase 6i): the 4 readiness checks, a real synchronous test send scoped to a chosen test
population, and Approve/Activate (now, or scheduled for later).

A test send is not a second implementation: it enrolls the chosen population at the version under test's Entry
step and drives them through apps.journeys.engine exactly as the live worker would (enroll.py / advance.py / steps.py),
except a WAIT step is treated as already elapsed — a test cannot wait real days — and the whole pass runs to
completion in this request rather than being picked up later by run_scheduler. Email/SMS steps go out for real
through the same campaign engine (messages.py: Mailer Master -> Postal, SMS Master -> Digivize); this module just
calls apps.delivery.engine.process_run synchronously instead of waiting for the next dispatch-campaign-runs pass.
"""
import logging
import random

from django.db import IntegrityError, transaction
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from api.exceptions import Conflict
from apps.contact_lists.models import ContactListMember
from apps.delivery.engine import process_run, session
from apps.delivery.models import MailerExecution, SmsExecution
from apps.governance.models import CommunicationGovernancePolicy
from apps.templates.models import TemplateMaster

from . import graph, schedule
from .engine import enroll as enroll_engine
from .engine import steps as steps_engine
from .engine.outcome import Done, Finish, Hold
from .models import (
    Journey, JourneyConnection, JourneyCustomerState, JourneyEnrollment, JourneyEntryRule, JourneyNode,
    JourneyNodeExecution, JourneyVersion,
)

log = logging.getLogger("cep.journeys")

MESSAGE_TYPES = ("EMAIL", "SMS", "MMS")
MAX_TEST_POPULATION = 200
MAX_HOPS = 50
RUN_ROUNDS = 5  # process_run's own retry rounds for the test's small batch


# ---------------------------------------------------------------------------------------------------- readiness

def _entry_summary(version: JourneyVersion) -> str:
    rules = list(JourneyEntryRule.objects.filter(journey_version=version, deleted_at__isnull=True))
    if not rules:
        return "No entry rule configured yet."
    journey = version.journey
    named = graph.name_references([{"entry_type": rule.entry_type, "rule_definition": rule.rule_definition or {}} for rule in rules],
                                  journey.tenant_id)
    parts = []
    for rule in named:
        definition = rule["rule_definition"]
        if rule["entry_type"] == "EVENT":
            parts.append(f"{str(definition.get('event_type') or 'an event').replace('_', ' ').title()} event")
        elif rule["entry_type"] == "CUSTOMER_LIST":
            parts.append(f"the {rule['reference_name']} customer list" if rule.get("reference_name")
                         else "an unknown customer list" if "reference_name" in rule else "a customer list")
        elif rule["entry_type"] == "SEGMENT_CHANGE" and definition.get("change_trigger"):
            parts.append({"LOYALTY_TIER": "a loyalty tier change", "PREFERENCE_UPDATE": "a preference update",
                          "ADDRESS_CHANGE": "an address change"}.get(str(definition["change_trigger"]).upper(), "an attribute change"))
        elif rule["entry_type"] == "SEGMENT_CHANGE":
            change = "leaving" if str(definition.get("change") or "").upper() == "LEFT" else "joining"
            if "reference_name" in rule:
                parts.append(f"customers {change} {rule['reference_name'] or 'an unknown segment'}")
            else:
                parts.append(f"a segment {str(definition.get('change') or 'change').lower()}")
        elif rule["entry_type"] == "DATE_TIME":
            parts.append(schedule.describe(definition, rule.get("reference_name")))
        else:
            parts.append("a date/time schedule")
    return (f"{', '.join(parts)} triggered, {journey.get_population_mode_display()} population, "
            f"re-entry {journey.get_reentry_policy_display().lower()}.")


def _step_configured(node: JourneyNode) -> bool:
    config = node.config or {}
    if node.node_type == "WAIT":
        return config.get("duration") not in (None, "")
    if node.node_type == "CONDITION":
        return bool(config.get("check")) or bool(isinstance(config.get("expr"), dict) and config["expr"].get("event"))
    if node.node_type in MESSAGE_TYPES:
        return bool(config.get("template_id"))
    if node.node_type == "COUPON_ISSUE":
        return bool(config.get("coupon_id"))
    if node.node_type == "LOYALTY_CHANGE":
        return bool(config.get("tier_id"))
    if node.node_type == "SEGMENT_UPDATE":
        return bool(config.get("segment_id")) and bool(config.get("action"))
    return True


def _message_templates(version: JourneyVersion) -> list[TemplateMaster]:
    ids = {node.config.get("template_id") for node in
           JourneyNode.objects.filter(journey_version=version, node_type__in=MESSAGE_TYPES, deleted_at__isnull=True)
           if isinstance(node.config, dict) and node.config.get("template_id")}
    return list(TemplateMaster.objects.filter(pk__in=ids))


def _governance(journey: Journey, version: JourneyVersion) -> dict:
    """What the send engine will apply to this journey's messages, in words: per channel the frequency caps (GLOBAL, or
    CHANNEL for that channel, as apps.delivery.engine.audience judges them: any cap reached holds the customer back) and the
    texts' quiet hours. It never blocks:
    every cap allows at least one message (ck_governance_policy_limits), and a customer at a cap is held back at send time,
    which the test's results count."""
    from apps.platform_ops import params
    channels = _channels_used(version)
    if not channels:
        return {"ok": True, "description": "This journey sends no messages, so no frequency cap or quiet hours apply."}
    policies = list(CommunicationGovernancePolicy.objects.filter(tenant_id=journey.tenant_id, is_active=True, deleted_at__isnull=True).order_by("priority"))
    sentences = []
    for channel in channels:
        word = "Emails" if channel == "EMAIL" else "Texts"
        caps = [p for p in policies if p.scope == "GLOBAL" or (p.scope == "CHANNEL" and (p.channel or channel) == channel)]
        if caps:
            limits = "; ".join(f"at most {p.max_messages} in {p.period_days} day{'s' if p.period_days != 1 else ''} ({p.name})" for p in caps[:3])
            more = f" and {len(caps) - 3} more" if len(caps) > 3 else ""
            sentences.append(f"{word}: {limits}{more}. A customer who has reached a cap is held back, not sent.")
        else:
            sentences.append(f"{word}: no frequency cap applies.")
    if "SMS" in channels:
        window = params.get("messaging.sms_quiet_hours", {}) or {}
        if isinstance(window, dict) and window.get("start") and window.get("end") and window["start"] != window["end"]:
            sentences.append(f"Texts wait out quiet hours, {window['start']} to {window['end']} in the workspace's time zone.")
    return {"ok": True, "description": " ".join(sentences)}


def _entry_ok(version: JourneyVersion) -> bool:
    rules = list(JourneyEntryRule.objects.filter(journey_version=version, deleted_at__isnull=True))
    return bool(rules) and all(schedule.problem(rule.rule_definition or {}) is None for rule in rules if rule.entry_type == "DATE_TIME")


def readiness(journey: Journey, version: JourneyVersion) -> dict:
    """The 4 checks the Test Publish page shows; `ready` gates the Run Test Publish button."""
    nodes = list(JourneyNode.objects.filter(journey_version=version, deleted_at__isnull=True).exclude(node_family="ENTRY"))
    configured = sum(1 for node in nodes if _step_configured(node))
    templates = _message_templates(version)
    templates_ok = bool(templates) and all(template.status == "ACTIVE" for template in templates)
    governance = _governance(journey, version)
    items = [
        {"key": "entry_rules", "label": "Entry rules configured", "description": _entry_summary(version),
         "ok": _entry_ok(version)},
        {"key": "steps_configured", "label": "All canvas steps configured",
         "description": f"{configured} of {len(nodes)} steps have complete settings.",
         "ok": len(nodes) > 0 and configured == len(nodes)},
        {"key": "templates_ready", "label": "Templates ready",
         "description": "Email and SMS templates are published in Template Studio.", "ok": templates_ok},
        {"key": "governance", "label": "Governance rules satisfied", "description": governance["description"], "ok": governance["ok"]},
    ]
    return {"ready": all(item["ok"] for item in items), "items": items}


# ---------------------------------------------------------------------------------------------------- test population

def _random_candidates(tenant_id, version: JourneyVersion, limit: int) -> list[str]:
    """Customers who currently qualify for this version's entry rules — the same candidate SQL enroll.py uses to
    enter a live journey, read here without enrolling anyone for real."""
    party_ids: set[str] = set()
    since = timezone.now() - timezone.timedelta(days=enroll_engine.LOOKBACK_DAYS)
    for rule in JourneyEntryRule.objects.filter(journey_version=version, deleted_at__isnull=True):
        args = {"tenant": str(tenant_id), "since": since}
        sql = enroll_engine._sources(rule, args)  # noqa: SLF001  same module family, not a public API boundary
        if sql is None:
            continue
        with session.connection().cursor() as cursor:
            cursor.execute(f"SELECT DISTINCT c.party_id FROM ({sql}) c "
                           f"JOIN customer_master cm ON cm.tenant_id = %(tenant)s AND cm.party_id = c.party_id LIMIT 2000", args)
            party_ids.update(row[0] for row in cursor.fetchall())
    ordered = list(party_ids)
    random.shuffle(ordered)
    return ordered[:limit]


def _list_candidates(tenant_id, contact_list_ids: list[str], limit: int) -> list[str]:
    return list(ContactListMember.objects.filter(tenant_id=tenant_id, contact_list_id__in=contact_list_ids)
                .values_list("party_id", flat=True).distinct()[:limit])


def pick_population(tenant_id, version: JourneyVersion, population: dict) -> list[str]:
    mode = str((population or {}).get("mode") or "RANDOM").upper()
    limit = max(1, min(int((population or {}).get("sample_size") or 50), MAX_TEST_POPULATION))
    if mode == "LIST":
        ids = [str(item) for item in (population or {}).get("contact_list_ids") or []]
        return _list_candidates(tenant_id, ids, MAX_TEST_POPULATION) if ids else []
    return _random_candidates(tenant_id, version, limit)


# ---------------------------------------------------------------------------------------------------- the test send

def _next_node(node: JourneyNode, branch: str | None) -> JourneyNode | None:
    edges = list(JourneyConnection.objects.select_related("to_node").filter(from_node=node, deleted_at__isnull=True))
    wanted = str(branch).upper() if branch else None
    chosen = next((edge for edge in edges if wanted and (edge.branch_key or "").upper() == wanted), None)
    chosen = chosen or next((edge for edge in edges if not edge.branch_key), None)
    if chosen is None and not wanted and len(edges) == 1:
        chosen = edges[0]
    return chosen.to_node if chosen else None


def _drive_one(enrollment_id) -> None:
    """One test enrollment, as far as it can go: a WAIT is treated as already elapsed, a message send is
    dispatched for real and waited on synchronously. Runs to Finish, a dead end, or MAX_HOPS (whichever first)."""
    for _hop in range(MAX_HOPS):
        run_id = None
        with session.tx():
            state = (JourneyCustomerState.objects.select_for_update(of=("self",))
                     .select_related("journey_enrollment", "current_node").filter(pk=enrollment_id).first())
            if state is None or state.current_node is None:
                return
            node, enrollment = state.current_node, state.journey_enrollment
            state.state_data = state.state_data or {}
            if node.node_type == "WAIT":                     # a test cannot wait real days: treat it as already elapsed
                outcome = Done(result={"skipped_for_test": True, "reason": "Waits are skipped during Test Publish."})
            else:
                outcome = steps_engine.run(node, state, enrollment)
            if isinstance(outcome, Hold):
                run_id = (state.state_data.get("pending") or {}).get("run")
                state.save(update_fields=["state_data"])
            elif isinstance(outcome, Finish):
                JourneyNodeExecution.objects.create(journey_enrollment=enrollment, journey_node=node, tenant_id=enrollment.tenant_id,
                                                    party_id=enrollment.party_id, execution_status="SUCCESS", result_data={"finished": outcome.status})
                JourneyEnrollment.objects.filter(pk=enrollment.pk).update(status=outcome.status, exited_at=timezone.now(), exit_reason=outcome.reason)
                state.next_scheduled_at = None
                state.save(update_fields=["next_scheduled_at"])
                return
            else:
                JourneyNodeExecution.objects.create(journey_enrollment=enrollment, journey_node=node, tenant_id=enrollment.tenant_id,
                                                    party_id=enrollment.party_id, execution_status=outcome.status, result_data=outcome.result or None,
                                                    generated_campaign_run_id=outcome.run_id)
                state.state_data.pop("pending", None)
                following = _next_node(node, outcome.branch)
                if following is None:
                    JourneyEnrollment.objects.filter(pk=enrollment.pk).update(status="EXITED", exited_at=timezone.now(),
                                                                              exit_reason=f"No step follows {node.node_key}.")
                    state.next_scheduled_at = None
                    state.save(update_fields=["next_scheduled_at", "state_data"])
                    return
                now = timezone.now()
                state.current_node, state.entered_node_at, state.next_scheduled_at = following, now, now
                state.save(update_fields=["current_node", "entered_node_at", "next_scheduled_at", "state_data"])
        if run_id:
            try:
                process_run(str(enrollment.tenant_id), run_id, max_rounds=RUN_ROUNDS)
            except Exception:                                  # noqa: BLE001  one customer's send trouble must not stop the test
                log.exception("test publish: run %s could not be processed", run_id)
                return
            continue                                           # re-check the same node: _verdict should resolve it now
    log.warning("test publish enrollment %s took %s steps; stopped early", enrollment_id, MAX_HOPS)


def run_test(journey: Journey, version: JourneyVersion, population: dict, user_id) -> dict:
    """Enrolls the chosen test population at the version's Entry step and drives every one of them, synchronously."""
    check = readiness(journey, version)
    if not check["ready"]:
        raise ValidationError({"readiness": "Every readiness check must pass before running a test."})
    tenant_id = journey.tenant_id
    with session.tenant_scope(tenant_id):
        start_node = JourneyNode.objects.filter(journey_version=version, node_family="ENTRY", deleted_at__isnull=True).order_by("created_at").first()
        if start_node is None:
            raise ValidationError({"graph": "This version has no Entry step."})
        party_ids = pick_population(tenant_id, version, population)
        if not party_ids:
            raise ValidationError({"population": "No customers match this test population."})
        started_at = timezone.now()
        enrollment_ids = []
        for party_id in party_ids:
            try:
                with session.tx():
                    enrollment = JourneyEnrollment.objects.create(journey=journey, journey_version=version, tenant_id=tenant_id, party_id=party_id, status="ACTIVE")
                    JourneyCustomerState.objects.create(journey_enrollment=enrollment, current_node=start_node, entered_node_at=started_at,
                                                        next_scheduled_at=started_at, state_data={"entry": "TEST_PUBLISH"})
                    enrollment_ids.append(enrollment.id)
            except IntegrityError:
                continue                                       # already actively enrolled for real (ux_journey_enrollment_no_reentry): skip, don't fail the test
        for enrollment_id in enrollment_ids:
            _drive_one(enrollment_id)
        with session.tx():                                     # a test never leaves anyone for the live engine to carry on
            JourneyEnrollment.objects.filter(pk__in=enrollment_ids, status="ACTIVE").update(status="EXITED", exited_at=timezone.now(),
                                                                                           exit_reason="Test Publish ended.")
        result = _tally(tenant_id, enrollment_ids, started_at, len(party_ids), _channels_used(version))
        _mark_tested(journey, version, result)
        return result


def _channels_used(version: JourneyVersion) -> list:
    """EMAIL and/or SMS, from the version's message steps; MMS goes out through SMS Master, so it counts as SMS."""
    types = set(JourneyNode.objects.filter(journey_version=version, node_type__in=MESSAGE_TYPES, deleted_at__isnull=True)
                .values_list("node_type", flat=True))
    return [channel for channel, members in (("EMAIL", {"EMAIL"}), ("SMS", {"SMS", "MMS"})) if types & members]


def _tally(tenant_id, enrollment_ids: list, started_at, population_size: int, channels: list) -> dict:
    if not enrollment_ids:
        return {"population_size": population_size, "sent_to": 0, "delivered": 0, "opened": 0, "clicked": 0, "bounced": 0, "governance_flags": [],
                "by_channel": {channel: {"sent": 0, "delivered": 0} for channel in channels}}
    executions = JourneyNodeExecution.objects.filter(tenant_id=tenant_id, journey_enrollment_id__in=enrollment_ids, executed_at__gte=started_at)
    run_ids = list(executions.exclude(generated_campaign_run_id=None).values_list("generated_campaign_run_id", flat=True).distinct())
    party_ids = list(JourneyEnrollment.objects.filter(pk__in=enrollment_ids).values_list("party_id", flat=True))
    mailer = MailerExecution.objects.filter(tenant_id=tenant_id, campaign_run_id__in=run_ids, party_id__in=party_ids) if run_ids else MailerExecution.objects.none()
    sms = SmsExecution.objects.filter(tenant_id=tenant_id, campaign_run_id__in=run_ids, party_id__in=party_ids) if run_ids else SmsExecution.objects.none()
    email_delivered = mailer.filter(status__in=("DELIVERED", "OPENED", "CLICKED")).count()
    sms_delivered = sms.filter(status__in=("DELIVERED", "RESPONDED")).count()
    delivered = email_delivered + sms_delivered
    opened = mailer.filter(status__in=("OPENED", "CLICKED")).count()
    clicked = mailer.filter(status="CLICKED").count()
    bounced = mailer.filter(status="BOUNCED").count() + sms.filter(status="FAILED").count()
    totals = {"EMAIL": {"sent": mailer.count(), "delivered": email_delivered}, "SMS": {"sent": sms.count(), "delivered": sms_delivered}}
    by_channel = {channel: totals[channel] for channel in channels}
    flags = sorted({row["reason"] for row in executions.filter(execution_status="SKIPPED").values_list("result_data", flat=True) if isinstance(row, dict) and row.get("reason")})
    flags = _held_back(tenant_id, run_ids, party_ids) + flags
    return {"population_size": population_size, "sent_to": len(enrollment_ids), "delivered": delivered, "opened": opened,
            "clicked": clicked, "bounced": bounced, "governance_flags": flags, "by_channel": by_channel}


HELD_WORDS = {"FREQUENCY_CAP": "held back by a frequency cap", "NO_CONSENT": "held back: no marketing consent", "UNSUBSCRIBED": "held back: unsubscribed",
              "SUPPRESSED": "held back: suppressed", "TOPIC_OPTED_OUT": "held back: opted out of this topic", "BLOCKED_ADDRESS": "held back: blocked address",
              "INVALID_ADDRESS": "held back: invalid address", "NO_EMAIL": "held back: no email address", "NO_PHONE": "held back: no mobile number",
              "DUPLICATE_ADDRESS": "held back: same address as another recipient", "UNKNOWN_PARTY": "held back: not in the customer records"}


def _held_back(tenant_id, run_ids: list, party_ids: list) -> list[str]:
    """Test recipients the send engine left out of the test's runs, counted by its reason ("2 held back by a frequency cap")."""
    if not run_ids or not party_ids:
        return []
    with session.connection().cursor() as cursor:
        cursor.execute("""SELECT m.suppression_reason, count(DISTINCT m.party_id) FROM campaign_list_member m
                            JOIN campaign_list l ON l.id = m.campaign_list_id
                           WHERE m.tenant_id = %s AND l.campaign_run_id::text = ANY(%s) AND m.party_id = ANY(%s) AND m.status = 'SUPPRESSED'
                           GROUP BY 1 ORDER BY 2 DESC""", [str(tenant_id), [str(r) for r in run_ids], list(party_ids)])
        rows = cursor.fetchall()
    return [f"{count} {HELD_WORDS.get(reason, 'held back: ' + str(reason or 'no reason').replace('_', ' ').lower())}" for reason, count in rows]


def _mark_tested(journey: Journey, version: JourneyVersion, result: dict) -> None:
    """A test that reached at least one customer moves a draft journey into TEST, same as a campaign's first
    successful test_publish moves it out of DRAFT (api/v1/campaigns_api.py)."""
    if result["sent_to"] == 0:
        return
    if version.status == JourneyVersion.Status.DRAFT:
        JourneyVersion.objects.filter(pk=version.pk).update(status=JourneyVersion.Status.TEST_PUBLISHED)
        version.status = JourneyVersion.Status.TEST_PUBLISHED
    if journey.status == Journey.Status.DRAFT:
        Journey.objects.filter(pk=journey.pk).update(status=Journey.Status.TEST)
        journey.status = Journey.Status.TEST


# ---------------------------------------------------------------------------------------------------- approve / activate

def _retire_others(journey: Journey, keep_version_id) -> None:
    """One live version at a time: the one going live retires the one it replaces. Customers on the old version carry on
    along its steps (the engine follows each enrollment's own version); only new entrants join the new one."""
    JourneyVersion.objects.filter(journey=journey, status=JourneyVersion.Status.ACTIVE).exclude(pk=keep_version_id).update(status=JourneyVersion.Status.RETIRED)


def approve(journey: Journey, version: JourneyVersion, when, user_id) -> Journey:
    """`when`: None (or already past) activates immediately; a future tz-aware datetime schedules it — the journey
    stays APPROVED until workers.journey.activate_scheduled (run_scheduler's activate-scheduled-journeys) flips it.

    A new version of a live (Active or Paused) journey keeps the journey's status: now, it replaces the live version at
    once (customers already inside finish the version they started); later, the live version carries on until the time
    comes. current_version then names the waiting version; the engine keeps using the newest ACTIVE one until then."""
    check = readiness(journey, version)
    if not check["ready"]:
        raise Conflict("This journey has not passed every readiness check.")
    if version.status not in (JourneyVersion.Status.DRAFT, JourneyVersion.Status.TEST_PUBLISHED):
        raise Conflict(f"Version {version.version_number} is {version.get_status_display().lower()} and cannot be approved again.")
    if not JourneyNodeExecution.objects.filter(tenant_id=journey.tenant_id, journey_enrollment__journey_version=version).exists():
        raise Conflict("Run a Test Publish before approving this journey.")
    now = timezone.now()
    with transaction.atomic():
        locked = Journey.objects.select_for_update().get(pk=journey.pk)
        if locked.deleted_at is not None or locked.status == Journey.Status.ARCHIVED:
            raise Conflict("An archived journey cannot be approved.")
        live = locked.status in (Journey.Status.ACTIVE, Journey.Status.PAUSED)
        if when is None or when <= now:
            _retire_others(locked, version.pk)
            JourneyVersion.objects.filter(pk=version.pk).update(status=JourneyVersion.Status.ACTIVE, published_at=now)
            locked.status = locked.status if live else Journey.Status.ACTIVE
            locked.current_version_id, locked.scheduled_activate_at = version.pk, None
        else:
            locked.status = locked.status if live else Journey.Status.APPROVED
            locked.current_version_id, locked.scheduled_activate_at = version.pk, when
        locked.save(update_fields=["status", "current_version", "scheduled_activate_at"])
    return locked


def activate_due() -> dict:
    """Journeys Approved · Scheduled whose time has come: goes live, same as Activate Now would have. Registered
    in apps.platform_ops.jobs.JOBS / workers.journey.activate_scheduled / run_scheduler._runnable()."""
    from . import engine
    activated, failed = 0, 0
    waiting = (Journey.Status.APPROVED, Journey.Status.ACTIVE, Journey.Status.PAUSED)   # Active / Paused: a new version waiting for its time
    for tenant_id in engine.tenants("SELECT DISTINCT tenant_id FROM journey WHERE status IN ('APPROVED', 'ACTIVE', 'PAUSED') "
                                    "AND scheduled_activate_at <= now() AND deleted_at IS NULL"):
        try:
            with session.tenant_scope(tenant_id), session.tx():
                due = list(Journey.objects.select_for_update().filter(tenant_id=tenant_id, status__in=waiting,
                                                                       scheduled_activate_at__lte=timezone.now(), deleted_at__isnull=True))
                now = timezone.now()
                for due_journey in due:
                    if due_journey.current_version_id is None:
                        continue
                    _retire_others(due_journey, due_journey.current_version_id)
                    JourneyVersion.objects.filter(pk=due_journey.current_version_id).update(status=JourneyVersion.Status.ACTIVE, published_at=now)
                    status = Journey.Status.ACTIVE if due_journey.status == Journey.Status.APPROVED else due_journey.status
                    Journey.objects.filter(pk=due_journey.pk).update(status=status, scheduled_activate_at=None)
                    activated += 1
        except Exception:                                      # noqa: BLE001  one tenant's trouble must not stop the others
            log.exception("activate-scheduled-journeys failed for tenant %s", tenant_id)
            failed += 1
    return {"activated": activated, "failed": failed}
