"""Settings for `pytest` (backend/pytest.ini): development's, without the connection pool, so each test's transactions are
plain connections pytest-django can wrap and roll back. No database is created: tests run against the configured one, every
change rolled back (see tests/conftest.py)."""
from .development import *  # noqa: F401,F403

for _alias in DATABASES:  # noqa: F405
    DATABASES[_alias].get("OPTIONS", {}).pop("pool", None)  # noqa: F405

CEP_TESTING = True
