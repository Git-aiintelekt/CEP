"""Adding base packs to workspaces without a person at the screen (manage.py load_base_packs).

Insights -> All Reports -> Base Reports adds a pack to one workspace, with somebody choosing the connection and
the databases on it. That does not scale to every workspace on a server, so the same work is done here: the pack
is added through `base_reports.add`, the same function the button calls, so a pack added this way and a pack added
by hand are the same thing.

What a pack needs is a connection and the databases on it holding the pack's tables. Two ways to say which:

    mapped       Settings -> Report Databases, or the mapping endpoint, records the connection a pack reads, kept
                 on the workspace as `base_pack_databases`. A mapping is the answer whenever there is one.
    worked out   otherwise the workspace's connections are looked at: the ones the pack's engine fits are asked
                 which of their databases hold its tables, and the answer is used only when exactly one connection
                 holds them in exactly one database. Two connections is a guess. So is one connection with the
                 tables in several databases - on a shared server those are different clients, and reading them
                 together would put another client's figures in this workspace's reports. Either way it asks.

Nothing is added twice: a workspace that already has the pack is left alone. Nothing is added halfway either -
`add` is one transaction, all or nothing - and a workspace that cannot be done is reported rather than skipped
silently, which is the difference between a load that can be trusted and one that cannot.
"""
import logging

from django.conf import settings
from django.db import connections, transaction
from rest_framework.test import APIRequestFactory

from apps.insights import base_reports, catalog, databases
from apps.insights.base_packs import PACKS, fitting, needs
from apps.insights.base_packs.common import OptionError
from apps.tenants import context

log = logging.getLogger(__name__)

# Where a workspace remembers which connection each pack reads: {pack key: {connection_id, options}}.
KEY = "base_pack_databases"

READY = "ready"
ALREADY = "already added"
NO_DATABASE = "no database holds its tables"
AMBIGUOUS = "more than one database could hold its tables"
NOT_FITTING = "the workspace does not have the components it needs"
NOT_FITTING_DATA = "the workspace's own datasets lack what it reads"
UNREACHABLE = "its database could not be read"


# --------------------------------------------------------------------------
# The mapping a workspace keeps
# --------------------------------------------------------------------------

def mapped(tenant) -> dict:
    """{pack key: {connection_id, options}} as the workspace has it"""
    found = (tenant.settings or {}).get(KEY) or {}
    return {str(k): v for k, v in found.items() if isinstance(v, dict) and v.get("connection_id")}


def map_to(tenant, pack_key: str, connection_id, options: dict | None = None) -> dict:
    """Remember the connection a pack reads. The options are checked now so a bad mapping is refused here rather
    than hours later in a load."""
    pack = PACKS[pack_key]
    row = databases.connection(tenant.pk, connection_id)
    databases._usable(row)
    if not base_reports._fits(pack, row):
        raise OptionError(f"{pack['name']} reads {pack['needs']['label']}.")
    options = pack["checked"](options or {})
    kept = {**(tenant.settings or {}), KEY: {**mapped(tenant), pack_key: {"connection_id": str(row["id"]), "options": options}}}
    _save_settings(tenant, kept)
    return kept[KEY][pack_key]


def unmap(tenant, pack_key: str) -> None:
    found = mapped(tenant)
    found.pop(pack_key, None)
    _save_settings(tenant, {**(tenant.settings or {}), KEY: found})


def _save_settings(tenant, kept: dict) -> None:
    tenant.settings = kept
    tenant.save(using=settings.PLATFORM_ALIAS, update_fields=["settings"])


# --------------------------------------------------------------------------
# What a pack would read in this workspace
# --------------------------------------------------------------------------

def _connections(tenant, pack: dict) -> list[dict]:
    """the workspace's connections whose engine this pack can read"""
    return [row for row in databases.connections(tenant.pk) if base_reports._fits(pack, row)]


def resolve(tenant, pack: dict) -> dict:
    """{status, connection, options, why} - the connection and options a pack would be added with"""
    if not pack.get("needs"):                                           # on the platform's own datasets (Engagement Reports): nothing to connect
        checked = base_reports.check(tenant, pack, None, {})
        if checked["ok"]:
            return {"status": READY, "connection": None, "options": {}, "why": "reads the workspace's own records"}
        return {"status": NOT_FITTING_DATA, "connection": None, "options": None, "why": " ".join(checked["problems"])[:200]}
    saved = mapped(tenant).get(pack["key"])
    if saved:
        try:
            row = databases.connection(tenant.pk, saved["connection_id"])
            return {"status": READY, "connection": row, "options": pack["checked"](saved.get("options") or {}), "why": "mapped"}
        except Exception as exc:                                        # a mapping to a connection since removed
            return {"status": NO_DATABASE, "connection": None, "options": None, "why": f"its mapping no longer works: {exc}"}

    found = []
    for row in _connections(tenant, pack):
        try:
            names = [d["name"] for d in base_reports.sources(tenant, pack, row)["databases"]]
        except Exception as exc:
            log.info("base packs: %s could not be read for %s: %s", row.get("name"), pack["key"], exc)
            return {"status": UNREACHABLE, "connection": None, "options": None, "why": str(exc)[:160]}
        if names:
            found.append((row, names))
    if not found:
        return {"status": NO_DATABASE, "connection": None, "options": None, "why": ""}
    if len(found) > 1:
        return {"status": AMBIGUOUS, "connection": None, "options": None,
                "why": "on " + ", ".join(sorted(r["name"] for r, _ in found)) + " - map it to one"}
    row, names = found[0]
    if len(names) > 1:
        # One server, several databases holding the same tables: on a shared server those are different clients,
        # and taking them all would read another client's data into this workspace's reports. Never worked out.
        return {"status": AMBIGUOUS, "connection": None, "options": None,
                "why": f"{row['name']} holds them in {', '.join(names)} - map it to the right one"}
    return {"status": READY, "connection": row, "options": pack["checked"]({"databases": names}),
            "why": f"worked out from {row['name']}: {names[0]}"}


