"""Base Reports (docs/mockups/base-reports.html, option 1): the Email Campaign Reports pack holds together (every field key as Report
Databases makes it, every report and tile naming what the pack makes), its SQL keeps to its options, and adding it makes the folder,
datasets, shared formulas, reports and dashboards through the app's own checks, all or nothing. No database server is contacted:
the Postal connection is faked. Rolled back."""
import copy

import pytest
from django.conf import settings
from django.core.cache import cache
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


def test_the_application_reads_and_adds_records_only(check):
    from pathlib import Path
    layer = (Path(settings.BASE_DIR).parent / "database" / "CEP_Database_Schema_Platform_Operations.sql").read_text(encoding="utf-8")
    check("the layer takes back what an owner's default privileges would give the application on the new table",
          "REVOKE UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON report_base_install FROM cep_app;" in layer)
    if not _table("report_base_install"):
        pytest.skip("patch 0079 has not been applied to this database")
    with connections[settings.PLATFORM_ALIAS].cursor() as cursor:
        cursor.execute("""SELECT has_table_privilege('cep_app', c.oid, 'SELECT'), has_table_privilege('cep_app', c.oid, 'INSERT'),
                                 has_table_privilege('cep_app', c.oid, 'UPDATE'), has_table_privilege('cep_app', c.oid, 'DELETE'), c.relforcerowsecurity
                            FROM pg_class c WHERE c.relname = 'report_base_install'""")
        found = cursor.fetchone()
    check("here the application reads and adds records, never changes or removes one, under row-level security", found == (True, True, False, False, True), found)
    check.done()


def test_a_percent_is_worked_out_in_percent(check):
    percent = [f for f in PACK["formulas"] if f["format"] == "percent"]
    check("every percent formula multiplies by 100: the app shows a percent's value with a % sign, so 0.964 would read 1.0%",
          percent and all(f["expression"].replace(" ", "").endswith("*100") for f in percent), [f["label"] for f in percent if not f["expression"].replace(" ", "").endswith("*100")])
    check("a ratio that is not a percent is left alone", all(not f["expression"].replace(" ", "").endswith("*100") for f in PACK["formulas"] if f["format"] != "percent"))
    check.done()


# ---------------------------------------------------------------------------------------------------- Engagement Reports: on the platform's own datasets
ENGAGEMENT = PACKS["engagement"]
WIDE = {"preset": "custom", "from": "2026-01-01", "to": "2027-12-31"}       # a period that holds whatever the local copy has


def _patch_0103() -> bool:
    """database patch 0103 is here: the views and catalogue fields the pack reads. Without it the pack cannot be added."""
    with connections[settings.PLATFORM_ALIAS].cursor() as cursor:
        cursor.execute("""SELECT EXISTS (SELECT 1 FROM pg_views WHERE schemaname = 'reporting' AND viewname = 'rpt_journey_steps')
                             AND EXISTS (SELECT 1 FROM report_field WHERE dataset_key = 'messages' AND key = 'unsubscribed')""")
        return cursor.fetchone()[0]


