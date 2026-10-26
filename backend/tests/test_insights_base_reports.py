"""Base Reports (docs/mockups/base-reports.html, option 1): the Email Campaign Reports pack holds together (every field key as Report
Databases makes it, every report and tile naming what the pack makes), its SQL keeps to its options, and adding it makes the folder,
datasets, shared formulas, reports and dashboards through the app's own checks, all or nothing. No database server is contacted:
the Postal connection is faked. Rolled back."""
import copy

import pytest
from django.conf import settings
from django.db import connections
from django.utils.text import slugify

from apps.insights import base_reports, external
from apps.insights.base_packs import PACKS, email_sql

pytestmark = pytest.mark.django_db(databases=["default", "platform"])
PACK = PACKS["email-campaigns"]
OPTIONS = {"databases": ["mailpostal-server-14", "txpostalprod-server-10"], "names": {"table": "citi_analysis_db.marketing_campaign", "id": "MARKETING_CAMPAIGN_ID", "name": "CAMPAIGN_NAME"},
           "leave_out": ["Test", "client list"]}
GOOD = {"ok": True, "version": "8.0.44", "timezone": "UTC", "tables": 9, "views": 0, "read_only": True, "offending": [], "ms": 40, "error": None}
BODY = {"name": "Citi Postal", "engine": "mysql80", "host": "postal.citi.internal", "port": 3306, "database": "citi_analysis_db", "username": "c360_reports", "password": "s3cret", "ssl": "REQUIRED"}


def _table(name: str) -> bool:
    with connections[settings.PLATFORM_ALIAS].cursor() as cursor:
        cursor.execute("SELECT to_regclass(%s) IS NOT NULL", [f"public.{name}"])
        return cursor.fetchone()[0]


def _key(label: str) -> str:
    return slugify(label).replace("-", "_")


def test_the_pack_holds_together(check):
    datasets = {d["id"]: d for d in PACK["datasets"]}
    keys = {d["id"]: {_key(f["label"]) for f in d["fields"]} for d in PACK["datasets"]}
    for formula in PACK["formulas"]:
        keys[formula["dataset"]].add("f_" + _key(formula["label"]))
    for dataset in PACK["datasets"]:
        check(f"{dataset['label']}: its time field and row key are fields", {dataset["time_field"], dataset["primary_key"]} <= keys[dataset["id"]])
        check(f"{dataset['label']}: every field but Link keeps its column's name as its key",
              all(_key(f["label"]) == f["column"] for f in dataset["fields"] if f["column"] != "url"), [(f["label"], f["column"]) for f in dataset["fields"] if _key(f["label"]) != f["column"]])
    for report in PACK["reports"]:
        named = {c["field"] for c in report["definition"]["columns"]} | {o["field"] for o in report["definition"]["orderBy"]} | \
                {r["field"] for r in report["definition"]["filters"]["rules"]} | {p["field"] for p in report["definition"]["parameters"]}
        check(f"{report['name']}: every field it names is in {datasets[report['dataset']]['label']}", named <= keys[report["dataset"]], named - keys[report["dataset"]])
    ids = {r["id"]: r for r in PACK["reports"]}
    for board in PACK["dashboards"]:
        for row in board["layout"]["rows"]:
            for tile in row["tiles"]:
                report = ids.get(tile["report"])
                check(f"{board['name']} · {tile['title']}: names a report of the pack", report is not None, tile)
                if tile["show"] == "figure" and report:
                    check(f"{board['name']} · {tile['title']}: its figure is one of the report's totals",
                          any(c["field"] == tile["measure"] and c.get("aggregate") for c in report["definition"]["columns"]))
    check("the Management Dashboard reads every campaign, the Campaign Performance one the latest",
          all(ids[t["report"]]["definition"]["parameters"][0].get("default") is None for r in PACK["dashboards"][0]["layout"]["rows"] for t in r["tiles"])
          and ids["kpis"]["definition"]["parameters"][0]["default"] == {"latest": True})
    check.done()


