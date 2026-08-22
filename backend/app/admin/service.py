import asyncio
from datetime import datetime, timezone

from fastapi import HTTPException, status
from firebase_admin import auth as firebase_auth

from app.admin import repository
from app.core.config import TRADING_ACCOUNT_CURRENCY
from app.onboarding import repository as onboarding_repository
from app.schemas.admin import KycDecision, KycReviewRequest, ProductAccessRequest
from app.schemas.onboarding import (
    REVIEW_GATED_PRODUCTS,
    KycTier,
    OnboardingStatus,
    Product,
)
from app.schemas.trading import LedgerKind, OrderStatus
from app.trading import repository as trading_repository
from app.trading import service as trading_service
from app.trading.money import ZERO, money
from app.users import repository as users_repository


def _not_found(detail: str = "No such user") -> HTTPException:
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=detail)


def _conflict(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_409_CONFLICT, detail=detail)


def review_kyc(uid: str, payload, claims: dict) -> dict:
    profile = users_repository.get_profile(uid)
    application = onboarding_repository.get_kyc_profile(uid)
    if profile is None or application is None:
        raise _not_found("No submitted KYC application for this user")

    requested = [Product(value) for value in application.get("enabled_products", [])]
    requested += [
        Product(value)
        for value in application.get("pending_products", [])
        if Product(value) not in requested
    ]
    if payload.decision is KycDecision.reject:
        enabled: list[Product] = []
        pending: list[Product] = []
        outcome = OnboardingStatus.rejected
        tier = KycTier.unverified
    else:
        enabled = payload.enabled_products or requested
        invalid = [product for product in enabled if product not in requested]
        if invalid:
            raise _conflict(
                "Cannot enable products the user did not request: "
                + ", ".join(product.value for product in invalid)
            )
        pending = []
        outcome = OnboardingStatus.approved
        tier = (
            KycTier.pro
            if any(p in REVIEW_GATED_PRODUCTS for p in enabled)
            else KycTier.verified
        )

    result = onboarding_repository.review_application(
        uid,
        status=outcome,
        tier=tier,
        enabled_products=[p.value for p in enabled],
        pending_products=[p.value for p in pending],
        note=payload.reason,
        reviewer_uid=claims["uid"],
    )
    if result is None:
        raise _not_found("No submitted KYC application for this user")
    repository.record_audit(
        actor_uid=claims["uid"],
        actor_email=claims.get("email"),
        action=f"kyc.{payload.decision.value}",
        target_uid=uid,
        reason=payload.reason,
        metadata={"enabled_products": [p.value for p in enabled]},
    )
    return result


def set_product_access(uid: str, payload, claims: dict) -> dict:
    profile = users_repository.get_profile(uid)
    application = onboarding_repository.get_kyc_profile(uid)
    if profile is None or application is None:
        raise _not_found("No submitted KYC application for this user")
    if profile.get("onboarding_status") != OnboardingStatus.approved.value:
        raise _conflict("Approve this user's KYC before changing product access")

    enabled = list(dict.fromkeys(payload.enabled_products))
    tier = (
        KycTier.pro
        if any(product in REVIEW_GATED_PRODUCTS for product in enabled)
        else KycTier.verified
    )
    result = onboarding_repository.review_application(
        uid,
        status=OnboardingStatus.approved,
        tier=tier,
        enabled_products=[product.value for product in enabled],
        pending_products=[],
        note=payload.reason,
        reviewer_uid=claims["uid"],
    )
    if result is None:
        raise _not_found("No submitted KYC application for this user")
    repository.record_audit(
        actor_uid=claims["uid"],
        actor_email=claims.get("email"),
        action="products.access.update",
        target_uid=uid,
        reason=payload.reason,
        metadata={"enabled_products": [product.value for product in enabled]},
    )
    return result


def bulk_approve_kyc(payload, claims: dict) -> dict:
    """Approve each eligible application independently and report partial failures."""
    succeeded: list[str] = []
    failed: list[dict] = []
    review = KycReviewRequest(decision=KycDecision.approve, reason=payload.reason)
    for uid in payload.uids:
        try:
            profile = users_repository.get_profile(uid)
            if profile is None:
                raise _not_found()
            if profile.get("onboarding_status") != OnboardingStatus.under_review.value:
                raise _conflict("KYC is not under review")
            review_kyc(uid, review, claims)
            succeeded.append(uid)
        except HTTPException as exc:
            failed.append({"uid": uid, "detail": str(exc.detail)})
        except Exception:
            failed.append({"uid": uid, "detail": "Unexpected storage failure"})
    return {"requested": len(payload.uids), "succeeded": succeeded, "failed": failed}


