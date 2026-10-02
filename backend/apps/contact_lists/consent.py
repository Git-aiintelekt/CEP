"""The compliance process for adding contacts.

Three parts, all around one idea: CEP sends only to people who agreed to hear from the workspace, and the workspace can show
where that agreement came from.

    the declaration   every upload says where its people agreed (the consent basis), where the proof is (a form, a store),
                      and the uploader confirms it in their own name (the attestation). Required before the import is applied.
    the policy        tenant.settings["consent_policy"]: what an upload does with a new person who has no consent date
                      (hold back until they confirm, or refuse the row), whether a text list needs a text consent date for
                      every number, whether a fresh upload needs approval before any campaign sends to its list, the consent
                      lifetime (stored for the reminder job that is still to come) and the attestation sentence.
    the record        what the list's compliance page shows: the source, the declaration, who approved, the policy at the
                      time, today's consent breakdown. Rebuilt from consent records on every read.

A bought or rented list has no basis here: the choice is refused. A text list refuses implied consent (marketing texts need
an express opt-in: TCPA, CASL).
"""
from django.db import connections
from django.utils import timezone

from apps.identity.models import AppUser
from apps.tenants.models import Tenant

from .models import ContactList, ContactListImport

KEY = "consent_policy"
HOLD_BACK, REFUSE = "HOLD_BACK", "REFUSE"
NOT_REQUIRED, AWAITING, APPROVED, REFUSED = "NOT_REQUIRED", "AWAITING", "APPROVED", "REFUSED"
BASES = (
    ("WEB_FORM", "Signed up on our website or app"),
    ("IN_STORE", "Enrolled in store or in the loyalty programme"),
    ("CUSTOMER_REQUEST", "Asked us directly"),
    ("IMPLIED", "Existing customers under implied consent"),
)
BASIS_LABEL = dict(BASES)
DEFAULTS = {
    "without_consent": HOLD_BACK,
    "texts_need_date": False,
    "approval_before_send": False,
    "lifetime_months": 24,
    "attestation": "I confirm these people agreed to receive marketing from {workspace}",
}
LIFETIMES = (6, 12, 24, 36)


class ConsentError(ValueError):
    def __init__(self, field: str, message: str):
        super().__init__(message)
        self.field = field


# ------------------------------------------------------------------------------------------------------------ the policy
def policy_of(tenant) -> dict:
    stored = (tenant.settings or {}).get(KEY) or {}
    return {**DEFAULTS, **{key: stored[key] for key in DEFAULTS if key in stored}}


def attestation_text(tenant) -> str:
    return policy_of(tenant)["attestation"].replace("{workspace}", tenant.name)


def save_policy(tenant, data: dict) -> dict:
    current = policy_of(tenant)
    if "without_consent" in data:
        if data["without_consent"] not in (HOLD_BACK, REFUSE):
            raise ConsentError("without_consent", "Hold back or refuse.")
        current["without_consent"] = data["without_consent"]
    for key in ("texts_need_date", "approval_before_send"):
        if key in data:
            if not isinstance(data[key], bool):
                raise ConsentError(key, "On or off.")
            current[key] = data[key]
    if "lifetime_months" in data:
        if data["lifetime_months"] not in LIFETIMES:
            raise ConsentError("lifetime_months", "Choose one of the offered lifetimes.")
        current["lifetime_months"] = data["lifetime_months"]
    if "attestation" in data:
        value = " ".join(str(data["attestation"] or "").split())
        if not value:
            raise ConsentError("attestation", "Write the sentence the uploader confirms.")
        if len(value) > 300:
            raise ConsentError("attestation", "Use 300 characters or fewer.")
        current["attestation"] = value
    tenant.settings = {**(tenant.settings or {}), KEY: current}
    tenant.save(update_fields=["settings"])
    return current


# ------------------------------------------------------------------------------------------------------------ the declaration
def declare(record: ContactListImport, *, basis: str, attested: bool, collected_at: str = "", user_id=None) -> ContactListImport:
    if record.status in ("APPLYING", "APPLIED"):
        raise ConsentError("basis", "This file is already imported.")
    if basis not in BASIS_LABEL:
        raise ConsentError("basis", "Choose where these people agreed.")
    if basis == "IMPLIED" and record.contact_list.channel != "EMAIL":
        raise ConsentError("basis", "A texts list needs express consent: marketing texts need a written opt-in with a date. Map a Text consent date column, or choose a basis where people opted in.")
    if not attested:
        raise ConsentError("attested", "Confirm that these people agreed to receive marketing.")
    record.consent_basis = basis
    record.consent_collected_at = " ".join(str(collected_at or "").split())[:300] or None
    record.attested_by = user_id
    record.attested_at = timezone.now()
    record.save(update_fields=["consent_basis", "consent_collected_at", "attested_by", "attested_at"])
    return record


