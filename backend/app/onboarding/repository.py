"""Mongo access for onboarding.

Two collections, deliberately separate:

* `onboarding_sessions` — the live, editable session. One document per uid, holding
  each captured step. Expires by TTL while still in progress so abandoned
  half-finished KYC data does not linger.
* `kyc_profiles` — the frozen application, written once at submit. This is the
  record of what the user actually attested to, and it is never edited in place
  by the signup flow.
"""

from datetime import datetime, timedelta, timezone
from typing import Any

from app.core.database import get_db
from app.schemas.onboarding import KycTier, OnboardingStatus
from app.users.repository import USERS

ONBOARDING_SESSIONS = "onboarding_sessions"
KYC_PROFILES = "kyc_profiles"

# An abandoned session is dropped after this long without a step being submitted.
SESSION_TTL_DAYS = 30


def _now() -> datetime:
    return datetime.now(timezone.utc)


def get_session(uid: str) -> dict | None:
    return get_db()[ONBOARDING_SESSIONS].find_one({"_id": uid})


def save_step(uid: str, step: str, data: dict[str, Any]) -> dict:
    """Write one step into the session, creating the session on the first step.

    Re-submitting a step overwrites it, so a user can correct a screen they
    already filled in as long as the application has not been submitted.
    """
    now = _now()
    get_db()[ONBOARDING_SESSIONS].update_one(
        {"_id": uid},
        {
            "$set": {
                f"steps.{step}": {"data": data, "at": now},
                "status": OnboardingStatus.in_progress.value,
                "updated_at": now,
                "expires_at": now + timedelta(days=SESSION_TTL_DAYS),
            },
            "$setOnInsert": {"created_at": now},
        },
        upsert=True,
    )
    session = get_session(uid)
    assert session is not None  # just upserted
    return session


def freeze_session(
    uid: str,
    tier: KycTier,
    enabled_products: list[str],
    pending_products: list[str],
    submitted_at: datetime,
) -> dict:
    """Close the session for editing. Dropping `expires_at` takes it out of the TTL
    index, so a submitted application is retained rather than swept."""
    get_db()[ONBOARDING_SESSIONS].update_one(
        {"_id": uid},
        {
            "$set": {
                "status": OnboardingStatus.under_review.value,
                "kyc_tier": tier.value,
                "enabled_products": enabled_products,
                "pending_products": pending_products,
                "submitted_at": submitted_at,
                "updated_at": submitted_at,
            },
            "$unset": {"expires_at": ""},
        },
    )
    session = get_session(uid)
    assert session is not None  # freeze only runs on an existing session
    return session


def write_kyc_profile(profile: dict[str, Any]) -> None:
    """Persist the frozen application. Raises DuplicateKeyError when the identity
    document already belongs to a different account."""
    get_db()[KYC_PROFILES].replace_one({"_id": profile["_id"]}, profile, upsert=True)


def set_user_onboarding(
    uid: str,
    status: OnboardingStatus,
    tier: KycTier,
    enabled_products: list[str],
    pending_products: list[str],
) -> None:
    """Denormalise the outcome onto the user record so trading paths can authorise
    without reading the whole KYC application.

    Upserts because the caller is authenticated by Firebase, not by the Mongo mirror —
    a client that went straight from sign-in to onboarding without calling
    `POST /auth/login` has no user document yet, and the outcome must not be lost.
    """
    now = _now()
    get_db()[USERS].update_one(
        {"_id": uid},
        {
            "$set": {
                "onboarding_status": status.value,
                "kyc_tier": tier.value,
                "enabled_products": enabled_products,
                "pending_products": pending_products,
                "updated_at": now,
            },
            "$setOnInsert": {"created_at": now, "login_count": 0},
        },
        upsert=True,
    )
