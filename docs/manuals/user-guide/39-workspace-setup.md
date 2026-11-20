# Setting Up a New Workspace

**Where:** Settings → General → Set-Up. The first sign-in of an administrator lands here while the workspace is not ready, and Home keeps a card pointing back until it is.

## What this is

The platform team creates the workspace and sends its first administrator an email with a one-time password link and the set-up list. From that email to the first production send is one path, and this chapter walks it: choosing a password, the first sign-in, the Set-Up page that knows what is done, the steps in order, a rehearsal with a test campaign, and the first real send. Nothing in it is a new form: every step opens the Settings page that does it, and those pages have their own chapters.

## Who does it

| | |
|---|---|
| Permission | `user.admin`. The first administrator holds the Workspace Admin role, which has every permission including `user.admin`. Anyone with `user.admin` sees the Set-Up page and the Home card. |
| Features | The texts step reads *Texts are not switched on for this workspace* without the **sms** feature; the API Keys button on the last Engagement step needs **api_access**. The platform team switches features on per workspace. |

## The path, from the email

### Before the first sign-in

1. **The email.** It names the workspace and its code (for example `NWA`), carries the password link and lists the set-up steps. The link is one-time: if it was used or has expired, ask the platform team, or any administrator who already has access, for a new one (Settings → Users → Password Link).
2. **Choose a password.** The link opens the password page; choose one and continue to the sign-in.
3. **Sign in.** The workspace code, your email and the password. When the workspace requires multi-factor authentication, the next screen walks you through it before anything else: scan the code with an authenticator app, type the six digits, store the recovery codes.
4. **You land on Set-Up.** An administrator whose workspace is not ready lands here instead of Home: *Welcome, {name}. Let's set up {CODE}.* with step 1 already done. Everyone else, and every later sign-in, lands on Home, where a card says how far the set-up is until the workspace is ready.

### The steps, in order

Set-Up lists only the steps of the components the workspace has: steps 1 and 2 for every workspace, six more when it has Engagement, and **Connect the database your reports read** when it has Insights. A workspace with Engagement alone sees eight steps, one with both sees nine, and one with Insights alone sees three (sign in, team, database), where the database step is then required. The numbers below are for a workspace with Engagement.

| # | Step | What to do | Done when |
|---|---|---|---|
| 1 | Choose your password and sign in | Done by reading this. Account Security sets up your own second step. | You are signed in. |
| 2 | Invite your team and give them roles | Users → Add User: email, name, a role. Three roles are ready: Workspace Admin, Campaign Manager, Analyst; Roles adds narrower ones, for example an approver. Each person gets their own password link. | At least one other active user with a role. |
| 3 | Add an email engine | Sending Engines → Add Engine: Postal or SendGrid with its address and key → Check. Then Copy Webhook URL and register the address with the provider, so deliveries and bounces come back. | An active email engine whose last Check passed. |
| 4 | Add an email sender and verify it | Sending Engines → Add Sender on the engine: the From name and address on a domain the engine may send for → Verify; the message arrives in your own inbox. Tick Default. | A verified email sender on an active email engine. |
| 5 | Warm up your domain and IP (optional) | Delivery Warm-Up → choose how mail leaves, the plan, the lists, the template and the sender → Start Warm-Up. For a new IP address or sending domain: it sends a little more each day and holds every marketing email to the day's limit until it is done. | A warm-up finished, or one that was stopped. Optional. |
| 6 | Add a text engine and a sender number (optional) | Sending Engines → Add Engine: Digivize with its keys and brand, or the Sandbox to rehearse without an aggregator → a sender with the number → Verify by a text. | An active text engine with a verified number. Optional. |
| 7 | Import your do-not-contact list, then your first contact list | Suppressions → Import the opt-outs from your previous system first, so no upload can reach them. Then Contact Lists → Create List → Upload a File: name it, say what it is for, match the columns, declare where the people agreed, review, import. | An active production list with people. |
| 8 | Decide who is told, and who approves (optional) | Notifications: the addresses or chat webhook that hear about failed sends. Approvals: whether a second person signs off before a production publish. API Keys: a key with `receipts:send` when the point of sale will send receipts. | A notification address, or approvals on, or an API key. Optional. |
| 9 (Insights) | Connect the database your reports read (optional with Engagement) | Report Databases → Connect a Database: a read-only login to the database the reports read. | A Report Database is connected. |

