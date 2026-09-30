"""Stores: the workspace's own list of its locations, kept in CEP because a TTDR transaction names a store by number only
(patch 0029). It fills the STORE tags of an e-receipt; the transaction itself is never stored."""
import uuid

from django.db import models
from django.db.models.functions import Now


class Store(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    tenant = models.ForeignKey('tenants.Tenant', on_delete=models.PROTECT, db_column='tenant_id', related_name='+')
    store_number = models.CharField(max_length=40)
    name = models.CharField(max_length=150)
    brand = models.CharField(max_length=150, null=True, blank=True)
    address1 = models.CharField(max_length=200, null=True, blank=True)
    address2 = models.CharField(max_length=200, null=True, blank=True)
    city = models.CharField(max_length=120, null=True, blank=True)
    state = models.CharField(max_length=60, null=True, blank=True)
    postal_code = models.CharField(max_length=20, null=True, blank=True)
    country = models.CharField(max_length=60, null=True, blank=True)
    district = models.CharField(max_length=120, null=True, blank=True)
    phone = models.CharField(max_length=40, null=True, blank=True)
    email = models.CharField(max_length=254, null=True, blank=True)
    manager = models.CharField(max_length=150, null=True, blank=True)
    return_policy = models.TextField(null=True, blank=True)
    url1 = models.CharField(max_length=300, null=True, blank=True)
    url2 = models.CharField(max_length=300, null=True, blank=True)
    url3 = models.CharField(max_length=300, null=True, blank=True)
    url4 = models.CharField(max_length=300, null=True, blank=True)
    image_url = models.CharField(max_length=300, null=True, blank=True)
    is_active = models.BooleanField(default=True)
    created_by = models.ForeignKey('identity.AppUser', on_delete=models.PROTECT, db_column='created_by', related_name='+', null=True, blank=True)
    updated_by = models.ForeignKey('identity.AppUser', on_delete=models.PROTECT, db_column='updated_by', related_name='+', null=True, blank=True)
    created_at = models.DateTimeField(db_default=Now())
    updated_at = models.DateTimeField(db_default=Now())
    row_version = models.IntegerField(default=1)

    class Meta:
        managed = False
        db_table = 'store'

    def __str__(self):
        return f"{self.store_number} {self.name}"

    def as_tags(self) -> dict:
        """What the STORE tags read."""
        return {"id": self.store_number, "number": self.store_number, "name": self.name, "brand": self.brand or "", "address": self.address1 or "", "address1": self.address1 or "",
                "address2": self.address2 or "", "city": self.city or "", "state": self.state or "", "postal_code": self.postal_code or "", "country": self.country or "",
                "district": self.district or "", "phone": self.phone or "", "email": self.email or "", "manager": self.manager or "", "return_policy": self.return_policy or "",
                "url1": self.url1 or "", "url2": self.url2 or "", "url3": self.url3 or "", "url4": self.url4 or "", "image_url": self.image_url or ""}