def test_the_sql_keeps_to_its_options(check):
    sql = email_sql.messages_sql(OPTIONS)
    check("one branch per Postal database", sql.count("UNION ALL") == 1 and "`mailpostal-server-14`.messages m" in sql and "`txpostalprod-server-10`.messages m" in sql)
    check("campaign mail only: an mkt_id, and MKT_CAMP where the tag names its kind (e-receipts carry an mkt_id too)", sql.count(email_sql.MARKETING) == 2)
    check("names from the campaign table", "LEFT JOIN `citi_analysis_db`.`marketing_campaign` c ON c.`MARKETING_CAMPAIGN_ID` = u.campaign_id" in sql)
    check("words left out in any case", "LOCATE('test', LOWER(" in sql and "LOCATE('client list', LOWER(" in sql)
    check("clicks on the unsubscribe link count as unsubscribes, not clicks", "l.url NOT LIKE '%unsubscribe%'" in sql and "l.url LIKE '%unsubscribe%'" in sql)
    bare = email_sql.messages_sql({"databases": ["mailpostal-server-14"]})
    check("without a names table, a campaign is named from its subject and first send, as CmpReport does", "DATE_FORMAT(FROM_UNIXTIME(c.first_ts)" in bare and "WHERE 1 = 1" in bare)
    for label, options in (("a database name with a quote", {"databases": ["shop`; DROP"]}), ("no database", {"databases": []}),
                           ("a word with a quote", {"databases": ["a"], "leave_out": ["it's"]}), ("a names table of three parts", {"databases": ["a"], "names": {"table": "a.b.c", "id": "x", "name": "y"}}),
                           ("an unsubscribe pattern with %", {"databases": ["a"], "unsubscribe": "50%"})):
        with pytest.raises(email_sql.OptionError):
            email_sql.checked(options)
        check(f"refused: {label}", True)
    for dataset in PACK["datasets"]:
        check(f"{dataset['label']}: passes the query window's check", bool(external.check_sql(dataset["sql"](OPTIONS), "mysql80")))
    check.done()


def _fake_postal(monkeypatch, asked):
    columns = sorted({f["column"] for d in PACK["datasets"] for f in d["fields"]})

    def run_sql(row, sql, *, limit=50, timeout_ms=15_000, zone=None):
        asked.append(sql)
        if "information_schema.TABLES" in sql:
            rows = [["mailpostal-server-14", 5, 26458], ["txpostalprod-server-10", 5, 17853]]
        elif "information_schema.COLUMNS" in sql:
            rows = [["citi_analysis_db.marketing_campaign", "MARKETING_CAMPAIGN_ID", "CAMPAIGN_NAME"]]
        elif sql.startswith("SELECT COUNT(*) FROM `"):
            rows = [[919]]
        elif sql.startswith("SELECT COUNT(*) FROM ("):
            rows = [[4]]
        else:
            return {"columns": [{"column": c} for c in columns], "rows": [], "truncated": False, "ms": 3, "sql": sql}
        return {"columns": [{"column": f"c{i}"} for i in range(len(rows[0]))], "rows": rows, "truncated": False, "ms": 3, "sql": sql}
    monkeypatch.setattr(external, "test", lambda row: dict(GOOD))
    monkeypatch.setattr(external, "run_sql", run_sql)


def _counts(world) -> dict:
    names = [r["name"] for r in PACK["reports"]]
    labels = [d["label"] for d in PACK["datasets"]]
    return {"reports": world.sql("SELECT count(*) FROM report WHERE name = ANY(%s) AND deleted_at IS NULL", [names], fetch=True)[0][0],
            "datasets": world.sql("SELECT count(*) FROM report_dataset_custom WHERE label = ANY(%s)", [labels], fetch=True)[0][0],
            "folders": world.sql("SELECT count(*) FROM report_folder WHERE name LIKE %s AND deleted_at IS NULL", [PACK["name"] + "%"], fetch=True)[0][0],
            "dashboards": world.sql("SELECT count(*) FROM dashboard WHERE name = ANY(%s) AND deleted_at IS NULL", [[d["name"] for d in PACK["dashboards"]]], fetch=True)[0][0]}


