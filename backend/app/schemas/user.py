from datetime import datetime
from enum import Enum

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.schemas.onboarding import (
    KycTier,
    OnboardingSessionResponse,
    OnboardingStatus,
    Product,
)


class AccountStatus(str, Enum):
    active = "active"
    suspended = "suspended"


class UserProfile(BaseModel):
    """App-side user record stored in MongoDB, mirrored from the Firebase identity."""

    uid: str
    email: str | None = None
    name: str | None = None
    picture: str | None = None
    provider: str | None = None
    email_verified: bool = False
    created_at: datetime
    updated_at: datetime
    last_login_at: datetime | None = None
    login_count: int = 0
    # Set by the onboarding flow; absent until the user starts signup.
    onboarding_status: OnboardingStatus = OnboardingStatus.not_started
    kyc_tier: KycTier = KycTier.unverified
    enabled_products: list[Product] = []
    pending_products: list[Product] = []
    account_status: AccountStatus = AccountStatus.active
    account_status_reason: str | None = None
    account_status_updated_at: datetime | None = None
    account_status_updated_by: str | None = None


class LoginLogEntry(BaseModel):
    at: datetime
    provider: str | None = None
    ip: str | None = None
    user_agent: str | None = None


class UserProfileUpdate(BaseModel):
    """Editable profile fields — everything else on `UserProfile` is derived (KYC/products)
    or mirrored from Firebase, not something a client can set directly."""

    name: str | None = Field(default=None, min_length=1, max_length=128)


class UserProductAccessRequest(BaseModel):
    """Desired markets. Existing access may be removed immediately; additions wait for staff."""

    model_config = ConfigDict(extra="forbid")
    # An empty list is intentional: it means the account holder is revoking every
    # currently enabled/pending market product.
    products: list[Product] = Field(max_length=len(Product))

    @field_validator("products")
    @classmethod
    def products_must_be_unique(cls, value: list[Product]) -> list[Product]:
        if len(value) != len(set(value)):
            raise ValueError("products must not repeat")
        return value


class AdminUserDetail(BaseModel):
    """What an admin needs to review or correct one user's account: the stored profile plus
    the same masked KYC recap the user sees on their own account page."""

    profile: UserProfile
    kyc: OnboardingSessionResponse
