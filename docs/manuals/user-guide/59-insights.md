# Insights: Reports, Dashboards and Scheduled Delivery

**Where:** Insights, in the app launcher (the grid icon at the top left), and the Insights item in Engagement's menu, which opens the same reports.

## Terms and What They Mean

The words Insights uses, in plain terms, with an example of each. The steps for each feature follow in this chapter.

**Building a report**

| Term | What it means | Example |
|---|---|---|
| Dataset | The table of data a report is built on, one row per thing recorded. | Messages: one row per email or text a campaign sent. |
| Dimension | A field you group by: a word, a code or a date. | Channel, Campaign, Sent by Month. |
| Measure | A number that adds up, with how it is totalled: Sum, Count, Distinct Count, Average, Min or Max. | Sent Count, Amount. |
| Calculated Measure | A measure made from others, worked out on the totals of each row, never as an average of averages. | Open Rate is Opened ÷ Delivered. |
| Field Wells | The editor where you drag fields into Rows, Columns, Values and Filters. | Channel into Rows, Sent Count into Values. |
| Steps | The other editor: the same report written as numbered steps (Data, Filter, Summarize, Group By, Sort and Limit). | For people who prefer reading the question top to bottom. |
| Report Filters | Questions a report asks above its rows before it runs. Every report asks Campaign, Channel and Period first. | Campaign: the latest campaign unless you pick another. |
| Period | The span of dates a report or dashboard reads, such as Last 7 Days, Last Quarter or 90 Days. | Postal keeps about two months of mail, so email dashboards use 90 Days. |
| Latest | A filter default that takes the value of the newest row, such as the campaign sent most recently. | Campaign KPIs opens on the latest campaign. |
| Folder | A shelf for a workspace's reports. | Email Campaign Reports holds the 16 base reports. |
| Version | Every saved state of a report or dashboard, with who and when; any one can be restored. | Versions → Restore puts last week's report back. |

**Analysing**

| Term | What it means | Example |
|---|---|---|
| Comparison | A column beside a measure that compares it over time or with a whole: Previous Period, Change, Last Year, Running Total, % of Total, Year to Date, Moving Average, Rank, % of Target. | Sent Count with Change vs Previous Month. |
| Forecast | A dashed line carrying a chart's trend three periods on. A straight-line trend, not a promise. | Monthly sends, three months ahead. |
| Flag Anomalies | Rings the points on a chart that sit far off its trend. | A week when sends dropped sharply. |
| Custom Field | A field you add to one report: groups of values, number bands, if-then labels or a formula. | Regions made of states; Basket Size: Large or Small. |
| Formula (Each Row) | A custom field worked out for every row of the data. | [Revenue] - [Cost]. |
| Measure Formula | A custom field that adds up the rows of each group, like a calculated measure you write yourself. | Click to Open: DIVIDE(SUM([Clicked]), SUM([Opened])) * 100. |
| Shared Formula | A formula saved on a dataset so every report on it uses the same definition. | Delivery Rate on Email Messages. |
| Certified | A shared formula a report administrator has vouched for; only they can change it. | The tick beside Delivery Rate. |
| Top N | Keeps the largest values and folds the rest into Others. | Top 5 campaigns by opens, the rest as Others. |
| Drill Down | Clicking a value in a chart, pivot or hierarchy to see the level under it. | Click 2026 to see its quarters, then a quarter to see its months. |
| Drill-Through | Right-clicking a value to open a detail report filtered to it. | Right-click a campaign → Campaign Detail for that campaign. |
| Detail Report | A report others can open from a value of a field it takes. | Customer Detail, opened from a campaign. |
| Tooltip Report | A report that appears as a small card when you rest the pointer on a value of a chart. | Hover a campaign's bar to see its detail. |
| Linked Measures | Measures from a second dataset shown in the same report, matched on what both share (such as Campaign, Channel and the date), without writing a join. | Each campaign's sends from Messages beside its revenue from Attributed Orders. |
| Key Influencers | Finds which groups push a rate or an average up (Raises It) or pull it down (Lowers It), with how far and over how many rows. It points to where to look; it does not prove a cause. | "When Channel is SMS" lowers Open Rate. |
| Decomposition Tree | Breaks one total down step by step, a field at a time, so you see where it comes from. High Value and Low Value let AI choose the next field. | Revenue → by Channel → Online by Store → one store by campaign. |

**Showing the numbers**

| Term | What it means | Example |
|---|---|---|
| View | How a report shows: Grid, Chart, Hierarchy or Pivot. Switching keeps the fields. | The same report as a table or as bars. |
| Hierarchy | Groups that fold over the next level, each with its subtotal. | Region, then State, then Store. |
| Pivot | One dimension spread across as columns, a total on both edges. **All Values** shows every measure side by side (a matrix); **Trend Column** adds a small line per row. | Campaigns down, months across. |
| Combo | A chart of bars and lines together; a line in another format reads on a scale on the right. | Sent Count as bars, Open Rate as a line. |
| Small Multiples | The same chart repeated once per value of a field, on one scale. Called **Repeat By** in the chart. | One chart per channel. |
| Map | A chart that shades US states or countries by a value. | Contacts by state. |
| KPI Card and Gauge | One figure against a target: a card with the share of target, or an arc. | Journey conversion against a target of 30%. |
| Conditional Formatting | Colours on the numbers: a colour scale, data bars, or rules shown as Good, Warning or Bad. Under **Format Values**. | Click to Open under 10% in red. |

