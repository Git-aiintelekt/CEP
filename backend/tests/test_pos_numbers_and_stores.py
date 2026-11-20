"""A register's phone number becomes an international (E.164) number by the workspace's "Phone Numbers Are From" country: a
national number gets the country's calling code (its leading 0 dropped), a number sent with + or 00 is used as sent. And the
store import template names exactly the columns Import CSV reads."""
import pytest

from apps.pos.mapping import e164


@pytest.mark.parametrize(("phone", "country", "expected"), [
    ("4249440599", "US", "+14249440599"),
    ("1 424 944 0599", "US", "+14249440599"),
    ("(416) 555-0123", "CA", "+14165550123"),
    ("07911 123456", "GB", "+447911123456"),
    ("7911123456", "GB", "+447911123456"),
    ("447911123456", "GB", "+447911123456"),
    ("0044 7911 123456", "GB", "+447911123456"),
    ("98765 43210", "IN", "+919876543210"),
    ("09876543210", "IN", "+919876543210"),
    ("919876543210", "IN", "+919876543210"),
    ("0412 345 678", "AU", "+61412345678"),
    ("412345678", "AU", "+61412345678"),
    ("61412345678", "AU", "+61412345678"),
    ("+14249440599", "GB", "+14249440599"),
    ("", "US", None),
    ("12345", "US", None),
])
def test_a_register_number_becomes_international_by_the_workspace_country(phone, country, expected):
    assert e164(phone, country) == expected


def test_the_store_template_names_exactly_the_columns_import_reads():
    """frontend/src/apps/cep/features/pos/storeTemplate.ts STORE_COLUMNS = STORE_FIELDS: the template never offers a column the
    import ignores, nor leaves one out"""
    import re
    from pathlib import Path

    from api.v1.pos_api import STORE_FIELDS
    source = (Path(__file__).resolve().parents[2] / "frontend/src/apps/cep/features/pos/storeTemplate.ts").read_text(encoding="utf-8")
    listed = re.search(r"STORE_COLUMNS = \[(.*?)\] as const", source, re.S).group(1)
    assert re.findall(r"'([a-z0-9_]+)'", listed) == list(STORE_FIELDS)
