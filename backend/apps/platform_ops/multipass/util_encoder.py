"""Port of org.groupfio.token.app.util.UtilEncoder."""
import logging

from .multipass_token_encode import MultipassTokenEncode

log = logging.getLogger(__name__)


def encoded_string(site_key: str | None, api_key: str | None, data: dict | None) -> str | None:
    """The Multipass token for `data`, or None when a key or the data is missing or encoding fails (as encodedString)."""
    if not site_key or not api_key or data is None:
        return None
    try:
        return MultipassTokenEncode(site_key, api_key).encode(data)
    except Exception:
        log.exception("Multipass token could not be encoded")
        return None
