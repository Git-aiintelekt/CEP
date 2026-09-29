"""The preference page a person opens from the link in an email. Public: no sign-in, the signed token names the workspace and
the person; the page shows that person's choices and nothing else. GET shows them (and records a Preference View), POST saves."""
from django.http import HttpResponse
from django.template.loader import render_to_string
from django.utils import timezone
from django.utils.html import escape
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods

from apps.delivery.engine import session, unsubscribe
from apps.governance import preferences
from apps.tenants import context
from apps.tenants.models import Tenant

from .delivery_public import PAGE

PREVIEW_ADDRESS = "someone@example.com"


def masked(address: str) -> str:
    local, _, domain = (address or "").partition("@")
    if not domain or len(local) < 3:
        return address or "this address"
    return f"{local[0]}•••{local[-1]}@{domain}"


def initials(name: str) -> str:
    parts = [part for part in name.split() if part[:1].isalnum()]
    return "".join(part[0].upper() for part in parts[:2]) or name[:2].upper()


class Person:
    """What the page knows about the person the token names, read under the workspace's row-level security."""

    def __init__(self, tenant_id, party_id: str, email: str):
        self.party_id, self.email = party_id, email
        self.phone = None
        self.consent = {}                                  # channel -> (consent_status, opted_out_at)
        with session.connection().cursor() as cursor:
            cursor.execute("""SELECT (SELECT e ->> 'number' FROM jsonb_array_elements(cm.phones) e
                                       WHERE (e ->> 'number') ~ '^\\+[1-9][0-9]{7,14}$' AND upper(COALESCE(e ->> 'type', 'MOBILE')) NOT IN ('LANDLINE', 'FAX')
                                       ORDER BY COALESCE((e ->> 'is_primary')::boolean, FALSE) DESC LIMIT 1)
                                FROM customer_master cm WHERE cm.tenant_id = %s AND cm.party_id = %s""", [str(tenant_id), party_id])
            row = cursor.fetchone()
            self.phone = row[0] if row else None
            cursor.execute("SELECT channel, consent_status, opted_out_at FROM consent_suppression WHERE tenant_id = %s AND party_id = %s AND channel IN ('EMAIL', 'SMS')",
                           [str(tenant_id), party_id])
            self.consent = {channel: (status, since) for channel, status, since in cursor.fetchall()}

    def opted_out(self, channel: str) -> bool:
        return self.consent.get(channel, ("UNKNOWN", None))[0] == "OPTED_OUT"

    def off_since(self, channel: str) -> str:
        since = self.consent.get(channel, (None, None))[1]
        return timezone.localtime(since).strftime("%d %b %Y, %H:%M UTC") if since else ""


def _page(prefs: dict, tenant, person: Person | None, shown: list, token: str, *, address: str, preview=False, saved=None, problem=None, unsubscribed_all=False, out_ids=None) -> str:
    brand = prefs["brand_name"] or tenant.name
    out_ids = out_ids if out_ids is not None else (preferences.opted_out(tenant.pk, person.party_id) if person else set())
    email_locked = bool(person and person.opted_out("EMAIL") and not prefs["allow_opt_in"])
    sms_locked = bool(person and person.opted_out("SMS") and not prefs["allow_opt_in"])
    return render_to_string("public/preferences.html", {
        "brand": brand, "initials": initials(brand), "heading": prefs["heading"], "address": masked(address), "token": token, "preview": preview,
        "email_description": prefs["email_description"], "sms_description": prefs["sms_description"], "footer": prefs["footer"], "privacy_url": prefs["privacy_url"],
        "allow_opt_in": prefs["allow_opt_in"], "saved": saved, "problem": problem, "unsubscribed_all": unsubscribed_all,
        "email_on": preview or not (person and person.opted_out("EMAIL")), "email_locked": email_locked, "email_off_since": person.off_since("EMAIL") if person else "",
        "sms_shown": preview or bool(person and person.phone), "phone_last4": (person.phone or "0142")[-4:] if person else "0142",
        "sms_on": preview or not (person and person.opted_out("SMS")), "sms_locked": sms_locked, "sms_off_since": person.off_since("SMS") if person else "",
        "topics": [{"id": str(topic.pk), "name": topic.name, "description": topic.description or "", "on": str(topic.pk) not in out_ids} for topic in shown],
    })


