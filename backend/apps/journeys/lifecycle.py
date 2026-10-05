"""Journey Details' lifecycle actions (phase 6d): Pause / Resume / Duplicate.

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
from .models import Journey, JourneyVersion


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
