"""Port of org.groupfio.token.app.encode.MultipassTokenEncode: the tokens iCRM makes, byte for byte. CEP only decodes;
the tests use this to make iCRM's tokens."""
import base64
import json

from cryptography.hazmat.primitives import padding
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

from .multipass_token_decode import IV, MultipassTokenDecode

TRAILING_ZEROS = bytes(10)                      # iCRM writes 10 bytes past the JSON, see multipass_token_decode


class MultipassTokenEncode:

    def __init__(self, site_key: str, api_key: str):
        self._key = MultipassTokenDecode(site_key, api_key)._key

    def encode(self, data: dict) -> str:
        plain = json.dumps(data, separators=(",", ":"), ensure_ascii=False).encode("utf-8") + TRAILING_ZEROS
        padder = padding.PKCS7(algorithms.AES.block_size).padder()
        encryptor = Cipher(algorithms.AES(self._key), modes.CBC(IV)).encryptor()
        encrypted = encryptor.update(padder.update(plain) + padder.finalize()) + encryptor.finalize()
        return base64.b64encode(encrypted).decode("ascii").rstrip("=").replace("+", "-").replace("/", "_")
