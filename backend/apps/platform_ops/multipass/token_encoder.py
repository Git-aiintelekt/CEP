"""Port of org.groupfio.token.app.encode.TokenEncoder."""
from abc import ABC, abstractmethod


class TokenEncoder(ABC):

    @abstractmethod
    def encode(self, data: dict) -> str:
        ...
