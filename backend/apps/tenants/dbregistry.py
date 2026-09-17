"""Register dedicated tenant databases at startup from tenant_database (credentials from the secret store, never the table)."""
import os

from django.conf import settings
from django.db import connections


def secret_get(ref: str) -> dict:
    """Minimal secret resolver: 'env:NAME' reads NAME_USER / NAME_PASSWORD from the environment. Replace with your vault client."""
    if ref.startswith("env:"):
        name = ref[4:]
        return {"user": os.environ[f"{name}_USER"], "password": os.environ[f"{name}_PASSWORD"]}
    raise ValueError(f"unsupported secret reference: {ref}")


def register_dedicated_databases() -> int:
    from apps.tenants.models import TenantDatabase
    added = 0
    for td in TenantDatabase.objects.using(settings.CONTROL_PLANE_ALIAS).filter(isolation_mode="DEDICATED").exclude(status="DECOMMISSIONED"):
        if td.db_alias in settings.DATABASES:
            continue
        creds = secret_get(td.db_secret_ref)
        cfg = {**settings.DATABASES["default"], "HOST": td.db_host, "PORT": td.db_port, "NAME": td.db_name,
               "USER": creds["user"], "PASSWORD": creds["password"]}
        settings.DATABASES[td.db_alias] = cfg
        connections.databases[td.db_alias] = cfg
        added += 1
    return added
