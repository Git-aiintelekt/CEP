# Report Databases

**Where:** Settings → Report Databases, which needs the user administration right. A report author (Report Edit) can also connect a
database from Insights → New Report → **Connect a Database**; changing or removing a connection stays here.

## Step by step

**Connect a database** (workspace administrator)

1. Ask your database administrator for an account that holds SELECT and nothing else; the page shows the exact statements for MySQL, PostgreSQL and ClickHouse.
2. Open Settings → Report Databases and press **Connect a Database**. Give it a name, pick the engine (MySQL 5.7, MySQL 8.0, PostgreSQL or ClickHouse), enter the host, port, database, the schema for PostgreSQL, the user and the password, and choose SSL. **Find Databases** (on PostgreSQL **Find Schemas**) lists the databases the account can see with their table counts, so you pick one instead of typing it; it reads names only.
3. Press **Test Connection**. Four facts come back: reached and the version, what the account can read, whether it is read-only, and the server's time zone. A ✕ on the read-only line names what the account holds beyond SELECT; have the account fixed before mapping anything. Where your platform does not require a read-only account (the global parameter **insights.report_db_read_only_required** set to No), the line reads **! Can write** instead and the connection is used as it is.
4. Press **Save**. The password is stored encrypted and never shown; leave it empty on a later edit to keep it.

**Set how reports treat a database** (workspace administrator)

