"""The legal line every page carries and the Terms of Use page (apps.platform_ops.params: legal.copyright_holder, legal.terms_of_use).

    GET /legal/    {copyright_holder, year, terms: {title, body (Markdown), updated_at}}   no sign-in, no workspace needed
"""
from django.conf import settings
from django.db import connections
from django.utils import timezone
from drf_spectacular.utils import extend_schema
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.platform_ops import params

DEFAULT_HOLDER = "Transaction Tree"
TERMS_TITLE = "Terms of Use"


def legal() -> dict:
    with connections[settings.CONTROL_PLANE_ALIAS].cursor() as cursor:
        cursor.execute("SELECT updated_at FROM platform_setting WHERE key = 'legal.terms_of_use'")
        row = cursor.fetchone()
    return {"copyright_holder": str(params.get("legal.copyright_holder", DEFAULT_HOLDER)), "year": timezone.now().year,
            "terms": {"title": TERMS_TITLE, "body": str(params.get("legal.terms_of_use", "")), "updated_at": row[0] if row else None}}


class LegalView(APIView):
    authentication_classes: list = []
    permission_classes = [AllowAny]

    @extend_schema(responses={200: None})
    def get(self, request, version=None):
        return Response(legal())
