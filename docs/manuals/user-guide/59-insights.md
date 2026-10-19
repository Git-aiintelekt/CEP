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

## Step by step: measures, comparisons, charts, formatting, sharing and slicers

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

**Year to date, a moving average, a rank, a target**

1. With the report grouped by a date, open **Add a Comparison** under a measure and pick **Year to Date** or **Quarter to Date** (the measure added up from the start of each year or quarter), or **Moving Average (3 Months)** (the month and the two before it).
2. **Rank** numbers the rows from the largest, per month when the report has other dimensions too.
3. **% of Target** and **Difference to Target** compare with a number: type it in **Target** beside the comparisons.
4. Year and quarter to date add up sums and counts only, and start from the year's or the quarter's first day even when the report's dates start later.

**Drill down in a chart**

1. Open a report with more than one level, such as Sent by Year then Channel, and choose **Chart**.
2. The line above the chart says what a click drills to. Click a bar, a slice or a stage: the chart shows the level below for that value, such as the quarters of 2026, then their months, then their days, then the next dimension.
3. The path above the chart shows where you are. Click any step to go back to it, or **Up One Level**.
4. On a dashboard, turn on **Drill Down** in a chart tile's header first: while it is on, a click drills that tile instead of filtering the others. Turn it off to go back to the top and to cross-filtering.

**Open a detail report from a value (drill-through)**

1. Make the detail report: in its editor press **Detail Report**, tick the fields it can be opened through (such as Channel or Store), **Apply**, then **Save**.
2. In any other report or dashboard tile on the same data, right-click a value of that field: a bar, a slice, a stage or a cell in a grid.
3. The menu lists the detail reports for the field. Pick one: it opens filtered to that value, and the line above the rows says where it was opened from.
4. **Show All Rows** shows the detail report without the filter.

**Share a report or a dashboard**

1. Open it and press **Share** (the owner, or a report administrator).
2. Choose who can open it: **You and the people and roles below**, or **Everyone in the workspace**.
3. Find a person or a role and add them. Give each **Can View** or **Can Edit**; Can Edit lets someone who builds reports change it. A role reaches everyone holding it.
4. Press **Save**. The list shows a private report as shared.

**Limit what a person sees (Report Access)**

1. Open **Settings → Report Access** (report administrators).
2. Press **Add a Rule**, find the person or the role, choose the dataset and the field (such as Store), and write the values they may see, one per line.
3. Press **Add Rule**. From then on, every report, dashboard, export and delivery on that dataset shows them only those rows, and the viewer tells them so.
4. **Edit** changes the values; **Remove** lets them see every row again. People without a rule see every row of what they can open.

**Stack the bars, or combine bars and a line**

1. Choose **Chart**, then **Stacked** to put each series on top of the other in one bar per category, or **100% Stacked** to show each series as its share of the bar.
2. The series come from the dimension in **Columns** (for example Channel), else from the values.
3. Choose **Combo** to show the first value as bars and the others as lines, such as Sent Count as bars with Open Rate as a line. A line in another format or of a very different size is read on a scale on the right.

**Colour the numbers**

1. In the editor, with the Grid, Pivot or Hierarchy view, press **Format Values**.
2. For each value (and each of its comparisons), choose **Colour Scale** (light to strong blue from the lowest to the highest), **Data Bars** (a bar behind each number) or **Rules**.
3. For rules, say when and how: **More than**, **At least**, **Less than**, **At most** or **Equal to** a number, shown as **Good**, **Warning** or **Bad**. **Add Rule** adds up to five; the first rule a number meets colours its cell. A change or a share is in percent: 10 means 10%.
4. Press **Apply**, then **Save**. The formatting shows in the viewer and on dashboards; totals stay plain, and exports carry the numbers without the colours.

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

**Drill in a pivot or a hierarchy**

1. Open a report with more than one level, such as Sent by Year, then Channel, then Campaign, and choose **Pivot** or **Hierarchy**.
2. In a pivot, click a row's label; in a hierarchy, press the arrow beside a top-level group (**Drill into** that value). The table shows the level below for that value, such as the quarters of 2026, and keeps the levels under it, so Channel and Campaign still nest inside.
3. The path above the table shows where you are. Click a step to go back to it, or **Up One Level**.

**Group values into a field of your own (Custom Fields)**

1. In the editor, press **Custom Fields**.
2. Name the field and choose how it is made. **Groups** names sets of values (North is Downtown, Riverside). **Number Bands** cuts a number at edges you type (100, 1000 gives Under 100, 100 to under 1,000, 1,000 and over). **If-Then Labels** gives the label of the first condition a row meets (Amount at least 500 is Gold), and a label for the rest.
3. Press **Add Field**, then **Done**. The field is in the field list like any other: drag it into Rows, Columns or Filters.
4. A custom field belongs to its report. Removing it removes its columns and filters too.

