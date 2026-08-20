from fastapi import APIRouter, Depends, Request, status

from app.auth.dependencies import get_current_user, require_verified_email
from app.auth.service import create_user, revoke_tokens, verify_token
from app.core.config import FIREBASE_WEB_CONFIG
from app.core.http import client_ip
from app.schemas.auth import FirebaseWebConfig, SignupRequest, TokenRequest, UserResponse
from app.schemas.common import CONFLICT, FORBIDDEN, UNAUTHORIZED, UNAVAILABLE, MessageResponse
from app.users.repository import record_login, upsert_user

router = APIRouter(prefix="/auth", tags=["auth"])


@router.get(
    "/config",
    response_model=FirebaseWebConfig,
    summary="Firebase Web SDK config",
    description="Client config sourced from .env so browsers never hardcode it.",
)
def firebase_config():
    return FirebaseWebConfig(**FIREBASE_WEB_CONFIG)


@router.post(
    "/signup",
    response_model=UserResponse,
    status_code=status.HTTP_201_CREATED,
    responses={**CONFLICT},
    summary="Register an email/password user",
    description="Creates the Firebase user and mirrors it into MongoDB. "
    "Signing in happens client-side via the Web SDK, which also sends the verification "
    "email — the account cannot reach a protected route until that link is clicked.",
)
def signup(payload: SignupRequest):
    user = create_user(payload.email, payload.password, payload.display_name)
    profile = UserResponse.from_user_record(user)
    upsert_user(profile.model_dump())
    return profile


@router.post(
    "/login",
    response_model=UserResponse,
    responses={**UNAUTHORIZED, **FORBIDDEN, **UNAVAILABLE},
    summary="Verify an ID token and record the login",
    description="Accepts a Firebase ID token from either email/password or Google, "
    "mirrors the identity into MongoDB and appends a login event. "
    "403 until the email address has been verified.",
)
def login(payload: TokenRequest, request: Request):
    claims = verify_token(payload.id_token)
    # This route verifies the token itself rather than via get_current_user, so it needs
    # the same guard: an unverified address must not get as far as a recorded login.
    require_verified_email(claims)
    profile = UserResponse.from_claims(claims)
    upsert_user(profile.model_dump())
    record_login(
        profile.uid,
        profile.provider,
        client_ip(request),
        request.headers.get("user-agent"),
    )
    return profile


@router.get(
    "/me",
    response_model=UserResponse,
    responses={**UNAUTHORIZED, **FORBIDDEN, **UNAVAILABLE},
    summary="Identity from the bearer token",
    description="Reads straight from the verified token. See GET /users/me for the stored profile.",
)
def me(claims: dict = Depends(get_current_user)):
    return UserResponse.from_claims(claims)


@router.post(
    "/logout",
    response_model=MessageResponse,
    responses={**UNAUTHORIZED, **FORBIDDEN, **UNAVAILABLE},
    summary="Revoke the user's refresh tokens",
    description="Ends existing sessions. The presenting token stops working immediately.",
)
def logout(claims: dict = Depends(get_current_user)):
    revoke_tokens(claims["uid"], not_before=claims.get("iat"))
    return MessageResponse(message="Signed out, refresh tokens revoked")
