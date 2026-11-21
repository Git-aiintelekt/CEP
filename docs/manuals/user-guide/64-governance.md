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

## Gap Between Messages

A gap keeps marketing of one channel apart: a person who received a marketing email in the last 16 hours is skipped by the next email send, like Klaviyo's Smart Sending. Each channel (Email, Text, WhatsApp) has one gap of your own, switched on or off, from 1 to 168 hours (7 days). It starts at the recommended hours: 16 for email, 24 for texts and WhatsApp.

A gap is checked with the caps, and a person it skips is counted as **Frequency Capped** too. The platform team may also set a gap for your workspace; it is shown locked under its channel, and both apply.

A cap of one message per day already keeps 24 hours between messages, so a gap of 24 hours or less adds nothing while such a cap applies. The page says so under the gap. The platform's standard caps are 1 per day on every channel, so a gap of your own matters when it is longer than 24 hours, or when that cap is switched off.

## Send Windows and Quiet Hours

A send window says when marketing of one channel may go out: from one time to another, on chosen days, in the workspace's time zone. Quiet hours are the same rule seen from the other side: a window of 08:00 to 21:00 means quiet hours of 21:00 to 08:00.

A marketing send due outside its window is not skipped: it **waits** and starts when the window opens. A campaign scheduled for Saturday at 22:00 with an email window of 07:00 to 21:00 goes out on Sunday at 07:00 (or on Monday at 07:00 if Sunday is not one of the window's days). Transactional messages, e-receipts and test sends to testers never wait.

Each channel (Email, Text, WhatsApp) has one window of your own, switched on or off. The platform team may set a window for your workspace too; it is shown locked under its channel. Every window applies, so a send goes out only when it is inside all of them: your own can only narrow the platform's. A window whose hours never meet the platform's is refused, since nothing could ever go out.

A window can run past midnight (22:00 to 02:00); it belongs to the day it opens. Until a workspace has a text window, the platform's older quiet hours for texts still apply and are shown under Text.

A campaign set to **Send at Each Recipient's Local Time** is checked against its window when its send starts, in the workspace's time zone; each person's message then goes at their own local time.

## Blackout Dates

A blackout date is a day with no marketing at all, on any channel: Christmas Day, a national day of mourning, the day of a system change. It is read in the workspace's time zone, from midnight to midnight.

A marketing send due on a blackout date is not skipped: it **waits** for the next day that is not blacked out, and then for that channel's send window. With an email window of 07:00 to 21:00 and blackout dates on 25 and 26 December, a campaign scheduled for Christmas morning goes out on 27 December at 07:00. Transactional messages, e-receipts and test sends to testers never wait.

A date can be one day or a run of up to 31 days (24 December to 2 January), once or **Every Year** on the same dates. Holidays that move from year to year, such as Thanksgiving, Easter or Eid, are added for each year. The platform team may set dates for your workspace too; they are listed locked, marked **Platform**, and every date applies.

The list shows the soonest dates first. A one-off date that has passed stays listed, marked **Passed**, until you remove it. A date that is on now is marked **Today**.

## Unengaged Contacts

Mailbox providers such as Gmail and Outlook decide between the inbox and the spam folder partly by how many recipients ignore a sender. Mailing people who stopped reading long ago pulls every other message towards spam. **Unengaged Contacts** leaves those people out of marketing email.

A person is left out when all three are true:

1. Their first marketing email from CEP went out at least **180 days** ago, so CEP has watched them for the whole period.
2. They were sent at least **5** marketing emails in the last 180 days.
3. In those 180 days they made no **email click**, **text link click**, **purchase** (an order or an e-receipt) or **preference-page visit**.

Opens are not counted: Apple Mail opens every message on its own, so an open says nothing about the reader. Clicks made by security scanners are not counted either. Nobody is unsubscribed or added to Suppressions: the next click or purchase brings the person back on the next send. Texts, transactional email and e-receipts are never affected.

The card shows what the rule does today: how many of your email contacts it leaves out, how many engaged in the period, and how many are **too new to judge** (mailed for less than the period, or sent fewer emails than the minimum). It also shows the last 30 days: recipients left out, and people who came back after a click or purchase. **Download the People** gives a CSV of everyone left out, to build a win-back list from.

**A new install.** CEP judges a person only after the period has passed since their first marketing email, so for the first 180 days nobody is left out. The card says when it starts: "Starts 18 May 2027" for a workspace whose first marketing email went out on 19 November 2026. People added later each get their own 180 days.

**A win-back campaign** can reach these people: turn on **Include Unengaged Contacts** on the campaign's Schedule step. It is off by default and recorded in the activity log when the campaign is published.

The platform team may set a longest allowed, shown locked on the card ("Platform: at most 270 days"). Your own rule may only be stricter: fewer days, or fewer emails.

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
| Last 30 Days · Skipped by a Cap or Gap | Recipients a cap or a gap held back. | Nothing: a figure. Each one is counted as Frequency Capped on the campaign's Recipients tab. |
| Frequency Caps table | Every cap that applies to this workspace: Channel, Most (for example *3 emails per 7 days*), Set By (**Platform** or **This Workspace**), In Use. | Each cap is checked on every marketing send of its channel. |
| Channel | Email, Text (SMS and MMS together), WhatsApp, or All Channels. | Which sent messages are counted. All Channels counts every email, text and WhatsApp message together; it applies to every marketing send. |
| Most | 1 to 1,000. | The number of marketing messages one person may have received in the period before the next one is skipped for them. |
| Days | 1 to 365. A rolling period ending now. | How far back the messages are counted. |
| In Use | A switch on each of your own caps; *On* or *Off* for the platform's. | Off: the cap stays listed but is not checked. |
| Add Cap | Opens the cap form. | Adds a cap of your own. It applies from the next send. |
| Use the Recommended Caps | Shown while the workspace has no caps of its own. | Adds the standard workspace caps above for every channel not capped yet. Each is then yours to change. |
| Gap Between Messages · Hours | 1 to 168, one box per channel. Saved when you leave the box or press Enter. | How long after a marketing message of that channel the next one is skipped for that person. |
| Gap Between Messages · Switch | On or off, per channel. | On: the gap is checked from the next send. Off: it is kept with its hours but not checked. |
| Edit | On your own caps. | Changes the cap from the next send; sends already built are not rebuilt. |
| Remove | On your own caps; asks first. | The cap no longer applies. |
| Locked | On the platform's caps. | The platform team changes or removes these in the back-office; you cannot. |
| Send Windows · From, To | Times in the workspace's time zone, saved when you leave the box. To earlier than From runs past midnight. | When marketing of the channel may start and stop going out. |
| Send Windows · Days | Mon to Sun; at least one. Saved on each click. | The days the window opens. |
| Send Windows · Switch | On or off, per channel. It starts at the recommended hours: email 07:00 to 21:00, texts and WhatsApp 09:00 to 20:00, every day. | On: sends of the channel wait for the window from the next send. Off: kept with its hours but not checked. |
| Send Windows · Bar | The 24 hours, with the window marked. | Nothing: a picture of the hours. |
| Blackout Dates · Add Date | Opens the date form: Name, From, To, Every Year. | Adds a blackout date of your own. It applies from the next send. |
| Name | Up to 120 characters, such as Christmas; no two rules share a name. | Shown in the list and in a waiting campaign's activity log. |
| From, To | Dates in the workspace's time zone. To empty means one day; at most 31 days in all. A one-off date must not have passed. | The days no marketing goes out. |
| Every Year | A tick. | Repeats the dates every year. Off: the dates happen once. |
| Blackout Dates · Switch | On or off, on each of your own dates. | Off: the date stays listed but holds nothing back. |
| Blackout Dates · Edit, Remove | On your own dates; Remove asks first. | Changes or removes the date from the next send. Platform dates are locked. |
| Unengaged Contacts · Use 180 Days | Shown when no rule applies. | Adds the recommended rule: 180 days, at least 5 marketing emails. |
| Unengaged Contacts · Edit | Opens the rule: No Engagement In and After at Least. | Changes the rule from the next send. |
| No Engagement In | 30 to 360 days, or up to the platform's longest. Click history is kept 12 months. | The period a person must have gone without engaging. |
| After at Least | 1 to 20 marketing emails sent in the period. | A person sent fewer is never left out. The dialog shows how many would be left out today before you save. |
| Unengaged Contacts · Switch | On or off. | Off: nobody is left out. |
| Download the People | A CSV: customer ID, email, name, emails in the period, first marketing email, last engagement. | Nothing: a list to upload as a win-back audience. |
| Include Unengaged Contacts | On a marketing email campaign's Schedule step; off by default. | On: the campaign reaches unengaged contacts too. Recorded in the activity log. |
| Priority and Exemptions | Read-only. | Transactional messages and e-receipts are never capped. A campaign can ignore the caps with **Apply Corporate Frequency Limits** off on its Schedule step; that is recorded in the activity log. |
| List Hygiene | Read-only. | A hard bounce or a spam complaint blocks an address at once; soft bounces block it after the number shown. Blocked addresses are listed under Suppressions. |

## How to

**Cap marketing email at three a week.** Add Cap → Channel **Email**, Most **3**, Days **7** → Add Cap.

**Keep one person from hearing from you more than five times a week, whatever the channel.** Add Cap → Channel **All Channels**, Most **5**, Days **7**.

**Keep at least a day and a half between texts.** Gap Between Messages → Text: type **36** in the hours box, switch it on.

**No marketing texts on Sunday, and only from 10:00 to 20:00.** Send Windows → Text: From **10:00**, To **20:00**, click **Sun** off, switch it on.

**Stop mailing people who stopped reading.** Unengaged Contacts → Use 180 Days. To be stricter: Edit → No Engagement In **120** → watch the count change → Save Rule.

**Send a last "Do you still want our emails?" message.** Unengaged Contacts → Download the People → upload the CSV as a contact list → a new email campaign to that list → Schedule step → turn on **Include Unengaged Contacts**.

**No marketing over the holidays, every year.** Blackout Dates → Add Date → Name **Holidays**, From **24 Dec**, To **26 Dec**, tick **Every Year** → Add Date.

**Pause a cap for a big launch.** Switch its **In Use** off, and on again afterwards. Or switch **Apply Corporate Frequency Limits** off on that one campaign's Schedule step.

## What happens behind the scenes

- The caps are checked when a send's audience is built. For each person, C360 counts the marketing messages they were sent in each cap's period (queued or failed ones do not count); if any cap is reached, the person is skipped.
- A platform cap is a copy of the platform team's policy in your workspace. When they change it, or take your workspace off it, your copy changes or disappears.

## Things to know

- A journey's marketing messages are checked like a campaign's: a customer at a cap or within a gap skips that message and moves on. They also count towards the caps and gaps.
- A cap of 1 per day on email still lets a transactional email through the same day.
- A blackout date holds back a journey's marketing messages too: customers who reach that step wait together and are sent the next clear day.
- Unengaged Contacts applies to journeys' and drips' marketing emails too. A drip's Review step says so, with the share of your email contacts it leaves out today.
- A customer's page shows when they last engaged and whether marketing email leaves them out, under Engagement.
- The counts on the card are refreshed every 10 minutes.
- A drip whose message falls on a blackout date says so on its Review step, with the day it will go out instead.
- Removing a cap does not resend anything to people it skipped earlier.
