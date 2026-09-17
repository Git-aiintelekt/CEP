"""Outbox relay: domain_event PENDING → Redis Streams (cep:events:<tenant>) → PUBLISHED. Runs every second from beat."""
import json

import redis
from apps.platform_ops.jobs import monitored
from celery import shared_task
from django.conf import settings
from django.db import connections, transaction

BATCH = 500


@shared_task(name="workers.outbox.relay_pending_events")
@monitored("outbox-relay")
def relay_pending_events() -> int:
    r = redis.Redis.from_url(settings.REDIS_URL)
    published = 0
    for alias in settings.DATABASES:
        with transaction.atomic(using=alias), connections[alias].cursor() as cur:
            cur.execute("""
                SELECT id, tenant_id, aggregate_type, aggregate_id, event_type, payload, producer, occurred_at
                FROM domain_event WHERE status = 'PENDING'
                ORDER BY occurred_at LIMIT %s FOR UPDATE SKIP LOCKED""", [BATCH])
            rows = cur.fetchall()
            for (eid, tenant_id, agg_type, agg_id, event_type, payload, producer, occurred_at) in rows:
                r.xadd(f"cep:events:{tenant_id}", {
                    "id": str(eid), "tenant_id": str(tenant_id), "aggregate_type": agg_type, "aggregate_id": agg_id,
                    "event_type": event_type, "producer": producer, "occurred_at": occurred_at.isoformat(),
                    "payload": json.dumps(payload),
                }, maxlen=1_000_000, approximate=True)
                cur.execute("UPDATE domain_event SET status = 'PUBLISHED', published_at = now(), publish_attempts = publish_attempts + 1 "
                            "WHERE id = %s AND tenant_id = %s AND occurred_at = %s", [eid, tenant_id, occurred_at])
                published += 1
    return published
