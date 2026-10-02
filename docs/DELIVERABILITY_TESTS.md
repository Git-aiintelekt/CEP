# Deliverability tests (patch 0030)

Inbox previews of a template's saved design in real email clients, through the workspace's own Mailgun Inspect
account, counted against the plan's monthly allowance. The spam verdict and inbox placement are not run yet: a test
already carries their slots and the panel shows their cards, so they drop in without a redesign.

## For the workspace

1. **Settings → Delivery → Deliverability Testing → Set Up Mailgun Inspect.** Region (US or EU), the Inspect account
   username and an API key (write-only, stored encrypted). Save, then **Check Connection**. Then **Edit** to pick the
   default clients every test renders in (grouped as Webmail, Desktop Apps, Phones and Tablets) and whether to render
   with images blocked. Leave all clients unchecked to use the service's own default set.
2. **Template editor → Deliverability tab → Run Inbox Previews.** The test renders the last saved version (unsaved
   changes are not in it). The history on the left lists every test of the template; the result shows three cards
   (Inbox Previews, Spam Verdict, Inbox Placement) and the renders grouped by client kind. A render opens full size.
3. **Settings → Plan and usage** shows "Deliverability tests this month" with the plan's allowance.

Mailgun Inspect Basic covers client previews. The spam check needs Inspect Premium; inbox placement needs a seed-list
service. Both show as "Not in your plan" / "Not available yet" until they exist.

## The allowance

`subscription_plan.max_deliverability_tests_per_month`: tests a workspace may request in a calendar month; NULL =
unlimited. Patch 0030 seeds STARTER 10, GROWTH 50, ENTERPRISE unlimited; the platform team changes it in the
back-office (Subscription plans). A test counts when it is requested, because that is when Mailgun bills it, whatever
comes back. The feature flag `deliverability_tests` (default on; a plan can take it away through `plan_key`) gates the
API with 403; a spent allowance answers 409 with the limit named.

## Where things are

- `database/CEP_Database_Schema_Platform_Operations.sql` §18: `deliverability_service` (one per tenant: provider,
  region, username, `api_key_enc`, `default_clients`, `image_blocking`, the last check) and `deliverability_test`
  (template, version, kind PREVIEW | SPAM | PLACEMENT, status PENDING | PROCESSING | COMPLETE | FAILED, `clients`,
  `summary`, `results`, who and when). Both tenant-scoped with RLS. `patches/0030_deliverability_tests.sql` re-runs the layer.
- `backend/apps/delivery/inspect.py`: the Mailgun Inspect client (`/v1/preview/tests/clients`, `POST /v2/preview/tests`,
  `/v1/preview/tests/<id>/results`), basic auth, through the integration bridge's logged session.
- `backend/apps/delivery/deliverability.py`: the account, the allowance, the sample render (latest rendered content with
  every tag filled from its sample value and the preheader in place), `start_preview`, and `refresh` (polls Inspect
  when a test is read and the last look is older than 8 s; nothing runs in the background).
- `backend/api/v1/deliverability_api.py`: `GET/PUT/DELETE /deliverability/service/`, `POST …/service/check/`,
  `GET /deliverability/clients/` (cached a day), `GET /deliverability/allowance/`, `GET/POST /templates/<id>/deliverability-tests/`,
  `GET/DELETE /deliverability-tests/<id>/`. The account needs `provider.edit`; tests need `template.edit` and the feature.
- `backend/apps/platform_ops/billing.py`: `tests_this_month`, the `DELIVERABILITY_TESTS` usage metric, the meter in `quota()`.
- `frontend/src/features/deliverability/`: `backend.ts` (`apiDeliverability(templateId)`, and `sampleDeliverability()`
  for `/dev/designer`), `DeliverabilityPanel.tsx` (the tab). `DesignerBackend.deliverability` switches the tab on.
- `frontend/src/pages/settings/DeliverabilityServiceSection.tsx`: the Settings → Delivery section and its form.

## Adding the spam verdict or placement later

Run the extra check in `deliverability.start_preview` (or a sibling for `kind = SPAM | PLACEMENT`), write what comes back
into `DeliverabilityTest.results` / `summary`, and fill `payload()`'s `spam` / `placement` slots. The panel's cards read
those slots; `DeliverabilityTest.spam` and `.placement` in `lib/types.ts` already carry the shape.

## Tests

- Backend scratch `test_deliverability.py` (rolled back, Inspect faked, the two tables as session-temporary copies
  because the app's database user has no DDL rights): account save and check, the client list and its cache, a test
  from a template with the tags filled, polling to completion with a failed client, the allowance, the 409 at the
  limit, the 403 without the feature, delete, login.
- Frontend `DeliverabilityPanel.test.tsx` and the Deliverability Testing case in `Delivery.test.tsx`.
