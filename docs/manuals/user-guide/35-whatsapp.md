# WhatsApp Templates

**Where:** Templates → the WhatsApp tab; a WhatsApp template opens in the WhatsApp editor. The number itself is connected under Settings → Delivery. Your administrator has the same steps with screenshots in the Word guide *CEP WhatsApp Set-Up Guide*.

## What this page is for

WhatsApp lets a business start a conversation only with a template Meta has approved. A WhatsApp template is written here with the workspace's tags, sent to Meta for review with **Submit to Meta**, and sent by campaigns once Meta approves it. Templates made directly in Meta's WhatsApp Manager appear here too, through **Sync from Meta**. Every workspace uses its own Meta business account: CEP never sends through a shared one.

## Who can use it

| | |
|---|---|
| Permissions | `provider.edit` to connect the number (Settings → Delivery); `template.edit` to write, submit, sync and activate templates; the usual campaign permissions to send. |
| Feature | **whatsapp** (WhatsApp messages), switched on for the workspace by the platform team. Off by default. |
| Outside CEP | A Meta business portfolio, a Meta app with the WhatsApp product, a WhatsApp business account with a phone number, a payment method on that account, and a system-user access token. Section *Set it up from start to finish* lists each one. |

## The fields and controls

### The WhatsApp editor

