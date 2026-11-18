# Scheduled Upgrade

**Where:** Operations → Scheduled Upgrade. The install script does the same from the server with `manage.py upgrade_notice`.

## What this is for

Telling everyone who is signed in, in every workspace (Platform included), that a new release is being installed. Without it, people who are in the app while the services restart see errors, and a page they were editing can fail to save.

## What people see

| When | In the app |
|---|---|
| **Before** (Scheduled) | An amber strip across the top of every page: "Scheduled upgrade today at 22:00, about 10 minutes. Save your work before then." The time is in each person's own time zone, followed by your note. They can hide it until 15 minutes before the start; after that it stays. |
| **During** (Upgrading) | The page dims under a small card, **Upgrade in Progress**. What people typed stays on the page underneath, and nothing can be saved into a service that is restarting. The card checks every 10 seconds (or at once with Check Now) and lifts by itself. If the API stops answering with no upgrade known, the same card says **Reconnecting**. |
| **After** (Upgraded) | A dark message: "C360 has been upgraded to v1.2.2. Save your changes, then reload." with **Reload**. It appears once the page sees a newer build than the one it runs. Nothing reloads by itself, so a half-filled form is never lost. |

## Who can use it

Platform staff see the page. Saving needs the right to change Global Parameters.

## Scheduling an upgrade

1. Under **Schedule an Upgrade**, set **Starts** and its **Time Zone** (for example `Asia/Singapore`), **Takes About** in minutes and an optional **Note for People**.
2. **Save**. Everyone in the app sees the strip within a minute.
3. To change it, save again. **Clear** removes it.

## On the day

The install steps in the Deployment Guide (section 11) run these around the restart:

```
manage.py upgrade_notice start                   # just before the services restart
manage.py upgrade_notice done --release v1.2.2   # once they are back
```

**Mark as Upgrading** and **Mark as Done** on the page do the same by hand.

## When nobody marks it

A schedule whose start is long past, or an upgrade nobody marked done, stops showing by itself after an hour (or three times its length, if longer). No workspace is left with a strip or a dimmed page.
