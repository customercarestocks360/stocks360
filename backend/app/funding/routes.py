# ruff: noqa: B008
"""Funding endpoints: the user's request queue, and the review queue behind it.

Two routers, because they answer to two different authorities. `/funding/*` is scoped to
the caller's uid like every other user-facing route here, so someone else's request reads
as a `404` rather than a `403`. `/admin/funding/*` is the only surface in this API that
reads across users, and it is gated on the `ADMIN_EMAILS` allowlist rather than on
anything the client can assert.

Every route is `async def` because settlement is async; the blocking pymongo work is
pushed to a thread explicitly, so a review action cannot stall the market-data sockets
this process is also serving.
"""

import asyncio

from fastapi import APIRouter, Depends, HTTPException, Query
from starlette import status

from app.admin import repository as admin_repository
from app.auth.dependencies import get_current_user, require_admin
from app.funding import repository, service
from app.schemas.common import NOT_FOUND, UNAUTHORIZED, UNAVAILABLE
from app.schemas.funding import (
    FUNDING_REJECTED,
    NOT_ADMIN,
    DepositRequest,
    FundingKind,
    FundingRequest,
    FundingStatus,
    FundingSummary,
    ReviewDecision,
    WithdrawalRequest,
)
from app.schemas.trading import NOT_ELIGIBLE

router = APIRouter(prefix="/funding", tags=["funding"])
admin_router = APIRouter(prefix="/admin/funding", tags=["admin"])


# --------------------------------------------------------------------------- #
# Placing a request
# --------------------------------------------------------------------------- #


@router.post(
    "/deposits",
    response_model=FundingRequest,
    status_code=status.HTTP_201_CREATED,
    responses={**UNAUTHORIZED, **NOT_ELIGIBLE, **FUNDING_REJECTED, **UNAVAILABLE},
    summary="Report a deposit for review",
    description="Records that you sent funds on `network`. **It credits nothing.** The "
    "balance moves only once a reviewer confirms the transfer arrived, which is the "
    "configured QR rail is enabled for the selected currency and network.\n\n"
    "`reference` is the transaction hash or bank UTR the reviewer checks against, and "
    "`network` has to be one the currency can actually travel on — `INR` on `TRC20` is a "
    "`422`, not a request that sits in the queue until somebody notices.\n\n"
    "`idempotency_key` is required. Replaying one returns the original request rather "
    "than queueing a second claim for the same transfer.",
)
async def report_deposit(
    payload: DepositRequest, claims: dict = Depends(get_current_user)
):
    return await service.request_deposit(claims["uid"], payload)


@router.post(
    "/withdrawals",
    response_model=FundingRequest,
    status_code=status.HTTP_201_CREATED,
    responses={**UNAUTHORIZED, **NOT_ELIGIBLE, **FUNDING_REJECTED, **UNAVAILABLE},
    summary="Request a payout",
    description="Locks the amount immediately: it stays in your balance and moves from "
    "`available` to `reserved`, so it cannot be spent, traded or withdrawn again while a "
    "reviewer looks at it. Approving debits it; cancelling or declining puts it straight "
    "back.\n\n"
    "`409` when `available` is short — cash locked by open orders or by an earlier "
    "withdrawal request does not count.",
)
async def request_withdrawal(
    payload: WithdrawalRequest, claims: dict = Depends(get_current_user)
):
    return await service.request_withdrawal(claims["uid"], payload)


# --------------------------------------------------------------------------- #
# Your own queue
# --------------------------------------------------------------------------- #


@router.get(
    "/requests",
    response_model=list[FundingRequest],
    responses={**UNAUTHORIZED, **UNAVAILABLE},
    summary="Your funding requests",
    description="Deposits and withdrawals together, newest first — the wallet's activity "
    "list. Filter by `kind`, `status` or `currency`.",
)
async def list_requests(
    claims: dict = Depends(get_current_user),
    kind: FundingKind | None = Query(default=None),
    request_status: FundingStatus | None = Query(default=None, alias="status"),
    currency: str | None = Query(
        default=None, min_length=2, max_length=10, examples=["USDT"]
    ),
    limit: int = Query(50, ge=1, le=200),
):
    return await asyncio.to_thread(
        repository.list_for_user,
        claims["uid"],
        limit,
        kind.value if kind else None,
        request_status.value if request_status else None,
        currency.upper() if currency else None,
    )


@router.get(
    "/requests/{request_id}",
    response_model=FundingRequest,
    responses={**UNAUTHORIZED, **NOT_FOUND, **UNAVAILABLE},
    summary="One funding request",
)
async def get_request(request_id: str, claims: dict = Depends(get_current_user)):
    request = await asyncio.to_thread(repository.get, claims["uid"], request_id)
    if request is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="No such funding request"
        )
    return request