def bulk_set_product_access(payload, claims: dict) -> dict:
    """Apply one product set to each approved account, preserving per-user audits."""
    succeeded: list[str] = []
    failed: list[dict] = []
    access = ProductAccessRequest(
        enabled_products=payload.enabled_products, reason=payload.reason
    )
    for uid in payload.uids:
        try:
            set_product_access(uid, access, claims)
            succeeded.append(uid)
        except HTTPException as exc:
            failed.append({"uid": uid, "detail": str(exc.detail)})
        except Exception:
            failed.append({"uid": uid, "detail": "Unexpected storage failure"})
    return {"requested": len(payload.uids), "succeeded": succeeded, "failed": failed}


async def set_account_control(uid: str, payload, claims: dict) -> dict:
    profile = await asyncio.to_thread(
        users_repository.set_account_control,
        uid,
        payload.status.value,
        payload.reason,
        claims["uid"],
    )
    if profile is None:
        raise _not_found()

    cancelled: list[str] = []
    if payload.status.value == "suspended":
        orders = await asyncio.to_thread(
            trading_repository.list_orders, uid, 200, [OrderStatus.open.value]
        )
        for order in orders:
            try:
                await trading_service.cancel_order(uid, order["id"])
                cancelled.append(order["id"])
            except HTTPException as exc:
                if exc.status_code not in (
                    status.HTTP_404_NOT_FOUND,
                    status.HTTP_409_CONFLICT,
                ):
                    raise

    await asyncio.to_thread(
        repository.record_audit,
        actor_uid=claims["uid"],
        actor_email=claims.get("email"),
        action=f"account.{payload.status.value}",
        target_uid=uid,
        reason=payload.reason,
        metadata={"cancelled_orders": cancelled},
    )
    return profile


def adjust_balance(uid: str, payload, claims: dict) -> dict:
    if users_repository.get_profile(uid) is None:
        raise _not_found()
    currency = payload.currency.value if payload.currency else TRADING_ACCOUNT_CURRENCY
    scope = "admin_balance_adjustment"
    existing = trading_repository.claim_key(uid, scope, payload.idempotency_key)
    if existing is not None:
        result_id = existing.get("result_id")
        if result_id:
            entry = trading_repository.get_ledger_entry(uid, result_id)
            if entry:
                return entry
        raise _conflict("An adjustment with this idempotency key is already in flight")

    delta = money(payload.amount)
    try:
        trading_repository.ensure_wallet(uid, currency)
        entry = trading_repository.apply_to_wallet(
            uid,
            currency,
            available_delta=delta,
            reserved_delta=ZERO,
            kind=LedgerKind.adjustment,
            require_available=-delta if delta < 0 else None,
            reference=f"Admin adjustment by {claims['uid']}: {payload.reason}",
        )
        if entry is None:
            raise _conflict(
                "The account does not have enough available balance for this debit"
            )
        trading_repository.complete_key(
            uid, scope, payload.idempotency_key, entry["id"]
        )
    except Exception:
        trading_repository.release_key(uid, scope, payload.idempotency_key)
        raise

    repository.record_audit(
        actor_uid=claims["uid"],
        actor_email=claims.get("email"),
        action="balance.adjust",
        target_uid=uid,
        reason=payload.reason,
        metadata={
            "amount": str(delta),
            "currency": currency,
            "ledger_entry_id": entry["id"],
        },
    )
    return entry


def revoke_sessions(uid: str, reason: str, claims: dict) -> dict:
    if users_repository.get_profile(uid) is None:
        raise _not_found()
    firebase_auth.revoke_refresh_tokens(uid)
    now = datetime.now(timezone.utc)
    repository.record_audit(
        actor_uid=claims["uid"],
        actor_email=claims.get("email"),
        action="security.sessions.revoke",
        target_uid=uid,
        reason=reason,
    )
    return {"uid": uid, "revoked": True, "revoked_at": now}
