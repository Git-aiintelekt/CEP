"""Deliverability tests: the workspace's inbox-preview account, the plan's allowance, and the tests run on a template.

    GET/PUT/DELETE /deliverability/service/        provider.edit   the Mailgun Inspect account (key write-only)
    POST           /deliverability/service/check/  provider.edit   does the credential work
    GET            /deliverability/clients/         template.edit   the clients a test can render in (cached a day)
    GET            /deliverability/allowance/       template.edit   used / limit this month
    GET/POST       /templates/<id>/deliverability-tests/   template.edit + the feature
    GET/DELETE     /deliverability-tests/<id>/              template.edit
"""
from django.core.cache import cache
from drf_spectacular.utils import extend_schema
from rest_framework import serializers, status
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from api.permissions import HasPermissionCode
from apps.delivery import deliverability
from apps.delivery.inspect import PROVIDER_TYPE
from apps.delivery.models import DeliverabilityService, DeliverabilityTest
from apps.delivery.providers.base import ProviderError
from apps.platform_ops import crypto, params
from apps.templates.models import TemplateMaster
from apps.tenants import context

MANAGE = [IsAuthenticated, HasPermissionCode.for_("provider.edit")]
USE = [IsAuthenticated, HasPermissionCode.for_("template.edit")]
TEST = [*USE, params.RequiresFeature.for_(deliverability.FEATURE)]


def _tenant_id():
    return context.require().tenant_id


class ServiceSerializer(serializers.Serializer):
    region = serializers.ChoiceField(choices=["US", "EU"], default="US")
    username = serializers.CharField(max_length=200, allow_blank=True, required=False, default="")
    api_key = serializers.CharField(write_only=True, required=False, allow_blank=True, help_text="leave blank to keep the stored key")
    default_clients = serializers.ListField(child=serializers.CharField(max_length=80), required=False, default=list, max_length=200)
    image_blocking = serializers.BooleanField(required=False, default=False)
    is_active = serializers.BooleanField(required=False, default=True)


class ServiceView(APIView):
    permission_classes = MANAGE

    @extend_schema(responses={200: None})
    def get(self, request, version=None):
        return Response(deliverability.service_payload(deliverability.service_for(_tenant_id())))

    @extend_schema(request=ServiceSerializer, responses={200: None})
    def put(self, request, version=None):
        form = ServiceSerializer(data=request.data)
        form.is_valid(raise_exception=True)
        data = form.validated_data
        service = deliverability.service_for(_tenant_id()) or DeliverabilityService(tenant_id=_tenant_id(), provider=PROVIDER_TYPE, created_by_id=request.user.pk)
        if not service.api_key_enc and not data.get("api_key"):
            raise ValidationError({"api_key": ["Enter the Mailgun Inspect API key."]})
        service.region = data["region"]
        service.username = data.get("username") or None
        service.default_clients = data.get("default_clients") or []
        service.image_blocking = bool(data.get("image_blocking"))
        service.is_active = bool(data.get("is_active", True))
        service.updated_by_id = request.user.pk
        if data.get("api_key"):
            service.api_key_enc = crypto.encrypt(data["api_key"])
            service.last_checked_at, service.last_check_ok, service.last_check_error = None, None, None
        service.save()
        return Response(deliverability.service_payload(service))

    @extend_schema(responses={204: None})
    def delete(self, request, version=None):
        DeliverabilityService.objects.filter(tenant_id=_tenant_id()).delete()
        cache.delete(_clients_key(_tenant_id()))
        return Response(status=status.HTTP_204_NO_CONTENT)


class ServiceCheckView(APIView):
    permission_classes = MANAGE

    @extend_schema(responses={200: None})
    def post(self, request, version=None):
        service = deliverability.service_for(_tenant_id())
        if service is None or not service.api_key_enc:
            return Response({"ok": False, "detail": "Enter the Mailgun Inspect account first."})
        ok, detail = deliverability.check_service(service)
        if ok:
            cache.delete(_clients_key(_tenant_id()))
        return Response({"ok": ok, "detail": detail or None})


def _clients_key(tenant_id) -> str:
    return f"cep:inspect-clients:{tenant_id}"


class ClientsView(APIView):
    """The clients the account can render in: Inspect's list, kept a day; empty with a note when there is no account yet."""
    permission_classes = USE

    @extend_schema(responses={200: None})
    def get(self, request, version=None):
        tenant_id = _tenant_id()
        service = deliverability.service_for(tenant_id)
        if service is None or not service.api_key_enc:
            return Response({"clients": [], "detail": "No inbox-preview account is set up."})
        cached = cache.get(_clients_key(tenant_id))
        if cached is not None and not request.query_params.get("refresh"):
            return Response({"clients": cached, "detail": None})
        client = deliverability.client_for(service)
        try:
            rows = client.clients()
        except ProviderError as exc:
            return Response({"clients": [], "detail": str(exc)})
        finally:
            client.close()
        cache.set(_clients_key(tenant_id), rows, 24 * 3600)
        return Response({"clients": rows, "detail": None})


class AllowanceView(APIView):
    permission_classes = USE

    @extend_schema(responses={200: None})
    def get(self, request, version=None):
        return Response(deliverability.allowance(_tenant_id()))


class StartSerializer(serializers.Serializer):
    clients = serializers.ListField(child=serializers.CharField(max_length=80), required=False, allow_null=True, max_length=200)
    image_blocking = serializers.BooleanField(required=False, allow_null=True)


class TemplateTestsView(APIView):
    permission_classes = TEST

    def _template(self, pk):
        template = TemplateMaster.objects.filter(pk=pk, deleted_at__isnull=True).first()
        if template is None:
            raise NotFound("No such template.")
        return template

    @extend_schema(responses={200: None})
    def get(self, request, pk, version=None):
        template = self._template(pk)
        return Response({"tests": [deliverability.payload(test, full=False) for test in deliverability.tests_for(template)],
                         "allowance": deliverability.allowance(_tenant_id())})

    @extend_schema(request=StartSerializer, responses={201: None})
    def post(self, request, pk, version=None):
        template = self._template(pk)
        form = StartSerializer(data=request.data)
        form.is_valid(raise_exception=True)
        test = deliverability.start_preview(_tenant_id(), template, request.user.pk, clients=form.validated_data.get("clients"),
                                            image_blocking=form.validated_data.get("image_blocking"))
        return Response(deliverability.payload(test), status=status.HTTP_201_CREATED)


class TestView(APIView):
    permission_classes = USE

    def _test(self, pk) -> DeliverabilityTest:
        test = DeliverabilityTest.objects.select_related("requested_by").filter(pk=pk).first()
        if test is None:
            raise NotFound("No such test.")
        return test

    @extend_schema(responses={200: None})
    def get(self, request, pk, version=None):
        return Response(deliverability.payload(deliverability.refresh(self._test(pk))))

    @extend_schema(responses={204: None})
    def delete(self, request, pk, version=None):
        test = self._test(pk)
        test.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

