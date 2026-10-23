"""AI · Ask for a Report with the data to ask about and documents (docs/mockups/ask-for-report-data-and-specs.html, option A): a
spec as PDF, Word, text or Markdown is read for the request (a Word file's text from its XML) and sent in each provider's shape,
never kept; the scope narrows the catalogue the model reads; on a Report Database's tables not mapped yet the model is given the
names and the columns of the tables named, may ask for more once, and drafts a new dataset that Open in Editor maps before it makes
the report. The provider and the customer's database are faked. Rolled back."""
import io
import json
import zipfile

import pytest
from django.conf import settings
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import connections
from django.test import Client
from rest_framework_simplejwt.tokens import AccessToken

from apps.identity.models import AppUser
from apps.insights import ask_documents, ask_tables, assistant, databases, external
from apps.platform_ops import crypto
from apps.tenants import context
from tests.test_insights_assistant import DRAFT, _tables
from tests.test_report_db_picker import BODY, GOOD, _column

pytestmark = pytest.mark.django_db(databases=["default", "platform"])

P = settings.PLATFORM_ALIAS
W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'


def pdf(pages: int = 1) -> bytes:
    return (b"%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Kids [3 0 R] /Count " + str(pages).encode()
            + b" >> endobj\n3 0 obj << /Type /Page /Parent 2 0 R >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF")


def docx(body: str) -> bytes:
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as packed:
        packed.writestr("[Content_Types].xml", "<Types/>")
        packed.writestr("word/document.xml", f"<w:document {W}><w:body>{body}</w:body></w:document>")
    return out.getvalue()


SPEC = docx('<w:p><w:pPr><w:tabs><w:tab w:val="left" w:pos="720"/></w:tabs></w:pPr><w:r><w:t>Net sales by store</w:t></w:r><w:r><w:tab/><w:t xml:space="preserve">and week</w:t></w:r></w:p>'
            '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Store</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Week &amp; year</w:t></w:r></w:p></w:tc></w:tr></w:tbl>'
            '<w:p><w:r><w:delText>gone</w:delText><w:t>Only stores open all quarter.</w:t></w:r></w:p>')


def refused(files) -> str:
    try:
        ask_documents.read_documents(files)
        return ""
    except Exception as exc:                                                       # noqa: BLE001  the ValidationError's words
        return json.dumps(getattr(exc, "detail", str(exc)), default=str)