def plan(tenant, pack_keys: list[str] | None = None) -> list[dict]:
    """what a load would do to this workspace, pack by pack, without doing any of it"""
    # A pack's reports go into a folder of their own named after it, which _folder_name settles: the pack's name,
    # or that name and a number where a workspace already has one. Said here so a plan shows where things land.
    have = {a["pack_key"]: a.get("folder_name") for a in base_reports._added(tenant.pk)}
    components = {p["key"] for p in fitting(catalog.components_of(tenant.pk))}
    out = []
    # With nothing named and nothing chosen, every pack that reads a database. A pack with nothing to connect (Engagement Reports)
    # changes where Engagement's Reports leads once added, so it is loaded only when it is named or was chosen for the workspace.
    for key in pack_keys or base_reports.chosen(tenant) or [k for k, p in PACKS.items() if p.get("needs")]:
        pack = PACKS.get(key)
        if pack is None:
            out.append({"pack": key, "status": "no such pack", "why": "", "name": key})
            continue
        if key in have:
            out.append({"pack": key, "name": pack["name"], "status": ALREADY, "why": "", "folder": have[key]})
        elif key not in components:
            out.append({"pack": key, "name": pack["name"], "status": NOT_FITTING, "why": ", ".join(needs(pack))})
        else:
            found = resolve(tenant, pack)
            out.append({"pack": key, "name": pack["name"], "status": found["status"], "why": found["why"],
                        "connection": (found["connection"] or {}).get("name"),
                        "databases": (found["options"] or {}).get("databases"),
                        "folder": base_reports._folder_name(pack) if found["status"] == READY else None})
    return out


# --------------------------------------------------------------------------
# Adding them
# --------------------------------------------------------------------------

FACTORY = APIRequestFactory()


def _request(user, tenant):
    """a request as the app's own endpoints expect one: this person, in this workspace"""
    request = FACTORY.post("/", {}, format="json")
    request.user = user
    request.auth = None
    request.tenant = {"id": str(tenant.pk), "code": tenant.code}
    return request


def _alias(tenant) -> str:
    from apps.tenants.models import TenantDatabase
    row = TenantDatabase.objects.using(settings.CONTROL_PLANE_ALIAS).filter(tenant_id=tenant.pk).first()
    return row.db_alias if row else settings.CONTROL_PLANE_ALIAS


def load(tenant, user, pack_keys: list[str] | None = None, apply: bool = False) -> list[dict]:
    """Add the packs this workspace is missing. Without `apply` nothing is written: the same answer, as a plan.

    A dry run has nobody to add them as, so `user` is None then; only the adding needs one.
    """
    alias = _alias(tenant)
    token = context.set_current(str(tenant.pk), alias, str(user.pk) if user else None)
    try:
        with connections[alias].cursor() as cursor:
            cursor.execute("SELECT set_config('app.current_tenant', %s, false)", [str(tenant.pk)])
        steps = plan(tenant, pack_keys)
        if not apply:
            return steps
        done = []
        for step in steps:
            if step["status"] != READY:
                done.append(step)
                continue
            pack = PACKS[step["pack"]]
            found = resolve(tenant, pack)
            try:
                with transaction.atomic(using=alias):
                    made = base_reports.add(_request(user, tenant), tenant, pack, found["connection"], found["options"])
                done.append({**step, "status": "added", "made": {k: len(v) for k, v in made.items() if isinstance(v, list)}})
            except Exception as exc:
                log.error("base packs: %s could not be added to %s: %s", pack["key"], tenant.code, exc)
                done.append({**step, "status": "refused", "why": str(exc)[:200]})
        return done
    finally:
        context.reset(token)


def workspaces(codes: list[str] | None = None):
    """the workspaces a load would touch: those named, or every active one"""
    from apps.tenants.models import Tenant
    found = Tenant.objects.using(settings.PLATFORM_ALIAS).filter(status="ACTIVE").order_by("code")
    return list(found.filter(code__in=codes) if codes else found)
