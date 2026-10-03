# Approvals

**Where:** Settings → Workspace → Approvals.

## What this page is for

Whether a campaign needs a second person's approval before it can be published to production, and who can give it. With approvals on, a campaign's Review & Publish step asks for approval and the approvers see it under Campaigns → Awaiting Approval.

## Who can use it

| | |
|---|---|
| Permission | `user.admin` for the switch; approving needs `campaign.approve` on a role. |

## The fields and controls

| Control | What it is | What it changes |
|---|---|---|
| Require Approval Before a Production Publish | The switch. Refused until at least one user can approve. | Production Publish answers *not approved* until an approver has approved; the pre-publish checklist gains an *Approved for production* line. |
| Who Can Approve | Every active user whose role carries campaign.approve. | Add the permission to a role under Roles to add a person here. |
| Waiting | How many campaigns wait, with a link to the list. | |

## How to

**Switch approvals on.** Roles → give campaign.approve to the approvers' role → here, switch on. From then on a Request Approval card appears on every campaign's Review & Publish step.

**Approve.** Campaigns → Awaiting Approval → open the campaign → Approve, or Send Back with a note saying what to change. The person who asked can never approve their own.

## What happens behind the scenes

Asking emails every approver; the decision goes back to the person who asked. Any change to the campaign, its lists or its targets after a request withdraws the request or the approval, with a note in the activity log, so what is approved is what is published.

## Things to know

- Test publishing never needs approval.
- Switching approvals off leaves pending requests where they are; the campaigns can simply be published.
