# Notifications

**Where:** Settings → Sending → Notifications.

## What this page is for

Who is told when something happens: a send completed or failed, an approval was asked for or decided, a sending engine is in trouble, a subject test chose its winner, the weekly report. Three channels: the campaign's owner by email, fixed recipient addresses, and a chat webhook (Slack, Teams, anything that takes a text message).

## Who can use it

| | |
|---|---|
| Permission | `user.admin`. |

## The fields and controls

| Control | What it is | What it changes |
|---|---|---|
| Events | A row per event with a checkbox per channel: Owner by Email, Recipients by Email, Webhook. | Who hears about each event. |
| Email Addresses | Up to 20, separated by commas. | They get the events ticked under Recipients by Email. |
| Webhook URL | The chat webhook's address; *Working* once a test reached it, *Not Tested* before. | The events ticked under Webhook are posted there as a message. |
| Save | | |
| Send a Test Message | One message by every channel that is set, with the saved settings, and records when the webhook last worked. | |

### The events

| Event | When | Default channels |
|---|---|---|
| Send completed | A run finished, with sent and failed counts. | owner, webhook |
| Send failed | A run could not start, or nothing went out. | owner, recipients, webhook |
| Approval requested | Someone asked for approval. Every approver is always emailed; this adds the recipients and the webhook. | webhook |
| Approved or sent back | The decision, to the person who asked. | owner |
| Sending engine trouble | A circuit opened on an engine after repeated failures. | recipients, webhook |
| A/B winner chosen | The subject test's winner, with the two rates. | owner |
| Weekly report | Monday 08:00 in the workspace's zone, the last 7 days. | recipients |

## How to

**Get failures in a Slack channel.** Make an incoming webhook in Slack, paste its address, tick Webhook on Send failed and Sending engine trouble, Save, Send a Test Message.

**Keep marketing ops informed.** Put the shared mailbox under Email Addresses and tick Recipients by Email on the events that matter.

## What happens behind the scenes

Notifications are prepared inside the work they report on and sent after it, so a failed notification never fails a send. Email goes through the workspace's own mail server when one is entered, the platform's otherwise. An integration's Email Alerts switch under Integrations decides whether that engine's trouble reaches these channels.

## Things to know

- The campaign's owner is set on its Edit Details; a campaign without an owner has nobody to email under Owner.
- The weekly report's own recipients and schedule live under Reports.
