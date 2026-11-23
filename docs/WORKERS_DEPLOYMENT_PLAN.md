# Separate Workers on .68: Deployment Plan

**Goal:** large imports (1.32M Party IDs) and large sends (1M+ texts and MMS) run side by side without slowing each other or the web pages, and anything that stops, crashes or hangs carries on from where it stopped.

**Status:** written 2026-11-24. Step 1 (the code changes, section 2) is built on branch `workers-resume` with patch 0095 (applied to the local database only). Nothing is deployed; each later step is done only when it is asked for.

---

## 1. Today and the target

**Today on .68.** Two services: `cep-backend` (gunicorn: pages, API, delivery reports) and `cep-jobs` (`manage.py run_scheduler --tick 15`). `cep-jobs` is one process that does everything in turn: starts and sends campaign runs, imports lists, runs every scheduled job. Its own description says it is for "a single small server … not for a fleet". A 1.32M import holds up every send for about an hour; a 1M text send holds up imports and journeys for days.

**Target.** The worker layout CEP was written for (`backend/config/celery.py`, `CELERY_TASK_ROUTES` in `config/settings/base.py`): a queue per kind of work, and separate worker services per group of queues.

| Service | Runs | Processes | Direction |
|---|---|---|---|
| `cep-backend` (unchanged) | Pages, API, back-office, Digivize delivery reports and STOP replies | 3 × 4 threads | web |
| `valkey` (new) | The queue (Redis-compatible; RHEL 10 ships Valkey instead of Redis) | 1 | — |
| `cep-beat` (new) | The clock: every scheduled job on its interval (`CELERY_BEAT_SCHEDULE`). Does no work itself. | 1 | — |
| `cep-worker-out` (new) | Queues `campaign`, `sms`, `email`: audience builds and sending | 8 to start, up to 16 | out |
| `cep-worker-in` (new) | Queue `imports`: list uploads and the iCRM lookup | 2 | in |
| `cep-worker-bg` (new) | Queues `journey`, `events`, `analytics`, `maintenance`, `default` | 4 | background |
| `cep-jobs` | **Stopped and disabled.** Never run it beside the Celery services. | 0 | — |

Each SMS batch (100 messages) is its own task, so 8 `sms` processes send 8 batches at once. A 1.32M import uses only `cep-worker-in`, so it never waits for a send and a send never waits for it.

---

## 2. Code changes needed first

Reading the code for this plan turned up three things that must change before the switch, and three that make "carry on from where it stopped" complete. C1 to C5 are built on branch `workers-resume`; C6 is not built yet.

| # | Change | Why | State |
|---|---|---|---|
| C1 | **The send window.** A run gives its workers 32 batches to start with, and each finished batch gives out one more (`runs.hand_out`). Each message records when it was given to a worker (`enqueued_at`, patch 0095); one given out over an hour ago and still waiting is given out again. The dispatcher's minute adds batches only when none is with a worker. A retry waiting for its turn keeps its messages; a paused run's batch gives them back. | With Celery today, every finished batch **and** the dispatcher's minute queue every message still waiting, again: a 1.32M send would put millions of duplicate tasks in the queue. Nothing was sent twice (the claim stops that), but the queue would grow without end. | Built |
| C2 | **PREPARING starts again.** A run is prepared under a lock held by its worker's database connection. A run PREPARING for over 5 minutes whose lock is free (its worker died) goes back to SCHEDULED, with a note in its log, and starts again on the next minute. | The audience is built in one transaction, so a crash leaves nothing half-built, but today the run stays PREPARING forever. | Built |
| C3 | **Time limits.** A batch: 12 minutes, then its process is replaced at 14 (under the 15 minutes after which unconfirmed messages count as interrupted). Preparing a run: 2 hours. An upload pass: 4 hours. Every other task: 4 hours 10 minutes. | A hung process is not a crashed one: systemd does not notice it, so it is never restarted. | Built |
| C4 | **Uploads carry on from the last finished chunk.** Reading the file carries on after the last stored line; importing carries on after the last finished range, with the counts of each range saved in that range's own transaction, so nothing is counted twice. Checking the rows (review) still starts again: it changes nothing outside the upload's own rows. | Today a crash restarts the whole step. At 1.32M rows that can cost up to an hour, and after three crashes the upload fails. | Built |
| C5 | **Stall alerts.** Every 5 minutes, on the back-office Alerts page (and by email to the alert recipients): a send with messages due, none with a worker and nothing sent for 15 minutes; a run preparing for over 30 minutes; an upload with no heartbeat for 10 minutes, or waiting 10 minutes while no upload worker is at work. Resolved by itself when the work moves again. | So a stall is seen in minutes, not when a customer asks. | Built |
| C6 | **Resend Interrupted.** A button on the run's Recipients tab, for messages marked "Interrupted before the provider confirmed the message". | These are never resent on their own, on purpose: Digivize may already have sent them, and a duplicate text is worse than a missing one. At most one batch per worker that died (100 × 16 = 1,600 messages). | Not built: needs a small design for the button |

