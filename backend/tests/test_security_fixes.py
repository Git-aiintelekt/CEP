"""Security fixes: the designer's saved state refuses code (scripts, inline event handlers, embedded pages, javascript: links);
CSV cells a spreadsheet would run as a formula are neutralised, plain numbers and phone numbers kept; the Insights Excel
export writes text as text; the PDF export prints names and cells as text, never as markup. Rolled back."""
import io
import json
import zipfile

import pytest
from django.db import transaction
from django.test import Client
from rest_framework_simplejwt.tokens import AccessToken

from apps.identity.models import AppUser
from apps.insights import excel, pdf
from apps.spreadsheet import safe_cell
from apps.templates.design import unsafe_state
from apps.tenants import context

pytestmark = pytest.mark.django_db(databases=["default", "platform"])

MJML = "<mjml><mj-body><mj-section><mj-column><mj-text>Hello</mj-text></mj-column></mj-section></mj-body></mjml>"


def _wrapped(*components) -> dict:
    return {"pages": [{"frames": [{"component": {"type": "wrapper", "components": list(components)}}]}], "styles": [], "assets": [{"type": "image", "src": "https://cdn.example/a.png"}]}


def test_designer_state(check, admin_email):
    plain = _wrapped({"type": "mj-section", "components": [{"tagName": "a", "attributes": {"href": "https://example.com", "title": "Shop"}, "content": "<b>Shop</b> now"},
                                                          {"type": "textnode", "content": "Prices < $10"}]})
    check("an ordinary design passes", unsafe_state(plain) is None)
    for name, state, words in (
            ("a component script", _wrapped({"type": "mj-text", "script": "fetch('//evil')"}), "script"),
            ("an export script", _wrapped({"type": "mj-text", "script-export": "x()"}), "script"),
            ("an inline event handler", _wrapped({"tagName": "img", "attributes": {"src": "x", "onError": "alert(1)"}}), "event handler"),
            ("an embedded page", _wrapped({"tagName": "iframe", "attributes": {"src": "https://x"}}), "iframe"),
            ("srcdoc", _wrapped({"tagName": "div", "attributes": {"srcdoc": "<p>x</p>"}}), "embedded page"),
            ("a javascript: link with case and spaces", _wrapped({"tagName": "a", "attributes": {"href": " \tJavaScript:alert(1)"}}), "javascript"),
            ("markup in content", _wrapped({"type": "mj-raw", "content": "<img src=x onerror=alert(1)>"}), "event handler"),
            ("a script tag in content", _wrapped({"type": "mj-raw", "content": "<p>x</p><SCRIPT>alert(1)</SCRIPT>"}), "script")):
        why = unsafe_state(state) or ""
        check(f"refused: {name}", words in why.lower(), why)

    tok = context.set_platform(True)
    admin = AppUser.objects.select_related("tenant").get(email=admin_email)
    context.reset_platform(tok)
    client = Client()
    headers = {"HTTP_X_TENANT": admin.tenant.code, "HTTP_AUTHORIZATION": "Bearer " + str(AccessToken.for_user(admin))}

    def post(path, body):
        return client.post(path, json.dumps(body), content_type="application/json", **headers)

    with transaction.atomic():
        template = post("/api/v1/templates/", {"name": "ZZ security design", "channel": "EMAIL"}).json()
        refused = post(f"/api/v1/templates/{template['id']}/design/", {"editor_state": _wrapped({"tagName": "img", "attributes": {"onerror": "alert(1)"}}),
                                                                       "mjml_source": MJML, "subject_line": "Hi", "preheader": "", "base_version": 0})
        check("the API refuses to save such a design, naming the editor state", refused.status_code == 400 and "editor_state" in refused.json().get("errors", refused.json()), refused.content[:300])
        saved = post(f"/api/v1/templates/{template['id']}/design/", {"editor_state": plain, "mjml_source": MJML, "subject_line": "Hi", "preheader": "", "base_version": 0})
        check("and saves an ordinary one", saved.status_code == 201, saved.content[:300])
        transaction.set_rollback(True)
    check.done()


def test_exports(check):
    check("a formula is neutralised in a CSV cell", [safe_cell(v) for v in ("=HYPERLINK(\"x\")", "@SUM(A1)", "+cmd|' /C calc'!A0", "-2+3+cmd|x", "\t=1", "\r=1")]
          == ["'=HYPERLINK(\"x\")", "'@SUM(A1)", "'+cmd|' /C calc'!A0", "'-2+3+cmd|x", "'\t=1", "'\r=1"])
    check("plain numbers, phone numbers, ordinary text and empty cells are kept", [safe_cell(v) for v in ("-12.50", "+1 (555) 010-0100", "Fall Launch", None, 42, -3.5)]
          == ["-12.50", "+1 (555) 010-0100", "Fall Launch", "", 42, -3.5])

    columns = [{"key": "name", "label": "=Name", "type": "string", "format": None}, {"key": "amount", "label": "Amount", "type": "number", "format": "money"}]
    book = excel.build("=Report", columns, [["=HYPERLINK(\"http://evil\",\"x\")", 12.5]], None)
    sheet = zipfile.ZipFile(io.BytesIO(book)).read("xl/worksheets/sheet1.xml").decode()
    check("the Excel export writes text that starts with = as text, never a formula", "<f>" not in sheet, sheet[:400])

    made = pdf.report("<font size=40>Big</font> & co", [{"key": "name", "label": "<b>Name</b>", "type": "string", "format": None}],
                      [["<img src=\"http://169.254.169.254/latest\" width=5 height=5/>"], ["a < b"]], None, workspace="NWA", when="today")
    check("the PDF export prints markup in names and cells as text (it builds; an image tag would have made it fetch the address)", made[:4] == b"%PDF" and len(made) > 800)
    check.done()


def test_query_window_guard(check):
    from apps.insights.external import ExternalError, check_sql

    def refused(sql: str) -> bool:
        try:
            check_sql(sql)
        except ExternalError:
            return True
        return False

    hiding = {"a PostgreSQL # (an operator there, a comment in MySQL)": "SELECT 1 # 1, pg_read_file('/etc/passwd')\n",
              "dollar quotes": "SELECT $$'$$, pg_sleep(5), $$'$$",
              "tagged dollar quotes": "SELECT $x$ ' $x$, pg_sleep(1), $x$ ' $x$",
              "a backslash in a PostgreSQL string": "SELECT '\' AS a, pg_sleep(5) AS b, '\' AS c",
              "a backslash in a PostgreSQL quoted name": 'SELECT 1 AS "a\\", pg_sleep(1), "b"',
              "a MySQL executable comment": "SELECT 1 /*!50000 , SLEEP(5) */",
              "a comment marker inside a string": "SELECT '--' AS a, pg_sleep(5)",
              "MySQL arithmetic that looks like a comment": "SELECT 1--1, SLEEP(5)"}
    for name, sql in hiding.items():
        check(f"refused: {name}", refused(sql), sql)
    fine = ["SELECT name, amount FROM orders WHERE note = 'it''s -- fine' AND tag <> '#x'", "SELECT data #>> '{a,b}' FROM t",
            "WITH x AS (SELECT 1 AS a) SELECT a FROM x -- the end", "SELECT E'line\nbreak' AS a FROM t", "SELECT /* a /* b */ c */ 1"]
    check("ordinary queries still pass", not any(refused(sql) for sql in fine), str([sql for sql in fine if refused(sql)]))
    check.done()
