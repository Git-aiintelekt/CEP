# Security

**Where:** Settings → General → Security.

## What this page is for

How people sign in to the workspace: whether everyone must use multi-factor authentication, single sign-on through your identity provider, and the record of every time platform support or a platform administrator acted inside the workspace.

## Who can use it

| | |
|---|---|
| Permission | `user.admin`. A support session can never open or change this page. |
| Features | Single sign-on needs the **sso** feature. Without it the section reads *Single sign-on is not part of this workspace's plan. Contact us to add it.* |

## The fields and controls

### Multi-Factor Authentication

| Control | What it is | What it changes |
|---|---|---|
| Require for Everyone | A switch, saved as soon as you change it. Default off. | On: everyone signs in with a code from an authenticator app. People who have not set it up are asked to on their next sign-in, before anything else, and nobody can turn their own off. Single sign-on users are covered by the identity provider. Refused until you have set it up yourself: *Set up multi-factor authentication on your own account first, so you are not locked out.*, with a Set It Up Now link to Account Security. Off: people who use it keep it, and may now turn their own off. |

### Single Sign-On (OpenID Connect)

| Control | What it is | What it changes |
|---|---|---|
| Set Up Single Sign-On | Shown until single sign-on has been saved once. Opens the form. | Nothing is saved until Save Single Sign-On. |
| Redirect URI to Register with Your Identity Provider | The address the provider sends people back to after they sign in, with a Copy button (it reads *Copied*). | Nothing here; register it on the application at your provider. Identity providers refuse to send people back to an address that is not registered, so sign-ins fail until it is. |
| Name on the Sign-In Button | Required. For example Okta, Microsoft, Google Workspace. | The button on the sign-in page, and the name in *This workspace signs in with {name}.* when a password sign-in is refused. |
| Issuer | Required. The https address of your OpenID Connect provider. | Where sign-ins go. When Use Single Sign-On is on, the provider's settings are fetched on save, so a wrong address is refused at once instead of at someone's first sign-in. An address that does not start with https:// is refused. |
| Client ID | Required. From the application registered at the provider. | Identifies C360 to the provider. A wrong one makes the provider refuse every sign-in. |
| Client Secret | From the same application. Stored encrypted and never shown again; *A secret is stored. Leave this empty to keep it.* | Proves to the provider that the sign-in comes from C360. Typing a new one replaces the stored one; leaving it empty keeps it. A wrong secret makes sign-ins fail on the way back from the provider. |
| Allowed Email Domains | Optional. Domains separated by commas or spaces, for example `example.com`. Something that is not a domain is refused: *Not a domain: …* | Only addresses on these domains may sign in through the provider, whatever the provider vouches for; anyone else sees *Your email domain is not allowed to sign in to this workspace.* Empty lets in any address the provider vouches for. |
| Role for New Accounts | A role of the workspace, or No Role (default). | The role an account created on first sign-in gets. Required while Create Accounts on First Sign-In is on: *Choose the role new users get when accounts are created on first sign-in.* |
| Use Single Sign-On | Default on. | On: the sign-in page shows the button, and people can sign in through the provider. Off: the button goes, sign-ins through the provider stop, and Require Single Sign-On cannot be on. The settings are kept. While it is off, its users get a **Password Link** under Users like everyone else; one who chooses a password signs in with it from then on. |
| Create Accounts on First Sign-In | Default off. | On: someone the provider vouches for who has no account yet gets one at their first sign-in, with the provider's name and email and the Role for New Accounts. Off: only people added under Users can sign in; anyone else sees *You do not have an account in this workspace yet. Ask your administrator to add you.* |
| Require Single Sign-On | Default off. | On: a password sign-in is refused for everyone without `user.admin`, with *This workspace signs in with {name}.* Administrators keep their password for the day the provider is unreachable. Refused while Use Single Sign-On is off: *Switch single sign-on on before requiring it.* |
| Save Single Sign-On | Saves the form; *Saved* confirms it. | Everything above takes effect for the next sign-in. Refused, with the reason under the field, when a required field is empty, the issuer cannot be reached or a rule above is broken. |
| Remove | Shown once single sign-on is saved. Asks *Remove single sign-on? People who only sign in through it will need a password link.* | Deletes the settings: the button leaves the sign-in page and nobody can sign in through the provider. Everyone who signed in through it becomes a password user: send each a link from Users → Password Link, since people who never had a password here cannot sign in until they choose one. |

### Support Access

| Column | What it is |
|---|---|
| When, Support Person, Acted As, Reason, Access, Ended | The last 100 support sessions platform staff opened into this workspace, acting as one of its users: who, as whom (name and email), why, whether it was **Read-Only** or **Could change data** (with how many changes), and when it ended, or **Open Now**. |

Nothing here can be changed; the table is the record. A support session can never manage users, roles, API keys or these settings.

### Platform Visits

| Column | What it is |
|---|---|
| Who, From, Until, Reason, Changes | Every time a platform administrator entered this workspace as themselves (Switch Workspace), with their reason, when the visit ended (or **In the Workspace Now**) and how many changes they made. |

Nothing here can be changed; the table is the record.

## How to

**Require a second step for everyone.** Set up your own under Account Security first (the account menu), then switch Require for Everyone on. From the next sign-in everyone without it is walked through the set-up.

**Sign in with your company's identity provider.** Set Up Single Sign-On → Copy the redirect URI and register C360 as an application at the provider with it → paste the issuer, client ID and secret, add your domain, choose the role new accounts get, leave Use Single Sign-On on → Save Single Sign-On. Try it from another browser before you switch Require Single Sign-On on.

## What happens behind the scenes

The issuer's configuration is fetched when you save, so a wrong address is refused at once. A sign-in through the provider matches the account by email, within the allowed domains; an account that had a password becomes a single sign-on account at its first sign-in through the provider. The provider owns the second step for those accounts: C360 does not ask for its own code. A support session is recorded with who, as whom, why, read-only or not, and when it ended; a banner shows while one is open.

## Things to know

- Keep one administrator with a password while single sign-on is required: it is the way in when the provider is down.
- Multi-factor authentication for yourself is under the account menu → Account Security; this page only sets the rule for the workspace.
- Single sign-on accounts have no Password Link under Users, and removing single sign-on does not change that.
- The **Terms of Use** every page's footer and the sign-in page link to are the platform's, kept by the platform team; the footer's copyright year is always the current year.
