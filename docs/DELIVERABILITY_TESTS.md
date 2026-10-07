# Deliverability tests (patches 0030, 0039)

Inbox previews of a template's saved design in real email clients, through the platform's Mailgun Inspect account
(set up in the back-office, limited by the plan's number plus the tests added for the month) or through the
workspace's own account (not limited). The spam verdict and inbox placement are not run yet: a test
already carries their slots and the panel shows their cards, so they drop in without a redesign.

## For the workspace

1. **Settings → Sending Engines → Deliverability Testing.** With the platform's account set up, the section reads
   **Provided by CEP** with this month's tests against the total and where it comes from. **Edit Clients** picks the
   default clients (grouped as Webmail, Desktop Apps, Phones and Tablets) and images blocked, saving only those
   (`PUT {default_clients, image_blocking}`). **Use Your Own Mailgun Account** opens the account form: region (US or
   EU), the Inspect username and an API key (write-only, stored encrypted); then **Check Connection**. With its own
   account, the section says CEP does not limit its tests; **Stop Using My Own Account** goes back to the platform's.
   With neither, the empty state offers Set Up Mailgun Inspect.
2. **Template editor → Deliverability tab → Run Inbox Previews.** The test renders the last saved version (unsaved
   changes are not in it). The history on the left lists every test of the template; the result shows three cards
   (Inbox Previews, Spam Verdict, Inbox Placement) and the renders grouped by client kind. A render opens full size.
3. **Settings → Plan and usage** shows "Deliverability tests this month" with the total and, under the meter, where
   it comes from.

Mailgun Inspect Basic covers client previews. The spam check needs Inspect Premium; inbox placement needs a seed-list
service. Both show as "Not in your plan" / "Not available yet" until they exist.

## The accounts

`deliverability.account_for(tenant)`: the workspace's own active account with a key first (`OWN`), else the
platform's (`deliverability_service` row with `tenant_id IS NULL`, one at most, active with a key: `PLATFORM`), else
none. Each test stores the `account` it ran on and `refresh` reads its results back from that account. On the
platform account the test's `reference_id` is `cep:<tenant code>:<template>:<version>`. The workspace's default
clients win; without them the platform's defaults apply. The back-office page is Configuration → Mailgun Inspect
(`apps/platform_ops/admin_deliverability.py`, mounted under `MailServerAdmin.get_urls`).

## The allowance

Only tests through the platform's account are limited. The total for a month is
`subscription_plan.max_deliverability_tests_per_month` (NULL = unlimited; STARTER 10, GROWTH 50, ENTERPRISE
unlimited as seeded) plus the month's rows in `tenant_quota_grant` (metric `DELIVERABILITY_TESTS`, not removed).
Added tests belong to their month and end with it. A workspace's own account is counted for information
(Plan & Usage, the back-office) and never refused. A test counts when it is requested, because that is when Mailgun
bills it. The feature flag `deliverability_tests` gates the API with 403; a spent total answers 409 naming the total,
its parts and the date more become available. `GET /deliverability/allowance/` returns `used`, `limit`, `left`,
`plan_limit`, `added`, `account` and `note` (where the number comes from, in words); the Plan & Usage meter carries the
same `note`.

The platform team adds tests on the tenant's page (Deliverability Tests card → Add Tests); an addition can be removed
while its month is open.

## Where things are

- `database/CEP_Database_Schema_Platform_Operations.sql` §18: `deliverability_service` (one per tenant: provider,
  region, username, `api_key_enc`, `default_clients`, `image_blocking`, the last check) and `deliverability_test`
  (template, version, kind PREVIEW | SPAM | PLACEMENT, status PENDING | PROCESSING | COMPLETE | FAILED, `clients`,
  `summary`, `results`, who and when). Both tenant-scoped with RLS. `patches/0030_deliverability_tests.sql` re-runs the layer.
- `backend/apps/delivery/inspect.py`: the Mailgun Inspect client (`/v1/preview/tests/clients`, `POST /v2/preview/tests`,
  `/v1/preview/tests/<id>/results`), basic auth, through the integration bridge's logged session.
- Patch 0039 (§24 of the same file): `deliverability_service.tenant_id` nullable with one platform row at most,
  `deliverability_test.account` (OWN | PLATFORM), `deliverability_test.updated_by` (the touch trigger needed it: before
  0039 every result update failed, so polled results were never saved), and `tenant_quota_grant` (control plane).
- `backend/apps/delivery/deliverability.py`: the accounts, the allowance, the sample render (latest rendered content with
  every tag filled from its sample value and the preheader in place), `start_preview`, and `refresh` (polls Inspect
  when a test is read and the last look is older than 8 s; nothing runs in the background).
- `backend/api/v1/deliverability_api.py`: `GET/PUT/DELETE /deliverability/service/`, `POST …/service/check/`,
  `GET /deliverability/clients/` (cached a day), `GET /deliverability/allowance/`, `GET/POST /templates/<id>/deliverability-tests/`,
  `GET/DELETE /deliverability-tests/<id>/`. The account needs `provider.edit`; tests need `template.edit` and the feature.
- `backend/apps/platform_ops/billing.py`: `tests_this_month(tenant, account=None)`, `added_tests`, the meter in `quota()`, and
  the hourly `rollup_usage`, which stores each month's tests in `tenant_usage` as `DELIVERABILITY_TESTS` (allowed by that
  table's metric check since patch 0040; before it, every rollup failed on this metric). The limit itself is counted live.
- `backend/apps/platform_ops/admin_deliverability.py` and `templates/admin/platform_ops/inspect_account.html`,
  `templates/admin/tenants/deliverability_panel.html`, `deliverability_tests.html`: the back-office pages.
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
- Backend `tests/test_deliverability_platform.py`: the platform account and what the workspace sees of it, a test
  tagged with the tenant code, additions (this month only, removed ones not counted), the 409 and the meter's note,
  results read from the account that ran the test, the clients-only save, the own account (not limited, not counted),
  the back-office pages (save keeps the key, Add Tests, Remove only while the month is open).
- Frontend `DeliverabilityPanel.test.tsx` and the two Deliverability Testing cases in `Delivery.test.tsx`.