def test_adding_the_pack(check, world, monkeypatch):
    if not _table("report_connection") or not _table("report_dataset_formula"):
        pytest.skip("patches 0056 and 0065 have not been applied to this database")
    asked = []
    _fake_postal(monkeypatch, asked)
    made = world.api("post", "/api/v1/workspace/report-databases/", BODY).json()
    world.api("post", f"/api/v1/workspace/report-databases/{made['id']}/test/")
    listed = world.api("get", "/api/v1/insights/base-reports/").json()
    pack = next(p for p in listed["packs"] if p["key"] == "email-campaigns")
    check("the catalogue lists the pack with its contents", pack["version"] == 1 and len(pack["contents"]["reports"]) == len(PACK["reports"]) and listed["can_add"], pack)
    check("and the connections it could read", any(c["id"] == made["id"] and c["usable"] for c in listed["connections"]), listed["connections"])

    found = world.api("post", "/api/v1/insights/base-reports/email-campaigns/sources/", {"connection_id": made["id"]}).json()
    check("Postal databases found on the connection, with their campaign mail", [d["name"] for d in found["databases"]] == OPTIONS["databases"] and found["databases"][0]["marketing"] == 919, found)
    check("and the table holding campaign names", found["names"] == [OPTIONS["names"]], found["names"])

    checked = world.api("post", "/api/v1/insights/base-reports/email-campaigns/check/", {"connection_id": made["id"], "options": OPTIONS}).json()
    check("each dataset test-run, and the campaigns of the last 90 days counted", checked["ok"] and len(checked["datasets"]) == 4 and checked["campaigns"] == 4, checked)
    bad = world.api("post", "/api/v1/insights/base-reports/email-campaigns/check/", {"connection_id": made["id"], "options": {"databases": ["x`; drop"]}})
    check("a database name that cannot go into SQL is refused", bad.status_code == 400 and "options" in bad.json()["errors"], bad.content[:200])

    before = _counts(world)
    added = world.api("post", "/api/v1/insights/base-reports/email-campaigns/add/", {"connection_id": made["id"], "options": OPTIONS})
    out = added.json()
    check("adding makes everything", added.status_code == 201 and len(out["datasets"]) == 4 and len(out["reports"]) == len(PACK["reports"]) and len(out["dashboards"]) == 2, str(added.content[:400]))
    after = _counts(world)
    check("all of it in the workspace", after == {"reports": before["reports"] + len(PACK["reports"]), "datasets": before["datasets"] + 4, "folders": before["folders"] + 1,
                                                 "dashboards": before["dashboards"] + 2}, (before, after))
    filed = world.sql("SELECT count(*) FROM report WHERE folder_id = %s AND deleted_at IS NULL", [out["folder"]["id"]], fetch=True)[0][0]
    check("every report filed in the pack's folder", out["folder"]["name"] == PACK["name"] and filed == len(PACK["reports"]), (out["folder"], filed))
    formulas = world.sql("SELECT count(*) FROM report_dataset_formula WHERE dataset_key = ANY(%s) AND deleted_at IS NULL", [[d["key"] for d in out["datasets"]]], fetch=True)[0][0]
    check("the shared formulas on the new datasets", formulas == len(PACK["formulas"]), formulas)
    kpis = world.api("get", f"/api/v1/insights/reports/{next(r['id'] for r in out['reports'] if r['name'] == 'Campaign KPIs')}/").json()
    check("a report reads its own new dataset and asks the latest campaign and a quarter",
          kpis["dataset"] == next(d["key"] for d in out["datasets"] if d["label"] == "Email Messages")
          and [(p["key"], p.get("default")) for p in kpis["definition"]["parameters"]][:2] == [("campaign", {"latest": True}), ("period", "quarter")], kpis["definition"].get("parameters"))
    board = world.api("get", f"/api/v1/insights/dashboards/{out['dashboards'][1]['id']}/").json()
    tiles = [t for row in board["layout"]["rows"] for t in row["tiles"]]
    check("the dashboards' tiles point at the new reports, with the campaign slicer", {t["report_id"] for t in tiles} <= {r["id"] for r in out["reports"]}
          and board["layout"]["slicers"][0]["field"] == "campaign_name", board["layout"].get("slicers"))
    if _table("report_base_install"):
        again = world.api("get", "/api/v1/insights/base-reports/").json()
        mine = next(p for p in again["packs"] if p["key"] == "email-campaigns")["added"]
        check("the addition is remembered, with its version and folder", out["recorded"] and mine[0]["version"] == 1 and mine[0]["folder_id"] == out["folder"]["id"], mine)
    second = world.api("post", "/api/v1/insights/base-reports/email-campaigns/add/", {"connection_id": made["id"], "options": OPTIONS}).json()
    check("adding again makes new copies beside the first, nothing changed", second["folder"]["name"] == f"{PACK['name']} (2)"
          and {d["key"] for d in second["datasets"]}.isdisjoint({d["key"] for d in out["datasets"]}), (second["folder"], second["datasets"]))
    check.done()


def test_all_or_nothing(check, world, monkeypatch):
    if not _table("report_connection") or not _table("report_dataset_formula"):
        pytest.skip("patches 0056 and 0065 have not been applied to this database")
    _fake_postal(monkeypatch, [])
    made = world.api("post", "/api/v1/workspace/report-databases/", BODY).json()
    world.api("post", f"/api/v1/workspace/report-databases/{made['id']}/test/")
    broken = copy.deepcopy(PACK)
    broken["reports"].append({**copy.deepcopy(broken["reports"][0]), "id": "broken", "name": "Broken"})
    broken["reports"][-1]["definition"]["columns"] = [{"field": "no_such_field", "aggregate": "sum"}]
    monkeypatch.setitem(PACKS, "email-campaigns", broken)
    before = _counts(world)
    shown_before = [d["label"] for d in world.api("get", "/api/v1/insights/catalog/").json()["datasets"]]
    refused = world.api("post", "/api/v1/insights/base-reports/email-campaigns/add/", {"connection_id": made["id"], "options": OPTIONS})
    check("a part that does not fit stops the addition and says where", refused.status_code == 400 and "Adding stopped at the report Broken" in str(refused.json()), refused.content[:300])
    check("and nothing was added: no folder, dataset, report or dashboard", _counts(world) == before, (before, _counts(world)))
    shown = [d["label"] for d in world.api("get", "/api/v1/insights/catalog/").json()["datasets"]]
    check("the catalogue does not keep the rolled-back datasets", shown.count("Email Messages") == shown_before.count("Email Messages"), shown_before)
    check.done()


