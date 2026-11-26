"""Base Reports (docs/mockups/base-reports.html, option 1): every pack holds together (every field key as Report Databases makes it,
every report, formula, benchmark and tile naming what the pack makes), each one's SQL keeps to its options, and adding the Email
Campaign Reports pack makes the folder, datasets, shared formulas, reports and dashboards through the app's own checks, all or
nothing. No database server is contacted: the Postal connection is faked, and the other packs' SQL is read, not run. Rolled back."""
import copy
import re

import pytest
from django.conf import settings
from django.db import connections
from django.utils.text import slugify

from apps.insights import base_reports, external
from apps.insights.base_packs import PACKS
from apps.insights.base_packs.common import OptionError, word
from apps.insights.base_packs.email_campaigns import sql as email_sql

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


# ------------------------------------------------------------------------------------------------- every pack, not only the first
# The six packs added after Email Campaigns follow its shape, so the checks that hold it together hold all of them. Anything
# registered in PACKS is covered: a pack added later is tested by being added, not by being remembered here.
PACK_OPTIONS = {
    "email-campaigns": OPTIONS,
    "email-campaigns-warehouse": {"databases": ["analysis_db"]},
    "sms-marketing": {"databases": ["analysis_db"]},
    "sms-ereceipts": {"databases": ["analysis_db"]},
    "ereceipts": {"databases": ["analysis_db"]},
    "service-requests": {"databases": ["crm_db"]},
    "surveys": {"databases": ["crm_db"]},
}
# Columns on the CRM's tables that are the customer, not a figure. None of them belongs in a report.
PERSONAL = ("CUSTOMER_NAME", "CUSTOMER_MOBILE", "CUSTOMER_EMAIL", "CUSTOMER_PRIMARY_PHONE", "CUSTOMER_WORK_PHONE",
            "CONTACT_EMAIL", "CONTACT_NAME", "EMAIL_ADDRESS", "GEO_LAT", "GEO_LNG", "ADDRESS_1", "ADDRESS_2")


def test_every_pack_is_registered_with_its_options(check):
    check("every pack in PACKS has options to test it with, and every option set names a pack",
          set(PACKS) == set(PACK_OPTIONS), set(PACKS) ^ set(PACK_OPTIONS))
    for key, pack in PACKS.items():
        check(f"{key}: its key matches its registration", pack["key"] == key)
        check(f"{key}: it says what it needs", bool(pack["needs"]["tables"]) and bool(pack["needs"]["label"]))
    check.done()


@pytest.mark.parametrize("pack_key", sorted(PACKS))
def test_every_pack_holds_together(check, pack_key):
    pack = PACKS[pack_key]
    datasets = {d["id"]: d for d in pack["datasets"]}
    keys = {d["id"]: {_key(f["label"]) for f in d["fields"]} for d in pack["datasets"]}
    for formula in pack["formulas"]:
        check(f"{formula['label']}: it belongs to a dataset of the pack", formula["dataset"] in datasets, formula["dataset"])
        keys[formula["dataset"]].add("f_" + _key(formula["label"]))
    for dataset in pack["datasets"]:
        check(f"{dataset['label']}: its time field and row key are fields",
              {dataset["time_field"], dataset["primary_key"]} <= keys[dataset["id"]],
              {dataset["time_field"], dataset["primary_key"]} - keys[dataset["id"]])
        # A field's key comes from its label, not its column, so the two have to agree or a report names nothing.
        check(f"{dataset['label']}: every field but Link keeps its column's name as its key",
              all(_key(f["label"]) == f["column"] for f in dataset["fields"] if f["column"] != "url"),
              [(f["label"], f["column"]) for f in dataset["fields"] if _key(f["label"]) != f["column"] and f["column"] != "url"])
    for formula in pack["formulas"]:
        named = {_key(n) for n in re.findall(r"\[([^\]]+)\]", formula["expression"])}
        check(f"{formula['label']}: every field it names is in {datasets[formula['dataset']]['label']}",
              named <= keys[formula["dataset"]], named - keys[formula["dataset"]])
    for report in pack["reports"]:
        named = {c["field"] for c in report["definition"]["columns"]} | {o["field"] for o in report["definition"]["orderBy"]} | \
                {r["field"] for r in report["definition"]["filters"]["rules"]} | {p["field"] for p in report["definition"]["parameters"]}
        check(f"{report['name']}: every field it names is in {datasets[report['dataset']]['label']}",
              named <= keys[report["dataset"]], named - keys[report["dataset"]])
    for benchmark in pack["benchmarks"]:
        fields = {benchmark["measure"], benchmark["count"], benchmark["base"]}
        check(f"a benchmark on {datasets[benchmark['dataset']]['label']}: its measure, count and base are fields",
              fields <= keys[benchmark["dataset"]], fields - keys[benchmark["dataset"]])
        check(f"a benchmark on {benchmark['measure']}: its bands point the way it says",
              (benchmark["act"] <= benchmark["good"]) if benchmark["higher"] else (benchmark["act"] >= benchmark["good"]))
    ids = {r["id"]: r for r in pack["reports"]}
    for board in pack["dashboards"]:
        for row in board["layout"]["rows"]:
            for tile in row["tiles"]:
                report = ids.get(tile["report"])
                check(f"{board['name']} - {tile['title']}: names a report of the pack", report is not None, tile)
                if tile["show"] == "figure" and report:
                    check(f"{board['name']} - {tile['title']}: its figure is one of the report's totals",
                          any(c["field"] == tile["measure"] and c.get("aggregate") for c in report["definition"]["columns"]),
                          tile["measure"])
    percent = [f for f in pack["formulas"] if f["format"] == "percent"]
    check("every percent formula multiplies by 100", all(f["expression"].replace(" ", "").endswith("*100") for f in percent),
          [f["label"] for f in percent if not f["expression"].replace(" ", "").endswith("*100")])
    check.done()


