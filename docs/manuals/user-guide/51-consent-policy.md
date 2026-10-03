# Consent Policy

**Where:** Settings → Audience → Consent Policy.

## What this page is for

How contacts come in. Every upload declares where its people agreed and the uploader confirms it in their own name; this page decides what happens to people without a consent date, whether a text list needs a text consent date for every number, whether a fresh upload must be approved before any campaign sends to it, the consent lifetime, and the sentence the uploader confirms. The send engine still decides for real at send time.

## Who can use it

| | |
|---|---|
| Permission | Read by anyone who uploads lists (the wizard shows the consequence); changed with `user.admin`. Approving lists needs `consent.edit`. |

## The fields and controls

| Field | What it is | What it changes |
|---|---|---|
| People Without Consent | *Import and hold back until they confirm* (the default) or *Refuse the row*. | Hold back: a new person without a consent date is imported and left out of marketing sends as *No consent on record* until they opt in. Refuse: the row is held back at the review as *No consent date* and listed in the row-by-row report. |
| Texts Need a Consent Date | A Texts or Email-and-Texts list cannot import a number without a text consent date in the file. | Marketing texts need an express opt-in; a number without one is held back as *No text consent date*. |
| Approval Before First Send | A new upload must be approved by someone with Consent · Edit before any campaign sends to its list. | The list reads *awaiting approval*; every campaign holds its people back as *in a list awaiting approval* until Approve. |
| Consent Lifetime | How long implied consent lasts without a purchase: 12, 24 or 36 months. | Kept on the compliance record; the reminder before it lapses is still to come. |
| Attestation Wording | The sentence the uploader confirms on the Consent step, up to 300 characters; `{workspace}` becomes the workspace's name. Shown on every compliance record. | |

## How to

**Tighten before a regulated campaign.** Set People Without Consent to Refuse and Approval Before First Send on. Uploads then reach a campaign only clean and approved.

**Word the attestation for your lawyers.** Save Wording with the sentence they gave you; the Consent step shows it from the next upload.

## What happens behind the scenes

The declaration (basis, where it was collected, who attested, when) is recorded on the upload and on every consent written from the file. The list's compliance record shows the source, every upload with its declaration, the approval, the policy as it stands today and today's consent by channel, rebuilt on every read.

## Things to know

- Changing the policy changes future uploads only; lists already imported keep what was recorded for them.
- A bought or rented list is never an allowed basis; the wizard refuses it.
