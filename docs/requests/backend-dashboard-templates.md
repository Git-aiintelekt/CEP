# Backend request: more about each pack's dashboards

**For:** the Dashboard Templates panel on Insights → Dashboards (`docs/mockups/dashboards.html`, `docs/build-prompts/dashboards.md` D1).

**Today:** `GET /insights/base-reports/` gives each pack's dashboards as names only (`contents.dashboards: string[]`). The pack files already hold more (`base_packs/email_campaigns.py`, `DASHBOARDS`: id, name, description, layout).

**Ask:** alongside `contents.dashboards`, a `dashboard_details` list, one entry per dashboard:

```json
{ "id": "management", "name": "Management Dashboard", "description": "Every email campaign in the period: …", "tiles": 8,
  "sketch": [{ "x": 0, "y": 0, "w": 3, "h": 2, "show": "figure" }, { "x": 0, "y": 2, "w": 8, "h": 5, "show": "chart" }] }
```

- `description` and `tiles` fill the card's line (“Every email campaign… · 8 tiles”).
- `sketch` is each tile's box and kind on the 12-column grid, first page only, so the card and the preview can draw the real layout. No report data.

**Until then:** the cards show the name, the pack's channel and a generic tile picture. Nothing breaks without it.
