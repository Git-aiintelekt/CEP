# Email Server

**Where:** Settings → Sending → Email Server.

## What this page is for

The workspace's own SMTP server. It carries the messages the platform sends to your people (password links, notifications, the weekly report), and, if you offer it, your campaigns. Campaign email otherwise goes through the sending engines. Until a server is entered, the platform's own server carries the platform's messages with the platform's From address.

## Who can use it

| | |
|---|---|
| Permission | `user.admin`. |

## The fields and controls

| Field | What it is | What it changes |
|---|---|---|
| Outgoing Email | The status line: the platform's server until you enter your own; *no mail server* when the platform has none either, and password links then have to be copied and sent by hand. | |
| Server, Port, Security | The host (for example smtp.office365.com), the port, and none, STARTTLS or SSL. | Where every message goes. |
| Username, Password | Often the full email address; empty for a server that needs no sign-in. The password is stored encrypted and never shown again; empty keeps the stored one. Many providers want an app password rather than the account's. | |
| From Address, From Name, Reply-To Address | What your people see; the address must be one the server is allowed to send as. | The From line on password links, notifications and, when offered, campaigns. |
| Offer as a Campaign Sender | Adds this server as a sending engine (SMTP) with a sender made from the From address. | Campaigns can pick that sender; the engine reports no callbacks (bounces arrive as mail at the From address). |
| Send a Test Message | To an address you type, with the saved settings. | Verifies the campaign sender when one was offered. |
| Remove | Forgets the server. | The platform's server takes over the platform's messages; the SMTP engine and its sender go. |

## How to

**Use your Microsoft 365 or Google Workspace account.** Server, port 587, STARTTLS, the mailbox's address and an app password, the From address the mailbox owns → Save → Send a Test Message to yourself.

**Send small campaigns through it.** Tick Offer as a Campaign Sender → Save → Send a Test Message, which verifies the sender. The engine appears under Sending Engines, read-only there; the sender appears in a campaign's Send From.

## What happens behind the scenes

Each message opens one connection to the server; a batch of campaign mail reuses it. A recipient the server refuses outright fails; a temporary refusal is retried. Nothing from your server is ever carried through the platform's.

## Things to know

- Mailbox providers rate-limit SMTP; for volume, a sending engine (Postal, SendGrid) is the right tool, and this server is for the platform's own messages.
- The password is write-only: to replace it, type the new one; to keep it, leave the field empty.
