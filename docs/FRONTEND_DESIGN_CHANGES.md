# CEP front end: design system and sign-in work

This document records the front-end changes made to CEP in September 2026, in plain English: what changed, why, and what is still open.

No backend code was changed at any point.

---

## 1. Project guide for AI-assisted work

A file called `CLAUDE.md` now sits at the root of the project. It tells Claude Code, the AI coding assistant, how the project is organised. It covers:

- how to run the app and its checks
- where the main code lives
- the design rules every screen must follow

It was first written to cover the whole system. It was then refocused on the front end, since that is where current work happens.

---

## 2. Adopting the CEP design system

The design system arrived as a bundle of colours, type, spacing, shapes and motion, with written rules for using them. A copy of the bundle now lives in the project at `.claude/skills/cep-design/`.

### Colours, fonts and shapes

- **Colours.** The app's colours were replaced with the design system's. There is now one action blue, a navy sidebar and a cool grey palette. Colours for success, warning, error and callouts come from the design system too.
- **Page background.** The page background is white. An earlier version of the spec used a light grey; the later spec changed it to white.
- **Fonts.** Headings use Plus Jakarta Sans and body text uses Inter. Before this work, no font was actually being loaded, so the app was showing the computer's default font.
- **Corners.** Nothing is more rounded than 8px. Buttons and inputs use 4px, and cards and dialogs use 8px. About 60 overly rounded elements were corrected.
- **Shadows.** Cards and tables no longer have shadows; structure comes from thin grey lines instead. Shadows are kept only for menus, side drawers and notifications.
- **Colour codes.** About 200 places in the code used colours directly rather than the design system's named colours. All of them now use the named colours, so a colour can be changed in one place.

### Status labels

- Status labels (Draft, Test Published, and so on) show a small coloured dot on a light background.
- Status labels are never blue, because blue means "you can click this".
- The four campaign statuses always read exactly **Draft / Test Published / Production Published / Scheduled**, as the spec requires.

### Main layout

- **Sidebar.** The sidebar is now navy and 256px wide. It has icons and two sections, ENGAGE and MANAGE, and it can be collapsed to a 64px icon strip.
- **Top bar.** The top bar is 56px tall and has:
  - a page search, which jumps to pages in the menu
  - a notifications bell, which is switched off until notifications exist
  - the user's avatar
  - sign out
- **Controls and tables.** Buttons and inputs are one of three standard heights (32, 40 or 48px). Table rows are 40 or 48px.
- **Dialogs.** Dialogs are 480px wide, fade in, and keep keyboard focus inside them while open.
- **Icons.** Icons now come from the Lucide icon set. Text characters such as `←` and `×` were replaced with proper icons.
- **Error messages.** "Something went wrong" was replaced with messages that say what failed and what to do next.

### Token names

The design system's colour names were reorganised during the work:

- The blues became a numbered set: `brand-100`, `600`, `700` and `800`.
- The navy and teal became single-purpose names: `sidebar` and `wordmark`.
- The unused grey was removed.

The app and the design-system bundle both use the new names.

---

## 3. Working on different screen sizes

| Screen width | Behaviour |
|---|---|
| Very wide (above ~2100px, up to 4K and beyond) | The content area grows, up to 2400px |
| 1280px and up | Full sidebar, standard 48px table rows |
| 1024–1279px | Sidebar shrinks to icons; it slides over the page when opened; rows become 40px |
| 768–1023px | Two-column forms become one column |
| Below 768px | Sidebar hidden behind a menu button; tables become stacked cards; dialogs go full width |
| Below 640px | No dedicated phone design, but nothing breaks |

**Very wide screens.** The spec capped content at 1440px wide. On a 4K display that left the content as a narrow strip, with more than 1000px of empty space on each side. It now stays at 1440px on normal screens and grows on very large ones. This departs from the spec and was agreed; it is recorded in `CLAUDE.md`.

---

## 4. The new sign-in and password-reset screens

These screens were built from the "CEP Sign In" design in Claude Design.

### Layout

- **Wide screens.** On screens 860px and wider, a navy brand panel sits on the left and the form sits on the right. The panel has a moving gradient and the headline "Every customer signal, orchestrated into action."
- **Narrower screens.** The panel is replaced by a small CEP logo above the form.

### The screens

1. **Log in to CEP.** Email and password, with a show/hide button for the password and a "Forgot password?" link.
2. **Enter your code.** This screen appears only for people who have two-step sign-in switched on.
3. **Reset your password.** The user enters their email address to get a reset link.
4. **Check your email.** Confirms the link was sent and offers a Resend button.
5. **Set a new password.** Reached from the link in the email.
6. **Password updated.** Confirms the change and links back to log in.

### The loading animation