def test_engagement_reports_hold_together(check, world):
    reports = {r["id"]: r for r in ENGAGEMENT["reports"]}
    messages = [r for r in ENGAGEMENT["reports"] if r["dataset"] == "messages"]
    check("every report on Messages leaves test sends out", all({"field": "test_mode", "operator": "=", "value": False} in r["definition"]["filters"]["rules"] for r in messages))
    check("every report on Messages asks Campaigns with no default, so a report made from it reads every campaign and not the latest one",
          all(r["definition"]["parameters"][0]["field"] == "campaign_name" and "default" not in r["definition"]["parameters"][0] for r in messages),
          [r["name"] for r in messages if r["definition"]["parameters"][0].get("field") != "campaign_name"])
    check("every report asks a period last, 30 days by default", all(r["definition"]["parameters"][-1]["operator"] == "period" and r["definition"]["parameters"][-1]["default"] == "30d"
                                                                     for r in ENGAGEMENT["reports"]))
    rated = [f for r in ENGAGEMENT["reports"] for f in r["definition"].get("derived", []) if f["kind"] == "measure"]
    check("a best or worst list rates a campaign only from 50 sends, an hour from 50 delivered",
          len(rated) == 4 and all(f["expression"].startswith(("IF(SUM([Sent Count]) >= 50, ", "IF(SUM([Delivered Count]) >= 50, ")) for f in rated), [f["expression"] for f in rated])
    for tile in [t for row in ENGAGEMENT["dashboards"][0]["layout"]["rows"] for t in row["tiles"]]:
        report = reports.get(tile["report"])
        check(f"Engagement Overview · {tile['title']}: names a report of the pack", report is not None, tile)
        if tile["show"] == "figure" and report:
            check(f"Engagement Overview · {tile['title']}: its figure is one of the report's totals", any(c["field"] == tile["measure"] and c.get("aggregate") for c in report["definition"]["columns"]))
        if tile.get("line") == "first" and report:
            check(f"Engagement Overview · {tile['title']}: its report is sorted by that figure, the highest first, lines without one left out",
                  report["definition"]["orderBy"] == [{"field": tile["measure"], "direction": "desc"}] and report["definition"]["hideZero"] == [tile["measure"]], report["definition"]["orderBy"])
    wanted = base_reports._platform_fields(ENGAGEMENT)
    check("the pack reads four of the platform's datasets, two of them for the measures it blends in", set(wanted) == {"messages", "journey_enrollments", "attributed_orders", "journey_steps"}
          and wanted["attributed_orders"] == {"amount"} and wanted["journey_steps"] == {"sent", "delivered_rate", "held_back"}, {k: sorted(v) for k, v in wanted.items()})
    checked = world.api("post", "/api/v1/insights/base-reports/engagement/check/", {})
    answer = checked.json()
    if _patch_0103():
        check("with patch 0103 the check needs no connection, finds the four datasets and every report fits them",
              checked.status_code == 200 and answer["ok"] and {d["label"] for d in answer["datasets"]} == {"Messages", "Journey Enrollments", "Attributed Orders", "Journey Messages"}, checked.content[:500])
    else:
        check("without patch 0103 the check names what the datasets lack and the patch that brings it",
              checked.status_code == 200 and not answer["ok"] and any("has no" in p or "no journey_steps" in p for p in answer["problems"]) and "database patch 0103" in answer["problems"][-1], checked.content[:500])
        refused = world.api("post", "/api/v1/insights/base-reports/engagement/add/", {})
        check("and nothing is added", refused.status_code == 400 and "database patch 0103" in str(refused.json())
              and world.sql("SELECT count(*) FROM report WHERE name = 'Engagement Totals' AND deleted_at IS NULL", fetch=True)[0][0] == 0, refused.content[:300])
    check.done()


def test_engagement_reports_wait_for_their_fields(check, world, monkeypatch):
    from apps.insights import catalog
    real = catalog.dataset

    def without_unsubscribed(tenant_id, key, can_see_pii=False):
        dataset = real(tenant_id, key, can_see_pii)
        return {**dataset, "fields": [f for f in dataset["fields"] if f["key"] != "unsubscribed"]} if dataset and key == "messages" else dataset
    monkeypatch.setattr(catalog, "dataset", without_unsubscribed)
    checked = world.api("post", "/api/v1/insights/base-reports/engagement/check/", {}).json()
    check("a catalogue without one of the pack's fields: the check says which dataset lacks it, and what the installation needs",
          not checked["ok"] and any(p.startswith("Messages has no ") and "unsubscribed" in p for p in checked["problems"]) and "database patch 0103" in checked["problems"][-1], checked["problems"])
    refused = world.api("post", "/api/v1/insights/base-reports/engagement/add/", {})
    check("and adding is refused before anything is made", refused.status_code == 400 and world.sql("SELECT count(*) FROM report WHERE name = 'Engagement Totals' AND deleted_at IS NULL", fetch=True)[0][0] == 0,
          refused.content[:300])
    check.done()


