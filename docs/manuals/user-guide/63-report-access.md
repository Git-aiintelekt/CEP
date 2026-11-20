# Report Access

**Where:** Settings → Insights → Report Access.

## What this page is for

Sharing decides which reports and dashboards a person can open. Report Access decides which **rows** they see inside them. A rule limits a person, or everyone holding a role, to some values of one field of a dataset: a store manager sees only their own stores, a regional lead only their region. The rule applies wherever that dataset is read for them, so it cannot be worked around by building another report.

People without a rule see every row of what they can open.

## Who can use it

| | |
|---|---|
| Permission | `report.admin` to see, add, change and remove rules. |
| Who a rule can name | Any active person of the workspace, or any role. A role reaches everyone holding it, including people given the role later. |

## The fields and controls

### The page

| Control | What it is | What it changes |
|---|---|---|
| Add a Rule | Opens the rule dialog. | |
| Who | The person (with their email address) or the role (with how many people hold it) the rule is for. A person or role that no longer exists reads "Removed". | |
| Dataset | The dataset the rule limits. | Only reads of this dataset are limited; other datasets are untouched. |
| Sees Only | The field and the values allowed ("Store: Lakeside Mall, Downtown"), with the rule's note under it. A red line says when the dataset no longer offers the field. | |
| Changed | When the rule was last saved. | |
| Edit | Opens the rule in the dialog, titled **Change a Rule**. | |
| Remove | Deletes the rule after asking ("They will see every row again."). | From the next run, the person or role sees every row of that dataset again, unless another rule still limits them. |

When there is no rule yet the page says so: everyone sees every row of the reports and dashboards they can open.

### The rule dialog (Add a Rule, Change a Rule)

| Field | What it is | What it changes |
|---|---|---|
| Who | Type part of a name, an email address or a role's name in **Find a person or a role**, then pick one from the list. Once picked it shows as a chip; **Change** clears it so you can pick someone else. Required. | Whose reads the rule limits. A rule on a role limits every holder of the role. |
| Dataset | The workspace's datasets. Required. Changing it empties Field. | Which dataset's reads are limited. |
| Field | The dataset's text, number and yes/no fields that group (dimensions), such as Store or Region. Required. Measures and date fields are not offered. | The field the values are checked against. |
| Sees Only | The allowed values, one per line or separated by commas, written exactly as the reports show them. From 1 to 500 values; repeats are dropped. A number field needs numbers, a yes/no field `true` or `false`. Required. | Only rows whose field holds one of these values are shown. |
| Note | Optional, up to 200 characters: why the rule exists, for whoever reads it later. | Shown under the values on the page. It does not change what anyone sees. |
| Add Rule / Save | Saves the rule. Greyed out until Who, Field and at least one value are given. | The rule applies from the person's next run. |

A person or role can have one rule per field of a dataset. To change the values, edit that rule; a second rule on the same field is refused with "That person or role already has a rule on this field; change it instead."

## How the rules combine

| Situation | What the person sees |
|---|---|
| A rule for the person and a rule for one of their roles, on the **same field** | The values of both rules together: Store is Lakeside Mall (their own rule) or Downtown (their role's rule). |
| Rules on **different fields** of the dataset | Every rule applies: Region is North **and** Store is Lakeside Mall. |
| No rule on the dataset | Every row. |
| A rule on a field the dataset no longer offers, or a value that does not fit the field's type | Nothing: the run is refused with a message asking them to have the rule changed. C360 never shows everything instead. |

## Where a rule applies

Every read of the dataset made for that person:

- Reports, in the viewer and the editor, with a note above the rows: "Your access shows only Store: Lakeside Mall, Downtown."
- Dashboard tiles, and the values offered by a dashboard's slicers.
- Exports and downloads of the report or dashboard.
- Scheduled deliveries and alerts, which are built with the rights of their owner: the owner's rules decide the rows every recipient receives and the value an alert watches.
- Linked measures read from another dataset, which carry that dataset's rules for the person.
- What the Rows Show (Explain): the AI reads only the rows the person sees.
- **Show the SQL**, which lists the rules it added ("Your row access rules are in it: …").

Not limited: the query window of a workspace's own Report Database, which runs SQL as written. Give that window only to people who may see all of the database.

## How to

**Limit a store manager to their stores.** Add a Rule → find the person → Dataset: the sales dataset → Field: Store → Sees Only: their store names, one per line → Note: "Store manager, Lakeside and Downtown" → **Add Rule**. Open one of their reports as a check: the note above the rows names the stores.

**Limit a whole team.** Make the rule on their role. Everyone who holds the role, now or later, is limited.

**Lift a limit for one person while their role keeps it.** Rules only narrow. Give the person a role without the rule instead.

## What happens behind the scenes

1. At every run C360 reads the person's own rules and their roles' rules for the dataset, and adds them to the report's filters before the query runs. The rules come first, before the report's own filters, parameters and the result cache, so a result kept for someone else is never shown to them.
2. A change to a rule is saved with a version number; saving over someone else's newer change is refused ("The rule changed since you opened it") and asks you to reload.

## Things to know

- Report Access limits rows, not reports. Who can open a report or dashboard is set by sharing (Share on the report or dashboard).
- Write the values as the reports show them, including capitals and spaces; a value that matches nothing shows nothing.
- Report administrators are limited by a rule that names them, like anyone else.
- Masking personal data is separate: a person without the right to see personal data sees it masked, whatever their rules.
