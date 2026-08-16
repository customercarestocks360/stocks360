from datetime import datetime

from pydantic import BaseModel

from app.schemas.onboarding import KycTier, OnboardingStatus, Product


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


class LoginLogEntry(BaseModel):
    at: datetime
    provider: str | None = None
    ip: str | None = None
    user_agent: str | None = None
