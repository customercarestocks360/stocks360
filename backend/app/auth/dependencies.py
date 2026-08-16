from fastapi import Header, HTTPException, status

from app.auth.service import verify_token


def get_current_user(authorization: str | None = Header(default=None)) -> dict:
    """Resolve the caller's Firebase claims from the Authorization bearer header."""
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing bearer token")
    return verify_token(authorization.split(" ", 1)[1], check_revoked=True)
