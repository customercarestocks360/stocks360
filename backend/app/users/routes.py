from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.auth.dependencies import get_current_user
from app.schemas.common import NOT_FOUND, UNAUTHORIZED, UNAVAILABLE
from app.schemas.user import LoginLogEntry, UserProfile
from app.users.repository import get_login_history, get_profile

router = APIRouter(prefix="/users", tags=["users"])


@router.get(
    "/me",
    response_model=UserProfile,
    responses={**UNAUTHORIZED, **NOT_FOUND, **UNAVAILABLE},
    summary="Stored profile for the current user",
    description="The MongoDB record, as opposed to /auth/me which reads from the token.",
)
def my_profile(claims: dict = Depends(get_current_user)):
    profile = get_profile(claims["uid"])
    if profile is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No stored profile yet — call POST /auth/login once",
        )
    return profile


@router.get(
    "/me/logins",
    response_model=list[LoginLogEntry],
    responses={**UNAUTHORIZED, **UNAVAILABLE},
    summary="Recent login events",
    description="Newest first, capped at 100 per request.",
)
def my_logins(
    claims: dict = Depends(get_current_user),
    limit: int = Query(20, ge=1, le=100, description="How many events to return"),
):
    return get_login_history(claims["uid"], limit)
