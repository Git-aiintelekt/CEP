# Backend request: Single sign-on and single logout from OFBiz

**From:** Frontend (OFBiz "Open CEP" link)
**Date:** 2026-11-16
**Size:** medium. Three endpoints, one extra claim on issued tokens, one sign-out check in authentication and refresh.
**Status (2026-11-16):** built in the backend at the user's request: `apps/platform_ops/ofbiz.py`, the three views in `api/v1/auth_api.py`, the sign-out check in `api/auth.py`, the keys in the new column `tenant.sso_config`, one iCRM system per workspace (patch `0087_tenant_sso_config.sql`; earlier homes `tenant_ofbiz_link`, patch 0083, and `tenant.settings.ofbiz_sso`, patch 0086, are carried over and removed; values from `database/ofbiz_sso_seed.sql`), tests in `tests/test_ofbiz_sso.py` (not yet run: no backend environment on the build machine).
**Change (2026-11-17), at the user's request:** OFBiz now sends the token of iCRM's existing **`UtilCommon.getSSOToken`** (Multipass, token-app.jar) for both launch (`openCep`) and logout (`notifyCepLogout`), not HS256 JWTs. `secret_enc` holds `{"site_key", "api_key", "time_zone"}`: iCRM TenantProperties `security` / `common.site.key` and `common.api.key`, and the iCRM server's time zone (`cep.sso.secret` is gone). Decoder: `apps/platform_ops/multipass/` (Python port of `TokenDecoder`, `MultipassTokenDecode`, `UtilDecoder`, `isValidToken`). `ofbiz.verify` needs `user_login_id` (→ `sub`) and `email`, and reads `expires` ("yyyy-MM-dd HH:mm", iCRM time, `common.token.expiry.min`, default 5 minutes) with a 30-second leeway. `tenant_id` (`common.site.tenantId`) is not checked: the per-workspace keys tie the token to the workspace. getSSOToken has **no `jti` and no audience**: a link can be reused until it expires, and the same token is accepted by launch and logout (`aud`, `exp`, `jti` are still honoured when present). Endpoints and everything after the check are unchanged. Re-run `database/ofbiz_sso_seed.sql`. Tests: `tests/test_multipass.py` (fixtures from iCRM's jar), `tests/test_ofbiz_sso.py`. The sections below still describe the JWT version.
**Change (2026-11-17), at the user's request: iCRM owns users and roles.** CEP keeps no login details for iCRM users, only the email, name and role.
- iCRM: three security groups `CEP_MARKETING_ADMIN`, `CEP_CAMPAIGN_MANAGER`, `CEP_ANALYST` (campaign seed data). `openCep` sends `UtilCommon.getCepSSOToken`: getSSOToken plus `cep_role` (`MARKETING_ADMIN` / `CAMPAIGN_MANAGER` / `ANALYST`, the highest group the user holds) and `display_name`. A user in none of the groups is refused in iCRM and never reaches CEP. Logout still sends getSSOToken.
- CEP launch (`ofbiz.provision`): no `cep_role` or a role the workspace lacks → login page error. No CEP user with the email → created (`LOCAL`, no password, the token's name). The user's roles are replaced by the one iCRM sent on every launch. A user deactivated in CEP stays out. An email already used in another workspace is refused (`app_user.email` is unique across workspaces). Logout never creates users.
- **Roles (2026-11-20):** nothing is stored. `cep_role` is the CEP role's name in capitals with underscores: `MARKETING_ADMIN` finds the workspace's role named "Marketing Admin" (case ignored; `CAMPAIGN_MANAGER` → "Campaign Manager", `ANALYST` → "Analyst"). iCRM sends only the code. A workspace without a role of that name refuses the user with the login page error. `DEFAULT_ROLES` and the per-workspace `roles` map are gone; one left in `secret_enc` by an earlier seed is ignored.
- Password sign-in is unchanged and independent: an Open CEP launch never looks at a CEP password.
- Tests: `test_ofbiz_launch_creates_the_user_and_sets_the_role` and the role refusals in `tests/test_ofbiz_sso.py` (not yet run: no backend environment on the build machine).

**Design:** `OFBiz_to_CEP_SSO_SLO.docx` (OFBiz to CEP Single Sign-On Link, Nov 15 2026). This page is the CEP backend part of it.

## Why
An OFBiz iCRM user clicks **Open CEP** under Campaign and lands in CEP signed in as the CEP user with the same email, with no login screen. When they sign out of OFBiz, every CEP session that was opened from OFBiz for that user ends.

The OFBiz side is built: it signs an HS256 JWT with a shared secret and redirects the browser, and on logout it POSTs a second JWT server to server. The CEP frontend is built (see "Frontend contract"). Only the API is missing.

## Configuration (in the database, not the environment)
- **`tenant.sso_config`** (new column, patch 0087, 2026-11-19): `{"is_active": true, "secret_enc": "..."}`, one iCRM system per workspace: another system (Citi Staging...) gets its own tenant row (new code) and its own `sso_config`. `secret_enc` holds `{"site_key", "api_key"}` only, inserted as plain text by the seed and encrypted by the API with `FIELD_ENCRYPTION_KEY` the first time it reads it. No other column of `tenant` is written. Empty, or `is_active` false: "Signing in from OFBiz is not set up".
- **Time zone (2026-11-20):** not stored in `sso_config`. iCRM writes `expires` as `yyyy-MM-dd HH:mm` in its server's local time, and CEP reads it in the workspace's own **`tenant.timezone`** column (`America/New_York` for NWA, the same as the iCRM staging server). The two must match, or every link looks expired or too long-lived. A token that carries `exp` (epoch seconds) needs no time zone; iCRM could add it in `UtilCommon.getSSOToken` with `data.put("exp", System.currentTimeMillis() / 1000 + tokenExpiryTime * 60L)`.
- **No address in CEP** (2026-11-20): iCRM sends the browser to its own `cep.url` + `/api/v1/auth/sso/ofbiz/`, and the launch answers with a relative redirect (`/launch`, or `/login` with the error), so the browser stays on that address; nginx and the Vite dev server serve the app beside `/api`. `sso_config` holds no `frontend_url` (a save from the Integrations screen removes one left by an earlier seed).
- **Settings → Integrations → Sign-On from OFBiz iCRM** (2026-11-20): `GET/PUT /workspace/ofbiz-sso/` (`provider.edit`) for the signed-in workspace (`tenant.code`). Site Key (iCRM `security` / `common.site.key`) and API Key (iCRM `cep` / `cep.api.key`, not `common.api.key`), both required and both shown (the API key masked, with Show / Hide). Nothing else is stored; `is_active` stays as it was.
- **`platform.frontend_url`** (global parameter, back-office → Parameters, unchanged): where OpenID Connect single sign-on lands (`/sso/complete`, `/login`). Links in emails use the `FRONTEND_URL` environment variable. Empty = the `FRONTEND_URL` environment variable.
- **`REDIS_URL`** stays in the environment: the cache is connected before the database is read, and every worker must share it for logout and one-use links.
- Set up: `database/apply_patch.sh` with 0083, 0086 and 0087 (0087 before deploying the code: the `Tenant` model reads `sso_config`), then fill in and run `database/ofbiz_sso_seed.sql` for the workspace code.

## Tokens OFBiz sends
Both are HS256, `iss = "ofbiz-icrm"`, valid for 60 seconds, with a random `jti` that must be single-use (shared Redis cache, 120 s).

| Claim | Launch token | Logout token |
|---|---|---|
| `aud` | `cep` | `cep-logout` |
| `sub` | OFBiz userLoginId (audit only) | same |
| `party_id` | OFBiz partyId (audit only) | same |
| `email` | primary email, trimmed, lower case | same |
| `tenant` | CEP workspace code, must equal `?tenant=` | same |
| `next` | `/campaigns` | n/a |

## 1. `GET /api/v1/auth/sso/ofbiz/?tenant=NWA&token=<jwt>`
Public and throttled like login. It sits under `/api/v1/auth/sso/`, so the tenant resolver already reads `?tenant=`.

1. `jwt.decode(..., algorithms=["HS256"], audience="cep", issuer="ofbiz-icrm", leeway=30, options={"require": ["exp","iat","jti","sub","party_id","email","tenant"]})`.
2. Reject if `tenant` ≠ the resolved workspace, or if the `jti` was already used (`cache.add`).
3. Find the user: `email__iexact`, active, not deleted, **in this workspace** (please apply the AppUser workspace filter). Never create an account.
4. `issue_tokens(user, claims={"ofbiz": int(time.time())}, refresh_lifetime=timedelta(hours=8))` with **no `mfa_setup`** (no MFA code and no forced enrolment: OFBiz has already signed the user in), then hand off through `sso.hand_off(...)` exactly as OpenID Connect sign-in does, with `next` from the token (default `/campaigns`) and no binding.
5. Redirect to `/launch#code=<code>&tenant=<code>`.

On any failure, redirect to `/login#sso_error=<message>` (the login page already shows `sso_error` from the fragment):
- bad, expired or tampered token: "This link is invalid or has expired. Open CEP again from OFBiz."
- reused `jti`: "This link was already used. Open CEP again from OFBiz."
- no matching user: "No active CEP account in this workspace uses <email>. Ask your administrator."

Log `user.pk`, `sub`, `party_id` and the workspace on success.

Please consider turning off query-string logging for this path in Nginx, since the token is in the URL.

## 2. `POST /api/v1/auth/sso/ofbiz/exchange/` `{code}` → `{access, refresh, next}`
The same as `SsoExchangeView`, but without the browser binding, because the sign-in did not start in a CEP tab. The code stays one-use and short-lived. A wrong or used code returns 401 problem+json.

## 3. Single logout
- **`issue_tokens(user, *, mfa_setup=False, claims=None, refresh_lifetime=None)`:** puts the extra claims on the refresh token and, when given, sets its lifetime (`refresh.set_exp(lifetime=...)`). simplejwt copies them into every access token and keeps them on rotation, as it already does for `mfa_setup`.
- **`POST /api/v1/auth/sso/ofbiz/logout/?tenant=NWA` `{"token": "<logout jwt>"}`:**
  - Server to server, with no throttle; the signed token is the guard.
  - Verify the token with `audience="cep-logout"`, the tenant and a single-use `jti`. A bad token returns 401.
  - Find the user by email with the same rules as sign-in.
  - Set `cep:ofbiz:logout:<user id> = now` in the shared Redis cache, for the OFBiz refresh-token lifetime (8 hours).
  - Always answer **204**, whether or not a user matched, so the endpoint cannot be used to discover accounts.
- **Sign-out check** in `CepJWTAuthentication.authenticate` (every request) and `RefreshSerializer.validate` (every refresh):
  - If the token has an `ofbiz` claim and that launch time is at or before the user's cutoff, raise `OfbizSignedOut`.
  - That is a 401 whose problem+json **title is exactly `Ofbiz Signed Out`**, with detail "You signed out of OFBiz. Open CEP again from OFBiz."
  - Tokens without the claim (password and OpenID Connect sign-ins) are never affected.

The cache must be the shared Redis cache, never per-process memory.

## Frontend contract (already built)
- `/launch#code=..&tenant=..` exchanges the code at `/auth/sso/ofbiz/exchange/`, stores the tokens and opens `next` (same-site paths only, default `/campaigns`).
- A 401 titled `Ofbiz Signed Out`, on any call or on refresh, is not retried with a refresh. The workspace's tokens are cleared and the login page shows "You signed out of OFBiz. Open CEP again from OFBiz to continue."
- Tabs whose session came from OFBiz re-check `GET /me/` on focus and every 60 seconds, so an idle tab closes within a minute.

## Decided
- **Refresh lifetime (2026-11-16):** sessions opened from OFBiz get an **8-hour** refresh token, not 7 days. The 8 hours run from the launch: on rotation, simplejwt resets `exp` to the default lifetime, so `RefreshSerializer` must cap tokens carrying `ofbiz` at `ofbiz + 8 h`. If CEP misses OFBiz's logout call, the session still ends within 8 hours. The OFBiz logout cutoff (`cep:ofbiz:logout:<user id>`) can then be kept for 8 hours instead of 7 days.
- **OFBiz menu:** the iCRM menu entry is under component `COMP_1001 - CEP`.
- **MFA (2026-11-16):** OFBiz launches skip CEP MFA and trust the OFBiz login. Sign-in never asks for a code, and the tokens never carry `mfa_setup`, even in a workspace that requires MFA or for a user who has not enrolled. `GET /me/` then returns `mfa_setup_required: false`, so the frontend does not send them to enrolment. Password and OpenID Connect sign-ins keep their MFA rules unchanged.
- **Marketing Admin, not Workspace Admin (2026-11-18, done):** iCRM's admin group is `CEP_MARKETING_ADMIN` ("CEP Marketing Admin") and sends `cep_role` `MARKETING_ADMIN`; iCRM has no `CEP_WORKSPACE_ADMIN`. `DEFAULT_ROLES` maps `MARKETING_ADMIN` to "Marketing Admin", and a workspace link's `roles` now adds to `DEFAULT_ROLES` instead of replacing them, so a link seeded before this change still opens Marketing Admins. The workspace must have a role named "Marketing Admin" (NWA does; a workspace on CEP's default names has "Workspace Admin" and needs one added or renamed).
