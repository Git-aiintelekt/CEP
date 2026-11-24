"""A user's name (or email) for display, by id, for every "created by", "owner", "approved by" a page shows.

A platform administrator who entered the workspace with Switch Workspace (apps/platform_ops/visits.py) acts as themselves: their
id is on what they create, but their app_user row belongs to the Platform workspace, so the workspace's row-level security hides
it. Following the foreign key (record.created_by) then raises DoesNotExist, a server error. Read the id instead
(record.created_by_id) through label()/email(): a miss on the workspace's connection is looked up on the platform connection.
"""
from django.conf import settings
from django.db import connections

from .models import AppUser


def _row(user_id) -> dict | None:
    if not user_id:
        return None
    row = AppUser.objects.filter(pk=user_id).values("display_name", "email").first()
    if row is None:                                       # a visiting platform administrator: hidden from the workspace
        with connections[settings.PLATFORM_ALIAS].cursor() as cursor:
            cursor.execute("SELECT display_name, email FROM app_user WHERE id = %s", [str(user_id)])
            found = cursor.fetchone()
        row = {"display_name": found[0], "email": found[1]} if found else None
    return row


def label(user_id) -> str | None:
    row = _row(user_id)
    return (row["display_name"] or row["email"]) if row else None


def email(user_id) -> str | None:
    row = _row(user_id)
    return row["email"] if row else None


def label_of(instance, field: str) -> str | None:
    """The name for instance.<field> (a ForeignKey to AppUser), from a select_related() copy when it was loaded, else by id."""
    cached = instance._state.fields_cache.get(field) if hasattr(instance, "_state") else None
    if cached is not None:
        return cached.display_name or cached.email
    return label(getattr(instance, f"{field}_id", None))
