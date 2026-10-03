# The Platform's Mail Server

**Where:** Configuration → Mail server.

## What this is for

The SMTP server the platform's own mail goes out from: password links, alerts, support-access notices, and the fallback for a tenant that has no working mail server of its own. It is never a campaign engine: campaigns and e-receipts go through the tenant's own server or its sending engines.

## Who can use it

Platform administrators.

## The fields and controls

| Field | What it is | What it changes |
|---|---|---|
| Owner | The platform, or the tenant whose own server this is (tenants enter theirs in the app; they are listed here read-only). | |
| Host, Port, Security | The server, the port, none or STARTTLS or SSL. | |
| Username, Password | The password is stored encrypted and never shown; empty keeps the stored one. | |
| From address, From name, Reply-to | What people see on the platform's mail. | |
| Active | Whether the server is used. | |
| Send a test message to me | On the server's page: a message to your own address; the result is kept as the last test. | |

## How to

**Set it up.** Add the platform's server → Save → Send a test message to me. From then on password links are emailed instead of shown to copy.

**A tenant's links are not arriving.** Mail server → the tenant's own server, if any: its last test. A failed or missing server of theirs falls back to the platform's; a missing platform server means the link is shown in the flow to copy by hand.

## What happens behind the scenes

Where a message goes out from is resolved per message, first match wins: the tenant's own server when the message is for one of its users, then the platform's server, then SMTP from the environment, then the server log in development so nothing is ever silently lost.

## Things to know

- The platform's server carries only the platform's mail; a tenant cannot pick it as a campaign sender.
- The home page's Email check reads this server's last test.
