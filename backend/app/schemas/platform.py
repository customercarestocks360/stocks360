from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator

from app.schemas.funding import FundingNetwork

BoundedText = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=256)
]
SupportEmail = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True,
        min_length=3,
        max_length=254,
        pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$",
    ),
]


def _unique_deposit_rails(value):
    if value is None:
        return value
    keys = [(rail.currency, rail.network) for rail in value]
    if len(keys) != len(set(keys)):
        raise ValueError("deposit rails must have unique currency/network pairs")
    return value


class DepositRail(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")

    currency: str = Field(pattern="^[A-Z0-9]{2,10}$")
    network: FundingNetwork
    name: BoundedText
    address: str = Field(min_length=4, max_length=256)
    address_label: BoundedText
    minimum: BoundedText
    arrival: BoundedText
    fee: BoundedText
    confirmations: BoundedText
    enabled: bool = True


class PlatformSettings(BaseModel):
    announcement: str | None = Field(default=None, max_length=280)
    support_email: SupportEmail | None = None
    deposit_rails: list[DepositRail] = Field(default_factory=list, max_length=20)
    updated_at: datetime | None = None
    updated_by: str | None = None

    _validate_unique_rails = field_validator("deposit_rails")(_unique_deposit_rails)


class PlatformSettingsUpdate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")

    announcement: str | None = Field(default=None, max_length=280)
    support_email: SupportEmail | None = None
    deposit_rails: list[DepositRail] | None = Field(default=None, max_length=20)

    _validate_unique_rails = field_validator("deposit_rails")(_unique_deposit_rails)
