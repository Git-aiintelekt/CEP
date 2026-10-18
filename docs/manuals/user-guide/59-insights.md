# Insights: Reports, Dashboards and Scheduled Delivery

**Where:** Insights, in the app launcher (the grid icon at the top left), and the Insights item in Engagement's menu, which opens the same reports.

## Step by step: the AI features

**Ask for a Report** (anyone who can build reports)

1. Open Insights → Reports. The Ask for a Report box sits above the list; it is there once your platform has switched on an AI provider and your workspace allows it.
2. Write what you want to see in your own words, pick a model beside Generate, and press **Generate Report** (or Ctrl+Enter).
3. Read what comes back. A **draft**: check its name, view, data, rows, columns, values and filter, then **Open in Editor** to make it a private report of yours and open the editor. **One question first**: press the answer that fits; answering does not cost a prompt. **No field for this**: pick one of the closest prompts, or ask your platform team to map the data.
4. Your recent prompts sit under the box, each with the report it became. The line at the top right counts the month's prompts against your plan; only a draft counts.

**Use AI in your workspace** (workspace administrator)

1. Open Settings → AI Assistant. **Use AI in Reports** is on by default; switch it off to hide every AI feature and keep every prompt inside CEP.
2. For each provider, allow or disallow it with its switch, or press **Use Your Own Key** (or **Add Your Own Key** when the platform does not offer it) to enter the workspace's own key and the two models, then **Check Connection**. The workspace's key wins over the platform's, and prompts on it are not counted against the plan.
3. **Explain This Report** decides whether a report's totals may be sent to the model; personal-data fields are never sent.
4. **AI Prompts This Month** shows the count against the plan.

**Write It for Me** in the query window is described in the Report Databases chapter.

## Step by step: measures, comparisons, charts and slicers

**Use a calculated measure in a report** (anyone who can build reports)

1. Open Insights → Reports → **New Report** and pick a dataset, such as Messages.
2. Drag a rate, such as Delivered Rate, into **Values**. Its calculation reads **Calculated** and is the only choice.
3. Add a dimension to **Rows**, such as Channel. The rate is worked out per row and in every total, as a rate of the totals.
4. A rate with nothing to divide by shows as empty.

Workspace administrators add calculated measures to their own datasets (Report Databases chapter); your platform team adds them to the platform's datasets.

**Compare a measure with an earlier period**

1. In the editor, group the report by a date: drag the date into **Rows** and choose **by Month** (or Day, Week, Quarter, Year).
2. Under a measure in **Values** (or in **Summarize** in Steps), open **Add a Comparison** and pick one: **Previous Month**, **Last Year**, **Change vs Previous Month**, **Change vs Last Year**, **Running Total** or **% of Total**. The names follow the date's grouping: Previous Week on a weekly report.
3. Each comparison is a column after its measure, named in words, such as Sent Count, Change vs Last Year. A change and a share read as percentages.
4. Up to four per measure; the cross on a comparison removes it. Running Total and % of Total add up sums and counts only, and an option the report cannot take says why.
5. The earlier figures come from the same report moved back in time, so the first month of the period has its previous month too.

**Drill down in a chart**

1. Open a report with more than one level, such as Sent by Year then Channel, and choose **Chart**.
2. The line above the chart says what a click drills to. Click a bar, a slice or a stage: the chart shows the level below for that value, such as the quarters of 2026, then their months, then their days, then the next dimension.
3. The path above the chart shows where you are. Click any step to go back to it, or **Up One Level**.
4. On a dashboard, turn on **Drill Down** in a chart tile's header first: while it is on, a click drills that tile instead of filtering the others. Turn it off to go back to the top and to cross-filtering.

**Show a report as a pie or a funnel**

1. In the report editor or viewer, choose **Chart**, then **Pie** or **Funnel**.
2. **Pie** shows the first measure by the first dimension. The total sits in the middle, and the legend gives each value with its share. More than eight slices fold into Other.
3. **Funnel** shows each row as a stage, in the report's sort order, with its value, its share of the first stage and the change from the stage before. Sort the report into the order the stages should run.
4. Press **Save** in the editor to keep the choice.

**Add slicers to a dashboard** (its owner or a report administrator)