@pytest.mark.parametrize("pack_key", sorted(PACKS))
def test_every_pack_writes_sql_the_window_accepts(check, pack_key):
    pack = PACKS[pack_key]
    options = PACK_OPTIONS[pack_key]
    for dataset in pack["datasets"]:
        check(f"{dataset['label']}: passes the query window's check", bool(external.check_sql(dataset["sql"](options), "mysql80")))
        check(f"{dataset['label']}: one branch per database it was given",
              dataset["sql"](options).count("UNION ALL") == len(options["databases"]) - 1)
    more = dict(options, databases=[*options["databases"], "another_database"])
    for dataset in pack["datasets"]:
        sql = dataset["sql"](more)
        check(f"{dataset['label']}: a second database adds a second branch",
              sql.count("UNION ALL") == len(options["databases"]) and "another_database" in sql)
    check.done()


@pytest.mark.parametrize("pack_key", sorted(PACKS))
def test_every_pack_refuses_what_it_cannot_quote(check, pack_key):
    options = PACK_OPTIONS[pack_key]
    quoted = "shop" + chr(96) + "; DROP"
    for label, bad in (("a database name with a quote", {**options, "databases": [quoted]}),
                       ("no database at all", {**options, "databases": []}),
                       ("the same database twice", {**options, "databases": [*options["databases"], *options["databases"]]})):
        with pytest.raises(OptionError):
            PACKS[pack_key]["checked"](bad)
        check(f"refused: {label}", True)
    check.done()


def test_a_word_left_out_is_a_whole_word(check):
    """The packs left campaigns out by substring, and "Hottest Deals" contains "test": turning tests off would
    have dropped the two biggest sends of the year, 400,761 messages, without saying so."""
    for name, left_out, matches in (("Hottest Deals Week 2", "test", False),
                                    ("latest news", "test", False),
                                    ("Important Update", "import", False),
                                    ("Internal Test Template A", "test", True),
                                    ("Test Campaign 29", "test", True),
                                    ("Joy Video (Copy)", "copy", True),
                                    ("Listrak Subscribe list", "listrak", True)):
        # what the SQL does, done here: everything but a letter or a digit becomes a space, then a padded word is looked for
        normalised = " " + " ".join(re.sub(r"[^0-9a-zA-Z]+", " ", name).lower().split()) + " "
        check(f"{name!r} contains {left_out!r} as a word: {matches}", ((" " + left_out + " ") in normalised) is matches)
    condition = word("c.CAMPAIGN_NAME", "test")
    check("the condition normalises the column the same way, and puts no pattern character in the statement",
          "REGEXP_REPLACE" in condition and "' test '" in condition and "%" not in condition)
    with pytest.raises(OptionError):
        word("c.CAMPAIGN_NAME", "   ")
    check("refused: a word with nothing in it", True)
    check.done()


