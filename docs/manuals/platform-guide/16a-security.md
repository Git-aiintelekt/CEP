# Security

**Where:** Overview → Security. The number on the menu item counts the open Critical and High items on this server; the back-office Home shows a card while one is open (a warning card when the worst is Medium).

## What this is for

Knowing which updates and settings this server needs before someone else finds out. Each server checks itself once a day (the check-security job) and whenever someone presses **Check Now**:

- **Packages:** every Python package installed for the backend and every npm package in the deployed frontend (its package-lock.json) is looked up in OSV.dev, the open vulnerability database behind the GitHub, PyPI and npm advisories.
- **Server settings:** Django's own deployment checks (debug mode, the signing key, allowed hosts, HTTPS-only cookies, HSTS, the HTTPS redirect) and whether the development web server (`manage.py runserver`) is serving the app.
- **Site headers:** the headers the app's public address really sends: HSTS, Content-Security-Policy, nosniff, and whether other sites may frame it. Set the address in Global Parameters → `security.site_address` (for example `https://cepdev.aiintelekt.com`); while it is empty the headers are not checked.
- **Workspace isolation:** every table holding workspace rows that the app's login can read keeps each workspace's rows apart (forced row-level security), unless it is one of the platform's own tables; and the app's login can neither skip row-level security nor change the schema.
- **Accounts and keys:** platform accounts that have not signed in for 90 days, platform staff allowed to sign in without a second factor, active accounts with a test address (example.com, .test and the like), workspace accounts unused for 90 days, workspace API keys over a year old or unused for 90 days, and Postal engines whose callbacks are not signed.
- **Sending domains:** the SPF and DMARC records of every domain a workspace sends email from, read from DNS by this server. Domains reserved for examples (`.example`, `.test`) are not looked up. DKIM is not checked here: its record name depends on the mail engine's selector, which each workspace gives on its own Settings → Delivery → Sending Domains, where its administrators also see these results with the record to publish (the daily check-sending-domains job and Check Now).

The last three need patch 0067; until it is applied the page says so under Passed and the other checks run as before.

The page never installs or changes anything. A package is updated with a deploy and a setting on the server; the next check marks the item **Fixed** and the check history says so.

## Who can use it

Platform staff see the page. Accepting a risk and reopening an accepted item need a platform administrator.

## Step by step

**See what needs updating**

1. Open **Overview → Security**. The figures say how many items are open (Critical and High, Medium and Low), how many are accepted, and how many packages were checked.
2. **Needs Attention** lists every open item, worst first, packages, settings and data checks together: the severity, the item and why it matters, where it is (Backend · Python, Frontend · npm, Server setting, Site header, Workspace isolation, Account or key, Sending domain), what is there now and what fixes it, the reference, and when it was first seen.
3. Press the advisory to read it (GitHub or OSV.dev for a package, Django's documentation for a setting).
4. An npm package marked **Build-time only** is used while the frontend is built and never reaches a browser.

**Check now**

1. Press **Check Now** at the top right. The check takes a few seconds; the message says how many items are open and how many were fixed since the check before.
2. If OSV.dev cannot be reached, the settings are still checked; the packages keep their earlier findings and the page says so.

**Accept the risk**

1. On an open item, press **Accept…**.
2. Write why the risk is acceptable in a sentence (for example, a build-time package, or a setting the proxy in front already covers), and choose a **Review On** date within a year.
3. Press **Accept the Risk**. The item leaves the count and shows under **Accepted**, with who accepted it, why and until when.
4. It opens again on its review date, or as soon as an advisory appears that was not there when it was accepted. Press **Reopen** under Accepted to open it earlier.

**See what passed and the history**

1. **Passed** lists the packages with no known advisories (Python and npm), every setting and header that passes, and, below them, what passed in Workspace Isolation, Accounts and Keys and Sending Domains.
2. **Checks · last 30 days** lists every check: when, by the daily job or by whom, how many packages, what was open after it, and what it found fixed.

## Severity

| Severity | Meaning |
|---|---|
| Critical | Fix now: for example a weak signing key, a package advisory rated critical, or the app's login skipping row-level security. |
| High | Fix soon: debug mode on, the development web server serving, a session cookie sent over HTTP, a high-rated advisory, a workspace table that does not keep workspaces apart, an unused platform administrator, staff signing in with a password alone, a sending domain without SPF. |
| Medium | Plan the fix: missing HSTS or Content-Security-Policy, a moderate advisory, an advisory its database did not rate, an API key over a year old, unsigned engine callbacks, a sending domain without DMARC. |
| Low | Note it: a low-rated advisory, nosniff missing, the HTTPS redirect left to the proxy, unused workspace accounts or API keys, DMARC that only monitors. |

Package severities come from the advisory (GitHub's rating, or the rating of the GitHub twin of a PyPI advisory).

## When something does not work

| What you see | What it means |
|---|---|
| The page says it needs a database update | Patch 0066 has not been applied on this server. |
| Not checked yet | No check has run: press Check Now, or wait for the daily job. |
| "OSV.dev could not be reached" | The server cannot reach api.osv.dev over HTTPS; allow it in the firewall. |
| The site could not be read | The address in `security.site_address` does not answer from the server itself. |
| The development web server item does not appear on Windows | Running processes are read on Linux only. |
| Passed says the data checks wait for patch 0067 | Patch 0067 has not been applied on this server. |
| "A sending domain could not be looked up" | This server's DNS did not answer for it; check the server's resolver. |
| "Workspace Isolation was not checked" (or another group) | That group failed to read the database; the check's history shows the error, and the group's earlier findings stand. |
