"""The back-office footer's legal line: {% load cep_legal %}{% cep_legal as legal %} -> {holder, year, terms_url}.

The holder comes from the legal.copyright_holder parameter (the same one the app's footer reads); the terms link opens the
app's Terms of Use page at FRONTEND_URL, so staff read the same text the workspaces see.
"""
from django import template
from django.conf import settings
from django.utils import timezone

from apps.platform_ops import params

register = template.Library()
DEFAULT_HOLDER = "Transaction Tree"


@register.simple_tag
def cep_legal() -> dict:
    return {"holder": str(params.get("legal.copyright_holder", DEFAULT_HOLDER)), "year": timezone.now().year,
            "terms_url": settings.FRONTEND_URL.rstrip("/") + "/terms"}
