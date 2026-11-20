# Email Server

**Where:** Settings → Engagement → Email Server.

## What this page is for

The workspace's own SMTP server. It carries the messages the platform sends to your people (password links, notifications, the weekly report), and, if you offer it, your campaigns. Campaign email otherwise goes through the sending engines. Until a server is entered, the platform's own server carries the platform's messages with the platform's From address.

## Who can use it

| | |
|---|---|
| Permission | `user.admin`. |

## The fields and controls

### Outgoing Email

| Control | What it is | What it changes |
|---|---|---|
| The status line | Which server carries this workspace's messages now: *Messages for this workspace go out through your own server*, the platform's server until you enter your own, or *No mail server is available: password links have to be copied and sent by hand.* | Nothing; it tells you where password links and notifications come from today. |

### Your SMTP Server

| Field | What it is | What it changes |
|---|---|---|
| Server | Required. The host name only, for example smtp.office365.com. A name with a port, `smtp://` or a slash in it is refused with what to type instead. | Where every message is handed over. |
| Port | Required, 1 to 65535. Default 587. | The port the connection opens on. Port 587 with SSL/TLS, or 465 with STARTTLS, is refused: *Port 587 goes with STARTTLS and port 465 with SSL/TLS.* |
| Security | STARTTLS (587), the default; SSL/TLS (465); or None. | How the connection is encrypted. It must match what the server expects, or the test fails. |
| Username | Often the full email address; empty for a server that needs no sign-in. | The account the server signs C360 in as. A wrong one makes every message, and the test, fail. |
| Password | Stored encrypted and never shown again; *A password is stored. Leave this empty to keep it.* Many providers want an app password rather than the account's. | Typing one replaces the stored password; empty keeps it. A wrong one makes every message fail until it is corrected. |

### Sender

| Field | What it is | What it changes |
|---|---|---|
| From Address | Required. An address the server is allowed to send as. | The From line on password links, notifications and, when offered, campaigns. An address the server may not send as makes the server refuse the messages. |
| From Name | Optional, for example Northwind Apparel. | The name shown next to the address. Also the name of the campaign sender when the server is offered to campaigns. |
| Reply-To Address | Optional. | Where replies go when not to the From address, for platform messages and the campaign sender alike. |
| In Use | Default on. | Off: the settings are kept but not used. Platform messages fall back to the platform's server, and the campaign sender and its engine are taken away until you switch it back on. |

### Campaigns

| Control | What it is | What it changes |
|---|---|---|
| Offer as a Campaign Sender | Default off. | On, after Save: adds a sending engine named *Workspace mail server* (SMTP, read-only under Sending Engines) and a sender made from the From name and address, which campaigns can pick in Send From. If the workspace has no default engine or email sender yet, these become the defaults. The engine reports no delivery results; bounces arrive as mail at the From address. Off: the engine and sender are taken away; campaigns that used them keep their history. |
| The sender's status | **Verified Sender** or **Sender Not Verified Yet**, with its name and address, and *default email sender* when it is. | A sender not verified yet cannot be used to publish to production. It becomes verified when a test message goes through, and goes back to not verified if a later test fails. |

### Buttons

| Control | What it is | What it changes |
|---|---|---|
| Save | Saves the form; *Saved* confirms it. | From the next message, everything above takes effect, and the campaign sender is brought in line with it. |
| Remove | Shown once a server is saved. Asks *Remove your mail server? Platform messages will fall back to the platform's server, and campaigns can no longer use it.* | Forgets the server. The platform's server takes over the platform's messages; the SMTP engine and its sender go. |

### Send a Test Message

Shown once a server is saved. It uses the saved settings, so save first if you changed anything.

| Control | What it is | What it changes |
|---|---|---|
| To | Required. Your own address by default. | Where the test message goes. |
| Send Test | Sends one message through the saved server, even while In Use is off. | Records the result. When the server is offered to campaigns, a passed test verifies the sender; a failed one leaves it, or puts it back, not verified. |
| Last Test Passed / Last Test Failed | The latest result, with when; a failure shows the server's error below. | Nothing; it tells you whether the settings work. |

## How to

**Use your Microsoft 365 or Google Workspace account.** Server, port 587, STARTTLS, the mailbox's address and an app password, the From address the mailbox owns → Save → Send Test to yourself.

**Send small campaigns through it.** Tick Offer as a Campaign Sender → Save → Send Test, which verifies the sender. The engine appears under Sending Engines, read-only there; the sender appears in a campaign's Send From.

**Pause your server without losing the settings.** Untick In Use → Save. Platform messages go through the platform's server until you tick it again.

## What happens behind the scenes

Each message opens one connection to the server; a batch of campaign mail reuses it. A recipient the server refuses outright fails; a temporary refusal is retried. Nothing from your server is ever carried through the platform's. A message that fails to send never fails the work it reports on: a password link can still be copied.

## Things to know

- Mailbox providers rate-limit SMTP; for volume, a sending engine (Postal, SendGrid) is the right tool, and this server is for the platform's own messages.
- The password is write-only: to replace it, type the new one; to keep it, leave the field empty.
