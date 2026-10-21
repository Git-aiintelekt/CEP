# Sending Engines and Senders

**Where:** Settings → Sending → Sending Engines.

## What this page is for

Nothing leaves C360 without an engine. An engine is the service that actually delivers your messages: a Postal or SendGrid account for email, Digivize for texts, your own mail server, or the Sandbox that sends nothing while you try things out. A sender is the name and address (or the number) your messages come from, on one of those engines. This page is where both are added, checked and kept healthy, and where the engine is told how to report deliveries back to C360.

A campaign picks a sender when it is set up; the sender decides the engine. Until a workspace has a checked email engine and a verified sender, test sends work but nothing can be published to production.

## Who can use it

| | |
|---|---|
| Permission | `provider.edit`. Without it the page says so and names the permission to ask for. Settings as a whole needs `user.admin`. |
| Features | Email engines are always offered. Text engines (Digivize, Sandbox) need the **sms** feature; MMS needs **mms** as well. The platform team switches features on per workspace. |

## The fields and controls

### The engines table

| Control | What it is | What it changes |
|---|---|---|
| Provider | The engine's name, its channel tag (Email or Texts) and **Default** when it is the one new senders are offered first. Under it, the engine type and its address, and *separate key for receipts* when a second credential is stored. | Nothing by itself; it is the row's identity. |
| Health | What C360 found when it last checked the engine (every 10 minutes): **Healthy**, **Attention**, **Failing**, **Quiet** (nothing sent in the last day, so nothing to judge) or **No Receipts Yet** (a text engine that has never sent a delivery receipt). Under the tag, the reason in one line, or when it was checked; **See Health** opens the checks. Before the first check the column shows the engine's last Check: **Not Checked Yet**, **Checked** with the date and time, or **Check Failed**. **Switched Off** when *In Use* is unticked. | Nothing by itself: it tells you what to fix. The platform team is alerted when an engine is Failing or needs attention. Set-Up counts an email engine as done only when its Check passed. A switched-off engine is skipped by every send. |
| Callbacks | **Copy Webhook URL** copies the engine's callback address, the address the provider must post delivery results to. **Rotate Address** makes a fresh address and retires the old one at once. Under them: when the last callback arrived and how many came in the last 24 hours, or a warning that none ever has. | Without a registered callback address C360 sends but never learns what happened: no delivered, bounced, opened or clicked counts, and bounced addresses are not blocked. Rotating means registering the new address with the provider again. |
| Check | Asks the provider to confirm the address and the credential without sending anything. With two keys on a Postal engine it checks both and names the one refused. C360 also runs it on every engine once a day. | Records the result with the provider's own words, and the engine's Health follows at once: a fixed key clears *Key refused*. |
| Edit | Opens the engine's form. | |
| Remove | Deletes the engine after a confirmation. | Its senders are removed with it. A campaign that used one of them has to be given another sender before it can publish. |
| Add Engine | Opens the form for a new engine. | |

### Engine Health

**See Health** opens a panel with the checks of one engine, each with its figure, what it means and the line it is judged against. The platform team sets the lines; they apply to every workspace.

| Check | What it looks at | When it is a problem |
|---|---|---|
| Callbacks | When the engine last called back with news of a message. | **Failing** when messages went out but the engine has not called back for an hour. Usually the callback address is no longer registered with the provider, or its webhook was switched off. |
| Refused Calls, 1 h | The share of the last hour's calls to the engine that were refused or failed. | **Failing** at once when the key is refused (the engine answered 401 or 403) or when calls are paused after too many failures in a row. **Attention** above 1% of calls. |
| API Speed, 1 h | How long the engine takes to answer: 95% of calls were answered faster than the figure. | **Attention** above 5 seconds. A slow engine slows every run. |
| Bounces · Complaints, 24 h (email) | Hard bounces and spam complaints among the last day's email. | **Attention** above 2% hard bounces or 0.1% complaints, **Failing** at twice either. Look for a list with old or bought addresses. |
| Failed Texts, 24 h (texts) | Texts the carrier reported as failed, among the last day's delivery receipts. | **Attention** above 5%, **Failing** at twice it. |
| Receipts (texts) | Texts that have had no delivery receipt 15 minutes after they were sent. | **Attention** when more than 1% of the last two hours' texts are still waiting. |
| Daily Check | The engine's last Check: key and address, nothing sent. | **Failing** when it failed. |

