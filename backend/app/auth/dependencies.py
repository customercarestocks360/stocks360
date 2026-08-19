from fastapi import Depends, Header, HTTPException, status

from app.auth.service import verify_token
from app.core.config import ADMIN_EMAILS


def get_current_user(authorization: str | None = Header(default=None)) -> dict:
    """Resolve the caller's Firebase claims from the Authorization bearer header."""
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing bearer token")
    return verify_token(authorization.split(" ", 1)[1], check_revoked=True)


def require_admin(claims: dict = Depends(get_current_user)) -> dict:
    """Staff-only routes. Admin is an allowlist of verified emails, not a second password.

    Three properties this shape has and a separate admin credential does not:

    * **No new secret.** The identity is already established by the same token every other
      route trusts, so there is nothing extra to leak, rotate or hardcode in a client.
    * **Revocation already works.** `get_current_user` verifies with `check_revoked=True`,
      so signing an admin out ends their staff session with it.
    * **Fails closed.** An empty `ADMIN_EMAILS` means nobody is an admin, so a deployment
      that forgets to configure it has a locked review queue rather than an open one.

    `email_verified` is required as well as membership: the allowlist keys on an email
    address, so accepting an unverified one would mean trusting a claim the user typed.
    """
    email = (claims.get("email") or "").strip().lower()
    if not ADMIN_EMAILS or not email or email not in ADMIN_EMAILS:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This endpoint is restricted to administrators",
        )
    if not claims.get("email_verified"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Verify your email address before using an administrator endpoint",
        )
    return claims
