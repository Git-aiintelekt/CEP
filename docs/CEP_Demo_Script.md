# CEP Demo Script for Stakeholders

A 60-minute walk through the product on the staging environment, told as one story: a new customer is onboarded, sets up their workspace, builds an audience and a message, sends a campaign, and sees the results, with the platform team watching from the back-office. A 20-minute cut is at the end. Companion documents: *CEP: Technical Stack and Capabilities*, the *CEP User Guide* and the *CEP Platform Guide*.

## Before the day

| Prepare | Detail |
|---|---|
| Environment | `https://cepdev.aiintelekt.com`, the staging installation. The back-office is at `/admin`. Hard-reload (Ctrl+Shift+R) once after any deploy. |
| Accounts | A platform administrator for the back-office. The NWA workspace's Marketing Admin for the app. Keep both signed in, in two browser windows side by side, zoomed so the room can read. |
| The onboarding demo | Decide the demo tenant's name and code beforehand (for example *Demo Retail*, `DEMO`). Have a mailbox you control for its first administrator, so the password link arrives in front of the room. The platform mail server must be set and tested (Configuration → Mail server). |
| Sending | NWA's Postal engine checked and its sender verified; the Sandbox text engine with a verified sender number. A test list of colleagues' addresses (production type), and a second list to upload live: download the Sample CSV from the upload wizard and keep it on the desktop with a dozen rows, two without a consent date. |
| An email template | A copy of the *Sale announcement* preset already made and activated, so the designer opens on something finished; the live designer segment adds to it. |
| E-receipts | An API key with `receipts:send`, an e-receipt campaign published, a store added, and the POST ready in a terminal: the endpoint and headers from Settings → POS Receipts, a sample TTDR document with the room's email address as the recipient. Run it once the day before. |
| Deliverability | Optional: the Mailgun Inspect account under Settings → Sending Engines → Deliverability Testing, with a test already run on the template so the result shows at once. |
| Fallbacks | Screenshots of every segment in case the connection drops; the Word guides open in the background. |

## The story, segment by segment

### 1. The platform in one minute (3 min)

Say: one installation, many workspaces; a marketing app for the customer, a back-office for us; everything a message touches (consent, suppression, frequency, the engine's answer) is decided at send time and on the record.

Show: the app's Home and the back-office Home side by side, nothing clicked yet.

### 2. Onboarding a customer (8 min)

Back-office → Tenants → Onboard a tenant.

| Step | Do | Say |
|---|---|---|
| Workspace | Name, code `DEMO`, time zone, shared hosting. | The code is fixed for life: partitions, callback addresses and the API header carry it. |
| Plan and features | Growth, 30 trial days, the Retail profile; switch Barcodes and QR codes on. | Point at the table under the form: where every feature's value comes from, and that the plan has the last word. |
| First administrator | Your demo mailbox. | They get Workspace Admin and a one-time link. |
| Policies | Hold back people without consent; approval before first send on. | The consent policy is part of onboarding, not an afterthought. |
| Hand-off | A line of welcome. | It goes into the email. |
| Review and onboard | Onboard DEMO. | One transaction: partitions, routing, roles, tags, subscription, users, mail. |

Then the tenant's page: the readiness panel reads what was just made; Usage against limits lists the new tenant.

### 3. The first sign-in and Set-Up (5 min)

Open the email in your mailbox → the password link → choose a password → sign in to `DEMO`. The app lands on **Settings → Set-Up**: step 1 done, the next step blue.

Say: the page is read from the workspace, never ticked; the Home card points back until the workspace is ready. Open the help icon in the trail: the chapter *Setting Up a New Workspace*. Switch to NWA for the rest of the demo, a workspace that is already set up.

### 4. Audiences and compliance (10 min)

In NWA:

1. Settings → Suppressions: the counts by reason; Import → paste two addresses with a note. Say: nothing can ever reach them, whatever list they are on.
2. Contact Lists → Create List → Upload a File with the prepared CSV: name it, Production, match the columns (point at the guessed mapping), the consent step (pick *Signed up on our website*, confirm the attestation), the review (two held back for no consent date, the numbers that add up), Import.
3. The list's page: the compliance record; *awaiting approval* because the policy asks for it; Approve.
4. Settings → Consent Policy: the four switches and the attestation wording.

Say: an upload never gives consent; the send engine decides again at every run.

### 5. Content (10 min)

1. Templates: the library and the preset gallery; open a preset's preview → Copy This Template.
2. The designer, on the prepared copy: drag a Coupon under the hero, insert the coupon code tag; drag a Barcode, pick the source tag; switch the canvas to the phone and hide the third product card on phones; Preview → Gmail, then Dark; Send a Test to the room's address.
3. Tags panel and Settings → Tags: where `{{first_name}}` comes from.
4. Deliverability tab if prepared: the inbox previews by client.
5. Activate. Then the SMS editor for thirty seconds: part counting, the STOP line.

Say: the designer writes MJML and the server renders the HTML every inbox gets; every save is a version.

### 6. A campaign, end to end (12 min)

1. Campaigns → Create Campaign: Regular Marketing, Email, Marketing, the owner, a tag.
2. Audience: tick the uploaded list and the colleagues' test list; the estimate and the reasons people are left out.
3. Content: the template, a subject line of the campaign's own, the topic (if the preference centre is on), the verified sender.
4. Test: Send a Test to the room; switch on the subject line test with a second subject.
5. Targets: a revenue target and a planned cost.
6. Review & Publish: Send immediately; tick Send at Each Recipient's Local Time and show the coverage line; Ask for Approval → approve from the second window as another user (or show the approver's view); Production Publish.
7. The campaign page: Performance as the run goes; Recipients → a row → the timeline → Check with the Engine; Audience → the frozen picture.
8. Settings → Integrations: the engine's card, the call log, open the call that sent the room's message.

