"""The back-office's form layout (templates/admin/includes/fieldset.html): label above the field, each field as wide as what
it holds, the unit beside a number, "(Optional)" on the few optional fields instead of an asterisk on the rest.

    {% load cep_forms %}{% cep_field field adminform.model_admin as f %} -> {label, optional, width S | M | L, unit, help, hidden}

A ModelAdmin may set cep_field_widths = {"name": "L"} where the guess is wrong. A widget may carry attrs["data-unit"].
"""
import re

from django import forms, template

register = template.Library()

ACRONYMS = {"ai", "api", "cdn", "dns", "gb", "id", "ip", "kb", "mb", "mfa", "pos", "sms", "smtp", "sso", "ttl", "url", "utm", "uuid", "vat"}
SMALL_WORDS = {"a", "an", "and", "as", "at", "by", "for", "from", "in", "into", "of", "on", "or", "per", "the", "to", "via", "with"}
WIDE_WIDGETS = ("Textarea", "SelectMultiple", "CheckboxSelectMultiple", "ClearableFileInput", "FileInput", "JSON", "Wysiwyg", "ArrayWidget")
SHORT_WIDGETS = ("NumberInput", "DecimalField", "IntegerField", "DateInput", "TimeInput", "ColorInput")


@register.filter
def cep_title(text) -> str:
    """'Custom app domain' -> 'Custom App Domain'; words already holding a capital or a digit (API, X-Tenant, 2FA) are kept."""
    words = str(text or "").split(" ")
    out = []
    for i, word in enumerate(words):
        if word.lower() in ACRONYMS and word[1:].islower():          # "ai", and Django's capitalised first word "Id"
            out.append(word.upper())
        elif not word or not word.islower() or re.search(r"\d", word):
            out.append(word)
        elif i and word in SMALL_WORDS:
            out.append(word)
        else:
            out.append(word[0].upper() + word[1:])
    return " ".join(out)


def _widget(field):
    bound = field.field
    if isinstance(bound, dict):
        return None
    widget = bound.field.widget
    return getattr(widget, "widget", widget)          # a RelatedFieldWidgetWrapper around a select


def _width(field, model_admin) -> str:
    name = field.field["name"] if isinstance(field.field, dict) else field.field.name
    chosen = (getattr(model_admin, "cep_field_widths", None) or {}).get(name)
    if chosen:
        return str(chosen).upper()
    if isinstance(field.field, dict):                   # read-only: as wide as what it shows
        return "M" if len(str(field.contents())) <= 32 else "L"
    widget = _widget(field)
    kind = type(widget).__name__
    if field.is_checkbox:
        return "M"
    if any(name in kind for name in WIDE_WIDGETS):
        return "L"
    if any(name in kind for name in SHORT_WIDGETS) or isinstance(field.field.field, (forms.IntegerField, forms.DecimalField, forms.FloatField)):
        return "S"
    if "SplitDateTime" in kind or "Select" in kind or "Email" in kind:
        return "M"
    if "URL" in kind:
        return "L"
    max_length = getattr(field.field.field, "max_length", None)
    if max_length and max_length <= 24:
        return "S"
    if max_length and max_length <= 80:
        return "M"
    return "L"


@register.simple_tag
def cep_field(field, model_admin=None) -> dict:
    readonly = isinstance(field.field, dict)
    if readonly:
        label, help_text, hidden = field.field.get("label"), field.field.get("help_text"), False
        optional = False
    else:
        bound = field.field
        label, help_text, hidden = bound.label, bound.help_text, bound.is_hidden
        optional = not bound.field.required and not field.is_checkbox and not getattr(bound.field, "disabled", False)
    widget = None if readonly else _widget(field)
    unit = (getattr(widget, "attrs", None) or {}).get("data-unit", "")
    return {"label": cep_title(label), "optional": optional, "width": _width(field, model_admin), "unit": unit, "help": help_text or "",
            "hidden": hidden, "readonly": readonly}


CANCEL_KEY = "cep_cancel"          # in the session: {form path: the page that opened it}, so Save and Keep Editing keeps it
CANCEL_KEEP = 30


@register.simple_tag(takes_context=True)
def cep_cancel_url(context) -> str:
    """Where Cancel on an add or edit page goes: the page that opened the form (a filtered list, a tenant, the home page),
    remembered for this form across Save and Keep Editing; else the model's list with its filters; else the home page.
    Only an address on this site counts, and never the form itself."""
    from urllib.parse import urlsplit

    from django.contrib.admin.templatetags.admin_urls import add_preserved_filters
    from django.urls import NoReverseMatch, reverse
    from django.utils.http import url_has_allowed_host_and_scheme

    request = context.get("request")
    if request is None:
        return "/admin/"
    here = request.path
    remembered = dict(request.session.get(CANCEL_KEY) or {})
    referer = request.META.get("HTTP_REFERER") or ""
    if referer and url_has_allowed_host_and_scheme(referer, allowed_hosts={request.get_host()}, require_https=request.is_secure()):
        parts = urlsplit(referer)
        if parts.path != here and parts.path.startswith("/admin/") and not parts.path.startswith(("/admin/login", "/admin/logout", "/admin/mfa")):
            # from another form we know (an add page that saved and kept editing): where THAT form came from
            target = remembered.get(parts.path) or parts.path + (f"?{parts.query}" if parts.query else "")
            if remembered.get(here) != target:
                remembered.pop(here, None)
                remembered[here] = target
                request.session[CANCEL_KEY] = dict(list(remembered.items())[-CANCEL_KEEP:])
            return target
    if remembered.get(here):
        return remembered[here]
    opts = context.get("opts")
    try:
        return add_preserved_filters(context, reverse(f"admin:{opts.app_label}_{opts.model_name}_changelist"))
    except (AttributeError, NoReverseMatch):
        return "/admin/"
