"""iCRM's Multipass tokens: the fixtures were made by iCRM's own token-app.jar (UtilEncoder.encodedString) with SITE_KEY and
API_KEY, so these tests prove CEP reads exactly what iCRM sends. No database."""
from unittest import mock

import pytest

from apps.platform_ops.multipass import (MultipassTokenDecode, MultipassTokenEncode, MultipassTokenInvalidException, TokenEncoder,
                                         decoded_json, encoded_string, is_valid_token)

SITE_KEY = "SITE-KEY-123"
API_KEY = "API-KEY-456"

CEP_TOKEN = (
    "Y8OqSx1REY8j7xRnJF5MFjKbTXmGnhfzTEvoL7qko6m_xQ5pWiX-G8AuCsCPxwdwRjCnZPj06ilJkt2LG6tvnFbVSthDgACkM2bx38VLRUIBGohLwK-T0WWRS3NL"
    "7EqB4QLF2hshN0kTHYHRxnOJ24XXWABdG9Q8tWP4NHR40szvi3nTDxHb9nDJJKmhBeAjLjFkPpnsB1H72rLG6HL11unvWKe3agAUqTnX8a0r3OD0_uPn5ldXIY1c"
    "ClCvav4h4bJGeviTpibGVmA0xC9DE1zkADOZGfTEkTMSwYMJWMmHc4R3ox3a-NjtRIV6R8F20B1Ki8TY4S_rzrYD35CvmEZIxf4lCaXq-nYjgQBNQsY"
)
CEP_DATA = {
    "version": "1.0", "aud": "cep", "user_login_id": "admin", "party_id": "10001", "email": "someone@example.com",
    "tenant_id": "NWA", "jti": "3f1c2a9e-0000-4000-8000-000000000001", "iat": 1700000000, "exp": 4102444800,
    "expires": "2100-01-01 00:00", "next": "/campaigns",
}
EXPIRED_LEGACY_TOKEN = (
    "Y8OqSx1REY8j7xRnJF5MFqCdeXLoi25fGGjql1y1Q5xAcW7hN78fYYR93yeQdbZsYuG8UDbwNAeIw6LhA0jLL7ywB0c4qczsTkg1g1gM92w9Pj4QQ-B1Dn0F-XNV"
    "RaNc8zDWB0F6NCzMLsCu9RT0IA"
)


def test_decodes_a_token_from_icrm():
    assert MultipassTokenDecode(SITE_KEY, API_KEY).decode(CEP_TOKEN) == CEP_DATA


def test_encodes_exactly_as_icrm():
    assert MultipassTokenEncode(SITE_KEY, API_KEY).encode(CEP_DATA) == CEP_TOKEN


def test_encoded_string_matches_icrm_util_encoder():
    assert encoded_string(SITE_KEY, API_KEY, CEP_DATA) == CEP_TOKEN
    assert isinstance(MultipassTokenEncode(SITE_KEY, API_KEY), TokenEncoder)


@pytest.mark.parametrize("site_key, api_key, data", [("", API_KEY, CEP_DATA), (SITE_KEY, None, CEP_DATA), (SITE_KEY, API_KEY, None)])
def test_encoded_string_is_none_without_keys_or_data(site_key, api_key, data):
    assert encoded_string(site_key, api_key, data) is None


def test_encoded_string_is_none_when_encoding_fails():
    assert encoded_string(SITE_KEY, API_KEY, {"not json": object()}) is None


def test_wrong_keys_are_refused():
    with pytest.raises(MultipassTokenInvalidException):
        MultipassTokenDecode(SITE_KEY, "another-api-key").decode(CEP_TOKEN)
    assert decoded_json("another-site-key", API_KEY, CEP_TOKEN) is None


@pytest.mark.parametrize("token", ["", "not a token", CEP_TOKEN[:-4], CEP_TOKEN + "AAAA"])
def test_damaged_tokens_are_refused(token):
    assert decoded_json(SITE_KEY, API_KEY, token) is None


def test_padding_is_accepted_as_java_does():
    assert decoded_json(SITE_KEY, API_KEY, EXPIRED_LEGACY_TOKEN + "=")["user_login_id"] == "admin"


def test_exp_decides_validity():
    data = decoded_json(SITE_KEY, API_KEY, CEP_TOKEN)
    assert is_valid_token(data)
    with mock.patch("apps.platform_ops.multipass.util_decoder.time.time", return_value=4102444800 + 1):
        assert not is_valid_token(data)
        assert is_valid_token(data, leeway=30)


def test_legacy_expires_is_read_in_icrm_time_zone(settings):
    data = decoded_json(SITE_KEY, API_KEY, EXPIRED_LEGACY_TOKEN)
    assert data["expires"] == "2020-01-01 10:00" and not is_valid_token(data)

    settings.ICRM_SSO_TIME_ZONE = "Asia/Kolkata"                                       # 2020-01-01 10:00 IST = 04:30 UTC
    with mock.patch("apps.platform_ops.multipass.util_decoder.time.time", return_value=1577852940):    # 04:29 UTC
        assert is_valid_token(data)
    with mock.patch("apps.platform_ops.multipass.util_decoder.time.time", return_value=1577853060):    # 04:31 UTC
        assert not is_valid_token(data)


@pytest.mark.parametrize("data", [None, {}, {"version": "1.0"}, {"expires": "soon"}, {"exp": "never"}])
def test_missing_or_unreadable_expiry_is_invalid(data):
    assert not is_valid_token(data)
