"""The forms refuse what the app would misread: an SMTP host with its port in the name (smtp.office365.com:587 is looked up as a
name) and an engine address ending in the path the adapter adds itself (https://emsb.lynxs.ai/api is called as /api/api/v1/...).
Both happened on a production install. Nothing is written."""
import pytest
from rest_framework import serializers

from api.v1.workspace_api import MailServerSerializer
from apps.delivery.providers.digivize import DigivizeProvider
from apps.delivery.providers.postal import PostalProvider
from apps.delivery.providers.sendgrid import SendGridProvider
from apps.platform_ops.admin import MailServerForm
from apps.platform_ops.mail import server_name_problem


def test_the_smtp_server_name(check):
    for host in ("smtp.office365.com", "mail.example.co.uk", "10.0.0.25", "::1", "2001:db8::25", ""):
        check(f"{host!r} is a server name", server_name_problem(host) is None, server_name_problem(host))
    problem = server_name_problem("smtp.office365.com:587")
    check("host:port is refused, naming the bare name and the port's own field",
          problem is not None and "smtp.office365.com." in problem and "587" in problem and "Port field" in problem, problem)
    check("a trailing colon too", server_name_problem("smtp.office365.com:") is not None)
    for host in ("smtp://smtp.office365.com", "https://smtp.example.com", "smtp.example.com/x", "user@smtp.example.com", "smtp example.com", "a:b:c"):
        check(f"{host!r} is refused", server_name_problem(host) is not None)
    check.done()


@pytest.mark.django_db(databases=["default", "platform"])
def test_both_mail_server_forms_refuse_host_and_port(check):
    form = MailServerForm(data={"host": "smtp.office365.com:587", "port": 587, "security": "STARTTLS", "from_email": "alerts@example.com", "is_active": True})
    check("the back-office form", not form.is_valid() and "without the port" in " ".join(form.errors.get("host", [])), form.errors.as_json())
    form = MailServerForm(data={"host": "smtp.office365.com", "port": 587, "security": "STARTTLS", "from_email": "alerts@example.com", "is_active": True})
    check("and takes the bare name", "host" not in form.errors, form.errors.as_json())
    with pytest.raises(serializers.ValidationError) as refused:
        MailServerSerializer().validate_host("smtp.office365.com:587")
    check("the workspace's Settings form", "without the port" in str(refused.value.detail))
    check("which still takes a bare name, lower-cased", MailServerSerializer().validate_host(" SMTP.Example.com ") == "smtp.example.com")
    check.done()


def test_an_engine_address_without_the_path_the_app_adds(check):
    errors = PostalProvider.validate_config({"endpoint": "https://emsb.lynxs.ai/api"}, has_secret=True)
    check("Postal: /api is refused and the base address offered", "https://emsb.lynxs.ai." in errors.get("endpoint", "") and "/api/v1/…" in errors["endpoint"], errors)
    for address in ("https://emsb.lynxs.ai/api/", "https://emsb.lynxs.ai/api/v1", "https://emsb.lynxs.ai/API"):
        check(f"Postal: {address} too", "endpoint" in PostalProvider.validate_config({"endpoint": address}, has_secret=True))
    errors = PostalProvider.validate_config({"endpoint": "https://example.com/postal/api"}, has_secret=True)
    check("an installation under a path keeps that path in the suggestion", "https://example.com/postal." in errors.get("endpoint", ""), errors)
    for address in ("https://emsb.lynxs.ai", "https://emsb.lynxs.ai/", "https://example.com/postal", "https://example.com/apis"):
        errors = PostalProvider.validate_config({"endpoint": address}, has_secret=True)
        check(f"Postal: {address} is fine", "endpoint" not in errors, errors)
    check("an http:// address keeps its own message", "https://" in PostalProvider.validate_config({"endpoint": "http://emsb.lynxs.ai/api"}, has_secret=True)["endpoint"])

    check("Digivize: /api before its default send path is refused",
          "endpoint" in DigivizeProvider.validate_config({"endpoint": "https://lab.digivize.ai/api"}, has_secret=True))
    check("but not with a send path of its own that does not start there",
          "endpoint" not in DigivizeProvider.validate_config({"endpoint": "https://lab.digivize.ai/api", "send_path": "/sms/send"}, has_secret=True))
    check("Digivize with no address at all uses its default", "endpoint" not in DigivizeProvider.validate_config({}, has_secret=True))
    check("SendGrid: /v3 is refused", "api_base" in SendGridProvider.validate_config({"api_base": "https://api.sendgrid.com/v3"}, has_secret=True))
    check("SendGrid: the EU address is fine", "api_base" not in SendGridProvider.validate_config({"api_base": "https://api.eu.sendgrid.com"}, has_secret=True))
    check.done()
