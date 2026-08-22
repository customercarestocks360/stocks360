# ruff: noqa: B008
import asyncio

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.admin import repository, service
from app.auth.dependencies import require_admin
from app.platform import repository as platform_repository
from app.schemas.admin import (
    AccountControlRequest,
    AdminAuditEntry,
    AdminOverview,
    AdminReasonRequest,
    AdminUserList,
    AdminUserOperations,
    BalanceAdjustmentRequest,
    KycReviewRequest,
    KycReviewResult,
    ProductAccessRequest,
    SessionRevocationResult,
)
from app.schemas.common import NOT_FOUND, UNAUTHORIZED, UNAVAILABLE
from app.schemas.onboarding import OnboardingStatus
from app.schemas.platform import PlatformSettings, PlatformSettingsUpdate
from app.schemas.trading import LedgerEntry, Order, OrderId
from app.schemas.user import AccountStatus, UserProfile
from app.trading import repository as trading_repository
from app.trading import service as trading_service
from app.users import repository as users_repository

router = APIRouter(prefix="/admin", tags=["admin"])


@router.get(
    "/overview", response_model=AdminOverview, responses={**UNAUTHORIZED, **UNAVAILABLE}
)
async def admin_overview(_: dict = Depends(require_admin)):
    return await asyncio.to_thread(repository.overview)


@router.get(
    "/settings",
    response_model=PlatformSettings,
    responses={**UNAUTHORIZED, **UNAVAILABLE},
)
async def admin_get_settings(_: dict = Depends(require_admin)):
    return await asyncio.to_thread(platform_repository.get_settings)


@router.patch(
    "/settings",
    response_model=PlatformSettings,
    responses={**UNAUTHORIZED, **UNAVAILABLE},
)
async def admin_update_settings(
    payload: PlatformSettingsUpdate, claims: dict = Depends(require_admin)
):
    fields = payload.model_dump(mode="json", exclude_unset=True)
    settings = await asyncio.to_thread(
        platform_repository.update_settings, fields, claims["uid"]
    )
    await asyncio.to_thread(
        repository.record_audit,
        actor_uid=claims["uid"],
        actor_email=claims.get("email"),
        action="platform.settings.update",
        reason="Platform settings changed",
        metadata={"fields": sorted(fields)},
    )
    return settings


@router.get(
    "/users/directory",
    response_model=AdminUserList,
    responses={**UNAUTHORIZED, **UNAVAILABLE},
)
async def admin_user_directory(
    _: dict = Depends(require_admin),
    search: str | None = Query(default=None, max_length=128),
    account_status: AccountStatus | None = Query(default=None),
    onboarding_status: OnboardingStatus | None = Query(default=None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0, le=100000),
):
    items, total = await asyncio.to_thread(
        users_repository.list_profiles,
        limit=limit,
        offset=offset,
        search=search,
        account_status=account_status.value if account_status else None,
        onboarding_status=onboarding_status.value if onboarding_status else None,
    )
    return AdminUserList(items=items, total=total, limit=limit, offset=offset)


@router.get(
    "/users/{uid}/operations",
    response_model=AdminUserOperations,
    responses={**UNAUTHORIZED, **NOT_FOUND, **UNAVAILABLE},
)
async def admin_user_operations(uid: str, _: dict = Depends(require_admin)):
    profile = await asyncio.to_thread(users_repository.get_profile, uid)
    if profile is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="No such user"
        )
    account, orders, trades, positions, ledger, logins = await asyncio.gather(
        asyncio.to_thread(trading_service.account, uid),
        asyncio.to_thread(trading_repository.list_orders, uid, 100),
        asyncio.to_thread(trading_repository.list_trades, uid, 100),
        asyncio.to_thread(trading_service.positions, uid, True),
        asyncio.to_thread(trading_repository.list_ledger, uid, 100),
        asyncio.to_thread(users_repository.get_login_history, uid, 50),
    )
    return AdminUserOperations(
        profile=profile,
        account=account,
        orders=orders,
        trades=trades,
        positions=positions,
        ledger=ledger,
        logins=logins,
    )


@router.patch(
    "/users/{uid}/control",
    response_model=UserProfile,
    responses={**UNAUTHORIZED, **NOT_FOUND, **UNAVAILABLE},
)
async def admin_control_account(
    uid: str, payload: AccountControlRequest, claims: dict = Depends(require_admin)
):
    if uid == claims["uid"] and payload.status is AccountStatus.suspended:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Administrators cannot suspend their own current account",
        )
    return await service.set_account_control(uid, payload, claims)


@router.post(
    "/users/{uid}/kyc-review",
    response_model=KycReviewResult,
    responses={**UNAUTHORIZED, **NOT_FOUND, **UNAVAILABLE},
)
async def admin_review_kyc(
    uid: str, payload: KycReviewRequest, claims: dict = Depends(require_admin)
):
    return await asyncio.to_thread(service.review_kyc, uid, payload, claims)


@router.patch(
    "/users/{uid}/products",
    response_model=KycReviewResult,
    responses={**UNAUTHORIZED, **NOT_FOUND, **UNAVAILABLE},
)
async def admin_set_product_access(
    uid: str, payload: ProductAccessRequest, claims: dict = Depends(require_admin)
):
    return await asyncio.to_thread(service.set_product_access, uid, payload, claims)


@router.post(
    "/users/{uid}/balance-adjustments",
    response_model=LedgerEntry,
    responses={**UNAUTHORIZED, **NOT_FOUND, **UNAVAILABLE},
)
async def admin_adjust_balance(
    uid: str, payload: BalanceAdjustmentRequest, claims: dict = Depends(require_admin)
):
    return await asyncio.to_thread(service.adjust_balance, uid, payload, claims)


@router.post(
    "/users/{uid}/revoke-sessions",
    response_model=SessionRevocationResult,
    responses={**UNAUTHORIZED, **NOT_FOUND, **UNAVAILABLE},
)
async def admin_revoke_user_sessions(
    uid: str, payload: AdminReasonRequest, claims: dict = Depends(require_admin)
):
    return await asyncio.to_thread(service.revoke_sessions, uid, payload.reason, claims)


@router.delete(
    "/users/{uid}/orders/{order_id}",
    response_model=Order,
    responses={**UNAUTHORIZED, **NOT_FOUND, **UNAVAILABLE},
)
async def admin_cancel_order(
    uid: str, order_id: OrderId, claims: dict = Depends(require_admin)
):
    order = await trading_service.cancel_order(uid, order_id)
    await asyncio.to_thread(
        repository.record_audit,
        actor_uid=claims["uid"],
        actor_email=claims.get("email"),
        action="order.cancel",
        target_uid=uid,
        reason="Cancelled by administrator",
        metadata={"order_id": order_id},
    )
    return order


@router.get(
    "/audit",
    response_model=list[AdminAuditEntry],
    responses={**UNAUTHORIZED, **UNAVAILABLE},
)
async def admin_audit_log(
    _: dict = Depends(require_admin),
    target_uid: str | None = Query(default=None, max_length=128),
    limit: int = Query(100, ge=1, le=500),
):
    return await asyncio.to_thread(repository.list_audit, limit, target_uid)
