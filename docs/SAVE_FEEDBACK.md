# Save feedback

Every save in CEP says that it worked, or why it did not and what to do, in CEP's words. A browser's ("Failed to fetch"),
a framework's ("Internal Server Error", "Invalid input") or a database's wording never reaches the screen. The design is
`docs/mockups/save-feedback.html`; the chosen options are **A** (a "Saved" tick beside instant settings) and **1** (CEP's
own errors carry a reference).

## Which component when

| The save | It worked | It failed |
|---|---|---|
| A dialog that closes, a delete, an archive, a rename, a Settings form with a Save button | A toast: a short title ("Sender saved") and, when it helps, one sentence naming the thing ("“Shop orders” can no longer call CEP.") | The dialog's banner (or, for an action from a list or a page, a red toast that stays until closed) |
| An instant setting (a switch or select that saves as it changes) | "✓ Saved" beside the control, fading after two seconds (`SaveTick`) | "Not saved · Try again" beside the control; the reason under the card (`ErrorState`) |
| A save that shows its own result (import counts, a test's outcome, an editor's version line, Mail Server's "Saved") | That result, as before | As above |
| A form with fields | The toast or the page that opens | Each field shows its own message; the banner says "Check the highlighted fields" and lists anything not about a shown field |
| A save that opens what it made (a new campaign, template, journey, list) | Opening it is the confirmation | The dialog's banner |

## The sentences (`src/lib/saveFeedback.ts`)

The page names what failed ("The sender was not saved"); `saveFailure(error, failedTitle, shownFields?)` says why and what to do.

| What happened | Title | Sentence |
|---|---|---|
| No answer (offline, unreachable; status 0) | CEP could not be reached | "The sender was not saved. Your changes are still here; check your connection and try again." (a warning, not an error) |
| A refused entry (400) with fields | Check the highlighted fields | "The sender was not saved." plus the problems not about a shown field |
| A refused entry without fields | The page's title | The server's own sentence |
| Signed out (401) | The page's title | "Your session ended. Sign in again to carry on." The login page then says "Your session ended" too. |
| Not allowed (403) | The page's title | The server's reason, or "You do not have permission to do this. Ask a workspace administrator." |
| Gone (404) / changed by someone else (409) | The page's title | The server's sentence |
| The database not answering (503) | The page's title | "CEP's database is not answering. Your entries are still here; try again in a minute." (a warning) |
| CEP's own problem (500) | The page's title | "CEP had a problem at 2:32 PM. Your entries are still here; try again. If it happens again, give your administrator the reference ER-123." |

Toasts use the short form ("CEP had a problem at 2:32 PM. Try again." with the reference as a chip): `toast.failure(error, 'The template was not duplicated')`.
`ErrorState` and `problemText` use the same helper, so a page that passes its error to them speaks this way without more work.

Wording follows the design system's Content & Copy Rules: sentences stay sentences, second person, never "we", no
exclamation marks, no "Oops"; titles of toasts are short sentence-case phrases without a full stop.

## On the server (`backend/api/exceptions.py`)

Every API error answers `application/problem+json`, including errors raised outside a view (`handler500`).

| The database said | The answer |
|---|---|
| Unique violation | 400 on the field: "Another record already uses this code." (the field from the key, or the index name `ux_<table>_<column>` on tables with row-level security, where Postgres hides the key) |
| Check violation | 400 on the field named by the rule (`ck_<table>_<column>`): "This value is not one CEP allows here."; rules with their own sentence are in `CHECK_SENTENCES` |
| Not null | 400 on the column: "This field is required." |
| Value too long, not a number or date | 400: "A value is longer than CEP allows." / "A value is not in a form CEP can store." |
| Foreign key | 409: "This refers to something that no longer exists, or something else still uses it." |
| Row-level security, privileges | 403: "You do not have access to this record." |
| Serialization failure, deadlock | 409: "Someone else was saving at the same moment. Try again." |
| Connection lost, database down | 503: "CEP's database is not answering. Try again in a minute." |
| Anything else | 500: "CEP had a problem at 14:32 UTC. Try again. If it happens again, give your administrator the reference ER-123.", with `reference` and `at` |

A 400's title is "Check the highlighted fields" (it was DRF's "Invalid input"). The reference is `ER-<error group>`: the
error is recorded on the back-office's **Errors** page, and searching there for `ER-123` opens that group.

Tests: `backend/tests/test_save_feedback.py` (real database errors in a rolled-back test), `frontend/src/lib/saveFeedback.test.tsx`.
