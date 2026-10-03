# Plan & Usage

**Where:** Settings → Workspace → Plan & Usage.

## What this page is for

What the workspace's plan allows and how much of it this month has used: messages, contacts, active users, storage, deliverability tests; the messages by channel; and the invoices the platform has issued. Plans and limits are changed by the platform team; this page is the reading.

## Who can use it

| | |
|---|---|
| Permission | `user.admin`. |

## The fields and controls

| Control | What it is | What it changes |
|---|---|---|
| The plan | Its name and status; the month shown. | |
| Messages this month | Sent messages against the plan's limit; *Then … per 1,000* when the plan allows overage, *Hard limit* when it does not. | At a hard limit sends stop until the next month or a plan change. |
| Contacts | People in the workspace against the limit. | |
| Active users | Against the plan's limit; Users refuses a new one past it. | |
| Storage | Media and files, in GB. | |
| Deliverability tests this month | Inbox previews run against the allowance. | A spent allowance refuses the next test until next month. |
| Messages by Channel | Email, SMS, MMS this month. | |
| Invoices | Number, period, plan, amounts, status, issued and due dates. An invoice appears shortly after the end of each month. | |

## How to

**See whether a big send fits.** Compare the campaign's estimated recipients with what is left under Messages this month. A plan with overage sends and bills the extra; a hard limit stops the run when it is reached.

**Ask for more.** The platform team changes the plan or its limits; the figures here follow within the hour.

## What happens behind the scenes

Usage is rolled up hourly from the sends, the contacts and the files; the meters are read from that roll-up, so a send from a minute ago may not show yet. The invoice is raised by the platform at month end from the same figures.

## Things to know

- The Sandbox text engine is not metered: trying text campaigns on it costs nothing against the plan.
- E-receipts count as messages.