Tests: `backend/tests/test_workers_resume.py` (the window feeding workers and surviving a dead one, a paused run, a held retry, a run left PREPARING, a stall alert, an upload resuming) and the existing send, drip, import and alert suites.

The sending speed changes from the 800K readiness page (Digivize batch mode, lighter logging per message) are a separate branch. They are not needed for the switch, but they multiply what each worker sends.

---

## 3. When something stops: what happens

With C1 to C5. "Carries on" means from the first message or chunk not yet done; nothing done is done twice.

| What happens | Imports | Sends |
|---|---|---|
| A worker process crashes | systemd restarts it in 5 s; the upload's heartbeat stops, so after 3 minutes another worker claims it and carries on from the last finished chunk (C4). | The other batches keep going. The dead batch's messages are given out again an hour after they were first given out (C1). Messages it had already claimed when it died become "Interrupted" after 15 minutes, whether or not they went out (C6). |
| A worker hangs | The pass's 4-hour limit replaces it; the stall alert shows it after 10 minutes (C5). | The batch's 12-minute limit stops it (C3); as above. |
| The whole server restarts | Every service starts on boot (`WantedBy=multi-user.target`); uploads carry on as above. | Runs that were SENDING are picked up by `dispatch-campaign-runs` within a minute; what was with a worker is given out again within the hour. A run that was PREPARING starts again (C2). |
| Valkey (the queue) restarts | Tasks in the queue are lost, but nothing depends on them: the database says what is waiting (`process-list-imports` every 30 s). | The messages given out are given out again within the hour (C1); the stall alert shows the pause after 15 minutes. |
| `cep-beat` stops | Uploads already queued go on; new ones wait until it is back (systemd restarts it). | Scheduled campaigns wait for it; nothing is lost. |
| The database is unreachable | Tasks fail and retry; the import's attempts count; it carries on once the database is back. | Batches retry with back-off (1, 5, 15, 30, 60 minutes) and keep their place. |
| Digivize is down | — | Temporary errors: the batch retries with back-off. A refusal of the whole account (`ProviderError`) stops the run and marks what was waiting as failed, as today; Publish Again sends to those people. |
| Someone presses Pause | Cancel on an import stops it at the next chunk. | Pause stops new batches; Resume carries on from the next queued message. |

---

## 4. Settings

In `/opt/cep/app/.env` on .68 (added by the user, as with every `.env` change):

```
REDIS_URL=redis://127.0.0.1:6379/0
LIST_IMPORT_RUNNER=celery
```

The rest is in `config/settings/base.py` on the branch: `CELERY_TASK_ACKS_LATE`, `CELERY_WORKER_PREFETCH_MULTIPLIER = 1`, the 5-hour `visibility_timeout` (longer than the longest task, so a task still at work is never handed to a second worker), the 4 h 10 min net under every task and `CELERY_WORKER_MAX_TASKS_PER_CHILD = 500`. A run's window is 32 batches (`CEP_RUN_WINDOW_BATCHES` to change it).

**If PgBouncer is ever added** (section 6), the workers must use it in session mode, or connect to PostgreSQL directly: C2's lock lives on the worker's database connection.

The `outbox-relay` job (every second) starts publishing to Valkey streams in this mode. Nothing reads them yet; turn it off in `CELERY_BEAT_SCHEDULE` for .68 unless something needs it.

---

## 5. Services on .68

System units, run as the `cep` user, logs to the journal (SELinux on .68 refuses append logs under `/opt`). Read them with `journalctl -u cep-worker-out -f`.

**Valkey:**
```
sudo dnf install -y valkey
sudo systemctl enable --now valkey
valkey-cli ping          # PONG
```
It listens on 127.0.0.1 only (the default). No persistence needed: the database is the record, the queue only hands out work.

**`/etc/systemd/system/cep-worker-out.service`** (the other two differ only in name, queues and `-c`):
```
[Unit]
Description=CEP outbound worker (campaign runs, texts, emails)
After=network.target valkey.service
Requires=valkey.service

[Service]
User=cep
WorkingDirectory=/opt/cep/app/backend
EnvironmentFile=/opt/cep/app/.env
Environment=DJANGO_SETTINGS_MODULE=config.settings.production
Environment=PYTHONUNBUFFERED=1
ExecStart=/opt/cep/app/backend/.venv/bin/celery -A config worker -n out@%%h -Q campaign,sms,email -c 8 -O fair --max-tasks-per-child 500 --max-memory-per-child 400000 -l info
Restart=always
RestartSec=5
KillSignal=SIGTERM
TimeoutStopSec=600

[Install]
WantedBy=multi-user.target
```
- `cep-worker-in`: `-n in@%%h -Q imports -c 2`
- `cep-worker-bg`: `-n bg@%%h -Q journey,events,analytics,maintenance,default -c 4`
- `cep-beat`: `ExecStart=… celery -A config beat -l info --schedule /var/lib/cep/celerybeat-schedule`, `-c` not used. **Only one beat, ever.** Create its folder first: `sudo install -d -o cep -g cep /var/lib/cep`.
- `%%h` is written doubled because systemd reads `%h` itself; Celery receives `%h` (the host name).