Say: pause stops queued messages, not ones the engine already has; nothing is deleted, everything is archived; the frozen list is the record of what a send used.

### 7. E-receipts from the point of sale (5 min)

Settings → POS Receipts: the campaign, the stores, the endpoint and headers. Run the prepared POST in the terminal: the XML answer with S100 and the message id. The receipt arrives in the room's mailbox. Received from the Point of Sale shows the transaction; the call log shows the document as received, card numbers masked.

Say: nothing about the transaction is stored, only the trail; a retrying register gets S102 and nothing is sent twice.

### 8. Home and Reports (3 min)

Home: the alerts, the figures against the period before, revenue versus cost, the funnel, the next seven days; pick one campaign to see its own picture. Reports: the period, the comparison, the weekly schedule.

### 9. Help and the guides (2 min)

The help icon on any page and a field's note; the back-office's Platform Guide; the two Word documents.

### 10. Questions (as long as it takes)

## Key messages to land

- Consent and compliance are built into the path of least resistance: the upload asks, the policy decides, the record exists.
- Every decision about a message is made at send time, in one engine, in one order, and is visible per recipient afterwards.
- One installation serves many customers with real isolation, and a customer can move to their own database without a rewrite.
- The platform team sees everything: readiness, usage, health, jobs, alerts, every external call.
- Documentation is part of the product: the guides live with the code and inside both surfaces.

## Questions to expect

| Question | Answer |
|---|---|
| Which email providers? | Postal and SendGrid today, SMTP for small volumes; a new provider is one adapter module. |
| Texts? | Digivize for sending; a sandbox for rehearsal; replies and STOP handled; quiet hours respected. |
| Where does revenue come from? | From each campaign's actuals, filled by the attribution feed; until it runs, those figures read as not set up. |
| Data isolation? | Partitioning by tenant, row-level security, an application role that cannot cross tenants, a dedicated database as an option. |
| Scale? | Imports of 250,000 rows chunked in the background; sends in batches paced per engine; the integration bridge throttles and breaks circuits. |
| What is not there yet? | The attribution feed, the campaign's own hourly limit, Excel uploads, journeys beyond the view, Digivize's production callbacks. |

## The 20-minute cut

Segment 2 with the first three steps of onboarding (3 min), the Set-Up page (2), the upload wizard's consent step and review (4), the designer's coupon and barcode with the phone view (4), a campaign from Review & Publish to the Recipients tab on a campaign prepared beforehand (5), the e-receipt POST (2). Skip Reports, the guides and the SMS editor.
