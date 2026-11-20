# Consent Policy

**Where:** Settings → Engagement → Consent Policy.

## What this page is for

How contacts come in. Every upload declares where its people agreed and the uploader confirms it in their own name; this page decides what happens to people without a consent date, whether a text list needs a text consent date for every number, whether a fresh upload must be approved before any campaign sends to it, the consent lifetime, and the sentence the uploader confirms. The send engine still decides for real at send time.

## Who can use it

| | |
|---|---|
| Permission | Read by anyone who uploads lists (the wizard shows the consequence); changed with `user.admin`. Each setting is saved as soon as it is changed, with a *Saved* tick beside it. Approving lists needs `consent.edit`. |

## The fields and controls

| Control | What it is | What it changes |
|---|---|---|
| People Without Consent | What an upload does with a new person who has no consent date in the file: *Import and hold back until they confirm* (the default) or *Refuse the row*. Saved as soon as you choose. | Hold back: the person is imported and left out of marketing sends as *No consent on record* until they opt in. Refuse: the row is held back at the review as *No consent date*, listed in the row-by-row report and not imported. |
| Texts Need a Consent Date | A switch, off by default. Saved at once. | On: a Texts or Email and Texts list cannot import a number without a text consent date in the file; such a number is held back as *No text consent date*. Off: a number without a text consent date is imported; the send engine still decides at send time. |
| Approval Before First Send | A switch, off by default. Saved at once. | On: a new upload must be approved by someone with Consent · Edit before any campaign sends to its list. Until then the list reads *awaiting approval* and every campaign holds its people back as *In a List Awaiting Approval*. Off: an upload can be sent to as soon as it is imported. |
| Consent Lifetime | How long implied consent lasts without a purchase: 6 months, 1 year, 2 years (the default) or 3 years. Saved as soon as you choose. | Kept on every list's compliance record as part of the policy. It does not yet hold anyone back: the reminder before consent lapses is still to come. |
| Attestation Wording | The sentence the uploader confirms on the Consent step of an upload, up to 300 characters; `{workspace}` becomes the workspace's name. *Reads as:* shows the result. Default: *I confirm these people agreed to receive marketing from {workspace}*. | **Save Wording** changes the sentence from the next upload on. The uploader must tick it before the import can be applied, and it is stored, in their name, on the upload and every compliance record. A blank sentence is refused. Uploads already made keep the sentence they confirmed. |

## How to

**Tighten before a regulated campaign.** Set People Without Consent to Refuse and Approval Before First Send on. Uploads then reach a campaign only clean and approved.

**Word the attestation for your lawyers.** Save Wording with the sentence they gave you; the Consent step shows it from the next upload.

## What happens behind the scenes

The declaration (basis, where it was collected, who attested, when) is recorded on the upload and on every consent written from the file. The list's compliance record shows the source, every upload with its declaration, the approval, the policy as it stands today and today's consent by channel, rebuilt on every read.

## Things to know

- Changing the policy changes future uploads only; lists already imported keep what was recorded for them.
- A bought or rented list is never an allowed basis; the wizard refuses it.