- **What it looks like.** After the user presses Log In, a full-screen navy animation plays: eight dots sweep in towards a softly pulsing centre.
- **When it plays.** It starts only once the email and password (or the two-step code) have been accepted, plays for 5 seconds, then hands over to the dashboard. A wrong password or code never shows it: the person just sees the error message.
- **How it hands over.** The animation fades out while the dashboard fades in and rises slightly into place, so the change feels continuous rather than a sudden cut.
- **Where it doesn't appear.** It is deliberately left out of the forgot-password flow.
- **Reduced motion.** People whose device is set to "reduce motion" see a simple fade with no movement.

### Where the build differs from the design, and why

- **Minimum password length is 12 characters, not 8.** The server requires 12, so a design showing 8 would reject passwords it claimed were fine.
- **The reset link lasts 72 hours, not 30 minutes.** 72 hours is how long the link really works.
- **The "Workspace" field is kept.** Every log-in must say which company workspace it belongs to, or the server refuses it. In live use the web address supplies the workspace (for example `northwind.cep…`), so the field never appears. It only shows when running the app on a developer's own computer.
- **Two-step sign-in and company single sign-on are kept.** The design did not show them. Without them, some users could not log in at all.
- **The "Prototype: open the reset link" shortcut was removed.** It only existed to demonstrate the design; in real use this step is an email.
- **Terms and Privacy are plain text, not links.** No such pages exist yet.
- **The wording is "Log in" and "Log In".** This was requested. The spec asks for sentence case on buttons, so "Log In" is a deliberate exception.

---

## 5. The forgot-password flow is not live yet

The screens are built, but **sending the reset email does not work yet**, because the server has no way to do it.

The server can already **set** a new password from a link. It cannot **create** a link for someone who is not logged in: only an administrator can create one today. Adding this is one small server change, and it was deliberately left for later.

Until that change is made, a user who asks for a reset link is told:

> "Password reset by email is not switched on yet. Ask your administrator to send you a link."

The screen never pretends an email was sent. When the server change is made, the flow will work with no further front-end work, and a test is already in place for it.

---

## 6. Things still open

| Item | Notes |
|---|---|
| **Transition speed is slowed down** | The fade to the dashboard is running at 4× its intended speed so it could be reviewed. The loader fade is 600ms (should be 150ms) and the dashboard settle is 1200ms (should be 240ms). Both are marked `TEMPORARY` in the code and should be put back. |
| Forgot-password email | Needs the server change described in section 5. |
| Campaign edit rules | The spec wants only some sections of a campaign locked once it has sent. Today the whole form locks. This needs a decision on the server side. |
| Template gallery | The spec wants a click to copy a template straight away, with a separate preview. Today you select a template, then submit. |
| Not built yet | Side drawers, pop-up notifications, the dashboard's "Create new" panel. The A/B test step was built on 2026-09-29 (CAMPAIGNS.md §8). |
| Workspace detection | If the app were ever served from a plain domain, for example `cep.example.com`, it would wrongly treat `cep` as the workspace name. This was already the case before this work and does not affect the normal setup, where each company has its own sub-address. |
| One unreliable test | A test for the SMS editor sometimes fails when all tests run together. It was already unreliable before this work and is unrelated to it. |

---

## 7. How the work was checked

- **Automated checks.** Every change was followed by the project's full set of checks: type checking, code-style checking, 73 automated tests, and a production build. All pass.
- **Browser checks.** Changes were also checked in a real browser. The team took screenshots at screen widths from phone size up to 5120px, and measured the timing and position of animations every 25 milliseconds.
- **Bugs found this way.** Several problems were caught by measuring rather than by eye:
  - the loading animation not appearing at all
  - the login screen flashing up before the dashboard
  - the brand panel sitting 39px too wide

## 8. The UX pass of 2026-09-27

What changed across the app, page by page, after the feature review:

- **Campaigns list:** saved views (Mine, Sending Today, Needs Attention, Awaiting Approval, Drafts), a Next Send column with
  the time in the campaign's zone, Pause / Resume / Approve on the row, and bulk Pause and Resume beside Clone and Archive.
- **Campaign setup:** Test now comes before Targets; Targets has Skip for Now; Review & Publish opens with a card naming
  anything unfinished. `setup_step` 4 is now "tested" and 5 "targets" (CAMPAIGNS.md §1).
- **Templates:** every card and row says which campaign last used the template and how many use it, so people know what
  is safe to change; an empty library says how to start.