@csrf_exempt
@require_http_methods(["GET", "POST"])
def preferences_view(request, version=None):
    token = request.GET.get("t", "")
    claims = unsubscribe.read(token)
    scope = context.current()
    if claims is None or scope is None:
        return HttpResponse(PAGE.format(title="This link is not valid", text="The link is incomplete. Use the link in a more recent email, or reply to the sender.", action=""), status=400)
    tenant = Tenant.objects.get(pk=scope.tenant_id)
    prefs = preferences.settings_of(tenant)
    if not prefs["enabled"]:
        link = escape(unsubscribe.url_for(token))
        return HttpResponse(PAGE.format(title="No preference page", text=f"{escape(tenant.name)} does not offer a preference page. You can unsubscribe from its marketing email instead.",
                                        action=f'<p><a href="{link}" style="font-weight:600;color:#3863DB">Unsubscribe</a></p>'))
    shown = preferences.topics(tenant.pk, shown_only=True)
    if claims.get("test"):
        return HttpResponse(_page(prefs, tenant, None, shown, token, address=claims.get("e") or PREVIEW_ADDRESS, preview=True, out_ids=set()))

    party, email = claims["p"], claims.get("e", "")
    person = Person(tenant.pk, party, email)
    evidence = {"ip": request.META.get("REMOTE_ADDR"), "user_agent": request.headers.get("User-Agent", "")[:300], "page": "preference_center"}
    if request.method == "GET":
        with session.connection().cursor() as cursor:
            cursor.execute("""INSERT INTO tracking_event (tenant_id, party_id, event_type, channel, campaign_id, campaign_run_id, ip_address, user_agent)
                              VALUES (%s, %s, 'PREFERENCE_VIEW', 'EMAIL', %s, %s, %s, %s)""",
                           [str(tenant.pk), party, claims.get("c"), claims.get("r"), evidence["ip"], evidence["user_agent"]])
        both_off = person.opted_out("EMAIL") and (not person.phone or person.opted_out("SMS"))
        return HttpResponse(_page(prefs, tenant, person, shown, token, address=email, unsubscribed_all=both_off))

    action = request.POST.get("action", "save")
    execution_id = _execution(tenant.pk, claims)
    common = {"tenant_id": tenant.pk, "party_id": party, "execution_id": execution_id}
    if action == "reopen":                                 # the person who unsubscribed from everything wants to choose again
        return HttpResponse(_page(prefs, tenant, person, shown, token, address=email))
    if action == "unsubscribe_all":
        for channel in ("EMAIL", "SMS") if person.phone else ("EMAIL",):
            if not person.opted_out(channel):
                unsubscribe.opt_out(**common, email=email, campaign_id=claims.get("c"), run_id=claims.get("r"), method="PREFERENCE_CENTER", evidence=evidence, channel=channel)
        return HttpResponse(_page(prefs, tenant, Person(tenant.pk, party, email), shown, token, address=email, unsubscribed_all=True))

    wanted = {"EMAIL": "email" in request.POST, "SMS": "sms" in request.POST}
    refused = None
    for channel in ("EMAIL", "SMS"):
        if channel == "SMS" and not person.phone:
            continue
        if person.opted_out(channel) and wanted[channel]:
            if prefs["allow_opt_in"]:
                unsubscribe.opt_in(**common, channel=channel, source="PREFERENCE_CENTER", evidence=evidence)
            else:
                refused = channel
        elif not person.opted_out(channel) and not wanted[channel]:
            unsubscribe.opt_out(**common, email=email, campaign_id=claims.get("c"), run_id=claims.get("r"), method="PREFERENCE_CENTER", evidence=evidence, channel=channel)
    chosen = set(request.POST.getlist("topic"))
    out_ids = {str(topic.pk) for topic in shown} - chosen
    preferences.set_topics(tenant.pk, party, shown, out_ids, evidence)

    person = Person(tenant.pk, party, email)
    on_topics = [topic.name for topic in shown if str(topic.pk) not in out_ids]
    channels = [name for channel, name in (("EMAIL", "email"), ("SMS", "text messages")) if (channel == "EMAIL" or person.phone) and not person.opted_out(channel)]
    if refused:                                            # the page keeps the locked switch and says why, whatever else was saved
        problem = f"{'Email stays' if refused == 'EMAIL' else 'Text messages stay'} switched off: to receive them again, contact {prefs['brand_name'] or tenant.name}."
        return HttpResponse(_page(prefs, tenant, person, shown, token, address=email, problem=problem, out_ids=out_ids))
    if not channels:
        return HttpResponse(_page(prefs, tenant, person, shown, token, address=email, unsubscribed_all=True))
    what = f" about {', '.join(on_topics[:-1])} and {on_topics[-1]}" if len(on_topics) > 1 else f" about {on_topics[0]}" if on_topics else (" about nothing on the list" if shown else "")
    saved = f"Saved. You will receive {' and '.join(channels)}{what}. Changes take effect on the next send."
    return HttpResponse(_page(prefs, tenant, person, shown, token, address=email, saved=saved, out_ids=out_ids))


def _execution(tenant_id, claims) -> int | None:
    """The message whose link was used: evidence for a consent record."""
    if not claims.get("r"):
        return None
    with session.connection().cursor() as cursor:
        cursor.execute("SELECT id FROM mailer_execution WHERE tenant_id = %s AND campaign_run_id = %s AND party_id = %s ORDER BY created_at DESC LIMIT 1",
                       [str(tenant_id), claims["r"], claims["p"]])
        row = cursor.fetchone()
    return row[0] if row else None
