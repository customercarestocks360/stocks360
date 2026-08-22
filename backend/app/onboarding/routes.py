from fastapi import APIRouter, Depends, Request

from app.auth.dependencies import get_current_user
from app.core.http import client_ip
from app.onboarding import service
from app.schemas.common import NOT_FOUND, UNAUTHORIZED, UNAVAILABLE
from app.schemas.onboarding import (
    STEP_CONFLICT,
    OnboardingSessionResponse,
    OnboardingSubmitResponse,
    StepPayload,
)

router = APIRouter(prefix="/onboarding", tags=["onboarding"])


@router.post(
    "/step",
    response_model=OnboardingSessionResponse,
    responses={**UNAUTHORIZED, **STEP_CONFLICT, **UNAVAILABLE},
    summary="Submit one signup step",
    description=(
        "One endpoint for the whole funnel — the `step` field selects which body shape "
        "is expected and which rules apply. Steps must arrive in order: "
        "`contact` → `personal` → `address` → `identity` → `tax` → `financial` → "
        "`markets` → `funding` → `security` → `agreements`. Each call upserts the "
        "server-side session and returns the updated progress, so the client never has "
        "to remember where it was. A step may be re-submitted to correct it until the "
        "application is submitted."
    ),
)
def submit_step(payload: StepPayload, request: Request, claims: dict = Depends(get_current_user)):
    return service.submit_step(
        claims["uid"],
        payload,
        ip=client_ip(request),
        user_agent=request.headers.get("user-agent"),
    )


@router.get(
    "/session",
    response_model=OnboardingSessionResponse,
    responses={**UNAUTHORIZED, **UNAVAILABLE},
    summary="Resume the signup session",
    description=(
        "Progress plus everything captured so far, with identifiers masked. Returns a "
        "`not_started` session rather than a 404 before the first step, so a client can "
        "always ask where to begin."
    ),
)
def my_session(claims: dict = Depends(get_current_user)):
    return service.get_session_view(claims["uid"])


@router.patch(
    "/kyc",
    response_model=OnboardingSessionResponse,
    responses={**UNAUTHORIZED, **NOT_FOUND, **STEP_CONFLICT, **UNAVAILABLE},
    summary="Correct one section of your submitted application",
    description=(
        "For an application that has already been submitted — an in-progress signup keeps "
        "using `POST /onboarding/step`. Accepts the same per-step bodies except `markets` "
        "and `agreements`, which return `409` here: product selection and consent aren't "
        "plain details to overwrite."
    ),
)
def amend_kyc(payload: StepPayload, claims: dict = Depends(get_current_user)):
    return service.amend_step(claims["uid"], payload)


@router.post(
    "/submit",
    response_model=OnboardingSubmitResponse,
    responses={**UNAUTHORIZED, **NOT_FOUND, **STEP_CONFLICT, **UNAVAILABLE},
    summary="Submit the completed application",
    description=(
        "Freezes the session into a permanent KYC record, closes it to further edits and "
        "opens the requested products. Leveraged products stay `pending` until the income "
        "proof is reviewed. `409` if any step is missing or the identity document is "
        "already registered to another account."
    ),
)
def submit(claims: dict = Depends(get_current_user)):
    return service.finalize(claims["uid"])
