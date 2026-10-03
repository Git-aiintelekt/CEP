# Preference Centre

**Where:** Settings → Audience → Preference Centre.

## What this page is for

A page where a customer chooses which channels and topics they receive, reached from a link in your emails. Off by default: then only the unsubscribe link exists. Switched on, every marketing email can carry `{{preference_url}}`, campaigns are filed under topics, and a person who unticks a topic is left out of its campaigns.

## Who can use it

| | |
|---|---|
| Permission | `user.admin`. The topic a campaign is filed under is chosen with `campaign.edit` on its Content step. |

## The fields and controls

| Control | What it is | What it changes |
|---|---|---|
| Offer a Preference Centre | The switch. | Off: only the unsubscribe link; the tag resolves to it; topics and words are kept. On: the page is live and campaigns need a topic. |
| In Your Templates | The tag `{{preference_url}}` with Copy. | The person's own page at send time; the unsubscribe page while the centre is off, so an email never carries a dead link. |
| Last 30 Days | Page opened, topics unticked, unsubscribed from the page, opted in again. | |
| Topics | A table: name and description, channels, Opted Out (people who unticked it), Shown or Hidden, Edit. Add Topic opens the form. | |
| The topic form | Name (as shown on the page), Description (one line under it), Offered On (Email, Texts), Shown to Customers. Remove warns how many campaigns are filed under it. | A hidden topic stays on campaigns but not on the page. Removing a topic takes it off the page and the set-up's choices; a campaign filed under it is told at publish. |
| Page | Brand Name (blank = the workspace's), Heading, Email Description, Text Messages Description, Footer (your postal address satisfies the sender-identification rule), Privacy Notice Link (https), Let People Opt In Again, Save, Open Preview. | The words on the customer's page. With opting in again off, a switched-off channel is shown locked with the date. |

## How to

**Switch it on.** Add the topics (for example *Rewards and offers*, *New arrivals*, *Store events*), write the page's words, Save, Open Preview; then the switch. Put `{{preference_url}}` in the footer of your templates.

**File a campaign.** On the campaign's Content step, Filed Under → the topic. Needed to publish while the centre is on.

## What happens behind the scenes

The link carries a signed token naming the workspace, the person and the send; the page needs no sign-in and shows the masked address, an Email switch, a Texts switch when a mobile number is on file, a checkbox per shown topic, *Receipts and order updates* locked on, Save Preferences and *Unsubscribe from all marketing messages*. Channel changes are consent records; topic choices are kept per person, and the audience builder leaves out people who unticked the campaign's topic, counted as *Opted Out of This Topic*. A test send's link opens the page as a preview that saves nothing.

## Things to know

- The unsubscribe link stays required in marketing email whether the centre is on or off.
- While a topic has no shown entry the page offers the channels only, and campaigns need no topic.
