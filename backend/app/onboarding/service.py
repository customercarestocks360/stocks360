"""Onboarding rules: step ordering and the submit hand-off.

The session is the single source of truth while signup is in flight. Nothing here
trusts the client to say where it is in the funnel — the stored session decides.
"""

from datetime import datetime, timezone

from fastapi import HTTPException, status
from pymongo.errors import DuplicateKeyError

from app.onboarding import repository
from app.schemas.onboarding import (
    AGREEMENTS_BY_PRODUCT,
    ALWAYS_REQUIRED_AGREEMENTS,
    REVIEW_GATED_PRODUCTS,
    STEP_ORDER,
    AgreementDocument,
    KycTier,
    OnboardingSessionResponse,
    OnboardingStatus,
    OnboardingStep,
    OnboardingSubmitResponse,
    Product,
)
from app.users import repository as users_repository

# Field paths that never travel back out in full once stored.
_MASKED_PATHS: dict[OnboardingStep, tuple[str, ...]] = {
    OnboardingStep.contact: ("mobile_number",),
    OnboardingStep.identity: ("document_number",),
    OnboardingStep.tax: ("tax_identification_number",),
    OnboardingStep.funding: ("bank_account.account_number",),
}

# Steps a submitted application may still be corrected on. `markets` drives product
# enablement/review gating and `agreements` is versioned consent — neither is a plain
# detail to overwrite in place, so both stay out of scope for `amend_step`.
AMENDABLE_STEPS: frozenset[OnboardingStep] = frozenset(STEP_ORDER) - {
    OnboardingStep.markets,
    OnboardingStep.agreements,
}


def _conflict(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_409_CONFLICT, detail=detail)


def request_product_access(uid: str, products: list[Product]) -> dict:
    """Apply removals now and hold every newly requested product for staff approval."""
    profile = users_repository.get_profile(uid)
    if profile is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No such user")
    onboarding_status = profile.get("onboarding_status")
    if onboarding_status == OnboardingStatus.not_started.value:
        raise _conflict("Submit account verification before changing market products")

    desired = list(dict.fromkeys(products))
    # Only an approved account can retain live access. Under-review/rejected users may
    # still correct their requested selection, but every selection remains pending.
    live = (
        [Product(value) for value in profile.get("enabled_products", [])]
        if onboarding_status == OnboardingStatus.approved.value
        else []
    )
    enabled = [product for product in desired if product in live]
    pending = [product for product in desired if product not in enabled]
    tier = (
        KycTier.pro
        if any(product in REVIEW_GATED_PRODUCTS for product in enabled)
        else KycTier.verified
    )
    saved = repository.update_product_request(
        uid,
        tier=tier,
        enabled_products=[product.value for product in enabled],
        pending_products=[product.value for product in pending],
    )
    if not saved:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No submitted KYC application for this user",
        )
    return users_repository.get_profile(uid)


# --------------------------------------------------------------------------- #
# Reads
# --------------------------------------------------------------------------- #


def _mask(value: str, keep: int = 4) -> str:
    """Leave the last few characters so a user can recognise their own value."""
    if len(value) <= keep:
        return "*" * len(value)
    return "*" * (len(value) - keep) + value[-keep:]


def _redact(steps: dict) -> dict:
    """Copy the captured steps with identifiers masked. The stored document keeps the
    full values — only the response is reduced."""
    out: dict = {}
    for name, entry in steps.items():
        data = dict(entry.get("data") or {})
        try:
            step = OnboardingStep(name)
        except ValueError:  # a step retired from the funnel but still on old sessions
            out[name] = {"data": data, "at": entry.get("at")}
            continue
        for path in _MASKED_PATHS.get(step, ()):
            head, _, tail = path.partition(".")
            if not tail:
                if isinstance(data.get(head), str):
                    data[head] = _mask(data[head])
            elif isinstance(data.get(head), dict) and isinstance(data[head].get(tail), str):
                data[head] = {**data[head], tail: _mask(data[head][tail])}
        out[name] = {"data": data, "at": entry.get("at")}
    return out


def _derive_tier(session: dict, captured: set[str]) -> KycTier:
    stored = session.get("kyc_tier")
    if stored:
        return KycTier(stored)
    if OnboardingStep.identity.value in captured:
        return KycTier.basic
    return KycTier.unverified


def build_view(uid: str, session: dict | None) -> OnboardingSessionResponse:
    """Render a session — real or not-yet-created — as the client's progress state."""
    session = session or {}
    steps = session.get("steps") or {}
    captured = set(steps)
    completed = [s for s in STEP_ORDER if s.value in captured]
    remaining = [s for s in STEP_ORDER if s.value not in captured]
    return OnboardingSessionResponse(
        uid=uid,
        status=OnboardingStatus(session.get("status", OnboardingStatus.not_started.value)),
        kyc_tier=_derive_tier(session, captured),
        current_step=remaining[0] if remaining else None,
        completed_steps=completed,
        remaining_steps=remaining,
        progress_percent=round(len(completed) * 100 / len(STEP_ORDER)),
        ready_to_submit=not remaining and session.get("submitted_at") is None,
        steps=_redact(steps),
        created_at=session.get("created_at"),
        updated_at=session.get("updated_at"),
        expires_at=session.get("expires_at"),
        submitted_at=session.get("submitted_at"),
    )


def get_session_view(uid: str) -> OnboardingSessionResponse:
    return build_view(uid, repository.get_session(uid))


# --------------------------------------------------------------------------- #
# Rules
# --------------------------------------------------------------------------- #