A rate is judged only from 50 messages or calls in its window, so a few test sends never raise it: below that the check reads Quiet and shows the counts (*1 of 1*) instead of a share. A text engine that has never sent a receipt shows **No Receipts Yet** instead of a Callbacks and a Receipts problem: Digivize, for example, accepts texts but does not post delivery receipts yet, so its texts read Sent, not Delivered. This clears by itself with the first receipt.

### The engine form (Add Engine, Edit)

| Field | What it is | What it changes |
|---|---|---|
| Engine | The engine type: *Email · Postal*, *Email · SendGrid*, *Texts · Digivize*, *Texts · Sandbox (sends nothing)*. The type is fixed once saved. *Email · SMTP (your mail server)* is not offered here: it is switched on from Settings → Email Server with *Offer this server as a campaign sender*. | Decides which fields follow, whether the engine reports callbacks, and the channel its senders belong to. |
| Name | How the engine is listed in this workspace, for example *Postal (marketing)* or *Texts (short code 55123)*. | Shown on every sender and in Set-Up. |
| The engine's own fields | What the type needs to connect. They are listed per type below. A field marked as a key or secret is write-only: once saved it is never shown again, and the form says *stored*; leave it empty to keep it, type a new one to replace it. | The credential and address C360 uses on every send. |
| Messages per Minute | An optional pace. Empty means as fast as the provider accepts. | Spreads a run over time. Use it when the provider has a rate limit or when a slow ramp is wanted for a new sending domain. |
| Default Engine for Email / Texts | One engine per channel is the default. | The one offered first when a sender is added. It does not change existing senders. |
| In Use | Whether the engine may send. | Unticked: State reads Switched Off and every send that would use it fails at once with that reason. Tick it again to resume. |

### Fields per engine type

**Postal**

| Field | What it is | What it changes |
|---|---|---|
| Postal Address | The base address of your Postal installation, for example `https://postal.example.com`. | Where every send and every Check goes. |
| Server API Key | Postal → your mail server → Credentials → type API. | Carries campaigns, and everything else until a transactional key is set. |
| Transactional Server API Key | Optional. The API key of a second Postal mail server. | Receipts and other transactional email go through that server in their own lane, so they never queue behind a campaign, and each server keeps its own sending reputation. Both servers post to the same callback address. *Remove* drops it. |
| Webhook Public Key | Optional. The PEM public key of the Postal installation. | Callbacks are then checked against Postal's signature as well as the address's own token. |

**SendGrid**

| Field | What it is | What it changes |
|---|---|---|
| API Key | SendGrid → Settings → API keys. It needs the *Mail Send* permission. | Used on every send and Check. |
| API Address | Optional. Empty means the global region; EU subusers use `https://api.eu.sendgrid.com`. | Where the calls go. |
| Event Webhook Verification Key | Optional. SendGrid → Mail settings → Event Webhook → Signed Event Webhook. | Callbacks are then verified against SendGrid's signature. |

**Digivize (texts)**

| Field | What it is | What it changes |
|---|---|---|
| API Address | Optional. Empty means Digivize's standard address; the sandbox has its own. | Where every send goes. |
| Batch Send Path | Optional. The path of the batch request, when Digivize gives one that differs from the standard. | Used in batch send mode. |
| API Key | Digivize's `api_key`. | Travels with every call. |
| Secret Key | Digivize's `secret_key`. Write-only. | Signs every call; a wrong key fails Check. |
| Brand ID | The brand's number at Digivize, for example `3`. A name is refused. | Every text is sent under this brand. |
| Send Mode | `single` (the default): one request per text. `batch`: one request per identical text with a list of recipients, once Digivize provides the batch route. | How a run's messages are grouped. |
| Message Type | `marketing` (the default) or `transactional`. | Digivize applies its own rules per type; a marketing text without a STOP line is refused by Digivize. |
| Callback Address to Send | Optional. Paste this engine's own callback address (Copy Webhook URL). | Digivize is asked to post delivery results there with every send. |
| Webhook Secret | Optional. The secret given to Digivize for the callback. | Results are then verified; empty, the address's own token is the check. |

**Sandbox (sends nothing)**

| Field | What it is | What it changes |
|---|---|---|
| Numbers to Refuse | Comma-separated numbers. | Sending to them fails for good, as an invalid number would: for rehearsing failures. |
| Numbers that Fail Temporarily | Comma-separated numbers. | Sending to them asks for a retry, as a busy aggregator would. |

