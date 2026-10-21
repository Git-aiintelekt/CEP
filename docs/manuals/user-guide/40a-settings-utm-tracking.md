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

## Step by step

**1. Switch UTM tracking on for your workspace** (needs Sending Engines · Edit)

1. Open **Settings → Sending → UTM Tracking**.
2. Switch on **Email Campaigns**, **Text Campaigns**, or both.
3. Under **Your Sites**, type each domain your links lead to (for example `northwindapparel.com`) and press **Add** or Enter. Subdomains such as `shop.northwindapparel.com` are included. If you paste a full address, only its domain is kept.
4. Leave **Links That Already Have Tags** on **Keep their tags** unless every link must carry this workspace's values.
5. Check the **Example** at the bottom: it shows a hero button's address as it would go out.
6. Press **Save**. The message *UTM tracking saved* confirms it. Campaigns sent from now on carry the tags.

**2. Change a value (optional)**

1. In **Parameters**, open the **Value** list of the parameter.
2. Choose **Fixed Text** and type the value, choose a campaign field (Campaign Name, Campaign Code, Campaign Type, Channel, Link Label, Link Label and A/B Variant), or choose **Not Sent**.
3. The **Sent As** column shows the result for the example link. Values are sent lowercase with dashes.
4. Press **Save**. **Reset to Recommended** puts the recommended values back before you save.

`utm_source` cannot be Not Sent, and `utm_medium` and `utm_creative_format` always follow the campaign's channel.

**3. Label the links of an email campaign**

1. Open the campaign and go to its **Content** step (Edit → Content).
2. Choose the template. The **Link Tracking** card appears under the template and the preview, listing every link of the message.
3. For each **Tagged** link, check its **Label**: it starts as the link's text (an image link: its alt text). Type a clearer label where two links would read the same, for example `hero-image`, `hero-cta`, `footer-shop`, then click outside the field. It is saved at once.
4. Look at **Tagging**: **Own Tags Kept** means the link already had tags; **Not Your Site** and **Never Tagged** go out as written.
5. To use another campaign value in Google Analytics (for example the same name for a series), type it under **Campaign (utm_campaign)**. To file the campaign under a different tactic, choose one under **Tactic**.

You don't press Save for these: each change is kept as you make it.

**4. Send a text campaign with short links**

1. Make sure **Text Campaigns** is switched on (step 1).
2. Write the message with the full address of your page, for example `https://shop.northwindapparel.com/weekend`. The editor's counter already counts it as a short link, and says *links to your sites counted as short links*.
3. On the campaign's Content step, the Link Tracking card shows the link as a **Short link** and, after sending, how many times it was opened.
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

**7. Send one campaign's links as written**

1. On the campaign's Content step, switch off **Tag Links in This Campaign** in the Link Tracking card.
2. Its links go out exactly as in the template. Switch it on again at any time before sending.

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
