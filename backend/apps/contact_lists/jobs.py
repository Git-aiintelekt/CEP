"""List uploads as background jobs. contact_list_import is the queue.

Why not inside the web request: reading, checking and importing 250,000 rows takes minutes. In a request that is a server
thread and a database transaction held for minutes, per upload, and a handful of workspaces doing it together would slow
the application down for everyone. So the request stores the file and returns; the work happens here.

How the load stays bounded, whatever is uploaded:
  * at most `lists.import_max_parallel` imports run at the same time in the whole platform (default 2);
  * a workspace never has two running at once, so one busy workspace cannot take every slot: the others' uploads
    are claimed in between, oldest first;
  * a workspace with `lists.import_max_waiting_per_workspace` unfinished uploads has to wait before starting another;
  * every job works in chunks of `lists.import_chunk_rows` rows, each chunk its own short transaction: no long locks,
    no large transactions, constant memory, progress after every chunk.
Chunks of one file are processed in order, not by parallel threads: the database is the bottleneck, and parallel writers
on one file would only add to the load the limits above exist to contain. The parallelism is between uploads, and bounded.

A claim is an UPDATE ... FOR UPDATE SKIP LOCKED under an advisory lock, so any number of workers (Celery processes, the
in-process thread, the management command) can run side by side without taking the same job or exceeding the limits.
A worker that dies stops sending heartbeats; after STALE the job is claimed again, up to MAX_ATTEMPTS. The three steps
are written to be run again safely.

Who runs it (settings.LIST_IMPORT_RUNNER):
  celery   production: the API sends workers.lists.process_imports (queue `imports`); beat repeats it every 30 s as a net
  thread   development without Redis: a daemon thread in the web process, started when something is queued
  none     tests, or when only `manage.py process_list_imports --loop` should do the work
"""
import logging
import os
import socket
import threading

from django.conf import settings
from django.db import connections, transaction
from django.utils import timezone

from apps.delivery.engine import session

from . import imports
from .models import ContactList, ContactListImport

log = logging.getLogger("cep.lists")
P = settings.PLATFORM_ALIAS
STALE = "3 minutes"
MAX_ATTEMPTS = 3
STATUS_WHILE = {"STAGE": "STAGING", "REVIEW": "MATCHING", "APPLY": "APPLYING"}
STATUS_BEFORE = {"STAGE": "UPLOADED", "REVIEW": "STAGED", "APPLY": "REVIEW"}


class TooManyUploads(Exception):
    """The workspace has reached its number of unfinished uploads."""


def _setting(key: str, default: int) -> int:
    from apps.platform_ops import params
    try:
        return max(1, int(params.get(key, default)))
    except Exception:                                     # noqa: BLE001
        return default


def _worker_name() -> str:
    return f"{socket.gethostname()[:60]}:{os.getpid()}:{threading.current_thread().name}"[:120]


# ---------------------------------------------------------------- queueing (in the request)
def assert_room(tenant_id) -> None:
    limit = _setting("lists.import_max_waiting_per_workspace", 5)
    running = ContactListImport.objects.filter(tenant_id=tenant_id).filter(next_action__isnull=False).count() \
        + ContactListImport.objects.filter(tenant_id=tenant_id, status__in=("STAGING", "MATCHING", "APPLYING"), next_action__isnull=True).count()
    if running >= limit:
        raise TooManyUploads(f"This workspace already has {running} uploads being processed. Wait for one to finish, then upload the next file.")


def enqueue(record: ContactListImport, action: str) -> None:
    record.next_action, record.queued_at, record.error = action, timezone.now(), None
    record.attempts = 0
    record.save(update_fields=["next_action", "queued_at", "error", "attempts"])
    transaction.on_commit(kick, using=record._state.db or settings.CONTROL_PLANE_ALIAS)      # a worker must not look before the row is there