def test_reading_documents(check):
    read = ask_documents.read_documents([SimpleUploadedFile("Store sales spec v3.docx", SPEC), SimpleUploadedFile("Regional KPIs.pdf", pdf(14)),
                                         SimpleUploadedFile("notes.md", "# Notes\r\n- by week\n".encode())])
    check("a Word file, a PDF and Markdown are read as what they are", [d["kind"] for d in read] == ["word", "pdf", "markdown"], [d["kind"] for d in read])
    check("a Word file's text keeps its paragraphs, tabs and table rows; tab stops and deleted text are left out",
          read[0]["text"] == "Net sales by store\tand week\nStore | Week & year\nOnly stores open all quarter.", repr(read[0]["text"]))
    check("a PDF goes as it is, with its page count", read[1]["pages"] == 14 and read[1]["data"].startswith("JVBERi0"), str(read[1].get("pages")))
    check("text keeps its lines", read[2]["text"] == "# Notes\n- by week" or read[2]["text"] == "# Notes\n- by week\n", repr(read[2]["text"]))
    check("four documents are refused", "up to 3 documents" in refused([SimpleUploadedFile(f"{i}.md", b"x") for i in range(4)]))
    check("an old Word file is refused, saying to save it as .docx", "save it as .docx" in refused([SimpleUploadedFile("spec.doc", b"\xd0\xcf\x11\xe0 old word")]))
    check("a file of another kind is refused, named", "budget.xlsx is not a PDF, Word (.docx), text or Markdown file" in refused([SimpleUploadedFile("budget.xlsx", b"\x00\x01binary")]))
    check("a PDF of more than 100 pages is refused", "more than 100 pages" in refused([SimpleUploadedFile("all.pdf", pdf(150))]))
    check("a document over 10 MB is refused with its size", "big.md is 10.0 MB" in refused([SimpleUploadedFile("big.md", b"x" * (ask_documents.DOCUMENT_BYTES_MAX + 1))]))
    check("documents whose text runs past 300,000 characters are refused", "300,000 characters" in refused([SimpleUploadedFile("a.txt", b"word " * 70_000)]))
    other = io.BytesIO()
    with zipfile.ZipFile(other, "w") as packed:
        packed.writestr("readme.txt", "not a Word file")
    check("a ZIP that is not a Word file is refused", "pack.docx is not a Word (.docx) file" in refused([SimpleUploadedFile("pack.docx", other.getvalue())]))

    sent = []

    class Answer:
        status_code, reason, ok = 200, "OK", True

        def __init__(self, data):
            self.data = data

        def json(self):
            return self.data

    def fake_post(url, json=None, **kwargs):
        sent.append(json)
        if "anthropic" in url:
            return Answer({"content": [{"type": "thinking", "thinking": ""}, {"type": "text", "text": "{\"kind\": \"question\"}"}], "stop_reason": "end_turn",
                           "usage": {"input_tokens": 10, "output_tokens": 2}})
        return Answer({"choices": [{"message": {"content": "{\"kind\": \"question\"}"}}], "usage": {"prompt_tokens": 10, "completion_tokens": 2}})

    original = assistant.requests.post
    assistant.requests.post = fake_post
    try:
        row = {"api_key_enc": crypto.encrypt("sk-test")}
        assistant.call_model("anthropic", row, "claude-sonnet-5-5", "system", "Build this", documents=read[:2])
        assistant.call_model("openai", row, "gpt-5", "system", "Build this", documents=read[:2])
    finally:
        assistant.requests.post = original
    claude, gpt = (body["messages"][-1]["content"] for body in sent)
    check("Anthropic gets the Word text and the PDF as titled document blocks before the text",
          [b["type"] for b in claude] == ["document", "document", "text"] and claude[0]["source"] == {"type": "text", "media_type": "text/plain", "data": read[0]["text"]}
          and claude[0]["title"] == "Store sales spec v3.docx" and claude[1]["source"]["media_type"] == "application/pdf", json.dumps(claude)[:300])
    check("OpenAI gets the text, the Word text in a document wrapper and the PDF as a file",
          gpt[0] == {"type": "text", "text": "Build this"} and gpt[1]["text"].startswith('<document name="Store sales spec v3.docx">') and gpt[2]["type"] == "file"
          and gpt[2]["file"]["file_data"].startswith("data:application/pdf;base64,"), json.dumps(gpt)[:300])
    check("Claude may answer in up to 16,000 tokens, room for its thinking and a new dataset", sent[0]["max_tokens"] == 16000)
    check.done()


def test_scope(check):
    sets = [{"key": "messages"}, {"key": "x_sales", "external": True, "kind": "table", "database": {"id": "11111111-1111-1111-1111-111111111111"}},
            {"key": "u_pos", "kind": "upload"}]
    check("all: every dataset", [d["key"] for d in assistant.scoped(sets, "all")] == ["messages", "x_sales", "u_pos"])
    check("the platform's: neither a database's nor an upload's", [d["key"] for d in assistant.scoped(sets, "platform")] == ["messages"])
    check("uploads", [d["key"] for d in assistant.scoped(sets, "uploads")] == ["u_pos"])
    check("one database's", [d["key"] for d in assistant.scoped(sets, assistant.valid_scope("db:11111111-1111-1111-1111-111111111111"))] == ["x_sales"])
    try:
        assistant.valid_scope("db:not-an-id")
        check("a scope that is not one of them is refused", False)
    except Exception:                                                              # noqa: BLE001
        check("a scope that is not one of them is refused", True)
    check.done()


CONN = {"id": "c1", "name": "CG-Prod", "engine": "mysql57", "database_name": "shop", "schema_name": "shop", "row_version": 1}
LINES = [{"column": "line_id", "column_type": "bigint", "key": True, "mappable": True, "type": "number", "role": "dimension", "aggregates": [], "format": "integer"},
         {"column": "sale_day", "column_type": "date", "key": False, "mappable": True, "type": "date", "role": "dimension", "aggregates": [], "format": "date"},
         {"column": "store_id", "column_type": "int", "key": False, "mappable": True, "type": "number", "role": "dimension", "aggregates": [], "format": "integer"},
         {"column": "net_amount", "column_type": "decimal(12,2)", "key": False, "mappable": True, "type": "number", "role": "measure", "aggregates": ["sum", "avg", "min", "max"], "format": "money"}]
STORES = [{"column": "store_id", "column_type": "int", "key": True, "mappable": True, "type": "number", "role": "dimension", "aggregates": [], "format": "integer"},
          {"column": "store_name", "column_type": "varchar(80)", "key": False, "mappable": True, "type": "string", "role": "dimension", "aggregates": [], "format": None}]
