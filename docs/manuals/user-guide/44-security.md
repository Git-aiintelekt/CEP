# Security

**Where:** Settings → Workspace → Security.

## What this page is for

How people sign in to the workspace: whether everyone must use multi-factor authentication, single sign-on through your identity provider, and the record of every time platform support acted inside the workspace.

## Who can use it

| | |
|---|---|
| Permission | `user.admin`. |
| Features | Single sign-on needs the **sso** feature. |

## The fields and controls

### Multi-Factor Authentication

| Control | What it is | What it changes |
|---|---|---|
| Require for Everyone | Everyone signs in with a code from an authenticator app. | People who have not set it up are asked to on their next sign-in, before anything else; nobody can turn their own off while it is required. Single sign-on users are covered by the identity provider. Refused until you have set it up yourself. |

### Single Sign-On (OpenID Connect)

| Field | What it is | What it changes |
|---|---|---|
| Name on the Sign-In Button | For example Okta, Microsoft, Google Workspace. | The button on the sign-in page. |
| Issuer | The https address of your OpenID Connect provider. Checked when you save. | Where sign-ins go. |
| Client ID, Client Secret | From the application registered at the provider. The secret is stored encrypted and never shown again; leave it empty to keep it. | |
| Allowed Email Domains | Only addresses on these domains may sign in; empty means any address the provider vouches for. | |
| Role for New Accounts | The role an account created on first sign-in gets. | Needed when accounts are created on first sign-in. |
| Use Single Sign-On | Shows the button. | |
| Create Accounts on First Sign-In | Otherwise only people added under Users can sign in. | |
| Require Single Sign-On | Passwords stop working for everyone except administrators, who keep theirs for the day the provider is unreachable. | |

### Support Access

| Column | What it is |
|---|---|
| When, Support Person, Acted As, Reason, Access (read-only or could change), Ended | Every support session platform staff opened into this workspace, acting as one of its users, with when it ended or that it is open now. |

## How to

**Require a second step for everyone.** Set up your own under Account Security first (the account menu), then switch Require for Everyone on. From the next sign-in everyone without it is walked through the set-up.

**Sign in with your company's identity provider.** Register CEP as an application at the provider, paste the issuer, client id and secret, add your domain, choose the role new accounts get, switch Use Single Sign-On on and try it from another browser before you Require it.

## What happens behind the scenes

The issuer's configuration is fetched when you save, so a wrong address is refused at once. A sign-in through the provider creates or matches the account by email, within the allowed domains. A support session is recorded with who, as whom, why, read-only or not, and when it ended; a banner shows while one is open.

## Things to know

- Keep one administrator with a password while single sign-on is required: it is the way in when the provider is down.
- Multi-factor authentication for yourself is under the account menu → Account Security; this page only sets the rule for the workspace.
- The **Terms of Use** every page's footer and the sign-in page link to are the platform's, kept by the platform team; the footer's copyright year is always the current year.
