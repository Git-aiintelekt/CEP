# Governance

**Where:** Settings → Engagement → Audience → Governance. Home's Governance card opens it with **Open Governance**.

## What this page is for

How often marketing may reach one person, and what those rules did in the last 30 days. Every marketing send is checked against the rules just before it goes out: a person who has reached a cap is skipped by that send and counted as **Frequency Capped** on the campaign's results. Transactional messages and e-receipts are never capped and never count towards a cap.

Some caps are set by the platform team for your workspace (sometimes for several workspaces at once). They are shown locked, marked **Platform**. You add caps of your own beside them. Every cap applies at the same time, so a cap of your own can only make sending stricter than the platform's, never looser.

## The standard caps

Every workspace starts with the industry-standard set:

| Set By | Cap | Can You Change It |
|---|---|---|
| Platform | 1 marketing email per day, 1 text per day, 1 WhatsApp message per day | No: the platform's limit for every workspace, so nobody receives a burst of messages. |
| This Workspace | 3 emails per 7 days, 4 texts per 30 days, 2 WhatsApp messages per 7 days, 5 messages per 7 days across all channels | Yes: edit, switch off or remove any of them, and add more. |

A workspace with no caps of its own sees **Use the Recommended Caps**, which adds the workspace set in one go.

## Who can use it

| | |
|---|---|
| Open the page | Workspace administrators (`user.admin`, as for every Settings page). |
| Add, change or remove a cap | `governance.edit` on a role. Without it the page is read-only. |

## The fields and controls

| Control | What it is | What it changes |
|---|---|---|
| Last 30 Days · Recipients Checked | One for each person on each campaign send in the last 30 days, kept or skipped for any reason: a person on three sends counts three times. | Nothing: a figure. |
| Last 30 Days · Sent Within the Rules | The share of those recipients who were sent the message. | Nothing: a figure. A low share means many people were left out, by caps, consent, opt-outs or blocked addresses. |
| Last 30 Days · Skipped by a Cap | Recipients a cap held back. | Nothing: a figure. Each one is counted as Frequency Capped on the campaign's Recipients tab. |
| Frequency Caps table | Every cap that applies to this workspace: Channel, Most (for example *3 emails per 7 days*), Set By (**Platform** or **This Workspace**), In Use. | Each cap is checked on every marketing send of its channel. |
| Channel | Email, Text (SMS and MMS together), WhatsApp, or All Channels. | Which sent messages are counted. All Channels counts every email, text and WhatsApp message together; it applies to every marketing send. |
| Most | 1 to 1,000. | The number of marketing messages one person may have received in the period before the next one is skipped for them. |
| Days | 1 to 365. A rolling period ending now. | How far back the messages are counted. |
| In Use | A switch on each of your own caps; *On* or *Off* for the platform's. | Off: the cap stays listed but is not checked. |
| Add Cap | Opens the cap form. | Adds a cap of your own. It applies from the next send. |
| Use the Recommended Caps | Shown while the workspace has no caps of its own. | Adds the standard workspace caps above for every channel not capped yet. Each is then yours to change. |
| Edit | On your own caps. | Changes the cap from the next send; sends already built are not rebuilt. |
| Remove | On your own caps; asks first. | The cap no longer applies. |
| Locked | On the platform's caps. | The platform team changes or removes these in the back-office; you cannot. |
| Send Times | Read-only: the texts' quiet hours set by the platform, in the workspace's time zone. | A text due inside quiet hours waits until they end. A campaign can also go out at each recipient's local time (its Schedule step). |
| Priority and Exemptions | Read-only. | Transactional messages and e-receipts are never capped. A campaign can ignore the caps with **Apply Corporate Frequency Limits** off on its Schedule step; that is recorded in the activity log. |
| List Hygiene | Read-only. | A hard bounce or a spam complaint blocks an address at once; soft bounces block it after the number shown. Blocked addresses are listed under Suppressions. |

## How to

**Cap marketing email at three a week.** Add Cap → Channel **Email**, Most **3**, Days **7** → Add Cap.

**Keep one person from hearing from you more than five times a week, whatever the channel.** Add Cap → Channel **All Channels**, Most **5**, Days **7**.

**Pause a cap for a big launch.** Switch its **In Use** off, and on again afterwards. Or switch **Apply Corporate Frequency Limits** off on that one campaign's Schedule step.

## What happens behind the scenes

- The caps are checked when a send's audience is built. For each person, C360 counts the marketing messages they were sent in each cap's period (queued or failed ones do not count); if any cap is reached, the person is skipped.
- A platform cap is a copy of the platform team's policy in your workspace. When they change it, or take your workspace off it, your copy changes or disappears.

## Things to know

- Journey messages are not held back by the caps yet.
- A cap of 1 per day on email still lets a transactional email through the same day.
- Removing a cap does not resend anything to people it skipped earlier.