**Keep the top values and fold the rest into Others (Top N)**

1. Put a dimension first in **Rows** and a measure in **Values**, sorted the way you want to rank them.
2. Under the rows, choose **Top** 3, 5, 10 or another number. **Show the rest as Others** adds one Others line per value of the next dimension; untick it to leave the rest out. **Every value** takes the limit off.
3. Sums, counts, minimums and maximums add up in Others; averages and comparisons show empty there.

**Slice a dashboard by a range of numbers or dates**

1. Edit the dashboard, press **Add Slicer** and choose a number (such as Sent Count) or a date that is not the dashboard's period. It becomes a range slicer.
2. In the viewer, open the slicer, type **From**, **To** or both, and press **Apply**. The chip says the range, such as Sent Count: 100 to 500.
3. **Clear** takes it off. A tile without the field says it is not sliced by it.

**Save a dashboard view (bookmarks)**

1. Set the dashboard the way you want it: the period, the comparison, the page, slicer values and drills.
2. Open **Views** and press **Save the Current View**. Name it, and tick **Share with everyone who opens this dashboard** if others should have it too.
3. Later, open **Views** and pick it: everything comes back as it was. The chip shows the view in use.
4. Remove a view with its cross. A saved view never changes the dashboard itself.

**Spread a dashboard over pages**

1. Edit the dashboard and press **Add Page**. The tiles so far become Page 1, and Page 2 starts empty.
2. Click a page's tab to work on it. Type its name in **Page title**, or press **Remove Page** to remove it with its tiles. **Add Tile** adds to the page in view, and **Done** saves.
3. In the viewer the pages are tabs above the tiles. The PDF and scheduled deliveries carry every page, each tile titled with its page.

**Add measures from a linked dataset**

1. In the editor of a report on Messages, press **Linked Measures**. The button is there when the platform team has linked the dataset to another one, such as Attributed Orders.
2. Tick the measures to add, such as Amount, choose how each is totalled, and press **Apply**.
3. The report may group only by what both share: Campaign, Channel, and the send date by a period. Each side is totalled on its own, then matched by those groups; a row with no orders shows the measure empty.
4. Filters on shared fields apply to both sides; filters on other fields apply to the report's own data only, and the viewer says so. A report with linked measures has no comparisons, no Top N and no hierarchy.

**Show the SQL**

1. In the viewer, open the **More actions** menu (the three dots) and choose **Show the SQL**; in the editor, press **Show the SQL** beside the row count.
2. The dialog shows the statement the engine runs for you, with the values written in, and the linked dataset's statement when the report has one. Your row access rules are in it.
3. **Copy** puts a statement on the clipboard. Nothing runs from this dialog.

**Explain This Report, with AI**

1. Open a report and press **Explain**. The button is there when the platform allows it and the workspace's **Explain This Report** switch is on (Settings → AI Assistant).
2. A panel above the rows says what they show in a few sentences, with the main points and what the rows cannot tell. The model reads the report's name, its columns and up to 100 of the rows you see; masked personal data is left out.
3. Each explanation counts as one prompt. Check the figures before you act on them.

**Change a report with a prompt, with AI**

1. In the editor, write the change in the box above the result, such as "by channel only, as a bar chart" or "only email, last 30 days", and press **Change**.
2. The editor shows the changed report at once, not saved yet. **Undo** puts the one before back; **Save** keeps it as a new version.
3. The model reads the dataset's fields and the report, never rows. A change counts as one prompt; a question back or "no field for this" does not.

**Add a forecast line, or flag unusual points**

1. Show the report as a **Chart** with Bars, Lines or Area, along a date grouped by day, week, month, quarter or year.
2. Press **Forecast** to add a dashed line carrying the trend of the first series three periods on, and **Flag Anomalies** to ring the points far off that trend in red. Hover a ringed point to read how far off it is.
3. A line under the chart says how they were worked out. A forecast is a straight-line trend, not a promise. Save in the editor to keep the choice.

**Embed a report or a dashboard on another site**

1. Open it. For a report, choose **More actions → Embed on Another Site**; for a dashboard, press **Embed** (its owner, or a report administrator).
2. Add a label for where it goes, choose when it expires, and press **Make a Link**.
3. Copy the **Address**, or the **Code to paste into a page** (an iframe). The link is shown only once.
4. Anyone with the link sees the item read-only, without signing in, as you see it: your row access rules apply and personal data is always masked. **Revoke** stops a link at once.

