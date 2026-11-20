# AI Assistant

**Where:** Settings → General → AI Assistant.

## What this page is for

This page decides whether C360 may use AI in reports, which AI providers it may use, whose key pays for them, and whether a report's rows may be sent to the AI for a short reading. It is one switchboard for every AI feature of Insights:

- **Ask for a Report** on Insights → AI Reports, which turns a prompt into a draft report.
- **Change With AI** in the report editor, which changes the report you are editing from a prompt.
- **Write It for Me** in a Report Database's query window, which writes the SQL from a prompt.
- **What the Rows Show** in a report's Explain panel, and the **Written Summary** tile on a dashboard, which describe a report's rows in a few sentences.

Two providers are offered: Claude (Anthropic) and OpenAI. Each runs either on the platform's key, within your plan's monthly allowance, or on your workspace's own key, which your plan does not limit.

## Who can use it

| | |
|---|---|
| Permission | `user.admin` (workspace administration) to open the page, change the switches and add or remove keys. |
| Using the AI features | Ask for a Report, Change With AI and Write It for Me need `report.edit` or `report.admin`. What the Rows Show and the Written Summary tile are for anyone who can open the report or dashboard. |

## The fields and controls

| Control | What it is | What it changes |
|---|---|---|
| Use AI in Reports | The main switch. On by default. It cannot be switched on while no provider is in use (the page says so). | **On:** the AI features above are offered to the people allowed to use them, and **AI Reports** appears in the Insights menu. **Off:** none of them is offered; reports are built in the editor only, and no prompt or field name leaves C360. The provider switches and Explain This Report are greyed out while it is off. |
| Providers | One row per provider, with its state: **Provided by the Platform**, **Not Offered**, or, with your own key, **Not Checked Yet**, **Checked** (with the time) or **Check Failed** (with the provider's reason). The line under the name says which models it runs. | What people can pick at the bottom of the prompt box. |
| Allow (the switch beside a provider) | Shown when the platform offers the provider and you have no key of your own for it. On by default. | **Off:** that provider's models are no longer offered in this workspace. With every provider off, the AI features are not offered even with Use AI in Reports on. |
| Use Your Own Key / Add Your Own Key | Opens the key form. **Use Your Own Key** when the platform offers the provider; **Add Your Own Key** when it does not. | Once saved, the provider runs on your key from then on (see below). |
| Edit Key | Opens the key form for a key you already saved. | Change the models, or replace the key. |
| Check Connection | Asks the provider for the account's model list with your stored key, and looks for your two models in it. | Records the result and its time on the provider's row. A key that does not work shows the provider's message; a model name the account does not list is named, so you can correct it. Saving a new key clears the last check. |
| Use the Platform's Key / Remove | Deletes your own key, after asking. **Use the Platform's Key** when the platform offers the provider; **Remove** when it does not. | Prompts go through the platform's key again, within your plan; or, when the platform does not offer the provider, its models leave the picker. |
| Explain This Report | Shown once a provider is in use. On by default. Greyed out, with "Switched off for the platform by the platform team.", when the platform does not allow it. | **On:** What the Rows Show and the dashboard's Written Summary tile are offered. **Off:** both are refused; the free What This Means tab of the Explain panel stays. |
| AI Prompts This Month | The prompts counted this month, against your plan's allowance when it has one ("12 of 200"), or "No limit on this plan". | Nothing; a reading. It also says how long prompts and drafts are kept: 90 days. |

### The key form

| Field | What it is | What it changes |
|---|---|---|
| API Key | The key from the provider's console (console.anthropic.com → API Keys, or platform.openai.com → API Keys). Required the first time; when a key is stored, leave it empty to keep it. | Stored encrypted and never shown again. The browser never sees it: every call goes from C360's server to the provider. |
| Model for Reports | The provider's model name, offered in the picker as "Best for reports". Filled in with the recommended model: `claude-sonnet-5-5` for Claude, `gpt-5` for OpenAI. Up to 80 characters: letters, digits, dots, dashes, underscores and colons. | The model the prompts run on when someone picks "Best for reports". |
| Fast Model | The second model, offered as "Fastest". Filled in with `claude-haiku-5-5` for Claude, `gpt-5-mini` for OpenAI. Same rules. | The model the prompts run on when someone picks "Fastest". |

Prompts on your own key are billed to you by the provider and are not limited by your plan.

## How to

**Switch AI off for the whole workspace.** Switch off **Use AI in Reports**. It saves at once (a tick confirms it). AI Reports leaves the Insights menu and the AI features are no longer offered; anything that still asks is answered "AI is switched off for this workspace (Settings → AI Assistant)."

**Use only one provider.** Leave **Use AI in Reports** on and switch off the provider you do not want. Its models leave the picker.

**Run on your own Claude key.** Press **Use Your Own Key** on the Claude row, paste the key, keep or change the two models, **Save**, then **Check Connection**. The row now says "Your own key" and prompts on it no longer count against the plan.

**Keep report rows away from the AI.** Switch off **Explain This Report**. Ask for a Report and Change With AI still work: they never send rows.

**Go back to the platform's key.** Press **Use the Platform's Key** on the provider's row and confirm.

## What happens behind the scenes

1. **What the AI receives.** Ask for a Report and Change With AI send your prompt and the names, types and calculations of the fields you may use (Change With AI also sends the report being edited), never customer rows. Write It for Me sends your request and the database's table and column names. What the Rows Show and the Written Summary tile send the report's name, its column names and up to 100 of the rows the person sees; columns hidden from that person as personal data are left out.
2. **Which key is used.** For each provider, your own key wins over the platform's whenever you have one, whatever the provider's Allow switch says. Otherwise the platform's key is used when the platform offers the provider and the switch is on.
3. **Which model is offered first.** The platform team's default model, when your workspace offers it; otherwise the first model in the list (Claude's model for reports when Claude is in use).
4. **What counts as a prompt.** Only results count: a draft from Ask for a Report, a report changed by Change With AI, a query from Write It for Me, an explanation from What the Rows Show or the Written Summary tile. A question back from the AI, an answer to it, and a failed call do not count. Only prompts on the platform's key count; prompts on your own key are never counted.
5. **When the allowance runs out.** Prompts on the platform's key are refused for the rest of the month, with a message saying how many were used. Prompts on your own key, and building reports by hand, carry on.
6. **What is kept.** Every prompt is recorded in the workspace for 90 days, with who asked, the model and the outcome, for your audit trail. Documents and images sent with a prompt are not kept.

## Things to know

- The platform team decides which providers the platform's key offers and whether Explain This Report is allowed at all. This page can narrow that, never widen it, except by adding your own key.
- Switching AI off does not touch the reports the AI made: they are ordinary reports and stay where they are.
- The What This Means tab of the Explain panel uses no AI and is there whatever this page says.
- The AI can be wrong. A draft is checked against your data before you see it, but read an explanation's figures before you act on them.
- Ask for a Report is described step by step in the Insights chapter; Write It for Me in the Report Databases chapter.