**Ready** means every step not marked optional is done: steps 1 to 4 and 7 with Engagement; steps 1 to 3 with Insights alone. The Home card goes, and the page stays under Settings with the optional steps still listed.

### Before the first real send

Worth setting while the workspace is quiet, each with its own chapter:

- **Consent Policy** (Settings → Engagement): what an upload does with people without a consent date, whether text lists need a text consent date, approval before a fresh list's first send, and the sentence uploaders confirm.
- **Preference Centre**: switch on when customers should choose topics; add the topics first and put `{{preference_url}}` in the templates' footer.
- **Email Server**: your own SMTP server for password links and notifications, so they come from your domain.
- **Tags**: the workspace's own personalization tags beyond the platform's catalogue.
- **Security**: require multi-factor authentication for everyone, or sign in through your identity provider.
- **Templates**: copy a preset, put your brand on it, Activate.

### The rehearsal, then production

1. **A test campaign.** Campaigns → Create Campaign → Regular Marketing, Email, Marketing → a Test list (Contact Lists lets you make one from a file of colleagues) → the template → Send a Test to yourself → Test Publish. A test publish sends to nobody real and counts in nothing.
2. **The first production send.** The same campaign with the production list attached, the sender verified, a subject line, the topic when the preference centre is on → Review & Publish → Production Publish. The checklist on that step names anything missing.
3. **Watch it land.** The campaign's Performance tab and Recipients show each message's story as the engine calls back; Home's Needs Attention raises a failed run; Settings → Integrations keeps every call.

## The Set-Up page's controls

| Control | What it is | What it changes |
|---|---|---|
| The heading | *Welcome, {name}. Let's set up {CODE}.* while only step 1 is done; *Set Up Your Workspace* afterwards. Under it the workspace's name and code, its plan and its time zone, and on a brand-new workspace how many steps there are (with Engagement: *Nothing sends until step 4*). | Nothing; it tells you at a glance whether the set-up has started. |
| Hide Until Later / Show on Home Again | Shown only while the workspace is not ready. Hide Until Later hides the set-up card; Show on Home Again brings it back. | For the whole workspace, not only for you: hidden, Home shows no set-up card and an administrator's first sign-in lands on Home instead of here. The page and its steps stay under Settings. |
| n of N done, the meter | How many of the listed steps are done, optional ones included. | Nothing; the meter fills as steps are done anywhere in the workspace. |
| A step's row | Its number (blue for the next required step, amber when it needs attention, a tick when done), its name, an *Optional* tag where it applies, and a sentence read from the workspace, for example the engine's name and when it was last checked. The next step also shows why it matters. | Nothing on its own; it reports what the workspace already has. Each row updates when the page that does the work is saved. |
| The status tag | **Done** (green) when the step is done. Otherwise an amber tag for a step that needs attention: **Not checked** (the email engine's Check has not passed), **Not verified** (a sender exists but is not verified: test sends work from it, production does not), **No sender** (a text engine without a verified number). The warm-up step shows **Day n of m** while it runs, **Paused**, **Waiting for Approval** when the next day waits to be approved, and **Stopped** (green, counted as done) when someone stopped it. | Nothing; it names what is missing. |
| The buttons on a row | The pages that do the step, for example Sending Engines, Verify Sender, Delivery Warm-Up, Upload a List. The main one is blue on the next step. | They open the page; nothing is changed until you save there. |
| The callout | Which steps make the workspace ready (*When steps 1 to 4 and 7 are done, the workspace is ready*), or *Your workspace is ready*. | Nothing; it tells you which steps hold the workspace back. |

## What happens behind the scenes

Every load reads the users and roles, the engines and their last check, the senders, the warm-up, the suppressions and lists, the notification settings, the approval switch, the API keys and, with Insights, the report databases, and decides each step from them; nothing is ticked by hand. Hiding the Home card is the only thing the page stores. The platform team sees the same readiness from their side, so they know when a workspace is sending.

## Things to know

- Until an email engine has been checked and a sender verified, test sends work and production publishing does not.
- A password link is one-time and expires (72 hours unless the platform team set another length).
- A warm-up that is still running is not done, but it never holds the workspace back: it is optional. While it runs, every marketing email waits for the hour's limit.
- The optional steps never hold the workspace back, and the page keeps listing them until they are done.