**Dashboards**

| Term | What it means | Example |
|---|---|---|
| Dashboard | A page of tiles, every tile a saved report, all on one period. | Management Dashboard. |
| Tile | One report on a dashboard, in one of its views, or as one figure. | Emails Sent as a large number. |
| Compare With Previous Period | Adds the change against the period before to every figure. | Emails Sent, with its change on the 90 days before. |
| Slicer | A filter chip on a dashboard that narrows every tile whose data has that field. | Pick a campaign; every tile shows that campaign. |
| Cross-Filter | Clicking a bar, slice or cell narrows the other tiles to that value. | Click Gmail in Providers. |
| Saved View | A dashboard's period, slicers, page and drills kept under a name, without changing the dashboard. | "Black Friday week". |
| Free Canvas | A dashboard layout where tiles are dragged and resized freely. | A board view with a large chart and small figures. |
| Written Summary | A tile in which AI writes a few sentences on a report's numbers for the period. | A few lines on the period's sends and deliveries. |

**Where the data comes from**

| Term | What it means | Example |
|---|---|---|
| Base Reports | Ready-made packs of datasets, formulas, reports and dashboards from the platform, added as the workspace's own copies. | Email Campaign Reports: 16 reports and 2 dashboards. |
| Report Databases | The workspace's own MySQL, PostgreSQL or ClickHouse databases, connected read-only. | A MySQL database holding the mail server's tables. |
| Map a Dataset | Turns a table of a connected database into a dataset, with labels and personal fields marked. | A stores table, mapped with Store Name and Region. |
| Query Window | Where you write one SELECT against a connected database, run it, and keep it as a dataset. | Emails by status per day. |
| Uploaded Files | CSV or Excel files brought in as datasets. **Replace File** refreshes them. | A store's POS sales export. |
| Kept Results | A report on a connected database is kept for 15 minutes, so opening it again is instant; **Refresh** runs it now. | "Kept from 10:42". |
| Freshness | How current the data is: **Live data**, or **Data as of the last quarter hour** on the analytics engine. | The line under a report's title says which. |
| Fiscal Year | The month a workspace's financial year starts, for fiscal quarters, fiscal years and year to date. | Starts in April: FY2027 Q1. |

**AI**

| Term | What it means | Example |
|---|---|---|
| Ask for a Report | Describe a report in your own words, with a spec or a sketch if you like; AI drafts it on your data and you open it in the editor. | "Delivery rate by email provider for the latest campaign, as a bar chart." |
| Run Details | The steps Ask for a Report takes, ticked as they finish. | Reading your documents, drafting, checking the draft. |
| Explain | A few sentences on what a report's numbers say. Personal data is never sent. | Explain on Campaign KPIs. |
| Change With a Prompt | Changes a report in the editor from a sentence; Undo puts it back. | "By provider only, as a bar chart." |

**Sharing and control**

| Term | What it means | Example |
|---|---|---|
| Share | Who may open a report or dashboard: everyone in the workspace, or chosen people and roles with Can View or Can Edit. | Share with the Marketing role, Can View. |
| Embed Link | A secret link that shows a report or dashboard read-only on another site, without signing in. **Revoke** stops it. | A dashboard on the company intranet. |
| Schedule | Emails a report or dashboard as a file on a timetable. Needs the workspace's mail server. | Every Monday at 8:00, as Excel. |
| Alert | Emails you when a value crosses a threshold. | When Delivery Rate falls below 90%. |
| Report Access | Rules that limit which rows a person or role sees, in every report, export and delivery. | A store manager sees only their store. |
| Personal Data (PII) | Fields that identify a person, such as an email address; masked for anyone without the right. | Recipient in Customer Detail. |
| Show the SQL | The statement the engine runs for a report, with the row rules in it. Nothing runs from it. | More Actions → Show the SQL. |
| Run Log | Every run, export and delivery of the last 7 or 30 days, with who, the outcome and the time. For report administrators. | Why a schedule failed on Monday. |
| Usage | Which reports and dashboards people open, and which nobody opens. | Reports Nobody Opened, to tidy away. |

## Step by step: the AI features

**Ask for a Report** (anyone who can build reports)

1. Open Insights → **AI Reports**, above Reports in the menu. The item is there once an AI provider with a key is switched on (the platform's, or your workspace's own under Settings → AI Assistant) and your workspace allows AI; otherwise it is not in the menu at all.
2. Choose what the prompt is about with **Ask About** at the top of the box: **All My Data**, the platform's datasets (**C360**), one of your Report Databases, or your **Uploaded Files**. The model then reads only those fields, so its answers are sharper. Your choice is remembered.
3. Give the report a name in **Report Name** at the top of the box if you like; leave it empty and the model names it.
4. Write what you want to see in your own words, pick a model at the bottom of the box, and press **Generate Report** (or Ctrl+Enter). While it works, **Run Details** under the box lists the steps as they happen: reading your documents, reading the database's tables, the model drafting the report (with the time so far), checking the draft against your data and previewing the rows. A step ticks when it finishes; if one stops, it says why.
5. Read what comes back in Run Details. A **draft**: check its view, data, rows, columns, values and filter, change its **Name** if you like, then **Open in Editor** to make it a private report of yours, under that name, and open the editor. **Show** beside the time lists the steps it took. **One question first**: press the answer that fits; answering does not cost a prompt. **No field for this**: pick one of the closest prompts, or ask your platform team to map the data.
6. **Earlier This Visit** in Run Details lists the prompts you ran while this browser tab is open, newest first: when each started, how long it took, the tokens it used, the model and what came of it (Draft, Saved, Question, No Field or Failed), with its steps under **Show Steps**. The list scrolls.
7. **Prompt History** under Run Details holds your prompts of the last 90 days, newest first; scroll down and older ones load. **Use Again** puts a prompt back in the box. The pencil beside a name renames the report the prompt became (or its draft, if you have not opened it yet): type the new name, Enter saves, Esc cancels. **Show** hides or shows the list (remembered in your browser). **Clear History…** asks first, then takes your prompts off the list; the reports they became are not touched and the month's prompt count stays as it is. The line at the top right of the box counts the month's prompts against your plan; only a draft counts.
8. The reports you make here are ordinary reports: they are listed under Insights → Reports with an **AI** mark beside the name, and you put them on a dashboard like any other (Dashboards → Edit → Add Tile).

