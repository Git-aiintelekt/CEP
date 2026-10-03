# The CEP manuals

Two guides, written as Markdown chapters so they live with the code and the app can show them:

| Guide | Chapters | Readers |
|---|---|---|
| CEP User Guide | `user-guide/*.md` | everyone who signs in to a workspace |
| CEP Platform Guide | `platform-guide/*.md` | the platform team in the back-office |

Chapters are numbered so they sort into reading order (`00-introduction.md`, `20-contact-lists.md`, `40-settings-sending-engines.md`). Each page's chapter has the same sections: what the page is for, who can use it, the fields and controls (a table: control, what it is, what it changes), how to, what happens behind the scenes, things to know.

## Help in the app

The workspace app shows the User Guide's chapters itself: `frontend/src/help/chapters.ts` maps a chapter key to its file, the `PageHelp` icon beside a page's title opens that chapter in a side panel, and a field's `help` text opens a note on that one field. The Markdown subset the panel renders (headings, paragraphs, bullet and numbered lists, tables, bold, code, links) is the one the chapters are written in; keep to it.

## Building the Word copies

```bash
node docs/tools/build_manuals.js
```

writes, for each guide, one Markdown file with a table of contents (`CEP_User_Guide.md`, `CEP_Platform_Guide.md`) and a Word document (`.docx`) beside it. The script needs the `docx` package (`npm install docx` in any folder on the path, or `npm install -g docx`).