def _assert_editable(session: dict | None) -> None:
    if session and session.get("submitted_at") is not None:
        raise _conflict(
            "Onboarding has already been submitted and is under review — steps can no longer be edited"
        )


def _assert_in_order(step: OnboardingStep, captured: set[str]) -> None:
    """A step is accepted only when every earlier step exists, so later rules can
    rely on the data they check against being present."""
    earlier = STEP_ORDER[: STEP_ORDER.index(step)]
    missing = [s.value for s in earlier if s.value not in captured]
    if missing:
        raise _conflict(f"Submit these steps first: {', '.join(missing)}")


def _step_data(steps: dict, step: OnboardingStep) -> dict:
    return (steps.get(step.value) or {}).get("data") or {}


def _requested_products(steps: dict) -> list[Product]:
    return [Product(p) for p in _step_data(steps, OnboardingStep.markets).get("products", [])]


def _required_agreements(products: list[Product]) -> set[AgreementDocument]:
    required = set(ALWAYS_REQUIRED_AGREEMENTS)
    for product in products:
        required |= AGREEMENTS_BY_PRODUCT[product]
    return required


def _assert_agreements_cover_products(accepted: list[dict], steps: dict) -> None:
    signed = {AgreementDocument(a["document"]) for a in accepted}
    missing = sorted(d.value for d in _required_agreements(_requested_products(steps)) - signed)
    if missing:
        raise _conflict(f"Missing consent for: {', '.join(missing)}")


# --------------------------------------------------------------------------- #
# Writes
# --------------------------------------------------------------------------- #


def submit_step(
    uid: str, payload, ip: str | None = None, user_agent: str | None = None
) -> OnboardingSessionResponse:
    """Validate one step against the session and persist it."""
    session = repository.get_session(uid)
    _assert_editable(session)
    steps = (session or {}).get("steps") or {}
    step: OnboardingStep = payload.step
    _assert_in_order(step, set(steps))

    # mode="json" keeps dates and enums as strings, which is what Mongo can store.
    data = payload.model_dump(mode="json", exclude={"step"})

    if step is OnboardingStep.agreements:
        _assert_agreements_cover_products(data["accepted"], steps)
        # Consent is only defensible with the context it was given in.
        data["accepted_from"] = {"ip": ip, "user_agent": user_agent}

    return build_view(uid, repository.save_step(uid, step.value, data))


def amend_step(uid: str, payload) -> OnboardingSessionResponse:
    """Correct one section of an already-submitted application — from account settings or
    admin support. `submit_step` keeps owning the in-progress funnel; this only runs once
    `finalize()` has already frozen a `kyc_profiles` record for this uid.

    Writes both copies so neither goes stale: the frozen `kyc_profiles` record other modules
    read from, and the `onboarding_sessions` step data the account page's recap renders —
    the latter first would let the recap show a value that failed to freeze.
    """
    session = repository.get_session(uid)
    if session is None or session.get("submitted_at") is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No submitted application to amend — complete onboarding first",
        )
    step: OnboardingStep = payload.step
    if step not in AMENDABLE_STEPS:
        raise _conflict(f"`{step.value}` cannot be corrected here")

    data = payload.model_dump(mode="json", exclude={"step"})
    try:
        repository.amend_kyc_profile_field(uid, step.value, data)
    except DuplicateKeyError as exc:
        raise _conflict(
            "This identity document is already registered to another account"
        ) from exc
    return build_view(uid, repository.save_step(uid, step.value, data))


def finalize(uid: str) -> OnboardingSubmitResponse:
    """Freeze the session into a permanent KYC application and open the products."""
    session = repository.get_session(uid)
    if session is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No onboarding session — submit the first step to start one",
        )
    _assert_editable(session)

    steps = session.get("steps") or {}
    missing = [s.value for s in STEP_ORDER if s.value not in steps]
    if missing:
        raise _conflict(f"Onboarding is incomplete — still missing: {', '.join(missing)}")

    products = _requested_products(steps)
    _assert_agreements_cover_products(_step_data(steps, OnboardingStep.agreements)["accepted"], steps)

    pending = [p for p in products if p in REVIEW_GATED_PRODUCTS]
    enabled = [p for p in products if p not in REVIEW_GATED_PRODUCTS]
    tier = KycTier.verified  # `pro` is granted by the review that clears `pending`
    submitted_at = datetime.now(timezone.utc)

    profile = {
        "_id": uid,
        **{name: entry["data"] for name, entry in steps.items()},
        "step_timestamps": {name: entry["at"] for name, entry in steps.items()},
        "status": OnboardingStatus.under_review.value,
        "kyc_tier": tier.value,
        "enabled_products": [p.value for p in enabled],
        "pending_products": [p.value for p in pending],
        "session_started_at": session.get("created_at"),
        "submitted_at": submitted_at,
    }
    try:
        repository.write_kyc_profile(profile)
    except DuplicateKeyError as exc:
        raise _conflict(
            "This identity document is already registered to another account"
        ) from exc

    repository.freeze_session(
        uid, tier, [p.value for p in enabled], [p.value for p in pending], submitted_at
    )
    repository.set_user_onboarding(
        uid,
        OnboardingStatus.under_review,
        tier,
        [p.value for p in enabled],
        [p.value for p in pending],
    )
    return OnboardingSubmitResponse(
        uid=uid,
        status=OnboardingStatus.under_review,
        kyc_tier=tier,
        enabled_products=enabled,
        pending_products=pending,
        submitted_at=submitted_at,
    )
