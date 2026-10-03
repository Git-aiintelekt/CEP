# Single Sign-On

**Where:** People and access → Single sign-on.

## What this is for

The identity providers workspaces sign in through, one per tenant, as the workspace's administrator entered them under Settings → Security. The back-office lists them for support and can switch one off; the details are the tenant's to change in the app.

## Who can use it

Staff read; platform administrators change what is editable.

## The fields and controls

| Field | What it is | What it changes |
|---|---|---|
| Tenant, Name on the button, Issuer, Client id, Scopes, Allowed email domains, Create accounts on first sign-in, Role for new accounts | As the tenant entered them; read-only here. | |
| Active, Require single sign-on | Whether the button shows and whether passwords are refused for everyone but administrators. | Switching Require off here is the way back in when a provider broke and no administrator kept a password. |

## How to

**A workspace locked itself out.** The provider is down and the workspace requires single sign-on: open the row → Require single sign-on → off → Save. Their administrators' passwords work again; they can also use Create password link on the user.

## What happens behind the scenes

The feature **sso** must be on for the workspace; the sign-in page asks the API what the workspace offers and shows the button when a provider is active. Accounts created on first sign-in get the role the provider's row names.

## Things to know

- The client secret is stored encrypted and never shown anywhere; a new one is entered in the app.
