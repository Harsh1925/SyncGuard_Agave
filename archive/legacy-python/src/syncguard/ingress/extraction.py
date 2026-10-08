from typing import Protocol


class InvoiceExtractor(Protocol):
    def extract(self, synthetic_document: str) -> dict:
        """Return untrusted fields; caller MUST normalize and deterministically validate."""
        ...


class DisabledExtractor:
    def extract(self, synthetic_document: str) -> dict:
        raise NotImplementedError(
            "AI provider integration is deferred until core reliability proof"
        )
