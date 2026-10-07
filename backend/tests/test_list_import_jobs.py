"""List uploads through the background job, the way the worker really runs them: the workspace is set inside each short
transaction only, never on the connection. A step that reads a row outside those transactions cannot see it (row-level
security), which is how every upload failed at REVIEW after the list channels change. Rolled back."""
import traceback
from contextlib import contextmanager
from unittest import mock

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import connections, transaction
from django.utils import timezone

from apps.contact_lists import imports, jobs
from apps.contact_lists.models import ContactList, ContactListImport
from apps.delivery.engine import session
from apps.identity.models import AppUser
from apps.tenants import context
from apps.tenants.models import Tenant

pytestmark = [pytest.mark.django_db(databases=["default", "platform"])]

CSV = ("﻿Email,First name,Last name,Mobile number,Postal code,Loyalty ID,Loyalty tier,Last order date,Email consent date,Text consent date\r\n"
       "dolores.alvarez@jobs.test,Dolores,Alvarez,+14045550101,30303,NWA790001,GOLD,2026-08-24,2026-01-10,2026-01-10\r\n"
       "miriam.okonkwo@jobs.test,Miriam,Okonkwo,+14045550102,31401,NWA790002,SILVER,2026-07-15,2026-03-02,\r\n").encode("utf-8")


def _forget_tenant():
    with connections["default"].cursor() as cursor:
        cursor.execute("SELECT set_config('app.current_tenant', '', false)")


def test_upload_through_the_worker(check, admin_email):
    real_tx = session.tx

    @contextmanager
    def worker_tx():
        """session.tx, but the workspace is forgotten when the transaction ends, as on the server (in a test the outer
        transaction would otherwise keep the transaction-local setting alive)."""
        with real_tx():
            yield
        _forget_tenant()

    ptok = context.set_platform(True)
    tenant = Tenant.objects.using("platform").get(code="NWA")
    user = AppUser.objects.using("platform").get(email=admin_email)
    context.reset_platform(ptok)
    T = str(tenant.id)
    with transaction.atomic(using="default"), transaction.atomic(using="platform"), \
            mock.patch.object(jobs, "kick", lambda: None), mock.patch.object(jobs, "assert_room", lambda *a, **k: None):
        token = context.set_current(T, "default", str(user.pk))
        with connections["default"].cursor() as cursor:                     # the request: the middleware sets the workspace
            cursor.execute("SELECT set_config('app.current_tenant', %s, false)", [T])
            cursor.execute("SELECT set_config('app.current_user_id', %s, false)", [str(user.pk)])
        contact_list = ContactList.objects.create(tenant_id=T, name=f"Worker upload {T[:4]}", created_by_id=user.pk, source_type="UPLOAD",
                                                  list_environment="PRODUCTION", status="ACTIVE", channel="EMAIL")
        record = imports.accept(contact_list, SimpleUploadedFile("cep-contact-list-template.csv", CSV, content_type="text/csv"), user_id=user.pk)
        context.reset(token)

        errors = []

        def worker(step):
            # the claim runs on the platform connection on the server (it sees every workspace); here it shares the test's
            # connection, so it is given the workspace. The step itself runs with none on the connection, as on the server.
            job = jobs.claim("default", T)
            _forget_tenant()
            errors.clear()
            with mock.patch.object(session, "tx", worker_tx), \
                    mock.patch.object(jobs.log, "exception", lambda *a, **k: errors.append(traceback.format_exc().strip().splitlines()[-1])):
                ok = job is not None and jobs._run(str(job[0]), str(job[1]), job[2], job[3])
            result = {"processed": int(bool(ok)), "failed": int(job is not None and not ok)}
            _forget_tenant()
            with connections["default"].cursor() as cursor:
                cursor.execute("SELECT set_config('app.current_tenant', %s, false)", [T])
            row = ContactListImport.objects.get(pk=record.pk)
            check(f"{step}: the worker finishes it on the first attempt", result == {"processed": 1, "failed": 0} and row.error is None,
                  f"{result} status={row.status} attempts={row.attempts} logged={errors}")
            return row

        row = worker("STAGE")
        check("the file is read: two rows", row.status == "STAGED" and row.row_count == 2, f"{row.status} {row.row_count}")

        token = context.set_current(T, "default", str(user.pk))
        imports.confirm_mapping(row, row.column_mapping)                      # the operator confirms the columns: REVIEW is queued
        context.reset(token)
        row = worker("REVIEW")
        check("the rows are checked: both ready", row.status == "REVIEW" and row.summary["ready"]["total"] == 2, f"{row.status} {row.summary}")

        if row.status == "REVIEW":
            ContactListImport.objects.filter(pk=row.pk).update(attested_at=timezone.now())
            token = context.set_current(T, "default", str(user.pk))
            imports.request_apply(ContactListImport.objects.select_related("contact_list").get(pk=row.pk))
            context.reset(token)
            row = worker("APPLY")
            check("the two contacts are added to the list", row.status == "APPLIED" and row.summary["result"]["added"] == 2, f"{row.status} {row.summary.get('result')}")
        transaction.set_rollback(True, using="default")
        transaction.set_rollback(True, using="platform")
    check.done()
