"""Port of org.groupfio.token.app.util.UtilDecoder, with UtilCommon.isValidToken from the same jar.

Settings (optional):
  ICRM_SSO_TIME_ZONE  the iCRM server's time zone, for tokens that carry only "expires"
                      ("yyyy-MM-dd HH:mm" in iCRM's local time); defaults to TIME_ZONE.
"""
import logging
import time
from datetime import datetime
from zoneinfo import ZoneInfo

from django.conf import settings

from .multipass_token_decode import MultipassTokenDecode

log = logging.getLogger(__name__)

EXPIRES_FORMAT = "%Y-%m-%d %H:%M"


def decoded_json(site_key: str, api_key: str, token: str) -> dict | None:
    """The token's payload, or None when it cannot be decoded (as UtilDecoder.decodedJson)."""
    try:
        return MultipassTokenDecode(site_key, api_key).decode(token)
    except Exception as exc:
        log.info("Multipass token could not be decoded: %s", exc)
        return None


def is_valid_token(data: dict | None, leeway: float = 0, time_zone: str | None = None) -> bool:
    """True while the token has not expired (as UtilCommon.isValidToken), allowing `leeway` seconds of clock difference.

    "exp" (epoch seconds) is used when present: it has no time zone doubt between servers.
    Otherwise "expires" is read in the iCRM server's time zone (`time_zone`, else the settings above), as iCRM does.
    """
    if not data:
        return False
    try:
        if "exp" in data:
            return float(data["exp"]) + leeway > time.time()
        if "expires" in data:
            zone = ZoneInfo(time_zone or getattr(settings, "ICRM_SSO_TIME_ZONE", None) or settings.TIME_ZONE)
            expires = datetime.strptime(str(data["expires"]).strip(), EXPIRES_FORMAT).replace(tzinfo=zone)
            return expires.timestamp() + leeway > time.time()
    except (TypeError, ValueError, KeyError):                 # KeyError: ZoneInfoNotFoundError, a misspelled zone
        log.warning("Multipass token has an unreadable expiry or time zone", exc_info=True)
    return False
