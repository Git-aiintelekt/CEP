"""Public endpoints of the send engine: no sign-in, the URL itself carries the proof.

    POST /api/v1/webhooks/delivery/<tenant>/<provider id>/<token>/    delivery providers report what happened to a message
    GET | POST /api/v1/public/unsubscribe/?t=<signed token>            the link in every marketing email

The tenant middleware resolves the workspace from the path / the token (apps/tenants/resolver.py), so both run in a
normal tenant transaction under row-level security.
"""
import hmac
import json
import logging

from django.http import HttpResponse, JsonResponse
from django.utils.html import escape
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods

from apps.delivery.engine import events, inbound, session, unsubscribe
from apps.delivery.models import DeliveryProvider
from apps.delivery.providers import ProviderError, registry
from apps.tenants import context

from .delivery_api import webhook_token

log = logging.getLogger("cep.delivery")


@csrf_exempt
@require_http_methods(["POST"])
def delivery_webhook(request, tenant_code, provider_id, token, version=None):
    tenant_id = context.require().tenant_id
    if not hmac.compare_digest(token, webhook_token(provider_id)):
        return JsonResponse({"title": "Not found", "status": 404}, status=404)
    provider = DeliveryProvider.objects.filter(pk=provider_id, tenant_id=tenant_id, deleted_at__isnull=True).first()
    if provider is None:
        return JsonResponse({"title": "Not found", "status": 404}, status=404)
    try:
        adapter = registry.adapter_class(provider.provider_type)(config=provider.config or {}, secret=None, provider_id=str(provider.pk), tenant_id=tenant_id)
    except ProviderError:
        return JsonResponse({"title": "Not found", "status": 404}, status=404)
    body = request.body
    if not adapter.verify_webhook({k.lower(): v for k, v in request.headers.items()}, body):
        log.warning("webhook signature refused for provider %s", provider_id)
        return JsonResponse({"title": "Signature verification failed", "status": 401}, status=401)
    try:
        payload = json.loads(body or b"null")
    except ValueError:
        return JsonResponse({"title": "The body is not JSON", "status": 400}, status=400)

    texts = adapter.channel == "SMS"
    outcome = {"received": 0, "applied": 0, "ignored": 0, "unmatched": 0, "failed": 0}
    if texts:                                               # what people texted back: STOP / START / HELP and free replies
        outcome["inbound"] = 0
        for message in adapter.parse_inbound(payload):
            try:
                with session.tx():
                    inbound.handle(tenant_id, provider.provider_type, message)
                outcome["inbound"] += 1
            except Exception:                               # noqa: BLE001
                log.exception("inbound text from %s could not be handled", message.from_number)
                outcome["failed"] += 1
    for event in adapter.parse_webhook(payload):
        outcome["received"] += 1
        with session.connection().cursor() as cursor:
            cursor.execute("""INSERT INTO delivery_webhook_event (tenant_id, provider, execution_type, execution_ref, event_type, raw_payload)
                              VALUES (%s, %s, %s, %s, %s, %s::jsonb) RETURNING id, received_at""",
                           [tenant_id, provider.provider_type, "SMS" if texts else "MAILER", (event.idempotency_key or event.provider_message_id or "unknown")[:200], event.event_type.value,
                            json.dumps(event.raw, default=str)])
            event_id, received_at = cursor.fetchone()
        try:
            with session.tx():                              # a savepoint: one bad event must not undo the others
                result = events.apply_sms(tenant_id, event) if texts else events.apply(tenant_id, event)
            status = "PROCESSED"
        except Exception:                                   # noqa: BLE001
            log.exception("webhook event %s could not be applied", event_id)
            result, status = "failed", "FAILED"
        outcome[result] += 1
        with session.connection().cursor() as cursor:
            cursor.execute("UPDATE delivery_webhook_event SET processed_at = now(), processing_status = %s WHERE tenant_id = %s AND id = %s AND received_at = %s",
                           [status, tenant_id, event_id, received_at])
    return JsonResponse(outcome)                            # always 200 once authenticated: providers retry on anything else


PAGE = """<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>{title}</title>
<style>body{{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#f1f5f9;color:#0f172a}}
main{{max-width:440px;margin:12vh auto;padding:32px;background:#fff;border:1px solid #e2e8f0;border-radius:16px;text-align:center}}
h1{{font-size:20px;margin:0 0 8px}}p{{font-size:15px;line-height:22px;color:#475569;margin:0 0 20px}}
button{{font:inherit;font-weight:600;color:#fff;background:#2753e4;border:0;border-radius:8px;padding:12px 24px;cursor:pointer}}</style></head>
<body><main><h1>{title}</h1><p>{text}</p>{action}</main></body></html>"""


@csrf_exempt
@require_http_methods(["GET", "POST"])
def unsubscribe_view(request, version=None):
    token = request.GET.get("t", "")
    claims = unsubscribe.read(token)
    if claims is None:
        return HttpResponse(PAGE.format(title="This link is not valid", text="The unsubscribe link is incomplete. Use the link in a more recent email, or reply to the sender.", action=""), status=400)
    address = escape(claims.get("e", "this address"))
    if request.method == "GET":
        action = f'<form method="post" action="?t={escape(token)}"><button type="submit">Unsubscribe</button></form>'
        return HttpResponse(PAGE.format(title="Unsubscribe from marketing email", text=f"Stop sending marketing email to <strong>{address}</strong>?", action=action))
    tenant_id = context.require().tenant_id
    with session.connection().cursor() as cursor:          # the message whose link was used: evidence for the opt-out, required by tracking_event
        cursor.execute("SELECT id FROM mailer_execution WHERE tenant_id = %s AND campaign_run_id = %s AND party_id = %s ORDER BY created_at DESC LIMIT 1",
                       [tenant_id, claims.get("r"), claims["p"]])
        found = cursor.fetchone()
    execution_id = found[0] if found else None
    unsubscribe.opt_out(tenant_id=tenant_id, party_id=claims["p"], email=claims.get("e", ""), campaign_id=claims.get("c"), run_id=claims.get("r"), execution_id=execution_id,
                        evidence={"ip": request.META.get("REMOTE_ADDR"), "user_agent": request.headers.get("User-Agent", "")[:300],
                                  "one_click": request.POST.get("List-Unsubscribe") == "One-Click"})
    if execution_id is not None:
        with session.connection().cursor() as cursor:
            cursor.execute("""INSERT INTO tracking_event (tenant_id, party_id, event_type, channel, campaign_id, campaign_run_id, mailer_execution_id, ip_address, user_agent)
                              VALUES (%s, %s, 'UNSUBSCRIBE_CLICK', 'EMAIL', %s, %s, %s, %s, %s)""",
                           [tenant_id, claims["p"], claims.get("c"), claims.get("r"), execution_id, request.META.get("REMOTE_ADDR"), request.headers.get("User-Agent", "")[:300]])
    return HttpResponse(PAGE.format(title="You are unsubscribed", text=f"<strong>{address}</strong> will no longer receive marketing email from this sender. "
                                          "Receipts and service messages about your account may still be sent.", action=""))