def test_adding_engagement_reports(check, world):
    if not _patch_0103():
        pytest.skip("patch 0103 is not on this database: the pack cannot be added here (test_engagement_reports_hold_together checks that it says so)")
    listed = world.api("get", "/api/v1/insights/base-reports/").json()
    pack = next((p for p in listed["packs"] if p["key"] == "engagement"), None)
    check("a workspace with Engagement and Insights is offered the pack, with no database to connect", pack is not None and pack["needs"] is None and pack["contents"]["datasets"] == []
          and {c["key"] for c in pack["components"]} == {"cep", "insights"}, pack)
    names = [r["name"] for r in ENGAGEMENT["reports"]]

    def counts():
        return (world.sql("SELECT count(*) FROM report WHERE name = ANY(%s) AND deleted_at IS NULL", [names], fetch=True)[0][0],
                world.sql("SELECT count(*) FROM dashboard WHERE name = %s AND deleted_at IS NULL", ["Engagement Overview"], fetch=True)[0][0],
                world.sql("SELECT count(*) FROM report_dataset_custom", fetch=True)[0][0] if _table("report_dataset_custom") else 0)
    before = counts()
    check("until it is added, Engagement's Reports has no dashboard to open", world.api("get", "/api/v1/me/").json()["insights"]["engagement_overview"] is None)
    added = world.api("post", "/api/v1/insights/base-reports/engagement/add/", {})
    out = added.json()
    check("adding makes the nine reports and the dashboard, and no dataset", added.status_code == 201 and out["datasets"] == [] and len(out["reports"]) == len(names) == 9 and len(out["dashboards"]) == 1,
          str(added.content[:400]))
    check("all of it in the workspace", counts() == (before[0] + len(names), before[1] + 1, before[2]), (before, counts()))
    check("filed in the pack's folder", out["folder"]["name"].startswith("Engagement Reports"), out["folder"])
    ids = {r["name"]: r["id"] for r in out["reports"]}
    totals = world.api("get", f"/api/v1/insights/reports/{ids['Engagement Totals']}/").json()
    check("a report reads the platform's Messages dataset, for the workspace to see", totals["dataset"] == "messages" and totals["visibility"] == "WORKSPACE", (totals.get("dataset"), totals.get("visibility")))
    asked = {name: world.api("get", f"/api/v1/insights/reports/{ids[name]}/").json()["definition"]["parameters"] for name in names if name != "Journeys in the Period"}
    check("each report on Messages is saved asking Campaigns with no default: it reads every campaign of the period, on its own and on the dashboard",
          all(next(p for p in parameters if p["field"] == "campaign_name").get("default") is None for parameters in asked.values()),
          {name: [p for p in parameters if p["field"] == "campaign_name"] for name, parameters in asked.items()})
    board = world.api("get", f"/api/v1/insights/dashboards/{out['dashboards'][0]['id']}/").json()
    tiles = [t for row in board["layout"]["rows"] for t in row["tiles"]]
    check("the dashboard's tiles point at the new reports, with the channel slicer and the last 30 days",
          {t["report_id"] for t in tiles} <= {r["id"] for r in out["reports"]} and board["layout"]["slicers"][0]["field"] == "channel" and board["period"] == {"preset": "30d"},
          (board["layout"].get("slicers"), board["period"]))
    check("four of its figures read a report's first line", [t["id"] for t in tiles if t.get("line") == "first"] == ["highest-open", "highest-click", "most-unsubscribes", "best-hour"], tiles)

    def run(tile_id, **body):
        return world.api("post", f"/api/v1/insights/dashboards/{board['id']}/tiles/{tile_id}/run/", {"period": WIDE, **body})
    ran = {t["id"]: run(t["id"]) for t in tiles}
    for tile_id, answer in ran.items():
        check(f"the {tile_id} tile runs", answer.status_code == 200 and answer.json().get("kind") in ("figure", "view"), answer.content[:300])
    labels = {tile_id: [c["label"] for c in ran[tile_id].json()["result"]["columns"]] for tile_id in ("campaigns", "journeys")}
    check("Campaigns in the Period has the mockup's columns, the revenue from Attributed Orders",
          labels["campaigns"] == ["Campaign", "Channel", "First Sent", "Sent", "Delivered", "Open Rate", "Click Rate", "Unsub.", "Revenue"], labels["campaigns"])
    check("Journeys in the Period has what became of the journey's messages beside who entered",
          labels["journeys"] == ["Journey", "Status", "Entered", "Converted", "Conversion Rate", "Revenue", "Sent", "Delivered", "Held Back"], labels["journeys"])

    # the figures against the tables themselves
    sent, journey_sent = (world.sql(statement, fetch=True)[0][0] for statement in (
        """SELECT count(*) FROM (SELECT x.status, x.submitted_at, x.campaign_run_id FROM mailer_execution x UNION ALL SELECT x.status, x.submitted_at, x.campaign_run_id FROM sms_execution x) x
             JOIN campaign_run r ON r.id = x.campaign_run_id WHERE NOT r.test_mode AND x.status NOT IN ('QUEUED', 'FAILED') AND x.submitted_at >= '2026-01-01' AND x.submitted_at < '2028-01-01'""",
        """SELECT count(*) FROM (SELECT x.status, x.campaign_id, x.campaign_run_id FROM mailer_execution x UNION ALL SELECT x.status, x.campaign_id, x.campaign_run_id FROM sms_execution x) x
             JOIN campaign_run r ON r.id = x.campaign_run_id JOIN journey_generated_campaign g ON g.campaign_id = x.campaign_id WHERE NOT r.test_mode AND x.status NOT IN ('QUEUED', 'FAILED')"""))
    check("Sent is every campaign's messages of the period, not the latest campaign's", (ran["sent"].json()["value"] or 0) == sent, (ran["sent"].json()["value"], sent))
    journeys = ran["journeys"].json()["result"]
    check("a journey's Sent is its campaigns' messages", sum(row[6] or 0 for row in journeys["rows"]) <= journey_sent and (journey_sent == 0 or any(row[6] for row in journeys["rows"])),
          (journeys["rows"], journey_sent))
    best, first = ran["best"].json()["result"], ran["highest-open"].json()
    check("Highest Open Rate is the first line of Best Campaigns by Open Rate: its name and its rate",
          first["line"] == "first" and not first["compared"] and (first["label"], first["value"]) == ((best["rows"][0][0], best["rows"][0][1]) if best["rows"] else (None, None)), (first, best["rows"][:1]))
    hour = ran["best-hour"].json()
    check("Best Send Hour names an hour of the day", hour["label"] is None or hour["label"].endswith((" AM", " PM")), hour.get("label"))

    # an opt-out a message carried counts on that message's campaign
    message = world.sql("""SELECT x.id, x.party_id, c.id::text, c.name FROM mailer_execution x JOIN campaign_run r ON r.id = x.campaign_run_id JOIN campaign c ON c.id = x.campaign_id
                            WHERE NOT r.test_mode AND x.delivered_at IS NOT NULL AND x.submitted_at >= '2026-01-01'
                              AND NOT EXISTS (SELECT 1 FROM consent_record o WHERE o.mailer_execution_id = x.id) ORDER BY x.submitted_at DESC LIMIT 1""", fetch=True)
    if message:
        message_id, party, campaign_id, campaign = message[0]

        def unsubscribed():
            rows = world.api("post", "/api/v1/insights/reports/preview/", {"dataset": "messages", "definition": {
                "columns": [{"field": "campaign_name"}, {"field": "unsubscribed", "aggregate": "sum"}, {"field": "unsubscribe_rate", "aggregate": "calc"}],
                "filters": {"combinator": "and", "rules": [{"field": "campaign_name", "operator": "=", "value": campaign}, {"field": "submitted_at", "operator": "between", "value": ["2026-01-01", "2027-12-31"]}]}}}).json()["rows"]
            return rows[0][1:] if rows else [0, None]
        was = unsubscribed()
        world.sql("""INSERT INTO consent_record (tenant_id, party_id, channel, action, source, evidence, campaign_id, mailer_execution_id, occurred_at)
                     VALUES (current_setting('app.current_tenant')::uuid, %s, 'EMAIL', 'OPT_OUT', 'UNSUBSCRIBE_LINK', '{}', %s, %s, now())""", [party, campaign_id, message_id])
        cache.clear()                                                  # a report's rows are kept a minute: read them again
        now = unsubscribed()
        check("an opt-out carried by a message is one more Unsubscribed for its campaign, and moves its rate", now[0] == was[0] + 1 and now[1] and now[1] > (was[1] or 0), (was, now))
    sliced = run("campaigns", slicers={"channel": ["SMS"]})
    check("the channel slicer narrows the messages, and the blended revenue stays the campaign's", sliced.status_code == 200 and sliced.json()["kind"] == "view" and sliced.json()["sliced"] == ["channel"], sliced.content[:300])
    if _table("report_base_install"):
        mine = next(p for p in world.api("get", "/api/v1/insights/base-reports/").json()["packs"] if p["key"] == "engagement")["added"]
        check("the addition names the dashboard it made, for Engagement's Reports to open", out["recorded"] and mine[0]["dashboards"] == [{"id": board["id"], "name": "Engagement Overview"}], mine)
        stored = world.sql("SELECT connection_id FROM report_base_install WHERE pack_key = 'engagement' ORDER BY created_at DESC LIMIT 1", fetch=True)[0][0]
        check("recorded with no connection", stored is None, stored)
        check("and GET /me/ says where Engagement's Reports leads", world.api("get", "/api/v1/me/").json()["insights"]["engagement_overview"] == board["id"])
        world.api("delete", f"/api/v1/insights/dashboards/{board['id']}/")
        mine = next(p for p in world.api("get", "/api/v1/insights/base-reports/").json()["packs"] if p["key"] == "engagement")["added"]
        check("a dashboard deleted since is no longer named", mine[0]["dashboards"] == [], mine)
        check("and Reports goes back to Engagement's own page", world.api("get", "/api/v1/me/").json()["insights"]["engagement_overview"] is None)
    check.done()


