# ruff: noqa: B008
from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.admin import repository as admin_repository
from app.auth.dependencies import get_current_user, require_admin
from app.onboarding import service as onboarding_service
from app.schemas.common import NOT_FOUND, UNAUTHORIZED, UNAVAILABLE
from app.schemas.onboarding import STEP_CONFLICT, OnboardingSessionResponse, StepPayload
from app.schemas.user import (
    AdminUserDetail,
    LoginLogEntry,
    UserProfile,
    UserProfileUpdate,
)
from app.users import repository
from app.users.repository import get_login_history, get_profile

router = APIRouter(prefix="/users", tags=["users"])
admin_router = APIRouter(prefix="/admin/users", tags=["admin"])


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


@router.patch(
    "/me",
    response_model=UserProfile,
    responses={**UNAUTHORIZED, **NOT_FOUND, **UNAVAILABLE},
    summary="Update your display name",
    description="Only `name` is editable here — KYC details are corrected via "
    "`PATCH /onboarding/kyc` instead.",
)
def update_my_profile(
    payload: UserProfileUpdate, claims: dict = Depends(get_current_user)
):
    profile = repository.update_profile_fields(
        claims["uid"], payload.model_dump(exclude_unset=True)
    )
    if profile is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No stored profile yet — call POST /auth/login once",
        )
    return profile


# --------------------------------------------------------------------------- #
# Admin: the only surface here that reads or edits across users.
# --------------------------------------------------------------------------- #


@admin_router.get(
    "",
    response_model=UserProfile,
    responses={**UNAUTHORIZED, **NOT_FOUND, **UNAVAILABLE},
    summary="Find a user by email",
)
def admin_find_user(
    email: str = Query(..., min_length=3, description="Exact match"),
    claims: dict = Depends(require_admin),
):
    profile = repository.get_profile_by_email(email)
    if profile is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="No user with that email"
        )
    return profile


@admin_router.get(
    "/{uid}",
    response_model=AdminUserDetail,
    responses={**UNAUTHORIZED, **NOT_FOUND, **UNAVAILABLE},
    summary="Full account detail for one user",
)
def admin_user_detail(uid: str, claims: dict = Depends(require_admin)):
    profile = get_profile(uid)
    if profile is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="No such user"
        )
    return AdminUserDetail(
        profile=profile, kyc=onboarding_service.get_session_view(uid)
    )


@admin_router.patch(
    "/{uid}",
    response_model=UserProfile,
    responses={**UNAUTHORIZED, **NOT_FOUND, **UNAVAILABLE},
    summary="Update a user's display name",
)
def admin_update_profile(
    uid: str, payload: UserProfileUpdate, claims: dict = Depends(require_admin)
):
    profile = repository.update_profile_fields(
        uid, payload.model_dump(exclude_unset=True)
    )
    if profile is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="No such user"
        )
    admin_repository.record_audit(
        actor_uid=claims["uid"],
        actor_email=claims.get("email"),
        action="user.profile.update",
        target_uid=uid,
        reason="Administrator updated user profile",
        metadata={"fields": sorted(payload.model_dump(exclude_unset=True))},
    )
    return profile


@admin_router.patch(
    "/{uid}/kyc",
    response_model=OnboardingSessionResponse,
    responses={**UNAUTHORIZED, **NOT_FOUND, **STEP_CONFLICT, **UNAVAILABLE},
    summary="Correct one section of a user's submitted KYC application",
    description="Same rules as `PATCH /onboarding/kyc` — `markets` and `agreements` are "
    "`409`, everything else overwrites that section of the user's frozen application.",
)
def admin_amend_kyc(
    uid: str, payload: StepPayload, claims: dict = Depends(require_admin)
):
    result = onboarding_service.amend_step(uid, payload)
    admin_repository.record_audit(
        actor_uid=claims["uid"],
        actor_email=claims.get("email"),
        action="kyc.section.update",
        target_uid=uid,
        reason=f"Administrator corrected KYC section: {payload.step.value}",
        metadata={"step": payload.step.value},
    )
    return result
