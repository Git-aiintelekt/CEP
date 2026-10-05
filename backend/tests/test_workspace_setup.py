"""Set Up Your Workspace: the seven steps read from the workspace, ready and next, the Home-card dismissal. Rolled back.

Converted from the verification script of the same name; every change is rolled back (tests/conftest.py)."""
import pytest
import json
from django.db import connections, transaction
from django.test import Client
from rest_framework_simplejwt.tokens import AccessToken
from apps.contact_lists.models import ContactList
from apps.delivery.models import DeliveryProvider, SenderProfile
from apps.identity.models import AppUser, UserRole
from apps.tenants import context, setup
from apps.tenants.models import Tenant

pytestmark = [pytest.mark.django_db(databases=["default", "platform"]), pytest.mark.slow]


def test_workspace_setup(check, admin_email):
    """Set Up Your Workspace: the seven steps read from the workspace, ready and next, the Home-card dismissal. Rolled back."""
    ptok = context.set_platform(True)
    tenant = Tenant.objects.using("platform").get(code="NWA")
    user = AppUser.objects.using("platform").get(email=admin_email)
    context.reset_platform(ptok)
    context.set_current(str(tenant.id), "default", str(user.pk))
    T = str(tenant.id)
    API = Client(HTTP_AUTHORIZATION=f"Bearer {AccessToken.for_user(user)}", HTTP_X_TENANT=tenant.code)
    try:
        with transaction.atomic(using="default"), transaction.atomic(using="platform"):
            with connections["default"].cursor() as cursor:
                cursor.execute("SELECT set_config('app.current_tenant', %s, false)", [T])
                cursor.execute("SELECT set_config('app.current_user_id', %s, false)", [str(user.pk)])

            r = API.get("/api/v1/workspace/setup/")
            body = r.json() if r.status_code == 200 else {}
            check("the overview answers 200 with the workspace, the viewer and seven steps", r.status_code == 200 and body.get("total") == 7 and len(body.get("steps", [])) == 7
                  and body["workspace"]["code"] == "NWA" and bool(body["viewer"]["first_name"]), f"{r.status_code} {str(r.content)[:200]}")
            keys = [s["key"] for s in body["steps"]]
            check("the steps in order, the optional ones marked", keys == ["signin", "team", "email_engine", "email_sender", "text", "lists", "tell"]
                  and [s["optional"] for s in body["steps"]] == [False, False, False, False, True, False, True], str(keys))
            check("the sign-in step is done for the person reading", body["steps"][0]["state"] == "done" and body["steps"][0]["tag"] == "Done" and body["steps"][0]["text"].startswith("Done"), body["steps"][0]["text"])
            check("every step has a label, a sentence and links with pages", all(s["label"] and s["text"] and all(l["to"].startswith("/") for l in s["links"]) for s in body["steps"]))
            done = sum(1 for s in body["steps"] if s["state"] == "done")
            required = [s for s in body["steps"] if not s["optional"]]
            check("done counts the done steps; ready means every required step is done; next is the first required step left",
                  body["done"] == done and body["ready"] == all(s["state"] == "done" for s in required)
                  and body["next"] == next((s["key"] for s in required if s["state"] != "done"), None), f"done={body['done']} ready={body['ready']} next={body['next']}")
            check("the steps that are not done say why and the next one carries a primary link",
                  all(s["why"] for s in required if s["state"] != "done") and (body["next"] is None or any(l["primary"] for l in next(s for s in body["steps"] if s["key"] == body["next"])["links"])))

            # ---- the team step counts other active users with a role, never the viewer
            others = AppUser.objects.filter(tenant_id=T, is_active=True, deleted_at__isnull=True).exclude(pk=user.pk)
            with_role = others.filter(pk__in=UserRole.objects.filter(role__tenant_id=T, role__deleted_at__isnull=True).values("user_id")).count()
            team = next(s for s in body["steps"] if s["key"] == "team")
            check("the team step follows the other users with a role", (team["state"] == "done") == (with_role > 0), f"{with_role} others with a role · {team['text']}")

            # ---- the sending steps follow the engines and senders
            engines = DeliveryProvider.objects.filter(tenant_id=T, deleted_at__isnull=True, is_active=True, channel="EMAIL")
            checked = engines.filter(last_check_ok=True)
            verified = SenderProfile.objects.filter(tenant_id=T, deleted_at__isnull=True, channel="EMAIL", verification_status="VERIFIED", delivery_provider__in=engines).exists()
            engine_step = next(s for s in body["steps"] if s["key"] == "email_engine")
            sender_step = next(s for s in body["steps"] if s["key"] == "email_sender")
            check("the email engine step: done with a checked engine, warn with an unchecked one, todo with none",
                  engine_step["state"] == ("done" if checked.exists() else "warn" if engines.exists() else "todo"), f"{engine_step['state']} · {engine_step['text']}")
            check("the email sender step is done only with a verified sender on an active engine", (sender_step["state"] == "done") == verified, f"{sender_step['state']} · {sender_step['text']}")

            # ---- the lists step: a production list with people
            lists = ContactList.objects.filter(tenant_id=T, deleted_at__isnull=True, list_environment="PRODUCTION", status="ACTIVE", is_master=True).exclude(approval_status="REFUSED")
            list_step = next(s for s in body["steps"] if s["key"] == "lists")
            check("the lists step follows the production lists with people", (list_step["state"] == "done") == lists.filter(member_count__gt=0).exists(), list_step["text"])
            # take the people away: the step is to do again, ready falls, the next step points here
            lists.update(member_count=0)
            again = setup.overview(Tenant.objects.get(pk=T), user)
            check("without a list with people the step is to do, the workspace is not ready and next points at it",
                  next(s for s in again["steps"] if s["key"] == "lists")["state"] == "todo" and again["ready"] is False and again["next"] in ("team", "email_engine", "email_sender", "lists"),
                  f"ready={again['ready']} next={again['next']}")

            # ---- the Home card dismissal
            r = API.put("/api/v1/workspace/setup/", {"dismissed": True}, content_type="application/json")
            stored = Tenant.objects.get(pk=T).settings.get("setup") or {}
            check("PUT dismissed hides the Home card and keeps when", r.status_code == 200 and r.json()["dismissed"] is True and stored.get("dismissed_at"), f"{r.status_code} {json.dumps(stored)}")
            r = API.put("/api/v1/workspace/setup/", {"dismissed": False}, content_type="application/json")
            check("PUT dismissed false shows it again", r.status_code == 200 and r.json()["dismissed"] is False and not (Tenant.objects.get(pk=T).settings.get("setup") or {}).get("dismissed_at"))

            # ---- not for everyone
            plain = AppUser.objects.filter(tenant_id=T, is_active=True, deleted_at__isnull=True).exclude(pk=user.pk).exclude(
                pk__in=UserRole.objects.filter(role__tenant_id=T, role__role_permissions__permission__code="user.admin").values("user_id")).first()
            if plain:
                other = Client(HTTP_AUTHORIZATION=f"Bearer {AccessToken.for_user(plain)}", HTTP_X_TENANT=tenant.code)
                r = other.get("/api/v1/workspace/setup/")
                check("a user without user.admin is refused (403)", r.status_code == 403, f"{plain.email} {r.status_code}")
            else:
                print("SKIP a user without user.admin is refused: NWA has no such user")
            raise RuntimeError("rollback")
    except RuntimeError as exc:
        if str(exc) != "rollback":
            raise
    check.done()