def cancel(record: ContactListImport) -> bool:
    """Stops an unfinished upload. A worker that is on it notices at its next chunk. Returns False when it was over already."""
    if record.status in ("APPLIED", "FAILED", "CANCELLED"):
        return False
    if record.status == "APPLYING":
        raise imports.ImportError_("The contacts are being added to the list right now; that step cannot be interrupted half-way.")
    record.status, record.next_action, record.completed_at = "CANCELLED", None, timezone.now()
    record.save(update_fields=["status", "next_action", "completed_at"])
    if record.worker is None:
        _clean_up(record)
    return True


def cancel_all_for(contact_list: ContactList) -> None:
    for record in ContactListImport.objects.filter(contact_list=contact_list, tenant_id=contact_list.tenant_id).exclude(status__in=("APPLIED", "FAILED", "CANCELLED")):
        record.status, record.next_action, record.completed_at = "CANCELLED", None, timezone.now()
        record.save(update_fields=["status", "next_action", "completed_at"])
        imports.discard_file(record)


def _clean_up(record: ContactListImport) -> None:
    imports.discard_file(record)
    with connections[record._state.db or settings.CONTROL_PLANE_ALIAS].cursor() as cursor:
        cursor.execute("DELETE FROM contact_list_import_row WHERE tenant_id = %s AND import_id = %s", [str(record.tenant_id), str(record.pk)])


# ---------------------------------------------------------------- starting a worker
_thread_lock = threading.Lock()
_thread: threading.Thread | None = None
_again = threading.Event()


def kick() -> None:
    runner = getattr(settings, "LIST_IMPORT_RUNNER", "celery")
    if runner == "celery":
        try:
            from workers.lists import process_imports
            process_imports.apply_async(retry=False)       # no broker: fail fast; beat and the management command take over
        except Exception:                                 # noqa: BLE001
            log.warning("list import could not be handed to Celery; it stays queued for the next worker run")
    elif runner == "thread":
        _kick_thread()


def _kick_thread() -> None:
    global _thread
    with _thread_lock:
        _again.set()
        if _thread is not None and _thread.is_alive():
            return
        _thread = threading.Thread(target=_thread_main, name="list-imports", daemon=True)
        _thread.start()


def _thread_main() -> None:
    try:
        while _again.is_set():
            _again.clear()
            run_pending()
    except Exception:                                     # noqa: BLE001
        log.exception("list import thread stopped")
    finally:
        connections.close_all()                           # the thread's connections go back to the pool


# ---------------------------------------------------------------- claiming and running (in a worker)
def claim(alias: str = P, tenant_id=None):
    """One job, or None. Serialised by an advisory lock so the limits hold with any number of workers."""
    fresh = f"o.worker IS NOT NULL AND o.heartbeat_at >= now() - interval '{STALE}'"
    with transaction.atomic(using=alias), connections[alias].cursor() as cursor:
        cursor.execute("SELECT pg_advisory_xact_lock(hashtext('cep.contact_list_import.claim'))")
        cursor.execute(f"""UPDATE contact_list_import i
                              SET worker = %(worker)s, heartbeat_at = now(), started_at = COALESCE(i.started_at, now()), attempts = i.attempts + 1,
                                  status = CASE i.next_action WHEN 'STAGE' THEN 'STAGING' WHEN 'REVIEW' THEN 'MATCHING' ELSE 'APPLYING' END,
                                  progress_done = 0
                            WHERE i.id = (SELECT c.id FROM contact_list_import c JOIN tenant t ON t.id = c.tenant_id
                                           WHERE c.next_action IS NOT NULL AND t.status = 'ACTIVE' AND (%(tenant)s::uuid IS NULL OR c.tenant_id = %(tenant)s::uuid)
                                             AND (c.worker IS NULL OR c.heartbeat_at < now() - interval '{STALE}')
                                             AND NOT EXISTS (SELECT 1 FROM contact_list_import o WHERE o.tenant_id = c.tenant_id AND o.id <> c.id AND {fresh})
                                             AND (SELECT count(*) FROM contact_list_import o WHERE {fresh}) < %(limit)s
                                           ORDER BY c.queued_at LIMIT 1 FOR UPDATE OF c SKIP LOCKED)
                        RETURNING i.id, i.tenant_id, i.next_action, i.attempts""",
                       {"worker": _worker_name(), "tenant": str(tenant_id) if tenant_id else None, "limit": _setting("lists.import_max_parallel", 2)})
        return cursor.fetchone()


