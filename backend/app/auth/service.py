import logging
import time

from fastapi import HTTPException, status
from firebase_admin import auth as fb_auth

from app.core.config import CLOCK_SKEW_SECONDS
from app.core.firebase import init_firebase

init_firebase()

logger = logging.getLogger(__name__)

_UNAUTHORIZED = status.HTTP_401_UNAUTHORIZED


def verify_token(token: str, check_revoked: bool = True) -> dict:
    """Verify a Firebase ID token (email/password or Google) and return its claims.

    The Admin SDK validates signature, expiry, audience and issuer against the
    project tied to the service account, so tokens from other Firebase projects
    are rejected.

    Clients get a deliberately generic message; the real reason is logged so
    misconfiguration (clock drift, wrong project) stays diagnosable.
    """
    try:
        return fb_auth.verify_id_token(
            token, check_revoked=check_revoked, clock_skew_seconds=CLOCK_SKEW_SECONDS
        )
    # Revoked/Expired both subclass InvalidIdTokenError, so they must come first.
    except fb_auth.RevokedIdTokenError:
        raise HTTPException(status_code=_UNAUTHORIZED, detail="Token has been revoked, sign in again")
    except fb_auth.ExpiredIdTokenError:
        raise HTTPException(status_code=_UNAUTHORIZED, detail="Token has expired")
    except fb_auth.UserDisabledError:
        raise HTTPException(status_code=_UNAUTHORIZED, detail="User account is disabled")
    except fb_auth.CertificateFetchError as exc:
        logger.error("Could not fetch Firebase signing certificates: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Could not fetch Firebase signing certificates",
        )
    except (fb_auth.InvalidIdTokenError, ValueError) as exc:
        logger.warning("Rejected ID token: %s", exc)
        raise HTTPException(status_code=_UNAUTHORIZED, detail="Invalid token")


def create_user(email: str, password: str, display_name: str | None = None):
    """Create an email/password user via the Admin SDK."""
    try:
        return fb_auth.create_user(email=email, password=password, display_name=display_name)
    except fb_auth.EmailAlreadyExistsError:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email is already registered")
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))


def get_user(uid: str):
    try:
        return fb_auth.get_user(uid)
    except fb_auth.UserNotFoundError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")


def revoke_tokens(uid: str, not_before: int | None = None) -> None:
    """Revoke the user's refresh tokens, invalidating existing sessions.

    Firebase treats a token as revoked only when ``iat < validSince``, and
    ``revoke_refresh_tokens`` derives ``validSince`` from *this* server's clock.
    A server running behind Google would therefore stamp ``validSince`` before the
    caller's own ``iat``, letting the token survive its own logout. Passing the
    presenting token's ``iat`` floors the timestamp just past it, so logout is
    correct regardless of clock drift.
    """
    valid_since = int(time.time())
    if not_before is not None:
        valid_since = max(valid_since, int(not_before) + 1)
    fb_auth.update_user(uid, valid_since=valid_since)
