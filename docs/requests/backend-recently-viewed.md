# Backend request: "Recently Viewed" for Insights

**From:** Frontend (Insights → Reports list redesign, Phase R3)
**Date:** 2026-10-26
**Size:** small. The data is already collected; this asks for one read endpoint.

## What we want
On **Insights → Reports**, a "Recently Viewed" strip at the top shows the last four reports **this person** opened, newest first. It must be the same on every device and browser they sign in on. A later step may add the same strip to Dashboards.

## What already exists
- Every time someone opens a report or dashboard in the app, the frontend calls `POST /insights/usage/ {kind, id}`:
  - for reports, in `ReportViewerPage.tsx`;
  - for dashboards, in `DashboardPage.tsx`.
- `apps/insights/usage.py` → `record()` writes a row to `insights_usage` (`tenant_id, kind, item_id, user_id, via, opened_at`). A repeat open within 10 minutes is skipped.
- `GET /insights/usage/` is admin-only and returns workspace-wide totals. It can't give one person their own list.

So nothing new needs collecting. We only need a way for a person to read their own openings.

## The ask: one endpoint

```
GET /insights/usage/recent/?kind=report&limit=4
```

| | |
|---|---|
| Who | Anyone with `report.view` (the same `VIEW` permission as the rest of Insights). |
| Whose rows | Only the caller's own (`user_id = request.user`). Never anyone else's. |
| Which rows | `via = 'app'` only (embed openings have no person anyway). One entry per item: its latest opening. |
| Filtered to | Items the caller can still open today: not deleted, and passing the same access check as `GET /insights/reports/` (a report that was unshared from them drops out). |
| Order | Newest opening first. |
| `kind` | `report` (required for now). `dashboard` if it's no extra work. |
| `limit` | Default 4, maximum 20. |

### Response
Return the same fields the report list already sends (`ReportSummary`), plus when it was opened. The frontend can then show the name and view icon, and link to the report, without a second call:

```json
{
  "items": [
    {
      "opened_at": "2026-10-26T09:12:44Z",
      "report": { "id": "…", "name": "Weekly Sends by Channel", "view_type": "chart", "ai": false, "…": "the rest of ReportSummary" }
    }
  ]
}
```

If returning the whole `ReportSummary` is awkward, `id`, `name`, `view_type`, `ai` and `opened_at` are enough for the strip.

When the `insights_usage` table isn't there (`access.present("insights_usage")` is false), return `{"items": []}` with 200, not an error.

### Speed
The strip loads with the list page, so this must be quick. The existing indexes are `(tenant_id, opened_at DESC)` and `(tenant_id, kind, item_id, opened_at DESC)`. Neither starts with the person. Please consider adding:

```sql
CREATE INDEX IF NOT EXISTS ix_insights_usage_user ON insights_usage (tenant_id, user_id, kind, opened_at DESC);
```

## Questions for the backend team
1. **How long are `insights_usage` rows kept?** If they're pruned, a person who hasn't opened anything since then gets an empty strip. That's fine; we hide the strip when it's empty.
2. **Is there an existing access helper we should mirror** to make sure a report the person can no longer open never appears?
3. **Could the API path go elsewhere?** `/insights/usage/recent/` is a suggestion. Anything under `/insights/` works for us, as long as you tell us the final path.

## Tests we'd expect on your side
- Returns only the caller's openings, never another user's.
- One entry per report, ordered by latest opening.
- A deleted report, or one no longer shared with the caller, is left out.
- `limit` is respected and capped at 20.
- Without the usage table, it returns an empty list.

## What the frontend does once it's live
Phase R3 adds the strip: up to four chips (view icon + name) above the tabs. It's hidden when the list is empty or the call fails, and it never blocks the page. Until the endpoint ships, the Reports list goes out without the strip. Nothing else waits on this.