1. Open the dashboard and press **Edit**.
2. Under the period, press **Add Slicer** and choose a dimension, such as Channel or Store. The list shows the dimensions of the tiles' datasets, up to six.
3. Remove one with its cross, then press **Done**.

**Filter a dashboard with slicers**

1. Each slicer is a chip under the period. Open it, search, tick values and press **Apply**.
2. Every tile whose data has that field narrows to those values. A tile without the field says **Not sliced by** that field.
3. **Clear** takes the values off.

**Cross-filter by clicking**

1. Click a bar, a pie slice, a funnel stage or a cell in a grid tile. The other tiles narrow to that value.
2. If the field is not one of the dashboard's slicers, a chip appears for it; its cross takes the filter off.
3. Clicking the same value again clears it. Dates cannot be clicked this way, since the period already covers them.
4. Slicer and click selections are never saved. A PDF export or a scheduled delivery always shows the dashboard as saved.

## What Insights is for

Insights is the suite's reporting app. It lets you build your own reports on the data C360 already keeps, your messages, the orders they led to, your contacts and your journeys, see them as a grid, a chart, a hierarchy or a pivot, put them on a dashboard with one period for all of them, export them as CSV, Excel or PDF, and have them emailed on a schedule. Nothing is collected for it; it reads what the rest of the suite records.

## Who can use it

| Permission | What it allows |
|---|---|
| Reports · View (`report.view`) | Open and run the reports and dashboards shared with the workspace, export them, star favourites, switch a report's view. |
| Reports · Edit (`report.edit`) | Make and change your own reports, dashboards, folders and schedules; delete your own. |
| Report Admin (`report.admin`) | Everything on every report, dashboard, folder and schedule in the workspace; build on personal-data fields; see the Run Log. |
| User Admin (`user.admin`) | Also builds on personal-data fields. |

The workspace needs the Insights component switched on by the platform team; without it the menu does not offer Insights.

## The datasets

A report is built on one dataset. Each offers **dimensions** (things to group by, such as Campaign, Channel or Sent month) and **measures** (numbers to total, such as Sent Count or Revenue). The datasets today:

| Dataset | One row per | Typical use |
|---|---|---|
| Messages | Every email and text a campaign sent | Sends, deliveries, opens and clicks by campaign, channel or month. |
| Attributed Orders | Every order the shop reported and the campaign it was credited to | Revenue by campaign, channel, store or month. |
| Contacts | Every contact in the workspace | Contacts by city, region, source or consent. |
| Journey Enrolments | Every customer in a journey | Enrolments, completions and conversions by journey. |

Fields marked **PII** carry personal data (a customer's identifier, an email address). Building on them needs Report Admin or User Admin. When you open a shared report that has such a column and you lack the right, its values are masked and the grid says so.

## Reports

### The list

Insights → Reports lists every report you can open, grouped by the component whose data it uses, with its view, dataset, owner and last run. Your **favourites** sit first: press the star on any row to add one. **Folders** group a workspace's reports; the chips at the top filter by folder or by No Folder, and the folder shows under the report's name. Search finds a report by name.

### Making a report

1. Press **New Report**, pick a dataset and give it a name. It opens in the editor with the dataset's first columns.
2. Build it with one of the two editors, switched at the top right and remembered for you:
   - **Field Wells**: the dataset's fields on the left, the result in the middle, the wells on the right. Click or drag a field into **Rows** (one line per value), **Columns** (one dimension spread across, for the pivot and the chart's series) or **Values** (a number to total, with its calculation). **Filters**, then **Sort and Limit**, sit under them.
   - **Steps**: the question written top to bottom as numbered steps: Data, Filter, Summarize, Group By, Sort and Limit. Each step has an Add button; the result sits under the steps.
   A date dimension can be grouped **by Day, Week, Month, Quarter or Year**. A measure has its calculation: Sum, Count, Distinct Count, Average, Min or Max, and under it **Add a Comparison** (the steps are at the top of this chapter).
3. **Filters**: one row per rule (field, operator, value), joined with **and** or **or**. A list is comma-separated, a range is from..to, "in the last days" takes a number. Dates are the workspace's time zone.
4. The preview runs as you build, up to the preview cap. The line above it says how many rows, how long, and how fresh the data is.
5. **Save** writes a new version. Cancel drops the changes.