- **Designer, Preview tab:** an Inbox control (Generic, Gmail, Outlook, Apple Mail) that changes the inbox row's cut-off
  and draws each client's known limits into the email; an Appearance control (Light / Dark) that darkens the email the way
  that client does (Gmail and Outlook invert, Apple Mail honours the email's own dark rules); a spam-word check under the
  subject beside the length note (`features/designer/spamWords.ts`).
- **Contact lists:** a Can Reach column (email and text, from `/contact-lists/{id}/reach/`), and a consent-state filter on
  a list's people (`?status=`).
- **Settings → Sending engines:** field labels in title case, from the engine catalogue.
- **Settings → Integrations:** Retry Send and Replay Callback on a log row, an Email Alerts switch on each card
  (INTEGRATIONS.md §6).
- **Across the app:** the top-bar search finds campaigns, lists and templates as well as pages (`GET /search/?q=`);
  keyboard shortcuts (`/` search, `n` new campaign, `g` then `c` / `t` / `l` / `h` to go to a page, `?` the list of them;
  never while typing in a field); Home says what to do when there are no campaigns yet.
- **Phones:** the tables that matter to a manager checking in (campaigns, a campaign's Overview and Performance, the
  Integrations log) stack into cards below 768px through `DataTable`; the campaigns list has its own card layout.

## 9. Designer fixes of 2026-09-29

- **Barcode and QR code blocks in a receipt:** they were listed in the receipt palette but could not be dropped anywhere.
  A receipt's body accepts the plugin's own block types and the receipt sections; the code block is a type of its own
  (`cep-code`), so it is now named in that rule too (`blocks/receiptBlocks.ts`). It lands between the sections, as the
  receipt blocks do.
- **Choose an Image:** an upload from the dialog went straight into the block, and the flag that arranged that was only
  cleared when the upload succeeded, so after a cancel or a failed upload the *next* upload from anywhere landed in
  whichever block was selected; with several files at once, whichever finished first was used. Now one file goes
  straight into the block, several are kept in the library to pick from, and closing the dialog or a failed upload
  clears the flag (`EmailDesigner.tsx`, `assets/ImagePicker.tsx`).
- **Social Links, TikTok:** MJML's icon set has no TikTok, so the designer serves the icon itself
  (`frontend/public/social-icons/tiktok.png`, a white glyph on transparent, like MJML's) and writes it on the element
  as a full address with the network's colour behind it (`inspector/social.ts`, `OWN_ICONS`). Choosing TikTok for an
  existing icon writes the same; choosing a network MJML draws again drops them. To use the official mark, replace
  the PNG; keep it square, white on transparent. Any further network goes in `OWN_ICONS` the same way.
- **Texts, emoji:** the note under a message with emoji named each one by its code point as though it were a fault. It
  now says what they cost ("Emoji (💳) make this a Unicode message, so each part holds 70 characters instead of 160.
  This message is 5 parts instead of 2.") and that carriers deliver them. A curly quote or a long dash is still named
  by its code, with Use Plain Punctuation beside it, because those are usually pasted in by accident
  (`messaging/MessageWorkspace.tsx`, `messaging/sms.ts`).

## 10. Designer: drops into columns, Custom HTML layout, device visibility, phone stacking (2026-09-29)

- **Custom HTML and the code blocks into a column.** The MJML plugin lets an `mj-raw` be dragged into the body or the
  head only, and a block that extends it inherits that, so Custom HTML could only sit between sections and the barcode
  and QR code blocks (a type of their own, which no parent's list named) could not be dropped anywhere — Enter on the
  palette tile was the only way in, and it bypasses the rules. `blocks/rawPlacement.ts` names the parents MJML
  itself accepts (body, column, wrapper, hero) on both types, closes them to drops (`droppable: false`: their markup
  is the panel's), and adds the code type to each parent that lists its children.
- **Custom HTML: Width, Alignment, Margin, Padding, Background Color** (`inspector/customHtmlSettings.ts`). MJML gives
  an `mj-raw` no attributes, so these live in a wrapper table inside the block's own markup (`class="cep-html"`: the
  outer cell carries margin and alignment, the inner table the width, the inner cell padding and background). The
  HTML field edits what is inside; a block without settings stays exactly as typed, and clearing every setting takes
  the wrapper away again. Centred and full width are the defaults and are never stored.
- **Hide on Phones and Hide on Desktop on every block** (before: Hide on Phones, sections only). Hide on Desktop is
  the same mechanism the other side of the breakpoint: class `cep-hide-desktop` and one `mj-style` in the head kept in
  sync (`syncHideDesktopStyle`), mirrored in the canvas through a `data-cep-desktop` attribute painted beside the
  phone one. Outlook for Windows and Windows Mail ignore media queries and show a phones-only block; the toggle says
  so. Layers and the breadcrumb mark both.
- **On Phones, on a section** (`inspector/stacking.ts`): *Stack, Left First* (MJML's own), *Keep Side by Side* (the
  columns wrapped in an `mj-group`, MJML's way of holding columns together on a narrow screen — a menu bar), *Stack,
  Right First* (`direction="rtl"` on the section with the columns stored right to left: desktop unchanged, a phone
  stacks the right column first; MJML sets `direction:ltr` on each column, so the words inside stay left to right).
  Layers lists the columns in stored order, so a right-first section reads right to left there.
- **Enter on a Custom HTML or code tile follows the selection** the way a drag now can: into the chosen column, after
  a chosen block inside one, otherwise beside the sections as before (`blocks/dropLevel.ts` level `raw`,
  `blocks/insertTarget.ts`).
