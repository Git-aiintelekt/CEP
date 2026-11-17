"""Port of org.groupfio.token.app.decode.MultipassTokenDecode.

Reads tokens made by iCRM's token-app.jar (UtilEncoder / MultipassTokenEncode):

  key   = first 16 bytes of SHA-1(api_key + site_key + SALT)
  token = AES-128-CBC, zero IV, PKCS#5 padding, over the payload JSON,
          then Base64 with "=" removed, "+" -> "-" and "/" -> "_"

The encoder writes 10 bytes past the JSON (cipherOutput.write(buffer, 0, read + 10)), zeros for any token under 2 KB.
Java's JSON parser ignores them; json.loads does not, so they are stripped here.
"""
import base64
import hashlib
import json

from cryptography.hazmat.primitives import padding
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

from .token_decoder import TokenDecoder

SALT = "9F8QQkSi-iem&-wbz0-O$0k-1@WQjwo@"
IV = bytes(16)


class MultipassTokenInvalidException(Exception):
    """Port of org.groupfio.token.app.exception.MultipassTokenInvalidException."""


class MultipassTokenDecode(TokenDecoder):

    def __init__(self, site_key: str, api_key: str):
        self.site_key = site_key
        self.api_key = api_key
        self._key = hashlib.sha1((api_key + site_key + SALT).encode("utf-8")).digest()[:16]

    def decode(self, token: str) -> dict:
        try:
            data = json.loads(self.decode_to_json_string(token))
        except MultipassTokenInvalidException:
            raise
        except Exception as exc:
            raise MultipassTokenInvalidException(exc) from exc
        if not isinstance(data, dict):
            raise MultipassTokenInvalidException("The token does not hold a JSON object")
        return data

    def decode_to_json_string(self, token: str) -> str:
        try:
            encoded = token.strip().replace("_", "/").replace("-", "+").rstrip("=")
            encrypted = base64.b64decode(encoded + "=" * (-len(encoded) % 4), validate=True)
            return self._process(encrypted).rstrip(b"\x00").decode("utf-8")
        except Exception as exc:
            raise MultipassTokenInvalidException(exc) from exc

    def _process(self, encrypted: bytes) -> bytes:
        decryptor = Cipher(algorithms.AES(self._key), modes.CBC(IV)).decryptor()
        padded = decryptor.update(encrypted) + decryptor.finalize()
        unpadder = padding.PKCS7(algorithms.AES.block_size).unpadder()
        return unpadder.update(padded) + unpadder.finalize()
