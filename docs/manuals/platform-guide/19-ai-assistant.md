# AI Assistant

**Where:** Configuration → AI Assistant.

## Step by step: switching AI on

1. Open Configuration → AI Assistant in the back-office.
2. On the Claude (Anthropic) or OpenAI card, paste the API key from the provider's console, keep or change the two model names, leave **Workspaces May Use This Provider** on, and press **Save**.
3. Press **Check Connection**. The card shows Connected with the time, or Failed with the provider's reason; the check also says when a model name is not in the account's list.
4. Under the cards, choose the **Default Model** and whether **Explain This Report May Send Totals**, then **Save**. The plans' prompts a month are set on each plan.
5. From then on every workspace on a plan with prompts sees Ask for a Report above its report list, unless its administrator switches AI off under Settings → AI Assistant. The table at the bottom counts this month's drafts by workspace.

## What this page is for

Insights can turn a prompt into a report: a person writes what they want to see on Insights → AI Reports (in the menu
only while a provider with a key is switched on and the workspace allows AI), picks a model, and gets a draft back in words, checked against the report catalogue the same way as a report built by hand.
The model is Claude (Anthropic) or OpenAI, reached from CEP's own server with a key the platform team enters here. The
browser never sees a key, and no customer row ever leaves CEP: the model receives the prompt and the names of the
fields that person may use. A prompt may run to 100,000 characters and carry up to three documents (a spec as PDF,
Word, Excel, CSV, text or Markdown) and five images, sent to the provider with the prompt and never stored; a PDF goes to the
model as it is, a Word file as its text, an Excel workbook as its sheets' rows (500 a sheet at most). For one of a workspace's Report Databases the model may also be given the
names and columns of tables not mapped yet; a draft on them is mapped as a dataset only when someone opens it.

Each workspace decides for itself whether AI is used in its reports (Settings → AI Assistant), and its plan sets how
many drafts it may ask for in a month.

## The providers

One card per provider, Claude (Anthropic) and OpenAI:

| Field | What it does |
| --- | --- |
| API Key | From the provider's console (console.anthropic.com → API Keys, platform.openai.com → API Keys). Typed to set or change it, stored encrypted, never shown again; the label says "stored" once it is. Leave it empty on a later save to keep the saved key. |
| Model for Reports | The model offered as "best for reports", by its exact name at the provider (for example `claude-sonnet-5-5`, `gpt-5`). |
| Fast Model | The model offered as "fastest" (`claude-haiku-5-5`, `gpt-5-mini`). |
| Workspaces May Use This Provider | Off keeps the key but takes the provider's models out of every workspace's picker. |

**Check Connection** reaches the provider with the key and looks for the two models in the account's model list. The
result stays on the card (Connected, Failed with the reason, Not Checked after a new key). **Remove** deletes the key and
the card's settings; workspaces can no longer pick that provider.

Model names are settings, not code: a newer model is a change on this page, not a release.

## A workspace's own key

A workspace may enter its own key for either provider under Settings → AI Assistant, with the two models to offer. Its
own key wins over the platform's for that provider, so a workspace can use a provider the platform does not offer, or
keep its prompts on its own account. Prompts on a workspace's own key are not counted against its plan and do not
appear in the table below; the row is the workspace's, in `ai_provider` with its tenant id, and never shown here.

## Defaults

- **Default Model**: preselected for people who have not chosen one. A person's own choice is remembered in their browser.
- **Explain This Report May Send Totals**: whether the (coming) Explain This Report feature may send a report's totals to
  the model. Personal-data fields are never sent. Each workspace has its own switch under this one.
- **Prompts a Month**: read from the plans. Set it on each plan (Plans → AI prompts a month; empty means unlimited; the
  seeds are Starter 50, Growth 200, Enterprise unlimited). Only a draft counts; a question back or a no-field answer
  does not.

## This month, by workspace

The table at the bottom counts this month's drafts by workspace and provider against the workspace's number. A
workspace that reaches its number is told so at the prompt and can still build reports in the editor.

## What happens on a prompt

1. CEP checks the workspace's switch, the provider the person picked and the month's number.
2. It sends the provider the prompt and the catalogue of the datasets and fields that person may use (locked
   personal-data fields are left out), with the workspace's time zone and today's date, and asks for a reply in a fixed
   shape: a draft, one question, or no field for this.
3. A draft's definition is validated against the catalogue. One that does not fit is sent back once with the reason; a
   second miss is reported to the person as a failure, nothing is saved.
4. A draft is previewed under the preview cap for its row count, recorded against the month, and shown in words. **Open
   in Editor** makes it a private report of the person's, with its first version noted "Drafted by AI".
5. Every prompt, its model, outcome, token counts and draft are kept in the workspace for 90 days.

## When something is off

- The page says patch 0055 is missing: apply it; until then no workspace is offered AI.
- A workspace sees no prompt box: no provider is switched on here, or the workspace switched AI off, or the person
  cannot build reports (the box needs the report.edit right).
- Check Connection says a model is not in the account's list: the name is wrong for that account, or the account has
  no access to it; the prompt will fail until it is fixed.
