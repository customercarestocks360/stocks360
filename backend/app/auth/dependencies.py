from fastapi import Depends, Header, HTTPException, status

from app.auth.service import verify_token
from app.core.config import ADMIN_EMAILS
from app.users.repository import get_profile


def require_verified_email(claims: dict) -> None:
    """403 unless Firebase has confirmed the address the token carries.

    `is not True` rather than a truthiness test: the claim is a bool from Firebase, so
    anything else is a surprise that should fail closed rather than read as "verified".
    """
    if claims.get("email_verified") is not True:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Verify your email address before using this account",
        )


def get_current_user(authorization: str | None = Header(default=None)) -> dict:
    """Resolve the caller's Firebase claims from the Authorization bearer header.

    An unverified email is refused here rather than per route: anyone can type an address
    they do not own, so until Firebase has seen the confirmation link, the identity behind
    the token is just a claim. Every protected route depends on this one function, so the
    single guard covers all of them. Clicking the link refreshes the token, and the next
    request carries `email_verified: true` with no further work here.
    """
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing bearer token"
        )
    claims = verify_token(authorization.split(" ", 1)[1], check_revoked=True)
    require_verified_email(claims)
    profile = get_profile(claims["uid"])
    if profile and profile.get("account_status") == "suspended":
        reason = profile.get("account_status_reason") or "Contact support for details"
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"This account is suspended: {reason}",
        )
    return claims


def require_admin(claims: dict = Depends(get_current_user)) -> dict:
    """Staff-only routes. Admin is an allowlist of verified emails, not a second password.

    Three properties this shape has and a separate admin credential does not:

    * **No new secret.** The identity is already established by the same token every other
      route trusts, so there is nothing extra to leak, rotate or hardcode in a client.
    * **Revocation already works.** `get_current_user` verifies with `check_revoked=True`,
      so signing an admin out ends their staff session with it.
    * **Fails closed.** An empty `ADMIN_EMAILS` means nobody is an admin, so a deployment
      that forgets to configure it has a locked review queue rather than an open one.

    Membership is the only check left here: `get_current_user` has already refused an
    unverified email, which this allowlist depends on — it keys on an address, so an
    unconfirmed one would mean trusting a claim the user typed.
    """
    email = (claims.get("email") or "").strip().lower()
    if not ADMIN_EMAILS or not email or email not in ADMIN_EMAILS:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This endpoint is restricted to administrators",
        )
    return claims
