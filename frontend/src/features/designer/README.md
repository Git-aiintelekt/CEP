# Email designer (GrapesJS + MJML)

How the drag-and-drop email editor is integrated, end to end.

```
 TemplateDesignerPage          loads template, latest design, tag catalogue, image library (TanStack Query)
   └─ DesignerWorkspace        subject / preheader, Save, Activate, Preview, Tags panel, History panel
        └─ EmailDesigner       grapesjs.init({ plugins: [grapesjs-mjml] })  — no API knowledge
                                  │ getDesign()  → { editor_state, mjml_source }
                                  ▼
 POST /api/v1/templates/{id}/design/   { editor_state, mjml_source, subject_line, preheader, base_version }
   └─ apps/templates/design.py         renders HTML from the MJML **on the server** (mrml), derives the text part,
                                       writes version n+1 to template_design_state + rendered_template_content,
                                       syncs template_tag, returns findings
```

## The pieces

| Piece | Where | Notes |
|---|---|---|
| Editor | `EmailDesigner.tsx` | `grapesjs` + `grapesjs-mjml`. `storageManager: false`: persistence is ours, not GrapesJS'. Created once per mount; props are read through a ref so callbacks never re-create the editor. |
| Lazy loading | `App.tsx` | `lazy(() => import('@/pages/TemplateDesignerPage'))`: ~650 KB gzipped, fetched only when a designer opens. |
| What is saved | `getDesign()` | `editor.getProjectData()` (re-open exactly as left) **and** `editor.getHtml()`, which under the MJML plugin is the MJML source. |
| What is sent to customers | server | The browser never supplies the final HTML. The API renders it from the MJML with `mrml`, so stored HTML always matches the stored MJML, and scripts / `mj-include` / inline handlers / `javascript:` are rejected. |
| Versions | API | Every save is version n+1 in both tables. `base_version` is the optimistic lock: a stale save gets 409. Loading an old version and saving creates a new one; nothing is overwritten. |
| Personalization | `tags.ts`, RTE action `cep-tags` | `{{tag_key}}` tokens from `/personalization-tags/`. A menu in the rich-text toolbar inserts at the caret; the Tags panel inserts while editing text, otherwise copies. |
| Findings | API → notice bar | unknown tags, missing subject, missing `{{unsubscribe_url}}`, HTML over Gmail's 102 KB clip limit. Warnings on save; blockers on **Activate** (and the unsubscribe link blocks publishing a MARKETING campaign). |
| Images | GrapesJS asset manager → `POST /media-assets/` | Multipart upload, validated by decoding the bytes (PNG / JPEG / GIF / WebP, 5 MB), content-addressed per tenant (same file stored once), served from the CDN in production and `/media/` in development. Never base64-embedded. |
| Preview | `DesignerWorkspace` | `mjml-browser` compiles in the page; shown in an `<iframe sandbox="">` with tags replaced by their sample values. Desktop (680 px) and mobile (375 px). |
| Legacy / imported templates | `isProject()` | A stored state that is not a GrapesJS project (no `pages`) is ignored and the template opens from its MJML. |
| Styling | `designer.css` | Tailwind only: `@reference` to the app theme, GrapesJS' colour variables mapped to the design tokens, panels and fields skinned with `@apply`. GrapesJS' base stylesheet is the one vendor CSS file and ships only in this lazy chunk. The MJML plugin's own dark theme is switched off (`useCustomTheme: false`). |
| Starters | API `GET /template-starters/` | Server-side library (`backend/apps/templates/starters.py`). Choosing one on **New template** makes it version 1; its editor state is not a GrapesJS project, so it opens from MJML via `isProject()`. |

## Working on it

`/dev/designer` (development builds only) runs the real workspace on an in-memory backend: no sign-in, no API. It is
the place to check the editor visually; jsdom cannot lay out GrapesJS, so component tests mock the designer page and
cover the helpers (`tags.test.ts`) and the new-template form.

To add a custom MJML block or component, pass `customComponents` / `blocks` in the `grapesjs-mjml` options in
`EmailDesigner.tsx`. To add a tag source, add rows to `personalization_tag`; the menus pick them up.

### Spacing and units (2026-09-28)

MJML has no margin and email clients drop CSS margins, so the email carries one `padding` per block. The panel offers
two: **Margin** (outside the block) and **Padding** (inside it), kept apart on the component as `cep-spacing`
(`inspector/spacing.ts`) and written into the MJML `padding` attribute as their sum. A block never given a margin keeps
its plain attribute; a side that mixes px and % is refused. A button is the exception: its MJML `padding` is already the
space around it (Margin) and `inner-padding` the space inside (Padding). Length fields and the four spacing boxes accept
em and rem as well as px and %: they are written as px the moment they are committed (rem from 16px, em from the block's
effective font size, MJML's 13px when nothing sets one, `inspector/fields/length.ts`). On the Font Size field itself em
means the size the block inherits, or previewing 1.5em would move its own base under it. Picking em or rem shows the px
already in the box in that unit and writes nothing until Enter; the field settles on px afterwards. vh and vw are not
offered, an email has no viewport. Text, image, divider, spacer and social blocks offer Background Color: MJML's
`container-background-color`, the cell behind the block, since those tags have no `background-color` of their own.
