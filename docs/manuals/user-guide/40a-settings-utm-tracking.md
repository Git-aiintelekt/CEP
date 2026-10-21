# UTM Tracking

**Where:** Settings → Sending → UTM Tracking, and on each campaign's Content step under **Link Tracking**.

## What this page is for

UTM tags are the `utm_…` parameters added to the end of a link. Google Analytics 4 (and most analytics tools) read them to credit each visit to the right source, medium and campaign. C360 adds them to the links in your email and text campaigns, so you never tag links by hand and every campaign uses the same values.

## Who can use it

Anyone with Sending Engines · Edit (`provider.edit`) changes the workspace settings. Anyone who edits campaigns sees the campaign's Link Tracking and can change its labels and its own campaign name and tactic.

## The fields and controls

### Settings → UTM Tracking

| Control | What it is | What it changes |
|---|---|---|
| Email Campaigns / Text Campaigns | Switch tagging on for each channel. | Campaigns sent from now on carry the tags. Text campaigns' links also become short links that count clicks. |
| Parameters | One row per UTM parameter: its value is fixed text, a campaign field, or Not Sent. **Sent As** shows what it goes out as for an example link. | What every tagged link carries. Values are sent lowercase with dashes: "Fall Launch" goes out as `fall-launch`. |
| Reset to Recommended | Puts back the recommended values (below). | |
| Your Sites | The domains whose links are tagged, with their subdomains. | Only links to these sites get tags. |
| Links That Already Have Tags | **Keep their tags** (recommended): a link someone tagged by hand keeps its values, and missing parameters are added. **Replace them with these**: every link carries this workspace's values. | |
| Example | The hero button of an example campaign, as it would go out. | |

Never tagged, whatever the settings: links to other sites, `mailto:` and `tel:` links, and the unsubscribe and preference links.

### The recommended values

| Parameter | Google Analytics 4 field | Value |
|---|---|---|
| `utm_source` | Session source | `c360` (required) |
| `utm_medium` | Session medium | `email` or `sms`, by the campaign's channel. GA4 files these under its built-in Email and SMS channels. |
| `utm_campaign` | Session campaign | The campaign name, e.g. `fall-launch-new-arrivals` |
| `utm_id` | Session campaign ID | The campaign code, e.g. `cmp-2026-0042`: it stays the same when the campaign is renamed |
| `utm_content` | Session manual ad content | The link's label, plus the A/B variant: `hero-cta-b` |
| `utm_term` | Session manual term | Not sent (it is for paid-search keywords) |
| `utm_source_platform` | Session source platform | `c360` |
| `utm_creative_format` | Session manual creative format | `email` or `text`, by the channel |
| `utm_marketing_tactic` | Session manual marketing tactic | From the campaign type: `promotional`, `transactional` (e-receipts), `nurture` (drips), `lifecycle` (journeys) |

### The campaign's Link Tracking (Content step)

| Control | What it is | What it changes |
|---|---|---|
| Tag Links in This Campaign | On by default when the workspace has tagging on for the channel. | Off: this campaign's links go out as written. |
| Campaign (utm_campaign) | This campaign's own campaign value; empty uses the campaign name. | |
| Tactic (utm_marketing_tactic) | This campaign's own tactic; empty uses the campaign type. | |
| Links | Every link of the chosen template: its text and address, its **Label** (utm_content), whether it is **Tagged**, **Own Tags Kept**, **Not Your Site** or **Never Tagged**, and the address it opens (email) or its short link and clicks (texts). | A label is saved as soon as you leave the field; it follows the link as long as its address stays the same. |

These choices are saved on their own, as you change them.

## How to

**Switch tagging on.** Settings → UTM Tracking → switch on Email Campaigns, Text Campaigns or both → add your sites (e.g. `northwindapparel.com`) → check the Example → Save.

**Tell two links apart.** On the campaign's Content step, under Link Tracking, give each link a clear label (`hero-image`, `hero-cta`, `footer-shop`). In Google Analytics, the clicks show under Session manual ad content.

**Check that it works.** Send a test from the campaign, open a link and look at the address bar: it ends with the tags. In Google Analytics, open Reports → Realtime: the visit shows source `c360`, medium `email` or `sms`, and the campaign. After a real send, Reports → Acquisition → Traffic acquisition, filtered by Session campaign or Session campaign ID.

## What happens behind the scenes

1. When each message is personalised, C360 adds the tags to every link to your sites, in the HTML and in the plain-text part.
2. In a text, each tagged link becomes a short link on C360's address (`…/api/v1/l/<workspace>/<code>/`), so it fits in fewer characters. The message editor counts the short link, not the long address.
3. Opening a short link counts a click and goes straight on to the tagged page. A link preview that only asks where it goes is not counted.
4. Postal's own click tracking still works for email: its redirect lands on the tagged address.

## Things to know

- Changes apply to messages sent after you save; messages already sent keep the links they went out with.
- Test sends are tagged too, and clicks on a test text's short link are counted.
- Text clicks are counted per link, not per person.
- Values are always lowercase with dashes, because Google Analytics treats `Email` and `email` as different sources.
