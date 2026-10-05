# Backend tests

pytest with pytest-django. Each file checks one feature end to end: the API, the jobs, the back-office pages and the database
rules behind them.

## Running them

From `backend/`, with the development tools installed once (`.venv/Scripts/python -m pip install -r requirements-dev.txt`):

```
.venv/Scripts/python -m pytest                       # everything
.venv/Scripts/python -m pytest tests/test_attribution.py
.venv/Scripts/python -m pytest -k "pos or receipt"   # by name
```

## How they use the database

- **No database is created.** The tests use the one `.env` points at, and refuse to start unless it is on this machine
  (`localhost`, `127.0.0.1`), so the dev server's data cannot be touched by mistake.
- **Nothing is kept.** Every test runs inside a transaction on both connections, `default` (the app's, under row-level
  security) and `platform` (the back-office's), rolled back at the end.
- **The sample workspace is assumed.** Scenarios work on NWA from `database/CEP_Seed_Data.sql` and the local copy's data.
- **Nothing leaves the machine.** A network connection to any other host fails with "blocked in tests"; mock outside services
  (`requests.Session.post`, a provider adapter) where a test needs their answer.
- **The partition test needs the owner login.** `test_partition_bounds.py` drops and makes partitions, which only the
  database owner may do; it runs when `OWNER_DATABASE_URL` is set and is skipped otherwise.

## Writing a test

```python
import pytest

pytestmark = pytest.mark.django_db(databases=["default", "platform"])


def test_a_refund_follows_its_order(check):
    ...
    check("the refund is credited to the original's campaign", verdict == expected, verdict)
    check.done()
```

`check(label, ok, extra)` records one expectation and the test carries on; `check.done()` fails it with every expectation that
did not hold. Plain `assert` works too.

Code that writes on a connection of its own is handled in `conftest.py`: the error recorder writes through the test's
connection, the request-figures thread does not start, and the cache and the workspace context are fresh for every test.

## Where they came from

Most files were the verification scripts written while each feature was built, converted as they were: one long scenario per
feature, the checks named in plain words. New features add their own file; the journey engine should start with one.