NEW_DRAFT = {"kind": "draft", "name": "Net Sales by Store", "dataset": "new_dataset", "view": {"type": "grid"}, "note": "No opening date in the tables.",
             "new_dataset": {"label": "Store Sales", "source": "sales_lines", "joins": [{"table": "stores", "type": "left", "to": "t0", "on": [["store_id", "store_id"]]}],
                             "fields": [{"table": "t1", "column": "store_name", "label": "Store"}, {"table": "t0", "column": "sale_day", "label": "Sale Day"},
                                        {"table": "t0", "column": "net_amount", "label": "Net Sales"}]},
             "definition": {"columns": [{"field": "store_name"}, {"field": "t0.net_amount", "aggregate": "sum"}], "orderBy": [{"field": "Net Sales", "direction": "desc"}]}}


def test_tables_not_mapped_yet(check, monkeypatch):
    names = [{"name": n, "kind": "table", "rows": None, "columns": None, "mappable": True} for n in ("sales_lines", "sales", "stores", "inv_moves")]
    monkeypatch.setattr(databases, "source_names", lambda row, reload=False: {"sources": names, "read_at": "2026-10-23T10:00:00Z"})
    asked = []
    monkeypatch.setattr(external, "columns_of", lambda row, tables: asked.append(list(tables)) or {t: {"sales_lines": LINES, "stores": STORES}.get(t, LINES[:1]) for t in tables})
    found = ask_tables.context_for(CONN, "Net amount from SALES_LINES by store")
    check("the columns read are those of the tables the prompt names, as a whole word (sales_lines, not sales)", asked == [["sales_lines"]] and list(found["columns"]) == ["sales_lines"], asked)
    words = ask_tables.words(found, set())
    check("the model is told how to draft on them and given the other tables by name", 'table "sales_lines": line_id bigint key, sale_day date' in words
          and "Other tables, names only (3): sales, stores, inv_moves" in words and 'dataset "new_dataset"' in words, words[:400])
    body, entry = ask_tables.build(found, NEW_DRAFT["new_dataset"])
    check("a join on a table not read yet reads its columns then", asked[-1] == ["stores"] and "stores" in found["columns"], asked)
    check("the new dataset is built as Map a Dataset builds one: types from the columns, keys from the labels, the date the time field",
          [f["key"] for f in entry["fields"]] == ["store", "sale_day", "net_sales"] and entry["fields"][2]["aggregates"] == ["sum", "avg", "min", "max"]
          and entry["time_field"] == "sale_day" and entry["joins"][0]["table"] == "shop.stores" and entry["source"] == "shop.sales_lines", json.dumps(entry, default=str)[:400])
    definition, view = ask_tables.remap(NEW_DRAFT["definition"], {}, entry)
    check("fields named by column, table.column or label are put to their keys", [c["field"] for c in definition["columns"]] == ["store", "net_sales"]
          and definition["orderBy"][0]["field"] == "net_sales", json.dumps(definition))
    result, made = assistant._read_reply(NEW_DRAFT, [], found, 5000)
    check("the draft reads as a draft on the new dataset, with its note and what Open in Editor will map",
          result["kind"] == "draft" and result["dataset"] == "new_dataset" and result["dataset_label"] == "Store Sales" and result["note"] == "No opening date in the tables."
          and result["new_dataset"]["joins"] == ["stores"] and result["new_dataset"]["fields"] == 3 and result["map"]["body"]["source"] == "sales_lines" and made is not None,
          json.dumps({k: v for k, v in result.items() if k != "map"}, default=str)[:400])
    try:
        ask_tables.build(found, {**NEW_DRAFT["new_dataset"], "fields": [{"table": "t0", "column": "website_visits"}]})
        check("a column the table does not have is refused for the retry", False)
    except assistant.DefinitionError as exc:
        check("a column the table does not have is refused for the retry", "website_visits" in str(exc), str(exc))
    check.done()


def _client(admin_email):
    token = context.set_platform(True)
    admin = AppUser.objects.select_related("tenant").get(email=admin_email)
    context.reset_platform(token)
    return admin, Client(HTTP_X_TENANT=admin.tenant.code, HTTP_AUTHORIZATION="Bearer " + str(AccessToken.for_user(admin)))