def test_the_packs_keep_to_their_scope(check):
    by_id = {d["id"]: d["sql"](PACK_OPTIONS["email-campaigns-warehouse"])
             for d in PACKS["email-campaigns-warehouse"]["datasets"]}
    check("the warehouse counts people, not rows: its reach is a distinct party count",
          "COUNT(DISTINCT CASE WHEN m.SENT > 0 THEN m.PARTY_ID END) AS reached" in by_id["campaigns"])
    check("and its message grain is one row per person per campaign",
          "GROUP BY m.MARKETING_CAMPAIGN_ID, m.PARTY_ID" in by_id["messages"])
    check("a list import is left out by name, always",
          "listrak" in by_id["campaigns"] and "subscribe list" in by_id["campaigns"])
    check("an event is named from a roster of campaigns, not from the recipient table, which would multiply it",
          "GROUP BY MARKETING_CAMPAIGN_ID" in by_id["opens"])

    marketing = {d["id"]: d["sql"](PACK_OPTIONS["sms-marketing"]) for d in PACKS["sms-marketing"]["datasets"]}
    check("the SMS scope compares the campaign type as it is: wrapping it in LOWER() cost the optimiser the column",
          "m.CAMPAIGN_TYPE IN ('sms', 'mms')" in marketing["messages"]
          and "LOWER(COALESCE(m.CAMPAIGN_TYPE" not in marketing["messages"])
    check("a click is kept apart from one that came back too fast to be a person",
          "AS human_click" in marketing["messages"] and "TIME_TO_CLICK_MINUTES >= 2" in marketing["messages"])
    slower = PACKS["sms-marketing"]["datasets"][0]["sql"]({**PACK_OPTIONS["sms-marketing"], "think_time": 7})
    check("how long a person is given to think is an option", "TIME_TO_CLICK_MINUTES >= 7" in slower)

    receipts = {d["id"]: d["sql"](PACK_OPTIONS["sms-ereceipts"]) for d in PACKS["sms-ereceipts"]["datasets"]}
    check("the receipt flow is named, not typed: it is filed under two campaign types, and one of them carries verification too",
          "m.CAMPAIGN_NAME = 'API SMS Receipt'" in receipts["receipts"])

    surveys = {d["id"]: d["sql"](PACK_OPTIONS["surveys"]) for d in PACKS["surveys"]["datasets"]}
    check("a survey's rates are built on one row per sitting", "GROUP BY a.RESPONSE_ID" in surveys["responses"])
    check("and the answer grain is left as it is, one row per question", "GROUP BY" not in surveys["answers"])
    check("the recommendation score is read the usual way, 9 and 10 against 6 and below",
          "AS promoters" in surveys["responses"] and "AS detractors" in surveys["responses"])

    for dataset in PACKS["service-requests"]["datasets"]:
        sql = dataset["sql"](PACK_OPTIONS["service-requests"])
        found = [column for column in PERSONAL if column in sql]
        check(f"{dataset['label']}: reads nothing that identifies a customer", not found, found)
    check.done()


# ------------------------------------------------------------------------------------------------- loading them in bulk
# manage.py load_base_packs adds a pack without anyone at the screen, so what it decides has to be visible: which
# database a pack reads, and why a workspace was left out. The database is never touched here - the connections and
# what their databases hold are stood in for, which is what the command itself would be reading.
class _Tenant:
    def __init__(self, settings=None, code="NWA"):
        self.settings, self.code, self.pk, self.name = settings or {}, code, "t-1", "Workspace"
        self.saved = None

    def save(self, **kwargs):
        self.saved = self.settings


def _connection(name="Analysis", engine="mysql80", id_="c-1"):
    return {"id": id_, "name": name, "engine": engine, "status": "ACTIVE", "read_only": True, "database_name": "analysis_db"}


def test_a_mapping_is_read_back_as_it_was_saved(check):
    from apps.insights import base_packs_loader as loader
    tenant = _Tenant({loader.KEY: {"surveys": {"connection_id": "c-1", "options": {"databases": ["crm"]}},
                                   "ereceipts": {"options": {}},          # no connection: not a mapping
                                   "nonsense": "not a dict"}})
    found = loader.mapped(tenant)
    check("a mapping with a connection is kept", found.get("surveys") == {"connection_id": "c-1", "options": {"databases": ["crm"]}})
    check("one without a connection is not a mapping", "ereceipts" not in found)
    check("and neither is something that is not a mapping at all", "nonsense" not in found)
    check("a workspace with nothing mapped has nothing", loader.mapped(_Tenant()) == {})
    check.done()