### Ask for a Report, with AI

When your platform has switched on an AI provider and your workspace allows it (Settings → AI Assistant), a prompt box sits above the report list for people who can build reports.

1. Write what you want to see, in your own words: "Revenue by channel and month for the last quarter, as a pivot". The examples under the box are a start.
2. Pick a model beside Generate: Claude or OpenAI, whichever your platform offers, each with a "best for reports" and a "fastest" model. Your last choice is remembered.
3. Press **Generate Report** (or Ctrl+Enter). The model receives your prompt and the names of the fields you may use, never customer rows, and answers in one of three ways:
   - **A draft**, in words: its name, view, data, rows, columns, values and filter, with how many rows the preview gives. **Open in Editor** makes it a private report of yours and opens it in the editor; nothing is shared until you save and share it. **Try Again** asks once more; **Edit Prompt** puts your words back in the box.
   - **One question first**, when the prompt has two readings ("which period is last month?"), with the answers as buttons. Answering does not use another prompt.
   - **No field for this**, when no dataset holds what you asked for, with the closest prompts the catalogue can answer. The model never makes a field up; ask your platform team to map the data if you need it.
4. The line at the top right counts the month's prompts against your plan. Only a draft counts. Your recent prompts sit under the box, with the report each became.

Prompts and drafts are kept in the workspace for 90 days. Settings → AI Assistant switches AI off for the whole workspace, or allows only one of the providers.

**Your own key.** Under Settings → AI Assistant each provider shows whether it runs on the platform's key or on yours. **Use Your Own Key** (or **Add Your Own Key**, when the platform does not offer that provider) takes your API key from the provider's console and the two models to offer; the key is stored encrypted and never shown again, and **Check Connection** proves it works. Your own key wins over the platform's for that provider, and prompts on it are billed to you by the provider and not limited by your plan. **Use the Platform's Key** goes back.

### The four views

Any report switches between the views without losing its fields; the switch sits above the result, in the editor and in the viewer. The editor saves the choice; the viewer switches for a look.

| View | What it shows | What it needs |
|---|---|---|
| Grid | One row per record or group, sortable and resizable columns | Anything |
| Chart | Bars, lines or area: the first dimension along the bottom, a series per value of the dimension across (else one per measure), the legend to show and hide, Show the Numbers under it. **Pie**: the first measure by the first dimension as shares, the total in the middle, more than eight slices folded into Other. **Funnel**: the rows in the report's order as stages, each with its share of the first and the drop from the one before | A dimension and a measure |
| Hierarchy | The dimensions in their order, each group folding over the next, a subtotal per group, Expand All and Collapse All | Two dimensions and a measure |
| Pivot | The dimension across as columns, one measure in the cells (a select when there are several), a total on both edges | A dimension down, one across, a measure |

Subtotals and totals come from the engine, so averages and distinct counts are exact, and a report longer than the page still totals everything. A comparison column is not added up into a subtotal.

**Calculated measures.** Some measures are made from others: Delivered Rate is Delivered ÷ Sent × 100, Average Order Value is Amount ÷ Orders. They sit among the measures with the one calculation **Calculated**, and the engine computes the formula in every view, subtotal and figure, so a rate of a group is the rate of its totals, never an average of rates. A rate with nothing to divide by reads as empty. Your platform team adds them to the platform datasets; a workspace administrator adds them to a mapped dataset under **Calculated Measures** on the mapping page (Report Databases chapter).

### The viewer

Opening a report runs it and shows the saved view. Above the rows: the view switch; under the title: what the run says (rows, time, freshness, version) and, once scheduled, the schedule line. The buttons:

| Button | What it does |
|---|---|
| Folder | Files the report in a folder, or in a new one (owner or administrator). |
| Versions | Every saved version with who, when and the note. **Open** shows one as it was, read-only, with Back to Current. **Restore** makes it the current version again, as a new version; nothing is lost. |
| Schedule | Emails the report on a schedule (below). |
| Edit | The editor (owner or administrator). |
| Export CSV, Export Excel, Export PDF | The report as a file: CSV the rows; Excel the view with its totals first and the rows after, with number formats; PDF the view styled for paper. |
| Delete | Removes the report and its versions (owner or administrator). |

