import hashlib
import json
from datetime import date
from decimal import Decimal
from enum import StrEnum
from uuid import NAMESPACE_URL, uuid5

from pydantic import BaseModel, ConfigDict, Field, field_validator


class InvoiceStatus(StrEnum):
    OPEN = "open"
    PAID = "paid"
    VOID = "void"


class Vendor(BaseModel):
    id: str
    company_id: str
    name: str


class Job(BaseModel):
    id: str
    name: str
    active: bool = True


class Invoice(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    company_id: str = Field(min_length=1)
    vendor_id: str = Field(min_length=1)
    invoice_number: str = Field(min_length=1)
    job_id: str = Field(min_length=1)
    amount: Decimal = Field(ge=0, max_digits=18, decimal_places=2)
    currency: str = Field(pattern=r"^[A-Z]{3}$")
    issued_on: date
    status: InvoiceStatus = InvoiceStatus.OPEN

    @field_validator("company_id", "vendor_id", "invoice_number", "job_id")
    @classmethod
    def trim_identifier(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("identifier cannot be blank")
        return value

    @property
    def logical_id(self) -> str:
        # Structured encoding avoids delimiter collisions in composite identities.
        return str(
            uuid5(NAMESPACE_URL, json.dumps([self.company_id, self.vendor_id, self.invoice_number]))
        )

    def canonical(self) -> dict:
        data = self.model_dump(mode="json")
        data["amount"] = format(self.amount.quantize(Decimal("0.01")), ".2f")
        return data

    @property
    def fingerprint(self) -> str:
        return hashlib.sha256(
            json.dumps(self.canonical(), sort_keys=True, separators=(",", ":")).encode()
        ).hexdigest()


class Action(StrEnum):
    UPSERT = "upsert"
    DELETE = "delete"


def operation_id(logical_id: str, version: int, action: Action, destination: str = "pm") -> str:
    return str(uuid5(NAMESPACE_URL, f"syncguard:{destination}:{logical_id}:{version}:{action}"))


def is_stale(version: int, applied_version: int, tombstone_version: int | None) -> bool:
    return version <= max(applied_version, tombstone_version or 0)
