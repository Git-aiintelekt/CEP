# WhatsApp Templates

**Where:** Templates → the WhatsApp tab; a WhatsApp template opens in the WhatsApp editor. The number itself is connected under Settings → Delivery.

## What this page is for

WhatsApp lets a business start a conversation only with a template Meta has approved. A WhatsApp template is written here with the workspace's tags, sent to Meta for review with **Submit to Meta**, and sent by campaigns once Meta approves it. Templates made directly in Meta's WhatsApp Manager appear here too, through **Sync from Meta**.

## Who can use it

| | |
|---|---|
| Permission | `template.edit` to write, submit, sync and activate. |
| Feature | **whatsapp**, switched on for the workspace by the platform team. The workspace needs its own Meta business account and a WhatsApp number connected under Settings → Delivery. |

## The fields and controls

### The WhatsApp editor

| Field | What it is | What it changes |
|---|---|---|
| WhatsApp Number | The connected number (engine) the template is for. | The Meta business account that reviews and sends it. |
| Name at Meta | Lower-case letters, digits and underscores, for example `back_in_stock`. | How Meta knows the template. Fixed once Meta has it. |
| Category | Marketing, or Utility for an update the person expects (a receipt, an order). | Meta charges by category, and moves anything promotional to Marketing. |
| Language | The language the words are in. | A template has one language; another language is another template. |
| Header | None, Text (up to 60 characters, the same for everyone), a Picture (JPEG or PNG up to 5 MB) or a Document (PDF). | Shown above the message. Meta reviews a picture or document header with the file you give it, and sends that file with every message. |
| Body | The message, up to 1,024 characters, with tags such as `{{first_name}}`. | What people read. Meta gets it with numbered variables (`{{1}}`, `{{2}}`) in the order the tags first appear. |
| Samples for Meta's Review | A sample value for every tag in the body. | Meta reviews the message with them. |
| If Empty | What to send when a person has no value for a tag. | Meta refuses a message with an empty value: without a fallback (or the tag's own default), that person's message fails. |
| Footer | A small grey line, up to 60 characters, for example *Reply STOP to opt out*. | Shown under the message. |
| Buttons | Up to 10: Link (at most 2), Quick Reply, Phone Number (at most 1). | A quick reply that starts with *Stop* opts the person out of WhatsApp when tapped. |
| Save | A new version, still a draft. | Nothing goes to Meta yet. |
| Submit to Meta | Sends the saved version for review. | The template is In Review; the status updates by itself when Meta decides, usually within minutes, at most 24 hours. |
| Copy to Change | A draft copy, under a name of its own. | A template in review or approved does not change: Meta sends exactly what it approved. The copy is reviewed again. |
| Activate | Makes an approved template usable by campaigns. | A template written here becomes active by itself when Meta approves it. |

### Where Meta's review stands

| Status | What it means |
|---|---|
| Not Submitted | Written here, not yet with Meta. |
| In Review | Meta is reviewing it. |
| Approved | Campaigns can send it. |
| Rejected | Meta's reason is shown; change it and submit it again. |
| Paused by Meta | Meta paused it for low quality (many people blocked or reported it). Campaigns cannot send it until Meta lifts the pause. |
| Disabled by Meta | Meta switched it off; copy it to make a new version. |

### A template made in WhatsApp Manager

Sync from Meta brings in every template of the number's business account. One made in WhatsApp Manager keeps Meta's words: the editor shows them with Meta's numbers and asks which tag fills each number, and what to send when it is empty. It can be used once every number has a tag.

## How to

1. Connect the number under Settings → Delivery (Add Engine → WhatsApp (Meta)), add its sender and Verify it.
2. Templates → WhatsApp → create a template, or start from one of the WhatsApp starting points.
3. Write the body with tags, give each tag a sample and, where a person may have no value, a fallback. Save.
4. Submit to Meta, and wait for Approved.
5. Create a campaign with the WhatsApp channel and pick the approved template on its Content step.

## What happens behind the scenes

- A WhatsApp message goes to people with a WhatsApp opt-in only, for every kind of campaign: Meta's rule. Consent to texts is not consent to WhatsApp. A list upload records it from a *WhatsApp consent date* column.
- A text STOP does not stop WhatsApp, and a WhatsApp STOP (typed, or a Stop quick reply) stops WhatsApp only.
- Meta reports Sent, Delivered, Read and Failed for each message; the campaign's Recipients tab shows Read, and its results count reads.
- Each person's values fill the approved template; the record of what they got is the template's words with their values.

## Things to know

- Meta rejects a body that starts or ends with a tag, or that has two tags side by side; the editor says so before you submit.
- Links in a WhatsApp message are not tagged with UTM parameters: Meta sends exactly the words and links it approved.
- A new number may start conversations with only a few hundred people a day until it has a sending history; Settings → Delivery shows the number's daily limit and quality.
- Not yet built: drip campaigns and journeys on WhatsApp, POS e-receipts on WhatsApp, a reply inbox, Meta's charge per campaign.
