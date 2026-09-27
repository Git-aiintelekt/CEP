"""Global search from the top bar: campaigns, contact lists and templates by name (a campaign also by its code), a few of each,
only the kinds the person may see. GET /search/?q=  (two characters or more)."""
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from django.db.models import Q

from apps.campaigns import service
from apps.campaigns.models import Campaign
from apps.contact_lists.models import ContactList
from apps.templates.models import TemplateMaster

LIMIT = 6
MIN_LENGTH = 2


def _allowed(user, code: str) -> bool:
    if getattr(user, "is_platform_admin", False):
        return True
    if hasattr(user, "has_scope"):
        return user.has_scope(code.replace(".", ":"))
    codes = user.permission_codes()
    return code in codes or code.rsplit(".", 1)[0] + ".edit" in codes


class SearchView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(parameters=[OpenApiParameter("q", str)], responses={200: None})
    def get(self, request, version=None):
        q = request.query_params.get("q", "").strip()[:80]
        out = {"q": q, "campaigns": [], "lists": [], "templates": []}
        if len(q) < MIN_LENGTH:
            return Response(out)
        user = request.user
        if _allowed(user, "campaign.view"):
            rows = Campaign.objects.filter(deleted_at__isnull=True).filter(Q(name__icontains=q) | Q(code__icontains=q)).exclude(status="ARCHIVED").order_by("-updated_at")[:LIMIT]
            out["campaigns"] = [{"id": str(row.pk), "name": row.name, "code": row.code, "channel": row.channel, "status": service.display_status(row),
                                 "status_label": {"SCHEDULED": "Scheduled", **dict(Campaign.Status.choices)}.get(service.display_status(row), row.status),
                                 "setup_complete": service.setup_complete(row)} for row in rows]
        if _allowed(user, "list.view"):
            rows = ContactList.objects.filter(deleted_at__isnull=True, name__icontains=q).exclude(status="DRAFT").order_by("-updated_at")[:LIMIT]
            out["lists"] = [{"id": str(row.pk), "name": row.name, "member_count": row.member_count, "list_environment": row.list_environment, "status": row.status} for row in rows]
        if _allowed(user, "template.view"):
            rows = TemplateMaster.objects.filter(deleted_at__isnull=True, name__icontains=q).order_by("-updated_at")[:LIMIT]
            out["templates"] = [{"id": str(row.pk), "name": row.name, "channel": row.channel, "status": row.status} for row in rows]
        return Response(out)