**Add a spec or images to a prompt** (anyone who can build reports)

1. In Insights → AI Reports, write your prompt in the Ask for a Report box. Say what the files are for: "Build the report described in the spec", "A chart like this sketch, by month", "Use the targets in the PDF".
2. Add up to three documents (the report's spec as a PDF, a Word .docx, an Excel .xlsx, a CSV, a text or a Markdown file) and up to five images (PNG, JPEG, GIF or WebP), whichever way is handiest: drag them from your computer onto the Ask for a Report panel and let go when the box shows **Drop images or documents here**; or press the paperclip at the bottom left of the box and choose the files; or copy an image, such as a screenshot, and paste it into the box with Ctrl+V.
3. Check the attachments at the top of the box: each document as a tile with its kind and size, each image as a thumbnail. The line beside the paperclip says how many there are ("2 documents · 1 image"); remove one with its ✕. A fourth document or a sixth image is left out with a note under the box.
4. Press **Generate Report** (or Ctrl+Enter). The documents and images go to the model with your prompt and the field names. They stay in the box, so **Try Again** sends them again. The draft's top line says what the model read.

A document may be up to 10 MB, PDFs up to 100 pages together, and the documents and images up to 20 MB together. An old Word file (.doc) or Excel file (.xls) needs saving as .docx or .xlsx first. An Excel workbook is read sheet by sheet (the values, not the formulas), up to 500 rows a sheet; the model reads its rows for the layout and the kind of values you want, and the report itself always runs on your data in Insights. A large image is scaled down in your browser before it is sent. Another kind of file is refused with a note under the box. Documents and images are not kept: only your prompt is saved with the draft. The prompt itself may run to 100,000 characters (about 25,000 words); the counter under the box appears from 90,000. A longer spec goes in as a document.

**Ask about a database's tables not mapped yet** (anyone who can build reports)

1. In the Ask for a Report box, open **Ask About** and pick one of your Report Databases.
2. Under it, keep **Also Look at Tables Not Mapped Yet** ticked (it is by default). The model is then told the names of the database's tables and, when you press Generate, given the columns of the tables your prompt or its documents name (up to 20). It may ask for more tables' columns once. Nothing is stored.
3. Name the tables you mean when you know them: "Net sales from sales_lines joined to stores, by store and week".
4. A draft on such tables says **Not Mapped Yet** beside its data, with the tables it joins. **Open in Editor** maps them as a dataset with the fields the report needs (as Map a Dataset would), then opens the report. Until then nothing is mapped. Your administrator can rename the dataset's fields later under Settings → Report Databases.

**Use AI in your workspace** (workspace administrator)

1. Open Settings → AI Assistant. **Use AI in Reports** is on by default; switch it off to hide every AI feature and keep every prompt inside CEP.
2. For each provider, allow or disallow it with its switch, or press **Use Your Own Key** (or **Add Your Own Key** when the platform does not offer it) to enter the workspace's own key and the two models, then **Check Connection**. The workspace's key wins over the platform's, and prompts on it are not counted against the plan.
3. **Explain This Report** decides whether a report's totals may be sent to the model; personal-data fields are never sent.
4. **AI Prompts This Month** shows the count against the plan.

**Write It for Me** in the query window is described in the Report Databases chapter.

## Step by step: measures, comparisons, charts, formatting, sharing and slicers

**File a report under a component** (anyone who can build reports)

1. When you make a report, choose its **Component**: in New Report under the name, in Ask for a Report with **Add To** beside the model, or beside the report name when you build a report from a query. **Automatic** lists it with its data's component; reports on your own databases and uploaded files go under Engagement unless you choose another.
2. Every component of the suite is offered (Engagement, Insights, CRM, Sales, Purchasing, Inventory, PIM, and any added later), whether or not it has data of its own.
3. To move a report later, open it and change **Component** beside Folder; it moves at once. In the editor, change it in the header and press **Save**.
4. Insights → Reports groups the reports by component, and the chips at the top filter by one. A component shows a chip once it holds a report or a dataset; **New Report** from a component with no data of its own offers every dataset and files the report there.

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

1. Open it and press **Share** (the owner, or a report administrator). On a report, Share is in **More actions** (the three dots).
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

**Explain: What This Means, free, and What the Rows Show, with AI**

1. Open a report, open **More actions** (the three dots) and choose **Explain**. A panel opens above the rows on **What This Means**: a verdict (On Track, Watch, Act or No Benchmark), up to four figures against their targets, **Why** with a link to the report each reason came from, and **Do Next**, at most three actions with a button each. It is written by set rules from the engine's own figures: it uses no AI, counts no prompt, shows at once and reads the same each time, so it is there in every workspace.
2. On an Email Campaign report (Base Reports), it reads the campaign's delivery, hard bounces, opens and clicks, the most common failure reply, the links clicked and the five campaigns sent before it. **Export the Addresses** downloads the hard-failed recipients of the same campaign as a CSV (masked unless you may see personal data). On any other report, it judges the report's totals against the benchmarks set for its measures and names its largest and smallest group.
3. **Copy as Email** puts the brief on the clipboard as plain text.
4. **What the Rows Show** is the AI's few sentences on the rows, with the main points and what the rows cannot tell. The tab is there when the platform allows it and the workspace's **Explain This Report** switch is on (Settings → AI Assistant). The model reads the report's name, its columns and up to 100 of the rows you see; masked personal data is left out. It is asked only when you open the tab, and counts as one prompt. Check the figures before you act on them.

**How What This Means stays accurate**

- **A verdict only when the figures are sure of it.** For a rate made of a count and a base (Delivered of Sent), the engine works out its 95% range (the Wilson interval). When the whole range sits in one band, the verdict is plain (On Target); when it crosses a band's edge, it says **Likely** (Likely On Target). Under 30 in the base it says **Too Few to Judge**.
- **Estimates are named.** Machine opens (Apple Mail Privacy Protection, scanners) are recognised from the email client, so People Who Opened is marked **≈** and estimated.
- **Comparisons say what they compared.** "Earlier" is the campaigns sent before this one, pooled; the line at the bottom says how many and their dates. A later campaign is never used.
- **Facts, not causes.** Each reason states a figure and links to the report it came from; none says one thing caused another.

**Benchmarks**

1. Open **Benchmarks** in the Insights menu. Everyone sees them; a report or user administrator changes them.
2. **Add a Benchmark**: the dataset, the measure, whether higher or lower is better, **Good** and **Act**. Between them is Watch. Higher is better: Good at or above Good, Act below Act. Lower is better: the same the other way.
3. For a rate, choose **Made Of: Count** and **Made Of: Base** (such as Delivered and Sent): then its 95% range is worked out, as above.
4. After adding the Email Campaign Reports, **Add the Email Campaign Defaults** sets four at once: Delivery Rate (Good 95%, Act under 90%), Bounce Rate (Good 2% or less, Act over 5%), Click-Through Rate (Good 1.5%, Act under 0.5%) and Unsubscribe Rate (Good 0.3% or less, Act over 0.5%). Change them to your own.
5. Without a benchmark, What This Means states the figures and says it cannot judge them, with **Set a Benchmark**.

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

**Lay a dashboard out freely (Free Canvas)**

1. Edit the dashboard and choose **Free Canvas** above the tiles. The rows become places on a 12-column grid, as they were.
2. Drag a tile by its grip (top left) to move it, and by its handle (bottom right) to resize it. With the keyboard, focus the grip and use the arrow keys to move, or Shift and the arrows (or the handle) to resize. Tiles may overlap; the later one sits on top.
3. Each page has its own layout. **Rows** turns a canvas back into rows, read top to bottom.
4. Press **Done** to save.

**See and shape the phone layout**

1. On a canvas page, press **Phone Preview**: the tiles stack top to bottom as a phone shows them.
2. Press a tile's phone icon to leave it out on a phone (**Hide on Phone**); the preview says how many are hidden.
3. On a narrow screen, every dashboard on a canvas reads this way. Rows stack on their own.

**Give a dashboard a theme**

1. Edit the dashboard and choose a **Theme**: Classic, Navy, Earth, Berry or Greyscale.
2. The theme sets the colours of every chart on the dashboard, in the viewer, in an embed link and in the editor. The PDF and PowerPoint keep the classic colours.

**Add text to a dashboard**

1. Edit the dashboard and press **Add Text**.
2. Give it an optional **Title** and the **Text**: a blank line starts a paragraph, a line starting with - is a bullet, and **words between two stars on each side** are bold.
3. Press **Add to Dashboard**. Its pencil changes the words later. The text shows in the PDF and PowerPoint too.

**Add a button that opens a saved view, a page or a report**

1. Save the view first if the button should open one (Views → Save the Current View).
2. Edit the dashboard, press **Add Button**, give it a **Label**, choose **When Pressed** (Open a Saved View, Go to a Page or Open a Report) and which one.
3. Press **Add to Dashboard**. In the viewer, pressing the button applies the view, opens the page or opens the report.

**Show another report when someone hovers a value (Tooltip Report)**

1. Make the report to show on hover a detail report: in its editor press **Detail Report**, tick the field the chart runs along (such as Campaign), **Apply**, **Save**.
2. In the chart's report, press **Tooltip Report** in the editor, pick that report, **Apply**, then **Save**.
3. In the viewer or on a dashboard, rest the pointer on a value of the chart for a moment: a card shows the first rows of the tooltip report for that value.

**Get an email when a value crosses a threshold (Alerts)**

1. Open the report, open **More actions** and choose **Alerts**.
2. Under **New Alert**, choose the value (**When**), the **Condition** (falls below, is at or below, rises above, is at or above) and the **Threshold**. For a percentage, 90 means 90%.
3. Choose **Check**: Every Day at a time, or Every Hour. Add the addresses to email (people without the right to build reports alert themselves only), and an optional name. Press **Set Alert**.
4. The value is the report's value over its own filters. When it crosses the threshold you get one email; you are emailed again only after it goes back and crosses again.
5. **Check Now** reads the value at once. **Pause**, **Resume** and **Delete** are on each alert; Insights → Scheduled lists all your alerts.

**Comment on a report or a dashboard, and pin a note to a value**

1. Open the report or dashboard and press **Comments** (on a report, in **More actions**). Write in the box at the bottom and press **Add Comment**.
2. To pin a note to a value, right-click it on a chart or a table and choose **Comment on This Value**. The chart then marks that value, and hovering it shows the note.
3. On a dashboard, a tile's speech-bubble icon opens comments on that tile, with the count beside it.
4. **Resolve** puts a thread among the resolved; **Open again** brings it back. You change or delete your own comments; the owner and report administrators delete any.

**Export to PowerPoint**

1. For a report, open **More actions** (the three dots) and choose **Export PowerPoint**. For a dashboard, press **Export PowerPoint**.
2. The deck has a cover, then a slide per tile (or for the report's view): bars, lines, areas, stacks, pies and funnels as charts you can edit in PowerPoint, figures as large numbers, text and summaries as words, other views as tables.
3. A schedule can send PowerPoint too: choose it under **Send as**.

**Print a report on numbered pages (Print-Ready PDF)**

1. Open the report, open **More actions** and choose **Print-Ready PDF**.
2. Choose the **Paper** (A4 or Letter) and the **Orientation**. Tick **A section per** the first field to start each value on a new page with its subtotals.
3. Press **Download PDF**: every row (up to 20,000), the header row on each page, the filters on the first page, and Page 3 of 12 at the foot of each page.

**Report on a CSV or Excel file (Uploaded Files)** (anyone who can build reports)

1. Open Insights → **Uploaded Files** and press **Upload a File**, or drop the file on the page. The first row names the columns; in an Excel workbook the first sheet is read. Up to 100,000 rows, 50 columns and 20 MB; save an older .xls as .xlsx first.
2. **Review the Columns** opens. Each column's type was read from its values: Text, Number, Date, Date and Time, or Yes or No. Rename a column under **Label**, make it **Text** if it is a code, and set a number to **A Dimension (Groups)** when it should group rather than add up, such as a year or a store number. The first values show beside each column.
3. Give the dataset a **Name** and press **Save as Dataset**. New Report opens with your file picked under **Your Files**. It also offers **Upload a File**.
4. Dates like 03/04/2026 are read with the day first when any day in the column is over 12, otherwise with the month first. A date and time with no zone is your workspace's time. Codes with leading zeros, such as 007, stay text.
5. To refresh the rows, open the file's menu (the three dots) and choose **Replace File**. The new file must have the same column names, in any order, and the reports on it read the new rows at once. A file with reports built on it cannot be deleted.

**Add filters people choose (Report Filters)**

1. In the editor, press **Report Filters** (the count beside it says how many the report has), then **Add Filter**. Choose the **Field**, then how it is **Asked As**: Any of Several Values, One Value, At Least, At Most, A Range or The Last Few Days.
2. Give it a **Label**, an optional **Default**, and tick **An Answer Is Required** if the report should not run without one. When the dataset has a time field, a value question can tick **Default to the Latest** (the value of the newest row: the latest SMS campaign sent) and a date question **Default to the Latest Day** (the day of the newest row, under the other answers: that campaign's send day). A report asks up to eight filters. Press **Apply**, then **Save**.
3. People opening the report see the questions above the rows. A text field offers its own values to pick from. A date range is asked as **One Day** or a **Date Range**. A question that defaults to the latest is left empty and says what the latest was ("Latest: Hottest Designer Deals Oct 17 Day 2"); pick another value to change it. They choose the answers and press **Run Report**. A required question with no answer and no default waits for one.
4. The answers are kept in the page's address, so a link opens the report with them. Exports, the Print-Ready PDF and Explain use the answers too.

**Every report asks Campaign, Channel and Period first**

Every report asks these filters above its rows, first and in this order, whether you made it yourself or with AI Reports; your own filters follow them:

- **Campaign** (data with a campaign): pick one or several campaigns. Left empty, it shows the **latest campaign** sent in the period, and says which ("Latest: Hottest Designer Deals Oct 17 Day 2"). If none was sent in the period, it shows every campaign of the period.
- **Channel** (data with a channel): one or several channels; left empty, every channel.
- **Period** (data with a date): **Last 7 Days** (the default), Last 15 Days, Last 30 Days, Last Quarter (3 months), Last Half Year (6 months), Last Year (12 months) or **Custom Range** with two dates. The days it covers show under it. Period is always asked, so no report reads a whole table unless you ask for a longer span; it filters on the data's date and time, which the database's index can use.

In the editor, **Report Filters** lists them with Period at the top: change its label or its default, but it cannot be removed. Campaign and Channel are ordinary filters: change or remove them. A draft from AI Reports lists them under **Asks** before you open it. On a dashboard, a tile uses the dashboard's own period instead of Period; a schedule or an alert uses the report's default (7 days unless you changed it). Reports made before were given the filters by the platform team (`manage.py insights_report_filters --tenant CODE --apply`), each as a new version noted "Report filters added"; until then a report shows and runs with them anyway.

**Set your fiscal year (Settings → Fiscal Year)** (workspace administrators)

1. Open Settings → **Fiscal Year** and choose the month it **Starts In**, such as April. It saves at once.
2. Choose whether to **Name a Fiscal Year By** the year it ends in (April 2026 to March 2027 is FY2027) or the year it starts in (FY2026). The page shows an example.
3. In the editor, a date then also groups **by Fiscal Quarter** and **by Fiscal Year**, read as FY2027 Q1. Filters offer **in this fiscal year**, **in last fiscal year**, **in this fiscal quarter** and **in last fiscal quarter**.
4. **Year to Date** and **Quarter to Date** comparisons count from the fiscal year's first day. Dashboards offer **Fiscal Quarter** and **Fiscal Year** periods (to date).

**Work out a value for each row with a formula** (anyone who can build reports)

1. In the editor, press **Custom Fields**, then **Add a Custom Field**. Give it a **Name** and choose the **Kind** **Formula (Each Row)**.
2. Write the formula. Put a field in square brackets, such as `[Revenue] - [Cost]`, or click a field under **Fields** to put it in where the cursor is. Click a function under **Functions** to put it in, such as `IF(`.
3. The line under the formula checks it as you type. It says what it works out and which fields it reads, or what is wrong, with the place marked.
4. A number formula is **A Measure (Adds Up)** or **A Dimension (Groups)**: choose a dimension for a year or a code. Choose how a number shows under **Show As**: Whole Number, Decimal, Money or Percentage.
5. Press **Add Field**. The formula is then a field like any other: drag it into Rows or Values, filter on it, or group a date formula by month.

Examples: `IF([Amount] >= 500, "Gold", "Standard")`, `YEAR([Sent]) & "-" & TEXT(MONTH([Sent]))`, `DATEDIFF([Ordered], TODAY(), "day")`, `COALESCE([Discount], 0)`.

**Write a measure formula, such as a rate or a filtered total**

1. In **Custom Fields**, add a field of the **Kind** **Measure Formula**.
2. A measure formula adds up the rows of each group, so every field goes inside SUM, AVERAGE, MIN, MAX, COUNT or DISTINCTCOUNT, or you count rows with COUNTROWS().
3. Give an aggregate a condition to add up only some rows: `SUM([Sent Count], [Channel] = "EMAIL")` is the email sends of each group.
4. Divide safely with DIVIDE: `DIVIDE(SUM([Delivered Count]), SUM([Sent Count])) * 100` is empty, not an error, where nothing was sent. Choose **Percentage** under **Show As**.
5. A measure formula may use the dataset's calculated measures and the measure formulas above it by name, such as `[Delivered Rate] / 100`.
6. Add it to **Values**: it is worked out for every row, in the totals, the pivot and the charts. Comparisons (previous period, last year) work on it as on any measure.

**The formula language at a glance**

- Fields: `[Field Name]` (the name you see; the field's key also works). Text: `"EMAIL"` or `'EMAIL'`. Yes and no: `TRUE`, `FALSE`. Empty: `BLANK`.
- Operators: `+ - * /` (dividing by zero gives an empty value), `&` joins text, `= <> < <= > >=` compare, `AND`, `OR`, `NOT`.
- Adding up (measure formulas only): SUM, AVERAGE, MIN, MAX, COUNT, DISTINCTCOUNT, each with an optional condition, and COUNTROWS(condition). SUMX, AVERAGEX, MINX, MAXX and COUNTX are the same, for a value worked out per row: `SUMX([Quantity] * [Price])`.
- Share, rank and time (measure formulas only): CALCULATE with ALL, RANKX, TOTALYTD, TOTALQTD, SAMEPERIODLASTYEAR, PREVIOUSPERIOD, PARALLELPERIOD (see the steps below).
- Naming parts: `VAR Sent = SUM([Sent Count]) VAR Delivered = SUM([Delivered Count]) RETURN DIVIDE(Delivered, Sent) * 100`.
- Logic: IF, SWITCH, ISBLANK, COALESCE. Numbers: DIVIDE, ROUND, ABS, FLOOR, CEILING, INT, MOD, POWER, SQRT, EXP, LN, LOG, SIGN, VALUE (text to a number).
- Text: CONCAT, UPPER, LOWER, TRIM, LEFT, RIGHT, MID, LEN, FIND, CONTAINS (any case), REPLACE (or SUBSTITUTE), TEXT.
- Dates: YEAR, QUARTER, MONTH, DAY, WEEKDAY (1 is Sunday), WEEKNUM, HOUR (in your workspace's time zone), EOMONTH, DATE(year, month, day), TODAY, NOW, DATEDIFF(start, end, "day" | "month" | "year"), DATEADD(date, number, "day" | "month" | "year").
- A formula can use the custom fields above it in the list, and the dataset's shared formulas. A formula that reads personal data is personal too.

**Show a share of the total, a rank, year to date or last year in a measure formula**

1. In **Custom Fields**, add a **Measure Formula**.
2. A share of the parent: `DIVIDE(SUM([Sent Count]), CALCULATE(SUM([Sent Count]), ALL([Channel]))) * 100` is each channel's part of its month's sends when the report shows Sent by Month and Channel. ALL names the fields to look past; `ALL()` looks past all of them, for a share of the grand total. Choose **Percentage** under **Show As**.
3. CALCULATE also narrows: `CALCULATE(SUM([Amount]), [Kind] = "REFUND")` adds up the refunds only.
4. A rank: `RANKX(SUM([Amount]))` numbers the rows from the largest, 1 first; `RANKX(SUM([Amount]), "asc")` from the smallest. RANKX is a measure formula of its own; it does not go inside a sum.
5. Time: put a date in the report's Rows, such as Ordered by Month. Then `TOTALYTD(SUM([Amount]))` is the year to date (from your fiscal year's first day), `TOTALQTD(...)` the quarter to date, `SAMEPERIODLASTYEAR(SUM([Amount]))` the same month a year before, `PREVIOUSPERIOD(SUM([Amount]))` the month before, and `PARALLELPERIOD(SUM([Amount]), -3, "month")` three months before. Mix them: `SUM([Amount]) - SAMEPERIODLASTYEAR(SUM([Amount]))` is the change on last year.
6. The line under the formula says when a formula is worked out over the report's rows. Such a formula shows in each row; the report's totals row leaves it empty.
7. The report keeps its date filter: last year's figures are read even when the report shows only this year.

**Share a formula with every report on a dataset** (anyone who can build reports)

1. Open **Insights**, then **Shared Formulas**, and choose the **Dataset**.
2. Press **Add a Formula**. Give it a **Name**, choose **Measure Formula** or **Formula (Each Row)**, and add a **Description** that says what it means.
3. Write the formula as in Custom Fields. It may use the dataset's fields and the shared formulas above it. Press **Add Formula**.
4. Every report on that dataset now lists it among the fields. It shows the word **Shared** next to its name, or a tick when it is certified.
5. To share a formula you wrote in a report: in the report's **Custom Fields**, press **Share With Every Report** next to it, then **Add Formula**. The report then uses the shared formula in place of its own.
6. A formula that reports use cannot be removed: the **Reports** column shows how many. Renaming one asks first, because a report may call it by name.

**Certify a shared formula** (report administrators)

1. In **Shared Formulas**, open the **…** menu on a formula and press **Certify**. It shows **Certified**, with your name and the time when you point at the mark.
2. Only a report administrator changes or removes a certified formula. Anyone else who needs a different version saves it under another name.
3. Press **Remove Certification** to take the mark off.

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

Insights → Reports lists every report you can open, grouped by its component (the one chosen for it, or Automatic: its data's), with its view, dataset, owner and last run. A report drafted with AI carries an **AI** mark beside its name. Your **favourites** sit first: press the star on any row to add one. **Folders** group a workspace's reports; the chips at the top filter by folder or by No Folder, and the folder shows under the report's name. Search finds a report by name.

### Making a report

1. Press **New Report**, pick a dataset and give it a name. It opens in the editor with the dataset's first columns. Under **Your Databases** are the workspace's own databases to query and the datasets mapped from them; a report author can **Connect a Database** there (MySQL, PostgreSQL or ClickHouse, read-only; see Report Databases). Under **Your Files**, **Upload a File** adds a CSV or Excel file.
2. Build it with one of the two editors, switched at the top right and remembered for you:
   - **Field Wells**: the dataset's fields on the left, the result in the middle, the wells on the right. Click or drag a field into **Rows** (one line per value), **Columns** (one dimension spread across, for the pivot and the chart's series) or **Values** (a number to total, with its calculation). **Filters**, then **Sort and Limit**, sit under them.
   - **Steps**: the question written top to bottom as numbered steps: Data, Filter, Summarize, Group By, Sort and Limit. Each step has an Add button; the result sits under the steps.
   A date dimension can be grouped **by Day, Week, Month, Quarter or Year**. A measure has its calculation: Sum, Count, Distinct Count, Average, Min or Max, and under it **Add a Comparison** (the steps are at the top of this chapter).
3. **Filters**: one row per rule (field, operator, value), joined with **and** or **or**. A list is comma-separated, a range is from..to, "in the last days" takes a number. Dates are the workspace's time zone.
4. The preview runs as you build, up to the preview cap. The line above it says how many rows, how long, and how fresh the data is.
5. **Save** writes a new version. Cancel drops the changes.

### Base Reports: ready-made reports from the platform

**Add Base Reports** on Insights → Reports offers the platform's ready-made **packs**: datasets, shared formulas, reports and dashboards that work together. You see the packs your workspace's components fit; one the platform team chose for you when the workspace was set up is marked **Chosen at Onboarding**. A pack is added as this workspace's own copies, filed in a folder named after it; you may change them like any report, and a later version of the pack never changes them. Adding a pack needs report administration.

The first pack is **Email Campaign Reports**, the reports of CmpReport on the mail server's own tables: Campaign KPIs, Campaign Send Status, Delivery Outcomes, Failure and Bounce Reasons, Provider Performance, Retry Analysis, Contact-List Quality, Link Clicks, Opens by Device and Client, Opens over Time, Customer Detail, Unsubscribes, Campaign Comparison and the best and worst campaigns, with a **Management Dashboard** (every campaign in the period) and a **Campaign Performance** dashboard (one campaign, the latest unless you pick another).

1. Press **Add Base Reports**, then **See What's in It** to read a pack's contents, and **Add to** your workspace. A pack that needs a database you have not connected says so, with a link to Report Databases.
2. **Your data**: pick the **Connection** that holds the mail server's tables. The databases on it holding every table the pack reads are listed with their messages and campaign emails; those with campaign mail are ticked. **Campaign Names** offers the tables that hold a campaign's name beside its id; without one, a campaign is named from its subject and first send. **Leave Out** drops campaigns whose name contains any of the words (test sends, client lists). **Unsubscribe Link Contains** tells a click on the unsubscribe link from a click on the content.
3. **Check** runs each dataset once and says how many campaigns were sent in the last 90 days. **Add Reports** then makes everything in one go: if any part does not fit, nothing is added and the message names the part.
4. The last step lists what was made; **Open Campaign Performance** opens the dashboard.

A campaign email is one whose mail-server tag carries a campaign id; e-receipts, which carry one too, are left out. The mail server keeps about two months of mail, so older campaigns drop out of the reports as their mail is removed.

### Ask for a Report, with AI

When an AI provider with a key is switched on (the platform's, or your workspace's own) and your workspace allows AI (Settings → AI Assistant), people who can build reports see **AI Reports** in the Insights menu, above Reports. Its page holds the prompt box, **Run Details** below it and **Prompt History** below that.

**Report Name** at the top of the box names the report; leave it empty and the model names it. The name field on the draft still changes it before you open it.


1. Choose the data with **Ask About** at the top of the box: All My Data, the platform's datasets, one of your Report Databases (with **Also Look at Tables Not Mapped Yet** for its tables nobody has mapped), or your Uploaded Files. The model reads only the fields of your choice. The choice is remembered in your browser.
   Write what you want to see, in your own words: "Revenue by channel and month for the last quarter, as a pivot". The examples under the box are a start. The box takes up to 100,000 characters; put the details on more lines (the filters, the order, what to compare). A counter appears from 90,000.
   **Documents and images:** drop them on the box, press the paperclip at its bottom left, or paste them, to send up to three documents (the report's spec as PDF, Word .docx, Excel .xlsx, CSV, text or Markdown) and up to five images (a sketch of the report you want, or a screenshot of a chart, a table or a spreadsheet) with the prompt. Remove one with its ✕. They go to the model with your prompt and are not kept; only the prompt is saved with the draft.
2. Pick a model at the bottom of the box, beside Generate: Claude or OpenAI, whichever your platform offers, each with a "best for reports" and a "fastest" model. Your last choice is remembered.
3. Press **Generate Report** (or Ctrl+Enter). The model receives your prompt, any documents and images you added and the names of the fields you may use (and, for a database's tables not mapped yet, their names and columns), never customer rows, and answers in one of three ways:
   While it works **Run Details** lists the steps as the server takes them, each ticked as it finishes, the one under way with the time so far; a second step for the model appears when it asks for more tables or its first draft did not fit, and a step that stops says why. The answer shows there too, and the runs before it stay under **Earlier This Visit** (with their time, tokens, model and outcome) while the browser tab is open.
   - **A draft**, in words: its name (a field you can change before you open it), view, data, rows, columns, values and filter, with how many rows the preview gives, what it read, how long it took and its steps (**Show**), and a note on anything in the request it could not follow. A draft on tables not mapped yet says **Not Mapped Yet**; **Open in Editor** maps them as a dataset first. **Open in Editor** makes it a private report of yours and opens it in the editor; nothing is shared until you save and share it. **Try Again** asks once more; **Edit Prompt** puts your words back in the box.
   - **One question first**, when the prompt has two readings ("which period is last month?"), with the answers as buttons. Answering does not use another prompt.
   - **No field for this**, when no dataset holds what you asked for, with the closest prompts the catalogue can answer. The model never makes a field up; ask your platform team to map the data if you need it.
4. The line at the top right counts the month's prompts against your plan. Only a draft counts.
5. **Prompt History** lists your prompts of the last 90 days, newest first, with the report each became; older ones load as you scroll. **Use Again** puts one back in the box, the pencil renames its report (or its draft not opened yet), **Show** hides the list, and **Clear History…** takes your prompts off it after asking. Clearing does not give prompts back: the month's count and the workspace's records are unchanged.

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

Opening a report runs it and shows the saved view. Above the rows: the view switch; under the title: what the run says (rows, time, freshness, version), **Refresh** and, once scheduled, the schedule line. The buttons:

- **Pages:** a grid with more than 20 rows shows them a page at a time. Under it: which rows are shown ("Rows 41–60 of 482"), **Rows per page** (20, 50 or 100, remembered in your browser), Previous, the page numbers and Next. Turning a page does not run the report again, and sorting a column sorts every row. Dashboard tiles and the editor's preview page the same way.
- **Kept results and Refresh:** a report on one of your Report Databases is kept for 15 minutes (other reports for a minute), so opening it again, or a dashboard with it, is instant. The line under the title then says **kept from 10:42**. **Refresh** runs it again now.
- **Why some reports take longer:** a report on your own database runs there, live. One that adds up a whole month of a large table (millions of rows) can take half a minute; one that lists the newest rows, or one campaign's day, is quick. A date filter on a day worked out from a date and time (such as DATE(SENT_AT)) is run on the date and time itself, so the database's index can help.

Component and Folder sit beside the title; every other action is in the **More actions** menu (the three dots), so the whole list fits on any screen. The menu is grouped: Explain and Edit; Share, Comments, Alerts, Schedule and Versions; the exports and Print-Ready PDF; Show the SQL and Embed on Another Site; Delete last.

| Action | What it does |
|---|---|
| Component | Lists the report under another component of the suite, or Automatic (its data's); it moves at once (owner or administrator). |
| Folder | Files the report in a folder, or in a new one (owner or administrator). |
| Versions | Every saved version with who, when and the note. **Open** shows one as it was, read-only, with Back to Current. **Restore** makes it the current version again, as a new version; nothing is lost. |
| Schedule | Emails the report on a schedule (below). |
| Explain | What This Means (free, by rules) and, where the AI is on, What the Rows Show (above). |
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

Press **Schedule** on a dashboard, or choose it in **More actions** on a report:

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