1. Open Settings → Report Databases and press **Edit** on the database's card (or set it while you connect it).
2. Under **How Reports Treat This Database**, pick what kind of database it is:
   **Standard** for a reporting copy or a small database (the workspace's limits, usually 15 seconds and 4 reports at once);
   **Large or Slow** for big tables or a server behind a slow link (60 seconds, 2 at once);
   **Live Production Database** for the database the business runs on (60 seconds, 1 at once);
   or **Custom** to set the **Time Limit** (5 to 110 seconds) and **Reports at Once** (1 to 4) yourself.
3. Press **Save**. The next report uses it; nothing restarts. The card shows the choice and its two values.

A report that needs longer than the time limit is stopped, with a message that names the database and its limit. A report that finds the database busy with as many reports as it allows waits up to 10 seconds for its turn, then asks you to try again. Reading the database's list of tables and columns may take at least 60 seconds, or the time limit when that is longer.

**Map a dataset from a table** (workspace administrator)

1. On the database's card, press **Map a Dataset**. The list on the left holds every table and view by name, read live from the database when the page opens (one statement that opens no table; nothing about the database is stored). A large database opens on your **pinned** tables and on folded groups by name prefix (`sales_`, `inv_` ...); type part of a name to search them all, narrow the matches with the chips, and press **Show 50 More** for the next ones. The star pins a table to the top for everyone who maps datasets here. **Reload the List** reads the names again after the database changed. Pick a table or view: its columns and row estimate are read then, for that table only.
2. Name the dataset and describe it. Choose the **Row Key** (what one row is) and the **Time Field** (the date a period filter applies to).
3. For each column: tick it to keep it, give it a label, check its type and role, pick the calculations a measure allows, and set the sensitivity (**Personal** is masked for readers without the right, **Confidential** is hidden from everyone).
4. Watch the preview under the fields update with your labels, then press **Save Dataset**. It appears in New Report under **Your Databases**.

**Connect a database from New Report** (report author)

1. Open Insights → Reports → **New Report**. Under **Your Databases**, press **Connect a Database**. A panel opens over the page.
2. Fill in the same fields as above and press **Test Connection**. **Save and Continue** is offered once the test passes: the account read-only, or, where read-only is not required, able to write (the panel warns). Where read-only is required and the account can write, the panel says what it holds and asks for an account that can only read.
3. Pick a table or view (search narrows the list) and press **Create Report**. The table becomes a dataset with every readable column, labelled from its name, the first date as its time field; the report opens in the editor. A table mapped before keeps its dataset. Or press **write a query** to open the query window on the database.

**Add a calculated measure** (workspace administrator)

1. On the database's card press **Map a Dataset**, or **Edit Fields** beside an existing dataset.
2. Mark the numbers you need as **Measure**.
3. Under **Calculated Measures**, press **Add a Calculated Measure** and give it a label, such as Delivered Rate.
4. Pick the left side and its calculation, such as Sum of Delivered.
5. Pick the operation: **Divided by**, **Minus**, **Plus** or **Times**.
6. Pick the right side: another measure, or **A number…** to type a value.
7. Set the **Scale** (100 for a percentage) and the **Format**, and mark it Personal if it uses personal data. The formula is spelled out under the label as you build it.
8. Press **Save Dataset**, or **Save Fields** for a dataset made from a query. Report authors find it among the measures with the calculation **Calculated**.

**Join tables in a dataset**

1. On the mapping page, press **Add a Join**, or **Join to this** on a table's card in the diagram.
2. Choose what to join to (the base, or a table already joined), the table, and whether to keep every row (**Left**) or only the rows that match (**Inner**).
3. Say which columns are equal; the first pair is suggested from the names. Press **Check the Join** to see how many rows match and whether the join multiplies rows, then **Add**.
4. The joined table appears as a card with the key drawn to it; its columns are fields labelled with the table's name. Up to five joins; removing one removes the joins chained to it.

**Build a report from a query** (anyone who can build reports)

1. Open Insights → Reports → **New Report** and, under **Query a Database**, press the database.
2. **Visual**: press **From** beside a table on the left, add columns with their calculations and aliases, add conditions and sorts; the group by is set for you and the SQL shows underneath. **SQL**: write or paste the SELECT; click a table or column on the left to insert its name.
3. **Write It for Me**: describe the query in words, pick the model, and press it; the SQL lands in the window for you to read. It counts as one prompt.
4. Press **Run** to preview the rows. A second statement, a write word or a file function is refused with the reason before anything runs.
5. Name the report and press **Create Report**. The report opens in the editor on the query's result, where you group, sort, switch views, export and schedule as with any report.
6. Administrators reach the same window from **Query** on a database card; there it ends with **Use as Dataset**, and a dataset from a query shows **Edit Query** beside **Edit Fields**.

## What it is for

Insights builds reports on the data the platform already keeps. Report Databases adds your own: a MySQL 5.7, MySQL 8.0,
PostgreSQL or ClickHouse database you connect here (or from New Report), strictly to read. You pick the tables or views to report on and name their
columns, and those datasets appear in New Report and in Ask for a Report for your workspace alone. The editor, the four
views, exports, dashboards and scheduled delivery work on them like on any dataset.

The engine never writes. It only ever runs the SELECT statements it builds from a report, on a session it opens
read-only with the workspace's time limit, and by default it refuses an account that could write or change the schema
(the platform can lift that refusal with a global parameter; the sessions stay read-only either way). Nothing but
the columns you mapped is read.

## The account to create

Ask your database administrator for an account that holds SELECT and nothing else. The page shows the exact statements:

- MySQL: `CREATE USER 'cep_reader'@'%' IDENTIFIED BY '…'; GRANT SELECT ON your_db.* TO 'cep_reader'@'%';`
- PostgreSQL: a login role with CONNECT on the database, USAGE on the schema and SELECT on its tables.
- ClickHouse: `CREATE USER cep_reader IDENTIFIED BY '…' SETTINGS readonly = 2; GRANT SELECT ON your_db.* TO cep_reader;`
  An account whose profile is read-only (`readonly = 1` or `2`) passes whatever it was granted; otherwise it may hold
  SELECT and SHOW and nothing else. With `readonly = 1` the server also refuses the engine's time limit, so the server's
  own limits apply.

Grant SELECT on views alone to hide tables the engine should never see. The database must be reachable from CEP's
server; a private network address is fine when CEP's server sits on that network.

## Connecting a database

1. Press **Connect a Database**. Give it a name (what people see in New Report), pick the engine, and enter the host,
   port (3306 for MySQL, 5432 for PostgreSQL, 8443 for ClickHouse), database, user and password. For PostgreSQL, also the
   schema the tables live in (`public` unless told otherwise). SSL is Required by default; Preferred tries SSL first, Off
   is for a private network. ClickHouse is read over its HTTP interface: **HTTPS** on 8443, or **Off (plain HTTP)** on 8123
   on a private network; the port follows the choice.
2. **Test Connection** reaches the server and reports four facts: reached and the version, what the account can read,
   whether the account is read-only, and the server's time zone. A ✕ on the read-only line names what the account holds
   beyond SELECT; the connection can be saved but cannot be used until the account is fixed. Where the platform does not
   require a read-only account, it reads **! Can write** and the connection is used.
3. **Save** keeps the connection and runs the test again. The password is stored encrypted and never shown; leave it
   empty on a later edit to keep it.

Each card shows the engine and version, host and database, the account with ✓ Read-only, ✕ Can write (refused) or ! Can write (allowed where read-only is not required), the datasets
mapped from it and the last test. **Test Connection** runs the check again; **Edit** changes the connection; **Remove**
is offered once its datasets are gone.

## Mapping a dataset

**Map a Dataset** on a card opens the mapping page.

1. The tables and views the account can read are on the left, views first, with their column counts and row counts.
   Search by name. A view is the safest source: it shows only what you put in it, already joined.
2. Pick one. Its columns fill the right side, each already typed from the column: a label made from the column's name,
   the type (Text, Number, Date, Date and time, Yes/No), the role (a number is a measure unless it looks like an id), the
   calculations a measure allows (Sum, Average, Min, Max, Count, Distinct) and a sensitivity. Untick a column to leave it
   out; it is then never read.
3. Name the dataset and describe it. Choose the **Row Key** (what one row is; optional) and the **Time Field** (the date a
   period filter applies to).
4. Mark personal columns **Personal**: they are masked for readers without the right, as in every dataset.
   **Confidential** hides a column from everyone.
5. The preview underneath shows the first rows with your labels applied, masked where you said so.
6. **Save Dataset**. It is in New Report under **Your Databases**, named with its database, and Ask for a Report knows
   it by label. **Edit Fields** in the table under the cards reopens it.

### Calculated measures

Under the columns, **Calculated Measures** makes a measure from the others: a rate, a share, a difference or a product.
**Add a Calculated Measure**, name it (Delivered Rate), pick the left side (a measure and its calculation, Sum of
Delivered), the operation (Divided by, Minus, Plus, Times), the right side (another measure, or **A number…**), a scale
(100 for a percentage) and a format. The formula reads under the label as you build it. Report authors get it as a
measure with the one calculation Calculated; the engine computes it in every view and total, so a group's rate is the
rate of its totals. A ratio with an empty denominator reads as empty, never as an error. Up to ten per dataset; one
formula may read another calculated measure.

## Joining tables

A dataset can read more than one table. The diagram above the fields shows the base table as a card with its columns;
**Add a Join** (or **Join to this** on a card) brings another table in:

1. Pick what to join to: the base, or a table already joined, which makes a chain such as sales → stores → regions.
2. Pick the table, and whether to keep every row of the table joined to (**Left**: a row with no match still shows, with
   the joined fields empty) or only the rows that match (**Inner**).
3. Say which columns are equal, one pair or more. The first pair is suggested from the names (store_id = id).
4. **Check the Join** before adding it: how many rows match, and a warning when the join multiplies rows, which would
   count the base's rows more than once in totals. It checks the first 10,000 rows of the base, never a whole table, and says so.

The joined table appears as a card with the key drawn to it, its columns ticked as fields and labelled with the table's
name ("Store Name", "Store City"). A key column is read for the join whether or not it is a field. Up to five joins;
removing a join removes the ones chained to it. The engine still writes one SELECT, read-only, under the same limits.

A dataset with reports built on it cannot be deleted until those reports are; a database with datasets cannot be removed
until they are.

## Query a Database: a report from a query

New Report offers **Query a Database** for every database your workspace has connected. Anyone who can build reports
can use it; the connection, its SELECT-only account and the limits are the administrator's.

- **Visual** builds the query from the tables and columns on the left: From (a table, then joins on a key), Columns
  with a calculation (Sum, Count, Count Distinct, Average, Min, Max) and an alias, Where conditions, Order by. Group
  by is set from the columns without a calculation. The SQL the builder writes shows underneath.
- **SQL** is the same window as text: write, paste or correct. Click a table or column on the left to put its name at
  the cursor. **Write It for Me** sends your request and the table and column names (never rows) to the AI assistant
  and puts the SQL in the window for you to read; it counts as one prompt. A query edited by hand stays in SQL; Start
  Over returns to Visual.
- **Run** shows the first rows with the time and the typed columns, under the workspace's limits.
- **Create Report** makes a dataset from the result (labels from the column names, numbers as measures) and opens the
  report in the editor, where you group, sort, switch views, export and schedule as with any report.

The window takes one SELECT and nothing else: a second statement, a write or schema word (INSERT, UPDATE, DELETE,
DROP, CREATE, ALTER, GRANT, SET, INTO …) or a file or system function is refused with the reason before anything runs.
The engine runs the query wrapped, `SELECT * FROM (your query) AS q` with the limit, on the read-only session; a query
that outgrows the time limit is stopped with advice to narrow it or put the heavy part in a view. A query never runs
against CEP's own database.

Under Settings → Report Databases, **Query** on a database card does the same for administrators and ends with **Use
as Dataset**, which opens the fields to name; a dataset from a query shows "From a query" with **Edit Query** beside
Edit Fields.

## When a report runs

The freshness line under a report on one of your datasets reads "live from <database>": the engine reads your database
at run time, under the same limits as any report (the statement time limit, the preview and run caps). A database that
does not answer shows "<database> did not answer" on the report; the Run Log records it like any run.
