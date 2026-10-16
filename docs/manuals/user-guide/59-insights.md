# Insights: Reports, Dashboards and Scheduled Delivery

**Where:** Insights, in the app launcher (the grid icon at the top left), and the Insights item in Engagement's menu, which opens the same reports.

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
   A date dimension can be grouped **by Day, Week, Month, Quarter or Year**. A measure has its calculation: Sum, Count, Distinct Count, Average, Min or Max.
3. **Filters**: one row per rule (field, operator, value), joined with **and** or **or**. A list is comma-separated, a range is from..to, "in the last days" takes a number. Dates are the workspace's time zone.
4. The preview runs as you build, up to the preview cap. The line above it says how many rows, how long, and how fresh the data is.
5. **Save** writes a new version. Cancel drops the changes.

### The four views

Any report switches between the views without losing its fields; the switch sits above the result, in the editor and in the viewer. The editor saves the choice; the viewer switches for a look.

| View | What it shows | What it needs |
|---|---|---|
| Grid | One row per record or group, sortable and resizable columns | Anything |
| Chart | Bars, lines or area: the first dimension along the bottom, a series per value of the dimension across (else one per measure), the legend to show and hide, Show the Numbers under it | A dimension and a measure |
| Hierarchy | The dimensions in their order, each group folding over the next, a subtotal per group, Expand All and Collapse All | Two dimensions and a measure |
| Pivot | The dimension across as columns, one measure in the cells (a select when there are several), a total on both edges | A dimension down, one across, a measure |

Subtotals and totals come from the engine, so averages and distinct counts are exact, and a report longer than the page still totals everything.

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
- Viewing a dashboard, you can switch the period and the comparison for a look without saving.
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