`TimeoutStopSec=600` lets a worker finish the batch in hand on a restart or deploy (a warm stop) instead of cutting it off. `--max-tasks-per-child` and `--max-memory-per-child` replace a process now and then, so a slow leak never builds up.

The deploy script (`deploy_68_<sha>.sh`) restarts `cep-worker-out cep-worker-in cep-worker-bg cep-beat` instead of `cep-jobs`.

---

## 6. Capacity

**.68 (4 CPUs, 15 GB, mostly idle): enough to start.** About 18 Django processes (3 web + 8 + 2 + 4 + beat) at 150 to 250 MB each is 3 to 4.5 GB. Sending is mostly waiting for Digivize, so CPU stays low.

**The database server is the one to check before the switch.** Every process holds a connection: about 18 to 30 at peak, plus Insights. Check on the database server, by whoever runs it:
- `SHOW max_connections;` (should be 100 or more)
- CPU, memory and disk while the .51 rehearsal runs (step 7)

If connections run short as workers grow past 16, put PgBouncer (transaction mode) in front of it.

**Later, only if the web pages slow down during a big send:** move `cep-worker-out` and `cep-beat` to a second VM with the same code and `.env`, pointing at .68's Valkey and the same database. No code change.

---

## 7. Rehearsal on .51

Same layout on .51 first, with the sandbox SMS engine. Passes when every line holds:

| Test | Pass |
|---|---|
| 250,000-row upload and a 20,000-text send started together | The send's speed is the same as on its own; the upload finishes |
| 1,320,000-row upload (6 × 220K until the row limit is raised) | Finishes; time recorded per step |
| `kill -9` an outbound worker in the middle of a send | The run finishes; every message is Sent, Failed or Interrupted; none sent twice (count by message id at the sandbox) |
| `kill -9` the import worker in the middle of a step | The upload finishes from the last chunk, not line 1 |
| `systemctl restart valkey` during a send | The run carries on within 2 minutes |
| Reboot the server during a send and an upload | Both carry on after boot |
| A worker made to hang (a test engine that never answers) | The time limit replaces it; the watchdog alert appears |
| Queue length during a 100K send | Stays around the number of batches left, never grows (C1) |

---

## 8. Switch on .68

In a quiet window, with no campaign run SENDING or PREPARING and no upload running (Campaigns → Running, Lists → Uploads):

1. Deploy the `workers-resume` branch (merged) as usual.
2. Install and start Valkey; the user adds the two `.env` lines.
3. `sudo systemctl disable --now cep-jobs`
4. Install the four units; `sudo systemctl daemon-reload && sudo systemctl enable --now cep-beat cep-worker-out cep-worker-in cep-worker-bg`
5. Check: `celery -A config inspect ping` answers for `out@`, `in@`, `bg@`; back-office → Jobs shows every scheduled job running; a test send to one phone; a 10-row upload.

**Going back** (5 minutes, nothing lost): `sudo systemctl disable --now cep-beat cep-worker-out cep-worker-in cep-worker-bg`, remove `LIST_IMPORT_RUNNER=celery`, `sudo systemctl enable --now cep-jobs`. The two modes keep their state in the same tables, so `cep-jobs` carries on whatever was left.

---

## 9. Running it

| Look at | Where |
|---|---|
| Is every worker alive | `celery -A config inspect ping`; `systemctl status 'cep-*'` |
| What is waiting | `valkey-cli llen sms`, `llen imports` (number of batches or uploads waiting) |
| Logs | `journalctl -u cep-worker-out -f` (and `-in`, `-bg`, `cep-beat`) |
| A run's progress | The campaign's Recipients tab; Engine Health |
| Scheduled jobs | Back-office → Jobs (unchanged) |
| Stalls | Back-office → Alerts (C5) |

---

## 10. Order

1. Build C1 to C6 on `workers-resume` with tests. C1 to C5 done; C6 waits for its design.
2. Patch 0095 on .51 and .68 (with the user's OK; .68 by the user), then deploy the branch once merged. It changes nothing while `cep-jobs` still runs: the single-process scheduler does not use the window, and only gains the PREPARING recovery and the stall alerts.
3. Rehearse on .51 (section 7).
4. Switch .68 (section 8).
5. The sending speed changes from the 800K page, then raise `-c` on `cep-worker-out` while watching the database.
6. The iCRM Party ID lookup (its own branch) runs on `cep-worker-in`.

Questions for Digivize before step 5: Citi's sender type (short code, 10DLC or toll-free), its per-second limit, any daily cap, and whether the 60 requests a minute in their documentation applies to Citi's account.