def test_api_documents_scope_and_unmapped_tables(check, admin_email, monkeypatch):
    if not _tables():
        pytest.skip("patch 0055 (and 0049) have not been applied to this database")
    with connections[P].cursor() as cursor:
        cursor.execute("INSERT INTO ai_provider (tenant_id, provider, api_key_enc, model_reports, model_fast, is_active) VALUES (NULL, 'anthropic', %s, 'claude-sonnet-5-5', 'claude-haiku-5-5', TRUE)", [crypto.encrypt("sk-test")])
    assistant._TABLE_SEEN = False
    calls, replies = [], []

    def fake_call(provider, row, model, system, user, **kwargs):
        calls.append({"system": system, "user": user, "documents": kwargs.get("documents") or [], "schema": kwargs.get("schema")})
        return (replies.pop(0) if replies else DRAFT), {"in": 1200, "out": 90}

    monkeypatch.setattr(assistant, "call_model", fake_call)
    monkeypatch.setattr(assistant.billing, "plan_for", lambda tenant_id: {"name": "Growth", "max_ai_prompts": 50})
    admin, client = _client(admin_email)
    model = "anthropic:claude-sonnet-5-5"

    asked = client.post("/api/v1/insights/assistant/ask/", {"prompt": "Build the report in the spec", "model": model, "documents": [SimpleUploadedFile("spec.docx", SPEC)]})
    body = asked.json()
    check("a prompt with a Word spec is asked: the model gets the document and a note naming it; the draft says what was read",
          asked.status_code == 200 and body["kind"] == "draft" and calls[-1]["documents"][0]["kind"] == "word" and '"spec.docx" (Word)' in calls[-1]["user"]
          and body["read"] == {"documents": [{"name": "spec.docx", "kind": "word", "words": 16}], "images": 0}, json.dumps(body)[:300])
    platform = client.post("/api/v1/insights/assistant/ask/", {"prompt": "Sent by campaign", "model": model, "scope": "platform"}, content_type="application/json")
    check("the platform's scope gives the model the platform's datasets only", platform.status_code == 200 and '## dataset "messages"' in calls[-1]["system"]
          and "x_" not in calls[-1]["system"].split("Catalogue:")[1].split('"')[1], str(platform.content[:200]))
    big = client.post("/api/v1/insights/assistant/ask/", {"prompt": "Build this", "model": model, "documents": [SimpleUploadedFile(f"{i}.md", b"x" * 9_000_000) for i in range(3)]})
    check("documents over 20 MB together are refused before the model is asked", big.status_code == 400 and "20 MB" in json.dumps(big.json()), str(big.content[:200]))

    if not _column("report_connection", "id"):
        check.done()
        return
    monkeypatch.setattr(external, "test", lambda row: dict(GOOD))
    made = client.post("/api/v1/workspace/report-databases/", BODY, content_type="application/json")
    cid = made.json()["id"]
    none = client.post("/api/v1/insights/assistant/ask/", {"prompt": "Net sales by store", "model": model, "scope": f"db:{cid}"}, content_type="application/json")
    check("a database with nothing mapped and the tables not asked for says how to go on", none.status_code == 409 and "Not Mapped Yet" in none.json()["detail"], str(none.content[:200]))

    names = [{"name": n, "kind": "table", "rows": None, "columns": None, "mappable": True} for n in ("sales_lines", "stores", "inv_moves")]
    monkeypatch.setattr(external, "sources", lambda row: names)
    monkeypatch.setattr(external, "columns_of", lambda row, tables: {t: {"sales_lines": LINES, "stores": STORES}[t] for t in tables if t in ("sales_lines", "stores")})
    replies[:] = [{"kind": "need_tables", "tables": ["sales_lines", "stores"]}, NEW_DRAFT]
    count = len(calls)
    drafted = client.post("/api/v1/insights/assistant/ask/", {"prompt": "Net sales by store", "model": model, "scope": f"db:{cid}", "unmapped": True}, content_type="application/json")
    reply = drafted.json()
    check("on tables not mapped yet the model may ask for columns once, then drafts a new dataset",
          drafted.status_code == 200 and reply["kind"] == "draft" and len(calls) == count + 2 and 'table "sales_lines"' in calls[-1]["system"]
          and "need_tables" in json.dumps(calls[-1]["schema"]) and reply["new_dataset"]["label"] == "Store Sales" and "map" not in reply, json.dumps(reply)[:400])
    opened = client.post(f"/api/v1/insights/assistant/{reply['id']}/open/", {}, content_type="application/json")
    report = opened.json()
    mapped = [d for d in databases_list(client, cid) if d["label"] == "Store Sales"]
    check("Open in Editor maps the dataset first, then makes the report on it", opened.status_code == 201 and len(mapped) == 1 and report["dataset"] == mapped[0]["key"] and report["definition"]["columns"][1]["field"] == "net_sales",
          str(opened.content[:300]))
    check.done()


def databases_list(client, cid) -> list[dict]:
    listed = client.get("/api/v1/workspace/report-databases/").json()
    return next(d for d in listed["databases"] if d["id"] == cid)["datasets"]
