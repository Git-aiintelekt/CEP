"""Journey runtime: no worker waits, everything is a due row picked up by a scheduled pass.

    enroll.run()     entry rules of every live journey  ->  journey_enrollment + journey_customer_state at the Start step
    advance.run()    journey_customer_state rows whose next_scheduled_at has come  ->  steps.py per node  ->  the next node
    rollup.run()     journey_enrollment / journey_node_execution  ->  journey_master_analytical / journey_execution_master_analytical

A journey is live when journey.status is ACTIVE and it has an ACTIVE version: new entrants join that version, customers
already inside finish on theirs. Pausing the journey holds everyone where they are. Message steps hand their customers to
the campaign send engine (messages.py) and move on once it has decided, person by person, to send or to hold back.

Each job finds its tenants on the platform connection (as delivery.engine.runs.due does), then works inside
delivery.engine.session.tenant_scope with short transactions under the tenant's row-level security.
"""
from django.conf import settings
from django.db import connections


def tenants(sql: str) -> list[str]:
    with connections[settings.PLATFORM_ALIAS].cursor() as cursor:
        cursor.execute(sql)
        return [str(row[0]) for row in cursor.fetchall()]
