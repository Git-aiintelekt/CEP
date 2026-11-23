# Campaign Content step: redesign build plan

The Content step of the campaign editor (`/campaigns/:id/edit?step=content`, step 2) redrawn as a short form on the left and a live preview on the right. Frontend only, no backend change.

Reference mockups (the user's own designs):
- `docs/mockups/content-step-1-overview.png`: the step, Email tab of the preview
- `docs/mockups/content-step-2-choose-template.png`: the "Choose a template" drawer
- `docs/mockups/content-step-3-override.png`: Subject and preheader overridden, In the Inbox tab of the preview

Code today: `frontend/src/apps/cep/features/campaigns/wizard/StepTemplate.tsx` (the step), `SubjectPreheaderCard.tsx`, `LinkTrackingCard.tsx`, `../MessagePreview.tsx`, `../parts.tsx` (`Panel`). Shared pieces to reuse: `components/Drawer.tsx`, `components/Form.tsx`, `components/PillRadioGroup.tsx`, `components/SegmentedControl.tsx`, `designer/preview/InboxRow.tsx`.

## Decisions already made with the user
1. **Choose a template is a right-side drawer**, as drawn. This is a deliberate exception to the "modals, not drawers" rule; use the shared `Drawer` (480px).
2. **Title Case** for UI labels (the mockups are sentence case; the project rule wins, as on the Add Contact List dialog). Full sentences stay sentences.
3. **Topic stays conditional**: shown only for marketing campaigns when the workspace has topics for that channel; required to publish when shown. Looks like the "Choose a topic" dropdown in the mockup.
4. **Texts and WhatsApp get no preview tabs**: the phone preview they have today. Email and E-Receipt get the Email / In the Inbox tabs and the desktop/mobile toggle.
5. **Link tracking: the row's Edit goes to Settings → UTM Tracking** (`/settings/utm-tracking`, new tab). See "What this removes" below: the user chose this knowing it drops per-campaign controls.

## What this removes (accepted by the user, not a bug)
Removing the Link Tracking card takes these per-campaign controls off the campaign: the "Tag Links in This Campaign" switch, the Campaign (`utm_campaign`) and Tactic (`utm_marketing_tactic`) overrides, per-link label editing, the tagging verdict per link, and a text's per-link click counts. The campaign keeps using the workspace's UTM settings and its saved per-campaign values stay as they are; the endpoint `PUT /campaigns/<id>/link-tracking/` is simply no longer called from this step. If those controls are still wanted per campaign, they need a new home (a modal from Edit was offered and declined); raise it again before building if that changes.

## Design (what the screens show)
**Left column, top to bottom**
1. `Template` label, then a row: template name, its status tag (Active / Draft), and a **Change** outline button (opens the drawer). When no template is chosen: an empty state in the same row, "Choose a Template" button.
2. `Send From`: the sender select (pill, "Choose a sender").
3. `Topic`: the topic select ("Choose a topic"), conditional (decision 3).
4. One grouped card with two rows divided by a hairline:
   - **Subject and Preheader**, with an **Override** link on the right. Collapsed by default. Override expands the row in place: Subject Line and Preheader fields, each with a "22 / 60" counter and an emoji button, and the link becomes **Use Template's** (clears both back to the template's). Starts expanded when the campaign already has its own subject or preheader.
   - **Link Tracking**, with an **Edit** link on the right (to Settings, decision 5). A one-line summary under the title, as in the third mockup: "Off. Links go out as written." / "On. 3 of 4 links carry UTM tags." / "This message has no links." / before the draft is saved: "Set up after the draft is saved."