## Dashboards

A dashboard is a page of tiles, each tile a saved report in one of its views or one of its figures, on **one period** that applies to every tile.

- **Insights → Dashboards** lists them, favourites first, with their tiles, owner and sharing.
- **New Dashboard** opens an empty one in the editor. Name it, choose who can open it (only you, or the workspace), and **Add Tile**: pick a report, then how to show it, one of its views or **one figure**, a measure totalled over the period. Each new tile goes into the last row with room, else a new row.
- A dashboard is **rows of tiles**: one to four across of equal width, or wide and narrow. The row bar sets the width and moves or removes the row; a tile's controls move it left or right, rename it or remove it. Nothing overlaps or leaves a gap. **Done** saves the layout as a version.
- **The period**: 7 Days, 30 Days, This Month, Quarter, or Custom dates, in the workspace's time zone, applied to every tile through its dataset's date. A report with its own date filter keeps it and the tile says **Own dates**. **Compare With Previous Period** adds the change to every figure.
- **Slicers**: in the editor, **Add Slicer** picks a dimension the tiles' datasets share (Channel, Store, Campaign…), up to six. Viewing, each slicer is a chip under the period; open it, tick values and **Apply**, and every tile whose data has that field runs narrowed to them. A tile without the field says **Not sliced by** it. **Clear** takes the values off.
- **Cross-filtering**: click a bar, a slice of a pie, a stage of a funnel or a cell in a grid tile, and the other tiles narrow to that value. When the field is not one of the dashboard's slicers, a chip appears for it with a cross to take it off. Clicking the same value again clears it.
- Viewing a dashboard, you can switch the period, the comparison and the slicers for a look without saving; nothing of a selection is saved, and a PDF or a scheduled delivery is the dashboard as saved.
- **Export PDF** gives the dashboard with its tiles on its saved period; **Schedule** emails it as PDF.

## Scheduled delivery

Press **Schedule** on a report or a dashboard:

| Field | Meaning |
|---|---|
| Every | Day, Weekday, Week (on a day) or Month (on a day of the month, 1 to 28). |
| At | The time, in the workspace's time zone. |
| Send as | Excel, CSV or PDF for a report; a dashboard goes as PDF. |
| To | Up to twenty addresses; Enter, a comma or a space adds one. |
| Subject | Optional. `{date}` becomes the sending date. Empty: the report's name and the date. |
| Note | Optional, at the top of the email. |

The email goes out through the workspace's own mail server (Settings → Email Server; a workspace without one cannot schedule), built at the moment of sending with the rights and masking of whoever scheduled it, the file attached. Under the title the schedule line shows what, when, to how many, the last sending and the next, with **Change** and **Pause**. **Send a Test Now**, on a saved schedule, sends the email to you at once. **Insights → Scheduled** lists every schedule you may see, with Pause, Resume and Delete. Three failures in a row pause a schedule; Resume starts it again.

## Run Log

Insights → Run Log, for report administrators: every preview, run, export and delivery of the last 7 or 30 days, with the report and its version, the kind, who, the outcome with its reason when it is not OK, the rows and the time, filterable by outcome, person and report name, with a summary of the period.

## How fresh is the data

The line under a report's title says it. **Live data**: the report reads the workspace's database as it is. **Data as of the last quarter hour**: the workspace reports on the analytics engine, which the platform team loads from the database every fifteen minutes; new sends show on the next load. The platform team decides which engine a workspace is on; the pages and the figures are the same either way.

## When something does not run

| Message | What it means |
|---|---|
| The report took longer than 15 seconds and was stopped | Narrow it with a filter or a shorter period. |
| X is personal data: building a report on it needs the report administration right | Ask an administrator to build that part, or to grant the right. |
| This workspace's reports are moving to a new engine | The platform team is switching the engine; try again shortly. |
| This workspace has no mail server yet | Set one up under Settings → Email Server before scheduling. |
| Insights is not part of this workspace | Ask the platform team to switch the component on. |
