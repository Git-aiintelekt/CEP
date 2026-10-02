"""GET /field-rules/: what each writable field accepts, read off the serializers (which take their lengths from the tables).

One document for the whole API, so a form can show "42 / 200" and stop at the limit before the request is made. The
server keeps validating: these rules are a copy of its own, never a replacement.
"""
from datetime import datetime, timezone
from functools import lru_cache

from django.core.validators import RegexValidator
from drf_spectacular.utils import extend_schema
from rest_framework import serializers
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from . import contact_lists_api, delivery_api, pos_api, preferences_api, settings_api, workspace_api
from . import serializers as s

RESOURCES = {
    "campaign": s.CampaignSerializer,
    "template": s.TemplateSerializer,
    "personalization_tag": s.PersonalizationTagSerializer,
    "journey": s.JourneySerializer,
    "contact_list": contact_lists_api.ContactListSerializer,
    "new_contact_list": contact_lists_api.NewListSerializer,
    "sender_profile": delivery_api.SenderProfileWriteSerializer,
    "delivery_provider": delivery_api.DeliveryProviderSerializer,
    "subscription_topic": preferences_api.SubscriptionTopicSerializer,
    "store": pos_api.StoreSerializer,
    "user": settings_api.UserSerializer,
    "role": settings_api.RoleSerializer,
    "api_client": settings_api.ApiClientSerializer,
    "mail_server": workspace_api.MailServerSerializer,
    "identity_provider": workspace_api.IdentityProviderSerializer,
}

TYPES = [
    (serializers.EmailField, "email"), (serializers.URLField, "url"), (serializers.UUIDField, "uuid"), (serializers.SlugField, "slug"),
    (serializers.RegexField, "string"), (serializers.CharField, "string"),
    (serializers.BooleanField, "boolean"), (serializers.IntegerField, "integer"), (serializers.DecimalField, "decimal"), (serializers.FloatField, "decimal"),
    (serializers.DateTimeField, "datetime"), (serializers.DateField, "date"), (serializers.TimeField, "time"),
    (serializers.MultipleChoiceField, "choices"), (serializers.ChoiceField, "choice"),
    (serializers.ManyRelatedField, "references"), (serializers.RelatedField, "reference"),
    (serializers.ListField, "list"), (serializers.DictField, "object"), (serializers.JSONField, "json"),
]


def _type_of(field):
    for cls, name in TYPES:
        if isinstance(field, cls):
            return name
    return "string"


def _pattern(field):
    for validator in getattr(field, "validators", []):
        if isinstance(validator, RegexValidator):
            return validator.regex.pattern
    return None


def _column(model, field):
    """The table column behind a model-backed field, when there is one."""
    if model is None:
        return None
    try:
        column = model._meta.get_field(field.source if field.source != "*" else field.field_name)
    except Exception:
        return None
    if not hasattr(column, "column"):
        return None
    kind = column.get_internal_type()
    return {"table": model._meta.db_table, "column": column.column, "type": kind, "max": getattr(column, "max_length", None) if kind != "TextField" else None}


def _rule(field, model):
    if isinstance(field, serializers.BaseSerializer):
        inner = field.child if isinstance(field, serializers.ListSerializer) else field
        nested_model = getattr(getattr(inner, "Meta", None), "model", None)
        return {"type": "list" if isinstance(field, serializers.ListSerializer) else "object", "required": field.required,
                "fields": {name: _rule(child, nested_model) for name, child in inner.fields.items() if not child.read_only}}
    kind = _type_of(field)
    rule = {"type": kind, "required": field.required, "label": str(field.label or field.field_name).strip()}
    if kind in {"string", "email", "url", "slug", "uuid"}:
        rule["max"] = getattr(field, "max_length", None)
        rule["min"] = getattr(field, "min_length", None)
        rule["blank"] = getattr(field, "allow_blank", False) or field.allow_null
        pattern = _pattern(field)
        if pattern:
            rule["pattern"] = pattern
    elif kind in {"integer", "decimal"}:
        rule["min_value"] = getattr(field, "min_value", None)
        rule["max_value"] = getattr(field, "max_value", None)
        if kind == "decimal":
            rule["decimal_places"] = getattr(field, "decimal_places", None)
            rule["max_digits"] = getattr(field, "max_digits", None)
    elif kind in {"choice", "choices"}:
        rule["choices"] = [{"value": value, "label": str(label)} for value, label in field.choices.items()]
    if field.allow_null:
        rule["nullable"] = True
    column = _column(model, field)
    if column:
        rule["column"] = column
        if rule.get("max") is None and column["max"] is not None:
            rule["max"] = column["max"]
    return rule


def rules_for(serializer_class) -> dict:
    serializer = serializer_class()
    model = getattr(getattr(serializer, "Meta", None), "model", None)
    key = model._meta.pk.name if model is not None else None                                   # the primary key is never typed in
    return {name: _rule(field, model) for name, field in serializer.fields.items() if not field.read_only and name != key}


@lru_cache(maxsize=1)
def all_rules() -> dict:
    return {"generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "resources": {name: rules_for(cls) for name, cls in RESOURCES.items()}}


class FieldRulesView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(responses={200: None})
    def get(self, request, version=None):
        response = Response(all_rules())
        response["Cache-Control"] = "private, max-age=3600"
        return response
