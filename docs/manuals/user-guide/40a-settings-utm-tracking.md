# UTM Tracking

**Where:** Settings → Engagement → UTM Tracking, and a **Link Tracking** row on each campaign's Content step, whose **Edit** leads here.

## What this page is for

UTM tags are the `utm_…` parameters added to the end of a link. Google Analytics 4 (and most analytics tools) read them to credit each visit to the right source, medium and campaign. C360 adds them to the links in your email and text campaigns, so you never tag links by hand and every campaign uses the same values.

## Who can use it

Anyone with Sending Engines · Edit (`provider.edit`) changes the workspace settings. Anyone who edits campaigns sees the campaign's Link Tracking row. Labels, a campaign name or a tactic set on a campaign before keep applying, but the Content step no longer changes them.

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

The Content step has a **Link Tracking** row in the card with Subject and Preheader. **Edit** (for anyone with Sending Engines · Edit) opens Settings → UTM Tracking in a new tab. The campaign's own switch, labels, campaign name and tactic are not edited on the Content step; values saved on a campaign before still apply.

`utm_source` cannot be Not Sent, and `utm_medium` and `utm_creative_format` always follow the campaign's channel.

**3. Change how an email campaign's links are tagged**

1. Open the campaign and go to its **Content** step (Edit → Content).
2. Choose the template. The **Link Tracking** row appears under Subject and Preheader.
3. To change how links are tagged, click **Edit**: Settings → UTM Tracking opens in a new tab.

**4. Send a text campaign with short links**

1. Make sure **Text Campaigns** is switched on (step 1).
2. Write the message with the full address of your page, for example `https://shop.northwindapparel.com/weekend`. The editor's counter already counts it as a short link, and says *links to your sites counted as short links*.
3. After sending, the campaign page shows how many times the link was opened.
4. Each recipient receives a short link such as `https://…/api/v1/l/NWA/k7Pq2Xs/`. Opening it counts a click and goes on to the tagged page.

**5. Test before you publish**

1. On the campaign, send a test to yourself.
2. Open a link in the test message and look at the browser's address bar: it ends with `utm_source=c360&utm_medium=email…` (for a text, the short link first opens, then the tagged address).
3. If Google Analytics 4 runs on your site, open **Reports → Realtime** in Google Analytics: the visit shows source `c360`, medium `email` or `sms`, and your campaign.

**6. Read the results in Google Analytics 4**

1. Open **Reports → Acquisition → Traffic acquisition**.
2. Change the table's first column to **Session campaign** (or **Session campaign ID**, which matches the campaign code and survives a rename).
3. Add **Session manual ad content** as a second dimension to see each link label, and the A/B variant (`hero-cta-a`, `hero-cta-b`).
4. GA4 files the visits under its **Email** and **SMS** channels in Reports → Acquisition → Traffic acquisition (Session default channel group).

**7. Send campaigns' links as written**

A campaign saved with tagging off keeps its links as written.

To stop tagging everywhere, switch off the channel on Settings → UTM Tracking and press Save.

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

## When something does not work

| What you see | What it means |
|---|---|
| The card says *UTM tracking is off for email campaigns* (or text) | The channel is switched off on Settings → UTM Tracking. Switch it on and save. |
| The card says *Link tagging is not switched on here yet* | This server does not have the link tracking update yet; links go out as written. |
| A link shows **Not Your Site** | Its domain is not under Your Sites. Add the domain and save. |
| A link shows **Never Tagged** | It is a mailto:, tel:, unsubscribe or preference link: these are never tagged. |
| Save says *Add at least one of your sites* | A channel is switched on without any site. Add one. |
| Google Analytics shows the visit as Direct or Referral | Check the link opened from a message sent after you saved, and that the address ended with the tags. A link to another site (not Your Sites) is not tagged. |
| A short link says *This link is not available* | The address was mistyped or cut off when it was copied. |