@router.delete(
    "/requests/{request_id}",
    response_model=FundingRequest,
    responses={**UNAUTHORIZED, **NOT_FOUND, **FUNDING_REJECTED, **UNAVAILABLE},
    summary="Cancel a pending request",
    description="Only while it is still `pending`. A withdrawal's locked amount is "
    "released back to `available` with it; a deposit locked nothing, so cancelling one "
    "simply withdraws the claim.",
)
async def cancel_request(request_id: str, claims: dict = Depends(get_current_user)):
    return await service.cancel(claims["uid"], request_id)


# --------------------------------------------------------------------------- #
# The review queue
# --------------------------------------------------------------------------- #


@admin_router.get(
    "/requests",
    response_model=list[FundingRequest],
    responses={**UNAUTHORIZED, **NOT_ADMIN, **UNAVAILABLE},
    summary="Every user's funding requests",
    description="The review queue, newest first. This is the one read in the API that is "
    "not scoped to the caller. Each row carries the requesting account's `email`, "
    "denormalised at creation, so rendering the queue costs no per-row lookup.\n\n"
    "Filter by `status=pending` for the work still outstanding.",
)
async def list_all_requests(
    _: dict = Depends(require_admin),
    kind: FundingKind | None = Query(default=None),
    request_status: FundingStatus | None = Query(default=None, alias="status"),
    currency: str | None = Query(
        default=None, min_length=2, max_length=10, examples=["USDT"]
    ),
    uid: str | None = Query(
        default=None, min_length=1, max_length=128, description="One account"
    ),
    limit: int = Query(50, ge=1, le=200),
):
    return await asyncio.to_thread(
        repository.list_all,
        limit,
        kind.value if kind else None,
        request_status.value if request_status else None,
        currency.upper() if currency else None,
        uid,
    )


@admin_router.get(
    "/summary",
    response_model=FundingSummary,
    responses={**UNAUTHORIZED, **NOT_ADMIN, **UNAVAILABLE},
    summary="Review queue totals",
    description="What is waiting, and what the venue is holding across every account. "
    "Balances are per currency with no grand total — adding INR to USDT would need an FX "
    "rate this API has no licensed source for, and a made-up figure on an operations "
    "dashboard is worse than none.",
)
async def get_summary(_: dict = Depends(require_admin)):
    return await asyncio.to_thread(service.summary)


@admin_router.post(
    "/requests/{request_id}/approve",
    response_model=FundingRequest,
    responses={
        **UNAUTHORIZED,
        **NOT_ADMIN,
        **NOT_FOUND,
        **FUNDING_REJECTED,
        **UNAVAILABLE,
    },
    summary="Settle a request",
    description="Credits a verified deposit, or records completion of a manually paid "
    "withdrawal from the amount it locked. "
    "The status is claimed atomically before any money moves, so two reviewers pressing "
    "this at the same moment produce one settlement and one `409`.\n\n"
    "A withdrawal whose lock never completed (`funded: false`) is refused — there is "
    "nothing to pay out. Cancel it instead.",
)
async def approve_request(
    request_id: str,
    payload: ReviewDecision | None = None,
    claims: dict = Depends(require_admin),
):
    result = await service.approve(
        claims["uid"], request_id, payload.note if payload else None
    )
    await asyncio.to_thread(
        admin_repository.record_audit,
        actor_uid=claims["uid"],
        actor_email=claims.get("email"),
        action=f"funding.{result['kind']}.approve",
        target_uid=result["uid"],
        reason=payload.note if payload else "Funding request approved",
        metadata={
            "request_id": request_id,
            "amount": str(result["amount"]),
            "currency": result["currency"],
        },
    )
    return result


@admin_router.post(
    "/requests/{request_id}/decline",
    response_model=FundingRequest,
    responses={
        **UNAUTHORIZED,
        **NOT_ADMIN,
        **NOT_FOUND,
        **FUNDING_REJECTED,
        **UNAVAILABLE,
    },
    summary="Turn a request down",
    description="Moves it to `cancelled` and releases a withdrawal's locked cash back to "
    "`available`. `note` is shown to the user — say why, since from their side this and a "
    "self-cancellation look identical apart from that field.",
)
async def decline_request(
    request_id: str,
    payload: ReviewDecision | None = None,
    claims: dict = Depends(require_admin),
):
    result = await service.decline(
        claims["uid"], request_id, payload.note if payload else None
    )
    await asyncio.to_thread(
        admin_repository.record_audit,
        actor_uid=claims["uid"],
        actor_email=claims.get("email"),
        action=f"funding.{result['kind']}.decline",
        target_uid=result["uid"],
        reason=payload.note if payload else "Funding request declined",
        metadata={
            "request_id": request_id,
            "amount": str(result["amount"]),
            "currency": result["currency"],
        },
    )
    return result
