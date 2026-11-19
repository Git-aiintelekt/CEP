"""What every page of the app polls, signed in or not, in any workspace: the upgrade notice (apps.platform_ops.upgrade).

    GET /platform-status/    {upgrade: {state: NONE | SCHEDULED | UPGRADING | DONE, starts_at, minutes, note, changed_at, version}}
"""
from drf_spectacular.utils import extend_schema
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.platform_ops import upgrade


class PlatformStatusView(APIView):
    authentication_classes: list = []
    permission_classes = [AllowAny]
    throttle_classes: list = []          # every open tab asks every 30 seconds

    @extend_schema(responses={200: None})
    def get(self, request, version=None):
        response = Response({"upgrade": upgrade.public()})
        response["Cache-Control"] = "no-store"
        return response
