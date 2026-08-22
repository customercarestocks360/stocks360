"""Staff control-plane request and response models.

Admin mutations are intentionally explicit and reasoned.  The UI may offer broad control,
but every action still passes through a typed endpoint and leaves an audit record.
"""

from datetime import datetime
from decimal import Decimal
from enum import Enum
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator

from app.schemas.onboarding import KycTier, OnboardingStatus, Product
from app.schemas.trading import (
    Account,
    AccountCurrencyField,
    IdempotencyKey,
    LedgerEntry,
    Order,
    Position,
    Trade,
)
from app.schemas.user import AccountStatus, LoginLogEntry, UserProfile

Reason = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=3, max_length=256)
]


class AdminOverview(BaseModel):
    users: int
    active_users: int
    suspended_users: int
    kyc_under_review: int
    open_orders: int
    open_positions: int
    pending_deposits: int
    pending_withdrawals: int
    at: datetime


class AdminUserList(BaseModel):
    items: list[UserProfile]
    total: int
    limit: int
    offset: int


class AccountControlRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")

    status: AccountStatus
    reason: Reason


class AdminReasonRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")

    reason: Reason


class ProductAccessRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")

    enabled_products: list[Product] = Field(max_length=len(Product))
    reason: Reason


class KycDecision(str, Enum):
    approve = "approve"
    reject = "reject"


class KycReviewRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")

    decision: KycDecision
    reason: Reason
    enabled_products: list[Product] | None = Field(
        default=None,
        description="Approval only. Defaults to every requested product.",
    )


class KycReviewResult(BaseModel):
    uid: str
    status: OnboardingStatus
    kyc_tier: KycTier
    enabled_products: list[Product]
    pending_products: list[Product]
    review_note: str
    reviewed_by: str
    reviewed_at: datetime


class BalanceAdjustmentRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")

    currency: AccountCurrencyField | None = None
    amount: Decimal = Field(
        ge=Decimal(-1000000000),
        le=Decimal(1000000000),
        max_digits=18,
        decimal_places=2,
        description="Signed amount: positive credits, negative debits.",
    )
    reason: Reason
    idempotency_key: IdempotencyKey

    @field_validator("amount")
    @classmethod
    def amount_must_not_be_zero(cls, value: Decimal) -> Decimal:
        if value == 0:
            raise ValueError("amount must not be zero")
        return value


class AdminUserOperations(BaseModel):
    profile: UserProfile
    account: Account
    orders: list[Order]
    trades: list[Trade]
    positions: list[Position]
    ledger: list[LedgerEntry]
    logins: list[LoginLogEntry]


class SessionRevocationResult(BaseModel):
    uid: str
    revoked: bool
    revoked_at: datetime


class AdminAuditEntry(BaseModel):
    id: str
    actor_uid: str
    actor_email: str | None = None
    action: str
    target_uid: str | None = None
    reason: str | None = None
    metadata: dict = Field(default_factory=dict)
    at: datetime