def test_only_report_administrators_add(check, world, monkeypatch):
    from api.permissions import HasPermissionCode
    _fake_postal(monkeypatch, [])
    monkeypatch.setattr(HasPermissionCode, "has_permission", lambda self, request, view: self.code in ("report.view", "report.edit"))
    monkeypatch.setattr(base_reports, "_has", lambda request, code: code in ("report.view", "report.edit"))
    refused = world.api("post", "/api/v1/insights/base-reports/email-campaigns/add/", {"connection_id": "00000000-0000-4000-8000-000000000000", "options": OPTIONS})
    check("a report author without report.admin may not add a pack", refused.status_code == 403, refused.content[:200])
    listed = world.api("get", "/api/v1/insights/base-reports/").json()
    check("they see the catalogue, without the connections or the Add", listed["can_add"] is False and listed["connections"] == [], listed.get("can_add"))
    check.done()


def test_the_back_office_page(check):
    from django.contrib.auth.models import update_last_login
    from django.contrib.auth.signals import user_logged_in
    from django.test import Client

    from apps.identity.models import AppUser
    staff = AppUser.objects.using(settings.PLATFORM_ALIAS).filter(is_staff=True, is_platform_admin=True, is_active=True).order_by("created_at").first()
    if staff is None:
        pytest.skip("no back-office superuser in this database")
    user_logged_in.disconnect(update_last_login, dispatch_uid="update_last_login")
    try:
        office = Client()
        office.force_login(staff)
        page = office.get("/admin/insights/reportdataset/base-reports/")
        body = page.content.decode()
        check("Configuration → Base Reports lists the pack, its contents and the workspaces that added it", page.status_code == 200 and "Email Campaign Reports" in body
              and "Management Dashboard" in body and ("No workspace has added this pack yet." in body or "Version 1" in body), f"{page.status_code} {body[:200]}")
        check("the menu links to it", 'href="/admin/insights/reportdataset/base-reports/"' in body)
    finally:
        user_logged_in.connect(update_last_login, dispatch_uid="update_last_login")
    check.done()


def test_campaign_name_tables_best_first(check):
    ids = ["MARKETING_CAMPAIGN_ID", "CAMPAIGN_PURPOSE_ID", "CAMPAIGN_TYPE_ID", "CAMPAIGN_TEMPLATE_ID", "CASSANDRA_CAMPAIGN_ID", "ALTERNATE_CAMPAIGN_ID"]
    rows = [("citi_analysis_db.marketing_campaign", i, n) for i in ids for n in ["CAMPAIGN_NAME", "PARENT_CAMPAIGN_NAME", "CAMPAIGN_TEMPLATE_NAME"]]
    rows += [("citi_analysis_db.campaign_report_unsubscribed", "CAMPAIGN_ID", "CAMPAIGN_NAME")]
    found = base_reports.name_tables(rows)
    check("a campaign's own id and name in the campaigns' table come first, not a type's, a template's or a parent's",
          found[0] == {"table": "citi_analysis_db.marketing_campaign", "id": "MARKETING_CAMPAIGN_ID", "name": "CAMPAIGN_NAME"}, found)
    check("a log of campaigns follows; the template, type and parent pairs are left out", len(found) == 2 and found[1]["table"].endswith("campaign_report_unsubscribed"), found)
    check.done()


def test_ninety_days_on_a_dashboard(check):
    from datetime import date

    from apps.insights.dashboards import PRESETS, period_bounds
    bounds = period_bounds({"preset": "90d"}, date(2026, 10, 26))
    check("90 Days is a dashboard period: the last 90 days to today, and the 90 before for comparison", "90d" in PRESETS and bounds == {
        "from": "2026-07-29", "to": "2026-10-26", "previous_from": "2026-04-30", "previous_to": "2026-07-28"}, bounds)
    check("the pack's dashboards open on it: Postal keeps about two months of mail", all(d["period"] == {"preset": "90d"} for d in PACK["dashboards"]))
    check.done()