def test_engagement_reports_need_engagement(check, world, monkeypatch):
    from apps.insights import catalog
    monkeypatch.setattr(catalog, "components_of", lambda tenant_id: ["insights"])
    listed = world.api("get", "/api/v1/insights/base-reports/").json()
    check("a workspace with Insights alone is not offered the pack", all(p["key"] != "engagement" for p in listed["packs"]), [p["key"] for p in listed["packs"]])
    refused = world.api("post", "/api/v1/insights/base-reports/engagement/add/", {})
    check("and cannot add it", refused.status_code == 400 and "Engagement" in str(refused.json()), refused.content[:300])
    check.done()


def test_the_reporting_tables_keep_the_views_columns(check):
    """the ClickHouse tables are loaded column by column from the PostgreSQL views: a column the loader names must be in its view"""
    from apps.insights import clickhouse
    with connections[settings.PLATFORM_ALIAS].cursor() as cursor:
        cursor.execute("SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'reporting'")
        found: dict[str, set] = {}
        for view, column in cursor.fetchall():
            found.setdefault(view, set()).add(column)
    if not found:
        pytest.skip("this login cannot read the reporting views' columns")
    patched = _patch_0103()
    for key, spec in clickhouse.TABLES.items():
        view = spec["view"].split(".")[1]
        if view not in found and not patched and key == "journey_steps":
            continue                                                   # the view patch 0103 makes
        named = {name for name, _ in spec["columns"]}
        new = {"campaign_channel", "unsubscribed_n", "journey_name"} if not patched else set()
        check(f"{key}: every column the loader copies is in {spec['view']}", named - new <= found.get(view, set()), sorted(named - new - found.get(view, set())))
        check(f"{key}: its key and its recent column are among them", {*spec["key"], *([spec["recent"]] if spec["recent"] else [])} <= named)
    statements = []
    original = clickhouse.execute
    clickhouse.execute = lambda sql, **_: statements.append(sql)
    try:
        clickhouse.ensure_schema(clickhouse.Connection(url="http://ch.test", user="u", password="p", database="cep_reporting"))
    finally:
        clickhouse.execute = original
    altered = [s for s in statements if s.startswith("ALTER TABLE cep_reporting.rpt_messages ")]
    check("a table made before a column was added gains it: one ALTER per table, each column added only if it is missing",
          len(altered) == 1 and "ADD COLUMN IF NOT EXISTS unsubscribed_n Int32" in altered[0] and "ADD COLUMN IF NOT EXISTS tenant_id" not in altered[0]
          and sum(s.startswith("CREATE TABLE IF NOT EXISTS") for s in statements) == len(clickhouse.TABLES) == 5, statements[:3])
    check.done()


