"""Samples for the designer's barcode and QR code blocks.

    POST /codes/sample/     {kind, format | ecc, width, height | size, value}
                            -> {valid: true, url} : a signed image address the canvas and the previews show
                            -> {valid: false, message} : why the value cannot be drawn in that format

Needs template.edit and the workspace's Barcodes and QR codes feature (tenant management).
"""
from drf_spectacular.utils import extend_schema
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from api.permissions import HasPermissionCode
from apps.platform_ops import params
from apps.templates import codes


class CodeSampleView(APIView):
    permission_classes = [IsAuthenticated, HasPermissionCode.for_("template.edit"), params.RequiresFeature.for_("dynamic_codes")]

    @extend_schema(request=None, responses={200: None})
    def post(self, request, version=None):
        body = request.data if isinstance(request.data, dict) else {}
        config, reason = codes.clean({**body, "source": "sample"})
        if config is None:
            return Response({"valid": False, "message": reason})
        value = str(body.get("value") or "").strip()
        problem = codes.value_problem(config, value)
        if problem:
            return Response({"valid": False, "message": f"The sample value cannot be drawn: {problem}."})
        return Response({"valid": True, "url": codes.url(config, value)})
