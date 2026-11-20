# Plan & Usage

**Where:** Settings → General → Plan & Usage.

## What this page is for

What the workspace's plan allows and how much of it this month has used: messages, contacts, active users, storage, deliverability tests and AI prompts; the messages by channel; and the invoices the platform has issued. Plans and limits are changed by the platform team; this page is the reading. It matters because some limits stop work when they are reached: publishing and sending at the message limit, adding users at the user limit, inbox previews at the test limit and AI drafts at the prompt limit.

## Who can use it

| | |
|---|---|
| Permission | `user.admin`. |

## The fields and controls

The page has no settings to change. Each meter shows what is used against the plan's limit, a bar, and a line under it: *No limit on this plan*, *Hard limit*, *Then … per 1,000* (overage allowed), *Close to the limit* (from 80% of it), *Above the included amount: billed at … per 1,000*, or *The limit is reached and this plan has no overage*.

| Control | What it is | What it changes |
|---|---|---|
| The plan | Its name (*… Plan*, or *No Plan*), its monthly price or *Custom pricing*, the month shown, and a status tag when the subscription is not active. With no plan, usage is measured but no limits apply. | Which limits below apply. |
| Messages this month | Emails, text parts and MMS sent this month against the plan's limit. | On a plan with overage, sending goes on and the extra is billed per started 1,000 on the month's invoice. On a hard limit, once it is reached: a red notice at the top of this page says *This month's messages are used up, so campaigns cannot be published until next month*; Production Publish is refused with *This workspace has used its … messages for the month and the … plan has no overage*; a run that starts after that fails with the same reason; e-receipts and text receipts are refused. Sending resumes on the 1st of the next month or after a plan change. |
| Contacts | People in the workspace against the plan's limit. | On a plan with contact overage, contacts above the limit are billed per started 1,000. The warm-up is sized to this number (Delivery Warm-Up). The meter warns; imports are not stopped at the limit. |
| Active users | Active users against the plan's limit. | At the limit, Settings → Users refuses a new user: *Your plan allows … active users. Deactivate someone or upgrade the plan.* Deactivating someone frees a place. |
| Storage | Media and files, in GB, against the plan's limit. | The meter warns; uploads are not stopped at the limit. |
| Deliverability tests this month | Inbox previews run against the total, with where the total comes from under the meter: the plan's number plus any tests the platform team added for the month. Through your own Mailgun account the count shows without a limit. | When the total is spent, the next inbox preview is refused until next month, or until the platform team adds tests. Added tests end with the month. |
| AI prompts this month | Report drafts asked for with AI · Ask for a Report, against the plan's number. A question back or a no-field answer does not count. | When the number is spent, Ask for a Report refuses the next draft on the platform's AI models until next month. A workspace that added its own key under Settings → AI Assistant can still draft with it. |
| Messages by Channel | Emails sent, SMS parts sent and MMS sent this month. | Nothing; a reading. Together they make Messages this month. |
| Invoices | Number, period, plan price plus any overage, total, and status: *Paid {date}*, *Due {date}* or *Void*. The last 36 issued invoices; an invoice appears shortly after the end of each month. | Nothing; a reading. Nothing is paid or changed from this page. |

## How to

**See whether a big send fits.** Compare the campaign's estimated recipients with what is left under Messages this month. A plan with overage sends and bills the extra; on a hard limit, publishing is refused once the month's messages are used up, and a run that starts after that fails.

**Ask for more.** The platform team changes the plan or its limits; the figures here follow at the next hourly refresh.

## What happens behind the scenes

Usage is rolled up hourly from the sends, the contacts and the files; the meters are read from that roll-up, so a send from a minute ago may not show yet. Deliverability tests, AI prompts and active users are counted live. The message check runs on every Production Publish, at the start of every run and before every receipt. The invoice is raised by the platform at month end from the same figures; overage is charged per started block of 1,000.

## Things to know

- The Sandbox text engine is not metered: trying text campaigns on it costs nothing against the plan.
- E-receipts count as messages.
- A text message longer than one part counts once per part.