def test_a_figure_reads_its_reports_first_line(check, world):
    """a dashboard figure with line "first": the name and the figure of the report's first line, as the report sorts it (no patch needed)"""
    definition = {"columns": [{"field": "campaign_name"}, {"field": "sent", "aggregate": "sum"}, {"field": "open_rate", "aggregate": "calc"}],
                  "filters": {"combinator": "and", "rules": [{"field": "test_mode", "operator": "=", "value": False}]}, "orderBy": [{"field": "sent", "direction": "desc"}],
                  "parameters": [{"key": "campaign", "field": "campaign_name", "label": "Campaigns", "operator": "in", "required": False}], "limit": 100}
    report = world.api("post", "/api/v1/insights/reports/", {"name": "ZZ Largest Campaigns", "dataset": "messages", "definition": definition, "visibility": "WORKSPACE"})
    check("the report is made", report.status_code == 201, report.content[:300])
    tile = {"id": "largest", "report_id": report.json()["id"], "show": "figure", "measure": "sent", "line": "first", "title": "Largest Campaign"}
    board = world.api("post", "/api/v1/insights/dashboards/", {"name": "ZZ First Lines", "period": WIDE, "compare": True, "layout": {"rows": [
        {"width": "2", "tiles": [tile, {"id": "total", "report_id": report.json()["id"], "show": "figure", "measure": "sent", "title": "Sent"}]}]}})
    check("a dashboard keeps the figure's line", board.status_code == 201 and board.json()["layout"]["rows"][0]["tiles"][0]["line"] == "first"
          and "line" not in board.json()["layout"]["rows"][0]["tiles"][1], board.content[:400])
    largest = world.sql("""SELECT c.name, count(*) FROM mailer_execution x JOIN campaign_run r ON r.id = x.campaign_run_id JOIN campaign c ON c.id = x.campaign_id
                            WHERE NOT r.test_mode AND x.status NOT IN ('QUEUED', 'FAILED') AND x.submitted_at >= '2026-01-01' AND x.submitted_at < '2028-01-01' GROUP BY 1 ORDER BY 2 DESC LIMIT 2""", fetch=True)
    first = world.api("post", f"/api/v1/insights/dashboards/{board.json()['id']}/tiles/largest/run/", {}).json()
    total = world.api("post", f"/api/v1/insights/dashboards/{board.json()['id']}/tiles/total/run/", {}).json()
    check("the figure is a figure, never compared with the period before, and says which column names its line",
          first["kind"] == "figure" and first["line"] == "first" and first["compared"] is False and first["previous"] is None and first["column"]["key"] == "sent"
          and (first["label_column"] or {}).get("key") == "campaign_name", first)
    if largest and (len(largest) == 1 or largest[0][1] > largest[1][1]):          # one campaign clearly ahead (texts aside): the first line is that one
        check("it reads the first line of the report as the report sorts it", first["label"] == largest[0][0] and first["value"] >= largest[0][1], (first["label"], first["value"], largest))
    if not largest:
        check("a period with no line gives no name and no figure", first["label"] is None and first["value"] is None, first)
    check("the plain figure beside it is still the period's total", total["kind"] == "figure" and "line" not in total and (not largest or total["value"] >= (first["value"] or 0)), total)
    sliced = world.api("post", f"/api/v1/insights/dashboards/{board.json()['id']}/tiles/largest/run/", {"period": {"preset": "custom", "from": "2001-01-01", "to": "2001-01-31"}}).json()
    check("a period with nothing sent: no name, no figure, no error", sliced["kind"] == "figure" and sliced["label"] is None and sliced["value"] is None, sliced)
    check.done()
