"""Journey Details' lifecycle actions: Pause / Resume / Duplicate / Archive / Cancel Schedule.

Pause and Resume only flip `journey.status` — a paused journey's customers stay exactly where they are
(`journey_customer_state.next_scheduled_at` keeps ticking, but `advance.py`'s DUE query only picks up
`journey.status = 'ACTIVE'` rows, so nothing moves until Resume). Duplicate mirrors `graph.py`'s
`create_first`/`new_version` pattern: a new Journey, status DRAFT, with the source's *current* (or newest)
version's graph copied in as its own version 1 — never the source's enrollments, executions or history.
"""
from django.db import IntegrityError, transaction
from django.utils import timezone

from api.exceptions import Conflict

from . import graph
from .models import Journey, JourneyEnrollment, JourneyVersion


def pause(journey: Journey, user_id) -> Journey:
    with transaction.atomic():
        locked = Journey.objects.select_for_update().get(pk=journey.pk)
        if locked.status != Journey.Status.ACTIVE:
            raise Conflict(f"A {locked.get_status_display().lower()} journey cannot be paused.")
        locked.status, locked.updated_by_id = Journey.Status.PAUSED, user_id
        locked.save(update_fields=["status", "updated_by"])
    return locked


def resume(journey: Journey, user_id) -> Journey:
    with transaction.atomic():
        locked = Journey.objects.select_for_update().get(pk=journey.pk)
        if locked.status != Journey.Status.PAUSED:
            raise Conflict("Only a paused journey can be resumed.")
        locked.status, locked.updated_by_id = Journey.Status.ACTIVE, user_id
        locked.save(update_fields=["status", "updated_by"])
    return locked


LIVE = (Journey.Status.ACTIVE, Journey.Status.PAUSED, Journey.Status.APPROVED)


def archive(journey: Journey, user_id) -> dict:
    """Ends the journey for good: nobody new enters, everyone still in it leaves (EXITED, "Journey archived"), its live and
    tested versions are retired and any scheduled go-live is dropped. Drafts stay readable; Duplicate starts it again."""
    with transaction.atomic():
        locked = Journey.objects.select_for_update().get(pk=journey.pk)
        if locked.status == Journey.Status.ARCHIVED:
            raise Conflict("This journey is already archived.")
        now = timezone.now()
        ended = JourneyEnrollment.objects.filter(journey=locked, status="ACTIVE").update(status="EXITED", exited_at=now, exit_reason="Journey archived")
        JourneyVersion.objects.filter(journey=locked, status__in=(JourneyVersion.Status.ACTIVE, JourneyVersion.Status.TEST_PUBLISHED)).update(
            status=JourneyVersion.Status.RETIRED)
        locked.status, locked.scheduled_activate_at, locked.updated_by_id = Journey.Status.ARCHIVED, None, user_id
        locked.save(update_fields=["status", "scheduled_activate_at", "updated_by"])
    return {"journey": locked, "ended": ended}


def cancel_schedule(journey: Journey, user_id) -> Journey:
    """An approved journey waiting for its go-live time goes back to Test: approve it again (now or at another time) from Test Publish.
    A live journey with a new version waiting keeps its live version; the waiting one stays tested, to approve again."""
    with transaction.atomic():
        locked = Journey.objects.select_for_update().get(pk=journey.pk)
        if locked.status not in LIVE or locked.scheduled_activate_at is None:
            raise Conflict("Only a journey scheduled to go live can have its schedule cancelled.")
        if locked.status == Journey.Status.APPROVED:
            locked.status = Journey.Status.TEST
        else:
            running = JourneyVersion.objects.filter(journey=locked, status=JourneyVersion.Status.ACTIVE).order_by("-version_number").first()
            locked.current_version_id = running.pk if running else locked.current_version_id
        locked.scheduled_activate_at, locked.updated_by_id = None, user_id
        locked.save(update_fields=["status", "current_version", "scheduled_activate_at", "updated_by"])
    return locked


def _copy_name(tenant_id, name: str) -> str:
    base = f"{name} (Copy)"
    taken = set(Journey.objects.filter(tenant_id=tenant_id, name__istartswith=base, deleted_at__isnull=True).values_list("name", flat=True))
    if base not in taken:
        return base
    number = 2
    while f"{base} {number}" in taken:
        number += 1
    return f"{base} {number}"


def _next_code(tenant_id) -> str:
    """Same JRN-{year}-{00001} scheme as the serializer's create() (api/v1/journeys_api.py) — duplicated rather
    than imported, since that module imports this app and a back-import would cycle."""
    prefix = f"JRN-{timezone.now():%Y}-"
    taken = set(Journey.objects.filter(tenant_id=tenant_id, code__startswith=prefix).values_list("code", flat=True))
    number = len(taken) + 1
    while f"{prefix}{number:05d}" in taken:
        number += 1
    return f"{prefix}{number:05d}"


def duplicate(journey: Journey, user_id) -> Journey:
    """A new DRAFT journey: the same setup (entry rule aside — the graph carries it), population and re-entry,
    and the source's current (or newest) version's graph as its own version 1. Never its enrollments or history."""
    source_version = (JourneyVersion.objects.filter(journey=journey, pk=journey.current_version_id).first()
                      or JourneyVersion.objects.filter(journey=journey).order_by("-version_number").first())
    source_graph = graph._strip_ids(graph.read(source_version)) if source_version else None  # noqa: SLF001  same module family
    with transaction.atomic():
        for attempt in range(5):
            try:
                with transaction.atomic():                     # savepoint: a code collision must not poison the outer transaction
                    copy = Journey.objects.create(
                        tenant_id=journey.tenant_id, name=_copy_name(journey.tenant_id, journey.name), code=_next_code(journey.tenant_id),
                        description=journey.description, population_mode=journey.population_mode,
                        reentry_policy=journey.reentry_policy, reentry_after_days=journey.reentry_after_days,
                        owner_user_id=journey.owner_user_id, goal_description=journey.goal_description,
                        exit_criteria_description=journey.exit_criteria_description, created_by_id=user_id,
                    )
                break
            except IntegrityError:
                if attempt == 4:
                    raise
        graph.create_first(copy, user_id, source_graph)
    return copy