def test_the_loader_works_out_which_database_a_pack_reads(check, monkeypatch):
    from apps.insights import base_packs_loader as loader
    pack = PACKS["surveys"]

    def connections(rows):
        monkeypatch.setattr(loader, "_connections", lambda tenant, pack: rows)

    # one connection whose databases hold the pack's tables: that is the answer, and it says how it got there
    connections([_connection()])
    monkeypatch.setattr(loader.base_reports, "sources", lambda tenant, pack, row: {"databases": [{"name": "crm_db"}], "names": []})
    found = loader.resolve(_Tenant(), pack)
    check("one connection holding its tables is the answer", found["status"] == loader.READY, found)
    check("and the databases it found become the options", found["options"]["databases"] == ["crm_db"])
    check("with a note saying it was worked out, not mapped", "worked out" in found["why"])

    # two of them is a guess, so it asks instead of picking
    connections([_connection(), _connection("Other", id_="c-2")])
    found = loader.resolve(_Tenant(), pack)
    check("two connections holding its tables is asked about, never guessed", found["status"] == loader.AMBIGUOUS, found)
    check("and it names them, so the answer is one click away", "Analysis" in found["why"] and "Other" in found["why"])

    # none of them holds the tables
    connections([_connection()])
    monkeypatch.setattr(loader.base_reports, "sources", lambda tenant, pack, row: {"databases": [], "names": []})
    check("no database holding its tables is said plainly", loader.resolve(_Tenant(), pack)["status"] == loader.NO_DATABASE)

    # the connection cannot be read at all
    def refuse(tenant, pack, row):
        raise RuntimeError("Access denied for user")
    monkeypatch.setattr(loader.base_reports, "sources", refuse)
    found = loader.resolve(_Tenant(), pack)
    check("a database that cannot be read is reported, not treated as empty", found["status"] == loader.UNREACHABLE, found)
    check("and the reason is kept", "Access denied" in found["why"])

    # a mapping beats working it out, and is not second-guessed
    monkeypatch.setattr(loader.databases, "connection", lambda tenant_id, connection_id: _connection(id_=connection_id))
    tenant = _Tenant({loader.KEY: {"surveys": {"connection_id": "c-9", "options": {"databases": ["crm_one"]}}}})
    found = loader.resolve(tenant, pack)
    check("a mapping is used as it stands", found["status"] == loader.READY and found["options"]["databases"] == ["crm_one"], found)
    check("and says so", found["why"] == "mapped")

    # a mapping to a connection that has since gone
    def gone(tenant_id, connection_id):
        raise RuntimeError("No such connection")
    monkeypatch.setattr(loader.databases, "connection", gone)
    check("a mapping to a connection since removed does not stop the load",
          loader.resolve(tenant, pack)["status"] == loader.NO_DATABASE)
    check.done()


def test_the_loader_says_why_a_pack_is_left_out(check, monkeypatch):
    from apps.insights import base_packs_loader as loader
    monkeypatch.setattr(loader.base_reports, "_added", lambda tenant_id: [{"pack_key": "surveys", "folder_name": "Survey Reports"}])
    monkeypatch.setattr(loader.catalog, "components_of", lambda tenant_id: ["insights"])
    monkeypatch.setattr(loader.base_reports, "_folder_name", lambda pack: pack["name"])
    monkeypatch.setattr(loader, "resolve", lambda tenant, pack: {"status": loader.READY, "connection": _connection(),
                                                                 "options": {"databases": ["db"]}, "why": ""})
    steps = {s["pack"]: s for s in loader.plan(_Tenant(), ["surveys", "ereceipts", "no-such-pack"])}
    check("a pack the workspace already has is left alone", steps["surveys"]["status"] == loader.ALREADY)
    check("and the plan says the folder it is already in", steps["surveys"]["folder"] == "Survey Reports")
    check("one it does not have is ready, with the database it would read", steps["ereceipts"]["status"] == loader.READY
          and steps["ereceipts"]["databases"] == ["db"])
    check("and the folder it would go into, named after the pack",
          steps["ereceipts"]["folder"] == PACKS["ereceipts"]["name"])
    check("a pack that does not exist is said so rather than passed over", steps["no-such-pack"]["status"] == "no such pack")

    monkeypatch.setattr(loader.catalog, "components_of", lambda tenant_id: [])
    without = {s["pack"]: s for s in loader.plan(_Tenant(), ["ereceipts"])}
    check("a workspace without the components is told which it needs", without["ereceipts"]["status"] == loader.NOT_FITTING
          and "insights" in without["ereceipts"]["why"])

    chosen = _Tenant({"base_packs": ["ereceipts"]})
    monkeypatch.setattr(loader.catalog, "components_of", lambda tenant_id: ["insights"])
    check("with no packs named, it takes the ones the workspace was onboarded with",
          [s["pack"] for s in loader.plan(chosen)] == ["ereceipts"])
    check.done()


def test_the_command_refuses_what_it_cannot_do(check):
    from django.core.management import call_command
    from django.core.management.base import CommandError
    for label, kwargs in (("neither a workspace nor all of them", {}),
                          ("both a workspace and all of them", {"tenants": ["NWA"], "all_tenants": True}),
                          ("a pack that does not exist", {"tenants": ["NWA"], "packs": "no-such-pack"}),
                          ("adding without saying who is adding", {"tenants": ["NWA"], "apply": True})):
        with pytest.raises(CommandError):
            call_command("load_base_packs", **kwargs)
        check(f"refused: {label}", True)
    check.done()