**See what people open (Usage)**

1. Open Insights → **Usage** (report administrators).
2. Choose 7, 30 or 90 days. **Most Opened** and **Who Opens the Most** rank the reports, dashboards and people; the table gives each item's openings, people, openings through embed links and when it was last opened.
3. **Reports Nobody Opened** lists the reports no one opened in the period: candidates to tidy away. Opening the same item again within ten minutes counts once.

**Use a scatter, bubble, treemap or waterfall chart**

1. Choose **Chart**, then pick one from **More Charts** beside the chart kinds. The one you pick joins the switch.
2. **Scatter**: one point per value of the first dimension, the first value along the bottom and the second up the side, such as Sent Count and Opened per Campaign. **Bubble** adds a third value as the point's size.
3. **Treemap**: the first value by the first dimension as boxes sized by their share, the largest first. More than 24 fold into Other.
4. **Waterfall**: the first value by the first dimension, in the report's order, as steps from the running total. Rises are blue, falls plum, and the total grey at the end.
5. Hover a mark to read it, or press **Show the Numbers** for the table. Save in the editor to keep the choice.

**Show one figure: a KPI card or a gauge**

1. Choose **Chart**, then **KPI Card** or **Gauge** from **More Charts**.
2. Type a **Target**. The card shows the value for the whole report, the target and the share of target, green when it is met and red when not. When the report runs along dates, a small trend line sits under the figure.
3. The gauge fills an arc to the value and marks the target on it.
4. On a dashboard, add the report as a **Chart** tile to show the card or the gauge.

**Put the numbers on a map**

1. Build a report with a place and a value, such as Contacts by Region (US states) or by Country.
2. Choose **Chart**, then **Map** from **More Charts**. States match by their two-letter code or name; countries by their two- or three-letter code or name.
3. **Map Of** picks **US States** or **Countries** when the guess is wrong. Darker blue is more; grey has no data.
4. Values that match no place are listed under the map. Click a place to filter a dashboard by it.

**Show every value side by side in a pivot (matrix)**

1. Choose **Pivot** and a dimension across, such as Sent by Month.
2. Press **All Values**: each value of the report gets its own column under each month, with a total for each.
3. Press **Trend Column** to add a small line per row showing how each value moves across the columns.

**Repeat a chart per value (small multiples)**

1. With a bar, line, area, stacked or pie chart and at least two dimensions, choose a dimension in **Repeat By**, such as Channel.
2. One small chart per value appears, up to 12, all on one scale so they compare at a glance.
3. Choose **One Chart** to go back.

**Find what drives a value (Key Influencers)**

1. Open a report with a rate or an average, such as Delivered Rate, and choose **Analyse → Key Influencers**.
2. **Raises It** and **Lowers It** list the groups whose value sits furthest from the whole report, such as "When Channel is SMS". Each line gives the group's value, how far it is from the whole, and its number of rows.
3. A sum is read per row of the data, such as Sent Count per message. A plain count cannot be explained.
4. With more than one value, choose which in **Explain**. Read the lines as leads, not causes.

**Break a value down step by step (Decomposition Tree)**

1. Choose **Analyse → Decomposition Tree**. The total of the value shows first.
2. Press **Split By** and choose a field, such as Channel. The values under it appear, largest first.
3. Pick one, such as EMAIL, and **Split By** again to break it down by another field. **High Value** and **Low Value** let AI pick the field whose largest or smallest part goes furthest.
4. A level's cross removes it and the levels after it; **Start Again** clears the tree.

**Add a written summary to a dashboard**

1. Edit the dashboard, press **Add Tile**, pick a report and choose **Written Summary**.
2. When the dashboard opens, the tile shows a few sentences from AI on the report's rows for the period, with the main points. It needs the workspace's **Explain This Report** switch (Settings → AI Assistant).
3. A summary counts as one prompt and is kept for six hours for the same period and slicers, so opening the dashboard again costs nothing. The PDF carries the kept summary; an embed link does not write one.

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
| Chart | Bars, lines or area: the first dimension along the bottom, a series per value of the dimension across (else one per measure), the legend to show and hide, Show the Numbers under it. **Stacked** and **100% Stacked**: the series on top of each other in one bar per category, as numbers or as shares. **Combo**: the first value as bars and the others as lines, a line in another format (such as a rate) read on a scale on the right. **Pie**: the first measure by the first dimension as shares, the total in the middle, more than eight slices folded into Other. **Funnel**: the rows in the report's order as stages, each with its share of the first and the drop from the one before | A dimension and a measure |
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
