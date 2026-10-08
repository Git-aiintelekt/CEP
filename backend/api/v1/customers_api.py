"""The customer page and its search (apps.customers.profile).

    GET /customers/?q=&page=&page_size=   customers by name, email address, mobile number or id
    GET /customers/{party_id}/            one customer: the record, consent, lists, events, orders, messages, journeys

Anyone who may see lists, campaigns or journeys may see a customer; the page shows what each of those already shows, in one place.
"""
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.permissions import BasePermission, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from api.permissions import HasPermissionCode
from apps.customers import profile
from apps.tenants import context

CODES = ("list.view", "journey.view", "campaign.view")


class CanSeeCustomers(BasePermission):
    def has_permission(self, request, view):
        return any(HasPermissionCode.for_(code)().has_permission(request, view) for code in CODES)


class CustomerSearchView(APIView):
    permission_classes = [IsAuthenticated, CanSeeCustomers]

    @extend_schema(parameters=[OpenApiParameter("q", str), OpenApiParameter("page", int), OpenApiParameter("page_size", int)], responses={200: None})
    def get(self, request, version=None):
        params = request.query_params
        try:
            page, size = int(params.get("page", 1)), int(params.get("page_size", profile.PAGE_SIZE))
        except ValueError:
            raise ValidationError({"page": "A whole number."}) from None
        return Response(profile.search(context.require().tenant_id, q=params.get("q", ""), page=page, page_size=size))


class CustomerRecordView(APIView):
    permission_classes = [IsAuthenticated, CanSeeCustomers]

    @extend_schema(responses={200: None})
    def get(self, request, party_id=None, version=None):
        found = profile.record(context.require().tenant_id, str(party_id or "")[:60])
        if found is None:
            raise NotFound("This customer is not in the customer records.")
        return Response(found)