**Right column: the preview card**
- Header: tabs **Email** and **In the Inbox** (email-type templates only) and a desktop / mobile toggle on the right.
- Email tab: the rendered message (today's `MessagePreview`, with `controls` so the card owns the device). Before a template is chosen: the grey wireframe with "Choose a template to see it here". Before the draft is saved: "The preview appears once the draft is saved."
- In the Inbox tab: three inbox rows with the campaign's row in the middle (`InboxRow`), using the override if there is one, else the template's. Caption "Updates as you type."

**Choose a template drawer** (480px, `Drawer`)
- Title "Choose a Template", a search field ("Search templates"), and a list of cards: name, status tag, and on the selected card a small preview of the template. Selected card: Blue 100 fill, Blue 600 border, Blue 800 name.
- Footer: link "Create New Template" on the left (opens `/templates/new` in a new tab, only with `template.edit`), **Cancel** (outline) and **Use Template** (primary) on the right. Nothing changes on the page until Use Template; the current template is preselected when the drawer opens.

## Everything that must keep working
- Only templates that fit the campaign's channel (`TEMPLATE_FIT`, `fit`) and are not archived are listed; E-Receipt campaigns use their own fit rule.
- Warning when the chosen template is the wrong channel, and when it is a Draft ("can be tested from here; a production publish needs it published first"). Keep them, as notices under the Template row.
- Sender: only senders for the channel; unverified ones marked "(not verified)"; a notice when the picked sender isn't verified; the empty-state hint with "New Sender" (link to Settings → Sending Engines, only with `provider.edit`); the marketing reminder about the unsubscribe link / "Reply STOP". Keep the information, shorter, as helper text under Send From.
- Required fields and errors: template, sender, topic show their `errors.*` messages. Saving a draft needs none of them; publishing needs all.
- Subject and preheader: blank means "use the template's"; saved as `subject_line` / `preheader`; counters from `useFieldRules`; emoji picker; the "tags such as {{first_name}} work" note.
- "Open in the Designer / Message Editor / WhatsApp Editor" for the chosen template (`editorRouteFor`), only with `template.edit`. Place it in the preview card header or under the template row.
- Escape closes the drawer, focus returns to the Change button, focus is trapped while it is open (`Drawer` already does this). Cards are a radio group with arrow-key support.
- Form values unchanged: `template`, `sender_profile`, `topic`, `subject_line`, `preheader`. No API call or payload changes.

## Phases (build one at a time; stop for the user to look on :5173)

### C1: The form and the preview card
- Rebuild `StepTemplate` as the two-column layout: Template row (with Change, drawer comes in C2, so for now Change opens nothing or scrolls to the old list; prefer to build C1 and C2 together if that is awkward), Send From, Topic, the grouped card with the two rows (rows static for now), and the preview card with its header, tabs and device toggle.
- Preview: Email tab via `MessagePreview` `controls`; In the Inbox tab via `InboxRow`; texts and WhatsApp keep the phone preview with no tabs.
- Move all warnings and helper text as described above.
- Done when: the step matches mockup 1 for an email campaign, a text campaign still previews, and publish-blocking errors still show.

### C2: Choose a template drawer
- New `ChooseTemplateDrawer` beside `StepTemplate`: search, radio-group list, selected-card preview (reuse the template thumbnail used on the Templates page / setup dialog if one exists, otherwise the neutral wireframe from the mockup), footer links and buttons as drawn.
- Wire Change and the empty-state button. Use Template sets `template` (with `shouldDirty` and `shouldValidate`); Cancel and Escape leave it as it was.
- Done when: it matches mockup 2, search works, wrong-channel templates never appear, Create New Template opens in a new tab.

### C3: Subject and preheader override
- Convert `SubjectPreheaderCard` into the collapsible row: Override expands, Use Template's clears both, starts expanded when either is set. Keep counters, the emoji picker and the tags note.
- The In the Inbox tab updates as the fields are typed.
- Done when: it matches mockup 3; clearing leaves the template's values in the inbox row.

### C4: Link Tracking row and clean-up
- Replace `LinkTrackingCard` on this step with the summary row and the Edit link to Settings → UTM Tracking. The summary reads the existing link-tracking queries (`choices` / `preview`) read-only.
- Delete the now-unused card code and its tests only after checking nothing else imports it (the campaign page's Content tab may still show link tracking: check `UtmTracking.test.tsx`).
- Update the User Guide chapter for campaign set-up (`docs/manuals/user-guide/32-campaign-setup.md` and the combined `CEP_User_Guide.md`): Content step rows, the drawer, and where link tracking is now edited.
- Done when: no dead code, guide updated.

## Tests (run only the tests tied to the changed files; never the whole suite unless asked)
- `wizard/StepTargets.test.tsx`, `wizard/SetupFlow.test.tsx` (they walk through the Content step), the existing Content-step tests, `settings/UtmTracking.test.tsx`.
- New: a drawer test (preselected current template, search, Use Template commits, Cancel and Escape don't, focus returns), an override test (starts collapsed, expands, Use Template's clears, starts expanded when set), a preview-tabs test (email shows tabs, text does not).
- Always: `npm run typecheck` and `npm run lint`; the theme test (`src/lib/theme.test.ts`) when styles change.

## Open points to confirm while building
- Is there an existing template thumbnail component or endpoint for the selected-card preview? If not, use the neutral wireframe and say so.
- Where "Open in the Designer" sits (preview card header is the suggestion).
- The empty Template row for a campaign with no template yet (not drawn in the mockups).
- Whether the campaign page's own Content tab, which shows the same information read-only, should get the same restyle (out of scope here unless asked).
