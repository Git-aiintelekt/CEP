"""Templates -> Receipt Layouts: the named receipt layouts E-Receipt templates pick (apps/templates/receipt_layouts.py)."""
from django.http import Http404
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import serializers, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from api.permissions import HasPermissionCode, SameTenant
from apps.templates import receipt_layouts
from apps.templates.models import ReceiptLayout
from apps.tenants import context
from apps.tenants.middleware import set_current_user

PRESETS = ["COMPACT", "STANDARD", "ITEMIZED", "REGISTER", "CUSTOM_HTML"]


class ReceiptLayoutContentSerializer(serializers.Serializer):
    sections = serializers.ListField(child=serializers.DictField(), default=list, help_text="the typed section list the editor owns")
    custom_html = serializers.CharField(trim_whitespace=False, allow_null=True, allow_blank=True, required=False, default=None)
    custom_css = serializers.CharField(trim_whitespace=False, allow_null=True, allow_blank=True, required=False, default=None)
    item_row = serializers.CharField(trim_whitespace=False, allow_null=True, allow_blank=True, required=False, default=None,
                                     help_text="Custom HTML: the row repeated once per line at {{receipt_items}}, with {{item.*}} tags")
    register = serializers.DictField(allow_null=True, required=False, default=None, help_text="the Store Register settings")


class ReceiptLayoutCreateSerializer(ReceiptLayoutContentSerializer):
    name = serializers.CharField(max_length=200)
    layout_preset = serializers.ChoiceField(choices=PRESETS, required=False)
    copy_from = serializers.UUIDField(required=False, allow_null=True, default=None, help_text="start from this layout's content")
    from_template = serializers.UUIDField(required=False, allow_null=True, default=None, help_text="start from this E-Receipt template's own layout")


class ReceiptLayoutSaveSerializer(ReceiptLayoutContentSerializer):
    name = serializers.CharField(max_length=200)
    layout_preset = serializers.ChoiceField(choices=PRESETS)
    base_version = serializers.IntegerField(min_value=1, help_text="the version the editor loaded; a newer one answers 409")


class ReceiptLayoutRenameSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=200)


class ReceiptLayoutViewSet(viewsets.ViewSet):
    """GET list / one, POST create, PUT save (409 on a stale base_version), and rename, duplicate, archive."""
    permission_classes = [IsAuthenticated, SameTenant, HasPermissionCode.for_("template.edit")]

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        user = request.user
        if getattr(user, "is_authenticated", False) and not hasattr(user, "has_scope"):
            set_current_user(user.id)

    def _user_id(self):
        return None if hasattr(self.request.user, "has_scope") else self.request.user.id

    def _layout(self, pk) -> ReceiptLayout:
        layout = ReceiptLayout.objects.select_related("updated_by").filter(pk=pk, tenant_id=context.require().tenant_id).first()
        if layout is None:
            raise Http404
        return layout

    @extend_schema(parameters=[OpenApiParameter("archived", bool, description="true lists the archived layouts instead")])
    def list(self, request, version=None):
        archived = request.query_params.get("archived") in ("1", "true", "yes")
        return Response(receipt_layouts.listing(context.require().tenant_id, archived=archived))

    def retrieve(self, request, pk=None, version=None):
        return Response(receipt_layouts.payload(self._layout(pk)))

    @extend_schema(request=ReceiptLayoutCreateSerializer)
    def create(self, request, version=None):
        body = ReceiptLayoutCreateSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        data = body.validated_data
        content = {key: data.get(key) for key in receipt_layouts.CONTENT_KEYS}
        made = receipt_layouts.create(context.require().tenant_id, self._user_id(), name=data["name"], layout_preset=data.get("layout_preset"),
                                      content=content, copy_from=data.get("copy_from"), from_template=data.get("from_template"))
        return Response(made, status=201)

    @extend_schema(request=ReceiptLayoutSaveSerializer)
    def update(self, request, pk=None, version=None):
        layout = self._layout(pk)
        body = ReceiptLayoutSaveSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        data = body.validated_data
        content = {key: data.get(key) for key in receipt_layouts.CONTENT_KEYS}
        return Response(receipt_layouts.save(layout, self._user_id(), name=data["name"], layout_preset=data["layout_preset"],
                                             content=content, base_version=data["base_version"]))

    @extend_schema(request=ReceiptLayoutRenameSerializer)
    @action(detail=True, methods=["post"])
    def rename(self, request, pk=None, version=None):
        body = ReceiptLayoutRenameSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        return Response(receipt_layouts.rename(self._layout(pk), self._user_id(), body.validated_data["name"]))

    @extend_schema(request=None)
    @action(detail=True, methods=["post"])
    def duplicate(self, request, pk=None, version=None):
        layout = self._layout(pk)
        tenant_id = context.require().tenant_id
        made = receipt_layouts.create(tenant_id, self._user_id(), name=receipt_layouts.copy_name(tenant_id, layout.name), copy_from=layout.pk)
        return Response(made, status=201)

    @extend_schema(request=None)
    @action(detail=True, methods=["post"])
    def archive(self, request, pk=None, version=None):
        return Response(receipt_layouts.archive(self._layout(pk), self._user_id()))
