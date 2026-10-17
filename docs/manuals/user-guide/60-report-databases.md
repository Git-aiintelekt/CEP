# Report Databases

**Where:** Settings → Report Databases. Needs the user administration right.

## What it is for

Insights builds reports on the data the platform already keeps. Report Databases adds your own: a MySQL 5.7, MySQL 8.0
or PostgreSQL database you connect here, strictly to read. You pick the tables or views to report on and name their
columns, and those datasets appear in New Report and in Ask for a Report for your workspace alone. The editor, the four
views, exports, dashboards and scheduled delivery work on them like on any dataset.

The engine never writes. It only ever runs the SELECT statements it builds from a report, on a session it opens
read-only with the workspace's time limit, and it refuses an account that could write or change the schema. Nothing but
the columns you mapped is read.

## The account to create

Ask your database administrator for an account that holds SELECT and nothing else. The page shows the exact statements:

- MySQL: `CREATE USER 'cep_reader'@'%' IDENTIFIED BY '…'; GRANT SELECT ON your_db.* TO 'cep_reader'@'%';`
- PostgreSQL: a login role with CONNECT on the database, USAGE on the schema and SELECT on its tables.

Grant SELECT on views alone to hide tables the engine should never see. The database must be reachable from CEP's
server; a private network address is fine when CEP's server sits on that network.

## Connecting a database

1. Press **Connect a Database**. Give it a name (what people see in New Report), pick the engine, and enter the host,
   port (3306 for MySQL, 5432 for PostgreSQL), database, user and password. For PostgreSQL, also the schema the tables
   live in (`public` unless told otherwise). SSL is Required by default; Preferred tries SSL first, Off is for a private
   network.
2. **Test Connection** reaches the server and reports four facts: reached and the version, what the account can read,
   whether the account is read-only, and the server's time zone. A ✕ on the read-only line names what the account holds
   beyond SELECT; the connection can be saved but cannot be used until the account is fixed.
3. **Save** keeps the connection and runs the test again. The password is stored encrypted and never shown; leave it
   empty on a later edit to keep it.

Each card shows the engine and version, host and database, the account with ✓ Read-only or ✕ Can write, the datasets
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

## Joining tables

A dataset can read more than one table. The diagram above the fields shows the base table as a card with its columns;
**Add a Join** (or **Join to this** on a card) brings another table in:

1. Pick what to join to: the base, or a table already joined, which makes a chain such as sales → stores → regions.
2. Pick the table, and whether to keep every row of the table joined to (**Left**: a row with no match still shows, with
   the joined fields empty) or only the rows that match (**Inner**).
3. Say which columns are equal, one pair or more. The first pair is suggested from the names (store_id = id).
4. **Check the Join** before adding it: how many rows match, and a warning when the join multiplies rows, which would
   count the base's rows more than once in totals.

The joined table appears as a card with the key drawn to it, its columns ticked as fields and labelled with the table's
name ("Store Name", "Store City"). A key column is read for the join whether or not it is a field. Up to five joins;
removing a join removes the ones chained to it. The engine still writes one SELECT, read-only, under the same limits.

A dataset with reports built on it cannot be deleted until those reports are; a database with datasets cannot be removed
until they are.

## When a report runs

The freshness line under a report on one of your datasets reads "live from <database>": the engine reads your database
at run time, under the same limits as any report (the statement time limit, the preview and run caps). A database that
does not answer shows "<database> did not answer" on the report; the Run Log records it like any run.
