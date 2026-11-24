# Welcome to C360

C360 is the Customer Engagement Platform: the place where a marketing team keeps its contacts, designs emails and texts, sends campaigns and reads what came back. This guide is for the people who sign in to a workspace: administrators who set it up, marketers who run campaigns, and anyone who reads the reports.

A second guide, the Platform Guide, is for the platform team who run the back-office: creating workspaces, plans, features and the platform's own settings. If you were invited to a workspace, you only need this one.

## How the guide is organised

Every page of the app has a chapter, and every chapter has the same shape:

- **What this page is for.** One paragraph on the job the page does.
- **Who can use it.** The permission a role needs, and the feature the workspace needs switched on.
- **The fields and controls.** A table of everything on the page: what each field or button is, and what it changes elsewhere in C360. That is the part to read when a setting is unclear.
- **How to.** The everyday tasks, step by step.
- **What happens behind the scenes.** The business flow: what C360 does with what you entered, and where it shows up later.
- **Things to know.** The limits and the consequences worth remembering.

## Help inside the app

- **The help icon** beside a page's title opens that page's chapter in a panel, so the guide is one click away from the page it describes. Close it with the cross or the Escape key.
- **The small information icon** beside a field opens a note on that one field: what it is and what it affects.
- **The keyboard icon** in the header lists the keyboard shortcuts. Pressing `?` on any page does the same.
- **Grey suggestions.** Some boxes offer a suggestion in grey, with a small **Tab** tag at the right while you are in the box. Press Tab (or the right arrow) while the box is empty to put the suggestion in, then change it or keep it. On a phone or tablet, tap **Use**. Once the box has text, or when it shows an "e.g." example, Tab moves to the next field as usual. Suggestions are offered in Ask for a Report and Change With a Prompt (Insights), the campaign name (from the type, the channel and the month), Subject B of a subject line test (the subject line), and an empty text message (the opt-out line, kept as the last line).
- **The foot of every page** carries the platform's copyright line and a link to the Terms of Use, which also opens from the sign-in page without signing in.

## Three ideas that run through everything

**Workspace.** Your company's own area of C360. Everything you see belongs to one workspace: its users, roles, lists, templates, campaigns and settings. The workspace code, shown as the **Workspace ID** (for example `NWA`), appears on the log-in page, at the top of every page and in every address C360 gives you to register with other systems. Your account belongs to one workspace: the same email address can also have an account in another workspace (a Staging and a Production one, say), with its own password, roles and two-factor.

**Roles and permissions.** What a person may do is set by their role. A role is a set of permissions such as *campaign.edit* or *user.admin*. The chapter for each page names the permission it needs. If a page refuses you, it says which permission to ask an administrator for.

**Features.** Some parts of C360 are switched on per workspace by the platform team: texts, MMS, e-receipts, journeys, A/B testing, API access, the preference centre, barcodes. A page that belongs to a feature that is off is simply not shown, and its chapter says which feature to ask for.

## Logging in, and knowing which workspace you are in

**The log-in page** asks for three things: the **Workspace ID**, your email and your password.

| What you see | What it means |
|---|---|
| *Workspace ID: CITYST* above Email | The address you opened (the workspace's own address, for example `citist.cep.example.com`) already names the workspace. Type only your email and password. |
| A **Workspace ID** field | You opened C360's own address. Type the workspace's ID; under it, **Recent** offers the workspaces you logged in to on this computer: one click fills the field. |
| The button **Log In to CITYST** | The workspace you are about to enter. Each workspace has its own password: Staging's does not open Production. |
| *The workspace, email and password do not match an account. Check the Workspace ID: Staging and Production have different passwords.* | One of the three is wrong. C360 never says whether the address has an account in some other workspace. |

**Inside the app:**

- The **Workspace ID** is at the top right, before the upload, help and notification buttons.
- A **Staging** workspace shows an amber band under the top bar on every page (*Staging workspace · CITYST-STG · sends here are for testing*) and a Staging tag beside the Workspace ID, so nobody mistakes it for Production. Sending engines still send for real: a Staging workspace should send only to test lists.
- The **account menu** (your name at the top right) shows your Workspace ID with Staging or Production, your roles in this workspace and whether two-factor is on. Under it, **Log In to CODE** offers the other workspaces you logged in to on this computer: it opens that workspace's log-in page, where you use that workspace's password.

## Statuses you will meet

| Status | Where | Meaning |
|---|---|---|
| Draft | campaigns, lists | Being prepared; nothing has been sent and nothing is live. |
| Test Published | campaigns | Published to test lists only. Production lists cannot be attached. |
| Production Published | campaigns | Published to real people; a scheduled run will go out. |
| Scheduled | campaigns | A production campaign with a run waiting for its time. |
| Active, Sending, Preparing | campaigns | Live right now: a run is building its audience or sending. |
| Completed | campaigns | The run finished. |
| Verified, Not Verified Yet, Verification Failed | senders | Whether a sender address or number has proven it can send. |

## Where to start

A new workspace begins with the chapter **Setting Up a New Workspace**: from the invitation email and the first sign-in through the seven set-up steps to the first production send. **Settings → Set-Up** is the page that walks them, read from the workspace so it always knows what is done. The chapters for the pages it opens come next: Users and Roles, Sending Engines, Suppressions, Contact Lists, Notifications and Approvals.