def declaration_of(record: ContactListImport) -> dict:
    """What the upload payload says about consent: the declaration so far, whether one is needed, and the sentence to confirm."""
    tenant = record.tenant
    policy = policy_of(tenant)
    return {
        "required": record.contact_list.source_type == "UPLOAD",
        "basis": record.consent_basis, "basis_label": BASIS_LABEL.get(record.consent_basis or ""),
        "collected_at": record.consent_collected_at,
        "attested_by_name": user_name(record.attested_by), "attested_at": record.attested_at,
        "attestation": attestation_text(tenant),
        "bases": [{"key": key, "label": label, "allowed": not (key == "IMPLIED" and record.contact_list.channel != "EMAIL")} for key, label in BASES],
        "policy": {"without_consent": policy["without_consent"], "texts_need_date": policy["texts_need_date"], "approval_before_send": policy["approval_before_send"]},
    }


# ------------------------------------------------------------------------------------------------------------ the approval
def decide(contact_list: ContactList, *, approved: bool, user_id=None, note: str = "") -> None:
    if contact_list.approval_status == NOT_REQUIRED:
        raise ConsentError("approval", "This list does not need approval.")
    ContactList.objects.filter(pk=contact_list.pk).update(approval_status=APPROVED if approved else REFUSED, approved_by=user_id, approved_at=timezone.now(),
                                                         approval_note=" ".join(note.split())[:300] or None)


# ------------------------------------------------------------------------------------------------------------ the record
def user_name(user_id) -> str | None:
    if not user_id:
        return None
    user = AppUser.objects.filter(pk=user_id).values("display_name", "email").first()
    return (user["display_name"] or user["email"]) if user else None


def record_of(contact_list: ContactList) -> dict:
    tenant = Tenant.objects.get(pk=contact_list.tenant_id)
    policy = policy_of(tenant)
    uploads = list(ContactListImport.objects.filter(contact_list=contact_list, status="APPLIED").order_by("completed_at"))
    channels = ["EMAIL", "SMS"] if contact_list.channel == "BOTH" else ["SMS" if contact_list.channel == "SMS" else "EMAIL"]
    with connections["default"].cursor() as cursor:
        cursor.execute("""SELECT cs.channel,
                                 count(*) FILTER (WHERE cs.consent_status = 'OPTED_IN' AND r.source = 'IMPORT'),
                                 count(*) FILTER (WHERE cs.consent_status = 'OPTED_IN' AND r.source IS DISTINCT FROM 'IMPORT'),
                                 count(*) FILTER (WHERE cs.consent_status = 'OPTED_OUT'),
                                 count(*) FILTER (WHERE COALESCE(cs.consent_status, 'UNKNOWN') = 'UNKNOWN')
                            FROM contact_list_member m
                            CROSS JOIN unnest(%(channels)s::text[]) AS ch(code)
                            LEFT JOIN consent_suppression cs ON cs.tenant_id = m.tenant_id AND cs.party_id = m.party_id AND cs.channel = ch.code
                            LEFT JOIN consent_record r ON r.tenant_id = cs.tenant_id AND r.id = cs.last_consent_record_id
                           WHERE m.tenant_id = %(tenant)s AND m.contact_list_id = %(list)s
                           GROUP BY cs.channel""", {"tenant": str(contact_list.tenant_id), "list": str(contact_list.pk), "channels": channels})
        found = {row[0]: row[1:] for row in cursor.fetchall()}
    unknown_only = found.get(None)
    consent = []
    for code in channels:
        imported, confirmed, out, unknown = found.get(code, (0, 0, 0, 0))
        if unknown_only and len(channels) == 1:
            unknown += unknown_only[3]
        consent.append({"channel": code, "opted_in_from_file": imported, "confirmed_since": confirmed, "no_consent": unknown, "unsubscribed": out})
    return {
        "list": {"id": str(contact_list.pk), "name": contact_list.name, "channel": contact_list.channel, "member_count": contact_list.member_count,
                 "source_type": contact_list.source_type, "source_reference": contact_list.source_reference, "created_at": contact_list.created_at},
        "inherited": contact_list.source_type != "UPLOAD",
        "uploads": [{"id": str(u.pk), "file_name": u.file_name, "completed_at": u.completed_at, "rows": u.row_count, "applied": u.applied_count, "consents_recorded": u.consent_count,
                     "basis": u.consent_basis, "basis_label": BASIS_LABEL.get(u.consent_basis or ""), "collected_at": u.consent_collected_at,
                     "attested_by_name": user_name(u.attested_by), "attested_at": u.attested_at,
                     "held_back": {key: value for key, value in ((u.summary or {}).get("held_back") or {}).items() if key in ("NO_CONSENT_DATE", "NO_TEXT_CONSENT_DATE") and value}}
                    for u in uploads],
        "approval": {"status": contact_list.approval_status, "by_name": user_name(contact_list.approved_by), "at": contact_list.approved_at, "note": contact_list.approval_note},
        "policy": {"without_consent": policy["without_consent"], "texts_need_date": policy["texts_need_date"], "approval_before_send": policy["approval_before_send"],
                   "lifetime_months": policy["lifetime_months"], "attestation": attestation_text(tenant)},
        "consent": consent,
        "generated_at": timezone.now(),
    }
