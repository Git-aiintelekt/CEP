# Fiscal Year

**Where:** Settings → Insights → Fiscal Year.

## What this page is for

Many businesses do not run their year from January to December. This page tells C360 the month your fiscal year starts in, and how a fiscal year is named. Insights then groups, filters, compares and labels by your fiscal quarters and years, so a report reads "FY2027 Q3" the way your finance team does.

Until someone sets it, the fiscal year is the calendar year.

## Who can use it

| | |
|---|---|
| Permission | Anyone signed in can read it (reports need it). Changing it needs `user.admin` (workspace administration). |

## The fields and controls

| Control | What it is | What it changes |
|---|---|---|
| Starts In | The month the fiscal year starts in, January to December. Default: January. Saves as soon as you choose. | Where every fiscal year and fiscal quarter begins: the four quarters are the three-month blocks counted from this month. Any month but January also adds **by Fiscal Quarter** and **by Fiscal Year** to the ways a date can be grouped, and the **Fiscal Quarter** and **Fiscal Year** periods to dashboards. |
| Name a Fiscal Year By | **The Year It Ends In** (default) or **The Year It Starts In**. Greyed out while Starts In is January, when the fiscal year is the calendar year. Saves as soon as you choose. | Only the name. With April: April 2026 to March 2027 is **FY2027** by the year it ends in, **FY2026** by the year it starts in. The dates covered do not change. |
| The example line | A sentence under the fields: "FY2027 runs from April 2026 to March 2027; today is in FY2027 Q3.", or "Your fiscal year is the calendar year." | Nothing; it reads your choice back so you can check it. |

## What it changes in Insights

| Where | With the calendar year (January) | With another start month |
|---|---|---|
| Grouping a date in the editor | by Day, Week, Month, Quarter, Year. | Also **by Fiscal Quarter** and **by Fiscal Year**, labelled FY2027 Q1, FY2027. |
| Date filters | **in this fiscal year**, **in last fiscal year**, **in this fiscal quarter** and **in last fiscal quarter** are offered and cover calendar years and quarters. | The same filters cover your fiscal years and quarters. |
| Year to Date and Quarter to Date comparisons | Count from 1 January and from the calendar quarter's first day. | Count from the fiscal year's first day and from the fiscal quarter's first day. |
| Dashboard period | **This Year** (1 January to today); no fiscal quarter. | **Fiscal Quarter** and **Fiscal Year**: from the first day of the current fiscal quarter or year to today. |
| Excel and PDF exports, the drill path, the result's labels | Calendar labels. | A fiscal column is written as FY2027 Q1 or FY2027. |

## A worked example

Your fiscal year starts in **April**, named by **The Year It Ends In**, and today is 20 November 2026.

| Fiscal period | Dates |
|---|---|
| FY2027 | 1 April 2026 to 31 March 2027 |
| FY2027 Q1 | April to June 2026 |
| FY2027 Q2 | July to September 2026 |
| FY2027 Q3 (today) | October to December 2026 |
| FY2027 Q4 | January to March 2027 |

- A report filtered **in this fiscal quarter** reads 1 October to 31 December 2026; **in last fiscal quarter** reads 1 July to 30 September 2026.
- **in this fiscal year** reads 1 April 2026 to 31 March 2027; **in last fiscal year** reads 1 April 2025 to 31 March 2026.
- Revenue grouped **by Fiscal Quarter** shows rows FY2027 Q1, FY2027 Q2, FY2027 Q3. A sale on 15 February 2026 falls in FY2026 Q4.
- A **Year to Date** column on that report adds up from 1 April 2026.
- A dashboard set to **Fiscal Year** shows 1 April 2026 to today; its previous period, for a tile that compares, is the same number of days just before.

Switch **Name a Fiscal Year By** to **The Year It Starts In** and the same rows read FY2026 Q1, FY2026 Q2, FY2026 Q3; the dates stay the same.

## How to

**Set your fiscal year.** Open Settings → Fiscal Year, choose the month under **Starts In**, then choose how to **Name a Fiscal Year By**. Each choice saves at once; check the example line.

**Report by fiscal quarter.** In the report editor, drag a date into Rows and choose **by Fiscal Quarter**. To keep it to this quarter, add a filter on the same date and choose **in this fiscal quarter**.

## What happens behind the scenes

1. The setting is stored on the workspace. Reports keep "in this fiscal quarter", never the dates, so every run works the dates out again from the setting and today's date in the workspace's time zone.
2. Changing the start month changes every report and dashboard that uses a fiscal grouping, filter, comparison or period from its next run, including schedules and alerts. Results kept from before are not reused for the new year.
3. A fiscal quarter or year in a result is the date of its first day; C360 names it (FY2027 Q1) on screen and in exports with the workspace's naming.

## Things to know

- With January, the fiscal filters still work and simply mean the calendar year and quarter.
- Changing the start month after reports exist moves their fiscal figures; tell the people who read them.
- The fiscal year applies to Insights. Campaign schedules and Home do not use it.
