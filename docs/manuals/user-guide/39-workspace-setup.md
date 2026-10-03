# Setting Up a New Workspace

**Where:** Settings → Workspace → Set-Up. The first sign-in of an administrator lands here while the workspace is not ready, and Home keeps a card pointing back until it is.

## What this is

The platform team creates the workspace and sends its first administrator an email with a one-time password link and the set-up list. From that email to the first production send is one path, and this chapter walks it: choosing a password, the first sign-in, the Set-Up page that knows what is done, the seven steps in order, a rehearsal with a test campaign, and the first real send. Nothing in it is a new form: every step opens the Settings page that does it, and those pages have their own chapters.

## Who does it

| | |
|---|---|
| Permission | The first administrator holds the Workspace Admin role, which has every permission including `user.admin`. Anyone with `user.admin` sees the Set-Up page. |
| Features | Step 5 (texts) reads as not available without the **sms** feature; the API Keys link under step 7 needs **api_access**. The platform team switches features on per workspace. |

## The path, from the email

### Before the first sign-in

1. **The email.** It names the workspace and its code (for example `NWA`), carries the password link and lists the set-up steps. The link is one-time: if it was used or has expired, ask the platform team, or any administrator who already has access, for a new one (Settings → Users → Password Link).
2. **Choose a password.** The link opens the password page; choose one and continue to the sign-in.
3. **Sign in.** The workspace code, your email and the password. When the workspace requires multi-factor authentication, the next screen walks you through it before anything else: scan the code with an authenticator app, type the six digits, store the recovery codes.
4. **You land on Set-Up.** An administrator whose workspace is not ready lands here instead of Home: *Welcome, {name}. Let's set up {CODE}.* with step 1 already done. Everyone else, and every later sign-in, lands on Home, where a card says how far the set-up is until the workspace is ready.

### The seven steps, in order

| # | Step | What to do | Done when |
|---|---|---|---|
| 1 | Choose your password and sign in | Done by reading this. Account Security sets up your own second step. | You are signed in. |
| 2 | Invite your team and give them roles | Users → Add User: email, name, a role. Three roles are ready: Workspace Admin, Campaign Manager, Analyst; Roles adds narrower ones, for example an approver. Each person gets their own password link. | At least one other active user with a role. |
| 3 | Add an email engine | Sending Engines → Add Engine: Postal or SendGrid with its address and key → Check. Then Copy Webhook URL and register the address with the provider, so deliveries and bounces come back. | An active email engine whose last Check passed. |
| 4 | Add an email sender and verify it | Sending Engines → Add Sender on the engine: the From name and address on a domain the engine may send for → Verify; the message arrives in your own inbox. Tick Default. | A verified email sender. |
| 5 | Add a text engine and a sender number (optional) | Sending Engines → Add Engine: Digivize with its keys and brand, or the Sandbox to rehearse without an aggregator → a sender with the number → Verify by a text. | An active text engine with a verified number. Optional. |
| 6 | Import your do-not-contact list, then your first contact list | Suppressions → Import the opt-outs from your previous system first, so no upload can reach them. Then Contact Lists → Create List → Upload a File: name it, say what it is for, match the columns, declare where the people agreed, review, import. | A production list with people. |
| 7 | Decide who is told, and who approves (optional) | Notifications: the addresses or chat webhook that hear about failed sends. Approvals: whether a second person signs off before a production publish. API Keys: a key with `receipts:send` when the point of sale will send receipts. | A recipient, or approvals on, or a key. Optional. |

**Ready** means steps 1, 2, 3, 4 and 6 are done. The Home card goes, and the page stays under Settings with the optional steps still listed.

### Before the first real send

Worth setting while the workspace is quiet, each with its own chapter:

- **Consent Policy** (Settings → Audience): what an upload does with people without a consent date, whether text lists need a text consent date, approval before a fresh list's first send, and the sentence uploaders confirm.
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
| The heading | *Welcome, {name}. Let's set up {CODE}.* on a brand-new workspace; *Set Up Your Workspace* afterwards. Under it the workspace's name, plan and time zone. | |
| Hide Until Later / Show on Home Again | Hides the Home card, or brings it back. | The Home card and the first-sign-in landing. The page itself stays. |
| n of 7 done, the meter | How many steps are done. | |
| A step's row | Its number (blue for the next one, amber when it needs attention, a tick when done), its name, a sentence read from the workspace, a hint while it is the next step, a status tag (Done, Not verified, Not checked), and the buttons to the page that does it. | |
| The callout | Which steps make the workspace ready, or that it is ready. | |

## What happens behind the scenes

Every load reads the users and roles, the engines and their last check, the senders, the suppressions and lists, the notification settings, the approval switch and the API keys, and decides each step from them; nothing is ticked by hand. The dismissal of the Home card is the only thing the page stores. The platform team sees the same readiness from their side, so they know when a workspace is sending.

## Things to know

- Until an email engine has been checked and a sender verified, test sends work and production publishing does not.
- A password link is one-time; a new one replaces the old.
- The optional steps never hold the workspace back, and the page keeps listing them until they are done.