| Field | What it is | What it changes |
|---|---|---|
| WhatsApp Number | The connected number (engine) the template is for. | The Meta business account that reviews and sends it. |
| Name at Meta | Lower-case letters, digits and underscores, for example `back_in_stock`. | How Meta knows the template. Fixed once Meta has it. |
| Category | Marketing, or Utility for an update the person expects (a receipt, an order). | Meta charges by category, and moves anything promotional to Marketing. |
| Language | The language the words are in. | A template has one language; another language is another template. |
| Header | None, Text (up to 60 characters, the same for everyone), a Picture (JPEG or PNG up to 5 MB) or a Document (PDF). | Shown above the message. Meta reviews a picture or document header with the file you give it, and sends that file with every message. |
| Body | The message, up to 1,024 characters, with tags such as `{{first_name}}`. | What people read. Meta gets it with numbered variables (`{{1}}`, `{{2}}`) in the order the tags first appear. |
| Samples for Meta's Review | A sample value for every tag in the body. | Meta reviews the message with them. |
| If Empty | What to send when a person has no value for a tag. | Meta refuses a message with an empty value: without a fallback (or the tag's own default), that person's message fails. |
| Footer | A small grey line, up to 60 characters, for example *Reply STOP to opt out*. | Shown under the message. |
| Buttons | Up to 10: Link (at most 2), Quick Reply, Phone Number (at most 1). | A quick reply that starts with *Stop* opts the person out of WhatsApp when tapped. |
| Save | A new version, still a draft. | Nothing goes to Meta yet. |
| Submit to Meta | Sends the saved version for review. | The template is In Review; the status updates by itself when Meta decides, usually within minutes, at most 24 hours. |
| Copy to Change | A draft copy, under a name of its own. | A template in review or approved does not change: Meta sends exactly what it approved. The copy is reviewed again. |
| Activate | Makes an approved template usable by campaigns. | A template written here becomes active by itself when Meta approves it. |

### Where Meta's review stands

| Status | What it means |
|---|---|
| Not Submitted | Written here, not yet with Meta. |
| In Review | Meta is reviewing it. |
| Approved | Campaigns can send it. |
| Rejected | Meta's reason is shown; change it and submit it again. |
| Paused by Meta | Meta paused it for low quality (many people blocked or reported it). Campaigns cannot send it until Meta lifts the pause. |
| Disabled by Meta | Meta switched it off; copy it to make a new version. |

### A template made in WhatsApp Manager

Sync from Meta brings in every template of the number's business account. One made in WhatsApp Manager keeps Meta's words: the editor shows them with Meta's numbers and asks which tag fills each number, and what to send when it is empty. It can be used once every number has a tag.

## Set it up from start to finish

The example throughout is a retailer, *City HT*, in Singapore, with the WhatsApp number +65 6812 4400. Every ID and value below is a made-up example: use your own.

### Step 1: at Meta (the workspace's own accounts)

1. **Business portfolio.** At business.facebook.com, create or choose the business portfolio (for example *City HT Pte Ltd*) and complete Meta's business verification (Settings → Security Centre). Unverified businesses can message far fewer people a day.
2. **App.** At developers.facebook.com → My Apps → Create App, create a *Business* app (for example *City HT Messaging*) connected to that portfolio, and add the **WhatsApp** product to it. Meta creates a WhatsApp business account and a test number with it.
3. **Phone number.** In WhatsApp Manager → Phone Numbers, add the real number (+65 6812 4400), verify it by SMS or voice call, and set the display name (*City HT*). Meta approves the display name. The number must not be in use on the WhatsApp or WhatsApp Business app.
4. **Payment method.** In WhatsApp Manager → Billing (or Business Settings → Payments), add the card or credit line Meta charges per delivered message.
5. **System user and token.** In Business Settings → Users → System Users, add a system user (role Admin), assign it the app and the WhatsApp account with full control, then **Generate New Token**: choose the app, expiry *Never*, and the permissions `whatsapp_business_messaging` and `whatsapp_business_management`. Copy the token: Meta shows it once.
6. **Collect five values.** WhatsApp Business Account ID (for example `104883925517204`) and Phone Number ID (for example `118204576330981`) from WhatsApp Manager or the app's WhatsApp → API Setup page; the App ID and App Secret from the app's App Settings → Basic; and the token from step 5.

> The temporary token on the API Setup page lasts 24 hours: never use it in CEP.

### Step 2: in the back office (platform team)

1. Back office → Tenants → open the workspace (for example *City HT*).
2. Under **Industry and Features**, set **WhatsApp messages** to *On*, and save.
3. Within a minute the workspace offers the WhatsApp engine, the WhatsApp tab in Templates and the WhatsApp channel in campaigns.

### Step 3: connect the number (Settings → Delivery)

1. **Add Engine** → Engine *WhatsApp · WhatsApp (Meta)*. Name: *City HT WhatsApp*. WhatsApp Business Account ID, Phone Number ID, Access Token and App Secret from step 1; App ID if templates will have a picture or document header. Leave Graph API Version empty. **Add Engine**.
2. In the engine's row, **Copy Webhook URL** and **Copy Verify Token**.
3. In the Meta app: WhatsApp → Configuration → Webhook → **Edit**. Paste the callback URL (for example `https://cepdev.aiintelekt.com/api/v1/webhooks/delivery/CITYHT/7f3c…/a1b2…/`) and the verify token, and **Verify and Save**. Meta calls the address once and CEP answers; a refusal here means the token or the address was not copied whole.
4. Under Webhook fields, **Subscribe** to `messages` and `message_template_status_update` (and, if you want them, `message_template_quality_update` and `phone_number_quality_update`).
5. Back in CEP, press **Check** on the engine. The row then reads, for example, *+65 6812 4400 · City HT · Quality High · 1,000 people a day*.
6. **Add Sender**: Sends Through *City HT WhatsApp*, Name *City HT WhatsApp*, WhatsApp Number *+65 6812 4400*. Then **Verify**: CEP asks Meta whether the engine's number is this one, and the sender shows *Verified*.

### Step 4: record WhatsApp consent

WhatsApp is sent only to people with a WhatsApp opt-in, for every kind of campaign; consent to texts does not count. A list upload records it from a *WhatsApp consent date* column, for example:

| email | first_name | mobile | whatsapp_consent_date |
|---|---|---|---|
| mei.ling@example.com | Mei Ling | +6591234471 | 2026-10-01 |
| arif.rahman@example.com | Arif | +60124481902 | 2026-10-03 |

Numbers need their country code. A date in the future, or one not recognised, records no consent.

### Step 5: write a template and have Meta approve it

1. Templates → **WhatsApp** card (or the WhatsApp tab → New Template). Name it *Weekend Offer*; start from **WhatsApp offer** or from blank.
2. In the editor: WhatsApp Number *+6568124400 · City HT*; Name at Meta `weekend_offer`; Category *Marketing*; Language *English*; Header *None*.
3. Body, for example: *Hi {{first_name}}, this weekend only: 20% off everything in store. Show this message at the till to get it.*
4. Samples: `first_name` → *Mei Ling*. If Empty: `first_name` → *there*.
5. Footer *Reply STOP to opt out*; Buttons: Quick Reply *Stop Offers*.
6. **Save**, then **Submit to Meta**. The status is *In Review*; when Meta decides, it becomes *Approved* (and the template Active) or *Rejected* with Meta's reason.

### Step 6: send a campaign

1. Campaigns → Create Campaign: type *Regular Marketing*, channel **WhatsApp**.
2. Content: choose *Weekend Offer* (it shows *Approved*); Sender *City HT WhatsApp*.
3. Audience: the list from step 4.
4. **Test Publish** to your own WhatsApp number: the approved template arrives with the samples Meta reviewed.
5. **Publish**. Meta's reports fill the campaign's Recipients tab (Delivered, Read, Failed with Meta's reason) and its results (Read beside Delivered).

## Test it

Run these in order on a new set-up; each says what to look for.

| # | Test | Do | Expect |
|---|---|---|---|
| 1 | The connection | Settings → Delivery → **Check** on the engine. | The number, name, quality and daily limit appear in the engine's row. A refusal names Meta's reason (most often the token). |
| 2 | The callback address | Meta's **Verify and Save** in step 3. | Meta accepts it. In CEP the engine's Callbacks column shows a callback once Meta sends its first event. |
| 3 | Sync | Templates → WhatsApp → **Sync from Meta**. | Meta's sample template `hello_world` (on a new account) and any template made in WhatsApp Manager appear, with Meta's status. |
| 4 | A review round trip | Write a short Utility template and **Submit to Meta**. | *In Review*, then *Approved* within minutes, with no action in CEP: Meta's callback arrives. If it stays *In Review* for an hour, test 2 is not done. |
| 5 | A refusal before Meta | Make the body end with a tag, for example *Your store is {{preferred_store}}*. | The editor says Meta would refuse it, and Save stays off. |
| 6 | A test send | A WhatsApp campaign → **Test Publish** to your own number. | The message arrives on your phone. |
| 7 | Consent | Publish to a small list: one person with WhatsApp consent, one with text consent only. | The first gets it; the second is left out as *No Consent*. |
| 8 | Read | Open the message on the phone. | The campaign's Recipients tab shows the time it was read. |
| 9 | Stop | Tap **Stop Offers** in the message. | The person is opted out of WhatsApp (Recipients: *Opted Out*); their text consent is unchanged. |
| 10 | A number that cannot receive | Add a person whose number is not on WhatsApp. | *Failed: Not a WhatsApp number, or it cannot receive this message (Meta 131026)*. |

## What happens behind the scenes

- A WhatsApp message goes to people with a WhatsApp opt-in only, for every kind of campaign: Meta's rule. Consent to texts is not consent to WhatsApp.
- A text STOP does not stop WhatsApp, and a WhatsApp STOP (typed, or a Stop quick reply) stops WhatsApp only.
- Meta reports Sent, Delivered, Read and Failed for each message; the campaign's Recipients tab shows Read, and its results count reads.
- Each person's values fill the approved template; the record of what they got is the template's words with their values.
- Callbacks are checked with the App Secret (Meta's signature) as well as the address's own token, and the same callback delivered twice is applied once.

## When something goes wrong

| What you see | Why | What to do |
|---|---|---|
| Check: *Meta refused the access token* (Meta 190) | The token expired, was revoked, or is the 24-hour one. | Generate a system-user token with expiry Never (step 1.5) and paste it under Edit. |
| Meta's Verify and Save fails | The callback URL or verify token was not copied whole, or WhatsApp is not on for the workspace. | Copy both again from the engine's row. |
| Templates stay *In Review*; nothing on Recipients | Meta is not calling back: webhook fields not subscribed, or the app is not subscribed to the WhatsApp account. | Subscribe `messages` and `message_template_status_update`; if the account was not created by the app, subscribe the app to the account in Meta (subscribed apps). |
| Meta says it sends callbacks, but the engine's Callbacks column never shows one | CEP refuses them: the App Secret in CEP is not this app's, so Meta's signature does not match. | Paste the right App Secret under Edit, or leave it empty to rely on the address's own token. |
| *Failed … (Meta 131026)* | The number is not on WhatsApp, or cannot receive it. | Nothing to fix in CEP; the person can be reached by another channel. |
| *Failed … (Meta 131049)* | Meta held a marketing message back: the person has had their share for now. | Counted as failed; try again another day. |
| *Failed … (Meta 131042)* | Meta could not charge the account. | Fix the payment method in WhatsApp Manager. |
| The run fails: *Meta has no approved template of this name and language* | The template was deleted or renamed in WhatsApp Manager. | Sync from Meta, then choose an approved template. |
| *No value for {{tag}} and the template has no fallback* | That person has no value for the tag. | Give the tag an If Empty value and save (a written template needs a copy, reviewed again). |
| Everyone is *No Consent* | Nobody has a WhatsApp opt-in yet. | Record consent (step 4). |

## Things to know

- Meta rejects a body that starts or ends with a tag, or that has two tags side by side; the editor says so before you submit.
- Links in a WhatsApp message are not tagged with UTM parameters: Meta sends exactly the words and links it approved.
- A new number may start conversations with only a few hundred people a day until it has a sending history; Settings → Delivery shows the number's daily limit and quality.
- Marketing campaigns keep the workspace's quiet hours for texts.
- Not yet built: drip campaigns and journeys on WhatsApp, POS e-receipts on WhatsApp, a reply inbox, Meta's charge per campaign.
