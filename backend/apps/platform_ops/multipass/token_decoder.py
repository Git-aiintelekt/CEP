"""Port of org.groupfio.token.app.decode.TokenDecoder."""
from abc import ABC, abstractmethod


class TokenDecoder(ABC):

    @abstractmethod
    def decode(self, token: str) -> dict:
        ...
