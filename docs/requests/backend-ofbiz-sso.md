# Backend request: Single sign-on and single logout from OFBiz

**From:** Frontend (OFBiz "Open CEP" link)
**Date:** 2026-11-16
**Size:** medium. Three endpoints, one extra claim on issued tokens, one sign-out check in authentication and refresh.
**Status (2026-11-16):** built in the backend at the user's request: `apps/platform_ops/ofbiz.py`, the three views in `api/v1/auth_api.py`, the sign-out check in `api/auth.py`, the secret in table `tenant_ofbiz_link` (patch `0083_ofbiz_sso.sql`, values from `database/ofbiz_sso_seed.sql`), tests in `tests/test_ofbiz_sso.py` (not yet run: no backend environment on the build machine).
**Design:** `OFBiz_to_CEP_SSO_SLO.docx` (OFBiz to CEP Single Sign-On Link, Nov 15 2026). This page is the CEP backend part of it.

## Why
An OFBiz iCRM user clicks **Open CEP** under Campaign and lands in CEP signed in as the CEP user with the same email, with no login screen. When they sign out of OFBiz, every CEP session that was opened from OFBiz for that user ends.

The OFBiz side is built: it signs an HS256 JWT with a shared secret and redirects the browser, and on logout it POSTs a second JWT server to server. The CEP frontend is built (see "Frontend contract"). Only the API is missing.

## Configuration (in the database, not the environment)
- **`tenant_ofbiz_link`**, one row per workspace: `secret_enc` is the same value as OFBiz TenantProperties `cep.sso.secret` (32+ characters, never in Git, different per environment), `is_active` switches "Open CEP" on or off. Row-level security, like `tenant_identity_provider`. The seed inserts the secret as plain text; the API encrypts it with `FIELD_ENCRYPTION_KEY` the first time it reads it. No row, or `is_active = false`: "Signing in from OFBiz is not set up".
- **`platform.frontend_url`** (global parameter, back-office → Parameters): where CEP sends the browser after checking the link (`<frontend_url>/launch`), and the base of every app link in emails. Empty = the `FRONTEND_URL` environment variable.
- **`REDIS_URL`** stays in the environment: the cache is connected before the database is read, and every worker must share it for logout and one-use links.
- Set up: `database/apply_patch.sh 0083_ofbiz_sso.sql`, then fill in and run `database/ofbiz_sso_seed.sql`.

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
