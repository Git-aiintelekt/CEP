# Approvals

**Where:** Settings → Engagement → Approvals.

## What this page is for

Whether a campaign needs a second person's approval before it can be published to production, and who can give it. With approvals on, a campaign's Review & Publish step asks for approval and the approvers see it under Campaigns → Awaiting Approval.

## Who can use it

| | |
|---|---|
| Permission | `user.admin` for the switch; approving needs `campaign.approve` on a role. |

## The fields and controls

| Control | What it is | What it changes |
|---|---|---|
| Require Approval Before a Production Publish | The switch, saved as soon as you change it. Default off. Greyed out, with *Nobody can approve yet. Give a role the campaign.approve permission under Roles first.*, while nobody can approve. | On: every campaign's Review & Publish step offers Request Approval, and Production Publish answers *not approved* until an approver has approved; the pre-publish checklist gains an *Approved for production* line. Off: campaigns publish without approval. Test publishing never needs it. |
| Waiting | Shown while approvals are on: *{n} campaigns waiting for a decision*, or *No campaign is waiting for a decision.* | Nothing; it tells you whether approvers have work waiting. |
| Open Them | The link after the count. | Opens Campaigns on the Awaiting Approval view: the campaigns whose approval was asked and not yet decided. |
| Who Can Approve | Every active user whose role carries `campaign.approve`, with name and email; *No Approvers* when there is nobody. A service account counts too. | These are the people emailed when someone asks for approval, and the only ones who can approve or send back. Deactivating a user, or taking the permission off their role, takes them off this list. |
| Change in Roles | The link beside Who Can Approve. | Opens Roles, where you add `campaign.approve` to a role (or create an approver role) and so add or remove the people listed here. |

## How to

**Switch approvals on.** Roles → give campaign.approve to the approvers' role (Change in Roles takes you there) → back here, switch on. From then on a Request Approval card appears on every campaign's Review & Publish step.

**Approve.** Campaigns → Awaiting Approval (or Open Them here) → open the campaign → Approve, or Send Back with a note saying what to change. The person who asked can never approve their own.

## What happens behind the scenes

Asking emails every approver; the decision goes back to the person who asked. Any change to the campaign, its lists or its targets after a request withdraws the request or the approval, with a note in the activity log, so what is approved is what is published. Notifications can also post requests and decisions to the chat webhook (Settings → Notifications).

## Things to know

- Test publishing never needs approval.
- A text campaign can need approval even with the switch off: when its estimated cost is above the approval limit under Settings → Message Costs, or would take the month over a budget set to Needs Approval. Its Review & Publish step then shows the Approval card, and the approvers listed here decide.
- Switching approvals off leaves pending requests where they are; the campaigns can simply be published.
- The switch cannot be turned on while nobody can approve; if the last approver later leaves, approvals stay on and campaigns wait until someone gets the permission.