The Sandbox accepts every text and sends none, and is not metered against the plan. Use it to try text campaigns before an aggregator is connected.

### The senders table

| Control | What it is | What it changes |
|---|---|---|
| Sender | The display name, the channel tag and **Default** when it is the one a new campaign is offered first. Under it, the address or the number and the engine it sends through. | The From line (email) or the number (texts) on every message of a campaign that uses it. |
| Status | **Not Verified Yet**, **Verified**, or **Verification Failed**. | Only a verified sender can publish to production. Test sends work from any sender. |
| Verify / Verify Again | Email: sends a real message from the address to your own sign-in email. Texts: asks for a mobile number (with the country code) and sends it a text. Accepted by the engine = Verified. | Sets the status. |
| Edit | Opens the sender's form. | |
| Remove | Deletes the sender after a confirmation. | A campaign that used it needs another sender before it can publish. |
| Add Sender | Opens the form for a new sender; needs an engine first. | |

### The sender form (Add Sender, Edit)

| Field | What it is | What it changes |
|---|---|---|
| Sends Through | The engine this sender uses. | The channel of the sender (email or texts) and which account delivers its messages. |
| From Name (email) / Name (texts) | Email: the name shown in the inbox, for example *Northwind Rewards*. Texts: how the sender is listed in campaigns, for example *Northwind texts*. | The name on every message, or the label in the campaign's sender list. |
| From Address (email) | The address messages come from. It must belong to a domain the engine is allowed to send for. | Changing it needs a new verification. The engine's domain checks (SPF, DKIM) decide whether inboxes trust it. |
| Reply-To Address (email) | Optional. Where replies go when it is not the From address. | The Reply-To header on every message. |
| Sender Number (texts) | The number texts come from: a short code (`55123`), a long number with the country code (`+14045550155`) or an alphanumeric sender id where the aggregator allows one. | The number on every text; replies and STOP messages come back to it. |
| Default | One sender per channel is the default. | Offered first when a campaign is set up. |

### Sending Domains

One row per domain your email senders send from, with what inboxes read before they trust its mail. C360 looks the records up every day and when you press **Check Now**; it never changes your DNS.