def run_pending(max_jobs: int = 50, alias: str = P, tenant_id=None) -> dict:
    """Claims and runs jobs until none is claimable. `alias` / `tenant_id` are for tests that run inside one transaction."""
    done = failed = 0
    for _ in range(max_jobs):
        job = claim(alias, tenant_id)
        if job is None:
            break
        import_id, tenant, action, attempts = job
        ok = _run(str(import_id), str(tenant), action, attempts)
        done, failed = done + int(ok), failed + int(not ok)
    return {"processed": done, "failed": failed}


def _run(import_id: str, tenant_id: str, action: str, attempts: int) -> bool:
    chunk = min(20_000, _setting("lists.import_chunk_rows", 5000))
    with session.tenant_scope(tenant_id):
        with session.tx():
            record = ContactListImport.objects.select_related("contact_list", "tenant").get(pk=import_id, tenant_id=tenant_id)

        def beat(done_, total):
            """After every chunk: progress for the people watching, a heartbeat for the claim, and a look at whether it was cancelled."""
            with session.tx():
                changed = ContactListImport.objects.filter(pk=import_id, tenant_id=tenant_id, status=STATUS_WHILE[action]).update(
                    progress_done=done_, progress_total=total, heartbeat_at=timezone.now())
            if not changed:
                raise imports.Cancelled()

        def finish(**fields):
            with session.tx():
                ContactListImport.objects.filter(pk=import_id, tenant_id=tenant_id).update(worker=None, heartbeat_at=None, **fields)

        try:
            if action == "STAGE":
                imports.stage(record, chunk, beat)
                with session.tx():
                    confirmed = ContactListImport.objects.filter(pk=import_id, tenant_id=tenant_id).values_list("mapping_confirmed", flat=True).first()
                # the operator may have confirmed the mapping while the file was being read: go straight on
                finish(status="STAGED", next_action="REVIEW" if confirmed else None, queued_at=timezone.now(), attempts=0)
            elif action == "REVIEW":
                # read again for the confirmed mapping, with its list and workspace: refresh_from_db() would drop them, and
                # review() would then fetch them outside any transaction, where row-level security hides them
                with session.tx():
                    record = ContactListImport.objects.select_related("contact_list", "tenant").get(pk=import_id, tenant_id=tenant_id)
                imports.review(record, chunk, beat)
                finish(status="REVIEW", next_action=None)
            else:
                imports.apply(record, chunk, beat, user_id=record.created_by_id)
                # the staged rows stay: they are the row-by-row report of this upload (the partition retention policy ages them out)
                finish(status="APPLIED", next_action=None)
            return True
        except imports.Cancelled:
            with session.tx():
                _clean_up(record)
            finish()
            return True
        except imports.ImportError_ as exc:                # the operator has to fix the file: no retry
            with session.tx():
                imports.discard_file(record)
            finish(status="FAILED", next_action=None, error=str(exc)[:500], completed_at=timezone.now())
            return False
        except Exception as exc:                          # noqa: BLE001
            log.exception("list import %s failed at %s (attempt %s)", import_id, action, attempts)
            if attempts >= MAX_ATTEMPTS:
                finish(status="FAILED", next_action=None, completed_at=timezone.now(),
                       error=f"CEP could not finish this upload after {MAX_ATTEMPTS} attempts. Nothing was half-imported; upload the file again, or contact support."[:500])
            else:
                finish(status=STATUS_BEFORE[action])      # still queued: claimed again by the next worker run
            return False


def recent(tenant_id, active_only: bool = False, limit: int = 50):
    rows = ContactListImport.objects.filter(tenant_id=tenant_id).select_related("contact_list", "created_by").order_by("-created_at")
    if active_only:
        rows = rows.filter(status__in=imports.ACTIVE)
    return rows[:limit]
