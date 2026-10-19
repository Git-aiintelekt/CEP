"""Insights' Key Influencers and Decomposition Tree views (PR 157) saved as a report's view (patch 0064): the report and its
versions keep the view type, and a grid report can be changed to either."""
import pytest
from django.db import connections

from .test_insights import P

pytestmark = pytest.mark.django_db(databases=["default", "platform"])


def _view_types_fit() -> bool:
    with connections[P].cursor() as cursor:
        cursor.execute("""SELECT character_maximum_length FROM information_schema.columns
                          WHERE table_schema = 'public' AND table_name = 'report' AND column_name = 'view_type'""")
        row = cursor.fetchone()
        return bool(row) and (row[0] or 0) >= len("decomposition")


def test_analysis_views_save(check, world):
    if not _view_types_fit():
        pytest.skip("patch 0064 has not been applied to this database")
    columns = [{"field": "channel"}, {"field": "campaign_name"}, {"field": "sent", "aggregate": "sum"}]
    for kind in ("influencers", "decomposition"):
        made = world.api("post", "/api/v1/insights/reports/", {"name": f"Sends by {kind}", "dataset": "messages",
                                                                "definition": {"columns": columns, "view": {"type": kind, "measure": "sent"}}})
        body = made.json() if made.status_code == 201 else {}
        check(f"a report shown as {kind} is saved", made.status_code == 201 and body["view_type"] == kind
              and body["definition"]["view"] == {"type": kind, "measure": "sent"}, made.content[:300])
        versions = world.api("get", f"/api/v1/insights/reports/{body.get('id')}/versions/").json() if body else {}
        check(f"its first version keeps the {kind} view", bool(body) and versions["versions"][0]["view_type"] == kind, str(versions)[:300])

    grid = world.api("post", "/api/v1/insights/reports/", {"name": "Sends as a grid", "dataset": "messages", "definition": {"columns": columns}}).json()
    changed = world.api("put", f"/api/v1/insights/reports/{grid['id']}/", {"row_version": grid["row_version"],
                                                                           "definition": {"columns": columns, "view": {"type": "decomposition", "measure": "sent"}}})
    check("a grid report changed to the Decomposition Tree saves as version 2", changed.status_code == 200 and changed.json()["view_type"] == "decomposition"
          and changed.json()["version"] == 2, changed.content[:300])
    check.done()