| Control | What it is | What it changes |
|---|---|---|
| Domain | The domain, and how many DNS changes it needs (*Nothing to change* when all is well). A sender whose domain needs a change says so under its address, with a link here. | |
| Used By | How many of your senders use the domain (point at it for their addresses). | |
| SPF | **Passes**, **Missing**, **Two Records** (the check fails outright: merge them) or **Lets Anyone Send** (the record ends in +all). | Names the servers allowed to send for the domain. Without it, mail is filtered more often and is easier to forge. |
| DMARC | **Passes** (quarantine or reject), **Monitor Only** (p=none: reports, no protection) or **Missing**. | Tells inboxes what to do with mail that fails SPF and DKIM. |
| DKIM | **Not Checked** until you give the selector, then **Passes** or **Missing**. | Proves a message was not changed on the way. |
| The open row | For each record: why it matters, the record found, and the record to publish (name and value) with **Copy**. | Nothing: you publish the record at your DNS provider. |
| Selector, Save and Check | The DKIM selector your engine shows for the domain (Postal: on the domain's DNS page, e.g. `postal-Xa71Qd`). Letters, digits, dots, hyphens and underscores. Empty it to stop checking DKIM. | The domain is looked up again with it at once. |
| Check Now | Looks up all your domains again. Once a minute at most. | |

A domain reserved for examples (`.example`, `.test`) is not looked up. A new or changed sender's domain is looked up as soon as you save the sender.

### Deliverability Testing

| Control | What it is | What it changes |
|---|---|---|
| Provided by C360 | Shown when your tests run through C360's Mailgun Inspect account: this month's tests against your total, and where the total comes from (your plan's number, plus any tests the platform team added for the month). | |
| Edit Clients | The default clients every test renders in (webmail, desktop apps, phones and tablets) and whether to render with images blocked. Leave every client unchecked for the service's own default set. | |
| Use Your Own Mailgun Account / Set Up Mailgun Inspect | Region (US or EU), your Inspect account's username and an API key (write-only, stored encrypted). Check Connection confirms them. | Your tests run through your own account, and C360 does not limit them. |
| Edit | Your own account's settings and its default clients. | |
| Stop Using My Own Account | Removes your account; past results stay. | Tests go back to C360's account, within your plan. Shown as Remove when C360's account is not available. |
| The status | Not Checked Yet, Checked, Check Failed, Switched Off. | |

Mailgun Inspect Basic covers client previews; the spam verdict and inbox placement show as not in your plan until they exist. Through C360's account, tests count against your plan's monthly number plus the tests added for the month (added tests end with the month); through your own, they are counted under Plan & Usage for information only.

## How to

**Connect an email engine.** Add Engine → choose the type → name it → paste the address and the key → Add Engine. Press **Check** on its row and wait for *Checked*. Then **Copy Webhook URL** and register that address with the provider (Postal: the mail server's Webhooks; SendGrid: Mail settings → Event Webhook). Within a day the Callbacks column should show callbacks arriving.

**Add and verify a sender.** Add Sender → pick the engine → the from name and address → tick Default if it is the usual one → Add Sender. Press **Verify** and look for the message in your own inbox: when the engine accepts it, the status reads Verified. For texts, Verify asks for a mobile number to text.

**Keep receipts out of the campaign queue (Postal).** Edit the engine and enter the API key of a second Postal mail server as the Transactional Server API Key. Receipts and transactional campaigns then use it in their own lane. One engine, one callback address, two keys.

**Make inboxes trust a domain.** Under Sending Domains, open the domain's row. For each record marked Missing, Two Records, Lets Anyone Send or Monitor Only, press **Copy** and add or change that TXT record at your DNS provider (for DMARC, copy the Name too). Add the DKIM selector from your engine's DNS page and press **Save and Check**. DNS changes can take up to an hour to appear; then press **Check Now** until the domain reads *Nothing to change*. Start DMARC at quarantine; move to reject once its reports show only your own mail.

**Replace a leaked key.** Edit the engine, type the new key over the stored one, save, press Check. For the callback address, press **Rotate Address** and register the new address with the provider; the old one answers nothing from the moment you rotate.

**An engine reads Failing.** Press **See Health** and read the first check marked Failing. *No callback*: Copy Webhook URL and check that the address is registered and switched on at the provider (Postal: the mail server's Webhooks). *Key refused*: Edit the engine, enter its current key, save and press **Check**. *Bounces*: find the campaign and the list behind them before the next send. The platform team has been told as well and may already be on it.

**Try texts without an aggregator.** Add the Sandbox engine and a sender on it. Text campaigns then run end to end and nothing is sent. The Sandbox can even play back deliveries and STOP replies when a developer posts to its callback address.

## What happens behind the scenes

1. **Publishing** a campaign attaches the sender you chose; the sender names the engine.
2. **At the run's time** C360 builds the audience, leaves out the people it must (no consent, unsubscribed, bounced, over the frequency cap, and so on), and hands the messages to the engine in batches, paced by Messages per Minute.
3. **The engine answers** per message: accepted (C360 records the engine's message id), rejected (failed, never retried) or try again (retried after 1, 5, 15, 30 and 60 minutes; after five attempts it fails). A refused key or a suspended account stops the whole run with that reason.
4. **The engine calls back** to the callback address as things happen: delivered, bounced, deferred, dropped, complained, opened, clicked, unsubscribed. C360 keeps every callback and moves the message's status forward. A hard bounce or a complaint blocks the address for every future campaign; a complaint or an unsubscribe also records an opt-out.
5. **Texts** follow the same path with their own vocabulary: delivered or failed receipts, and replies. A STOP reply opts the number out of every kind of campaign and blocks it; START lifts the block.

6. **Every 10 minutes** C360 checks each engine: its callbacks, refused calls, speed, bounces or failed texts and receipts, and once a day its key and address. The result is the engine's Health; a problem alerts the platform team by email.

The campaign's **Recipients** tab shows each message's story, and **Check with the Engine** on a row asks Postal directly what became of it.

## Things to know

- A sent message with no delivered time, and *No callback has ever arrived* on the engine, means the callback address is not registered with the provider. The send worked; the news is not coming back.
- Verification is per address. Changing a sender's From Address resets it to Not Verified Yet.
- Verified and Sending Domains answer different questions: Verified means the engine accepted a message from the address; Sending Domains means inboxes can tell the mail is really yours.
- Removing an engine removes its senders. Switch it off instead when you may need it again.
- Keys are stored encrypted and are never shown, exported or written to the audit trail.
- The platform's own mail server (used for password links and notifications) is never a campaign engine. Your workspace's own mail server can be, from Settings → Email Server.
