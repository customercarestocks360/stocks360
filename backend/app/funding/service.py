"""Funding rules: what a request has to satisfy, and what resolving one does to a balance.

The gates are the trading gates, deliberately. Crediting an unidentified account is the
exact step the KYC funnel exists to prevent, and paying one out is worse — so
`assert_can_trade` guards both ends here exactly as it guards an order.

The asymmetry between the two kinds is the whole design, and it is worth stating plainly:

* A **deposit** request touches no balance at all until it is approved. The money is not
  here yet. Recording an unverified claim as a credit would be inventing funds.
* A **withdrawal** request locks the amount at once, into the same `reserved` bucket an
  open buy order uses, and the debit happens out of *that* on approval. So the cash cannot
  be spent, traded or withdrawn a second time while a reviewer is looking at it, and a
  decline puts it straight back. This is the only shape where the user's spendable balance
  is honest at every instant in between.

Both settle through `app.trading.repository.apply_to_wallet`, so every movement lands in
the one ledger `GET /trading/ledger` already serves. There is no second set of books.
"""

import asyncio
import logging
from datetime import datetime, timezone

from fastapi import HTTPException, status

from app.core.config import (
    FUNDING_MAX_PENDING_PER_USER,
    TRADING_MAX_DEPOSIT,
    TRADING_MAX_WITHDRAWAL,
)
from app.funding import repository
from app.schemas.funding import (
    CurrencyTotal,
    DepositRequest,
    FundingKind,
    FundingStatus,
    FundingSummary,
    WithdrawalRequest,
)
from app.schemas.trading import LedgerKind
from app.trading import repository as trading_repository
from app.trading import service as trading_service
from app.trading.money import ZERO
from app.users import repository as users_repository

logger = logging.getLogger(__name__)

# Scope prefixes for the shared idempotency keys, kept distinct from the instant
# `/trading/deposits` scopes so the same key can be used on both paths without colliding.
_SCOPE = {
    FundingKind.deposit: "funding_deposit",
    FundingKind.withdrawal: "funding_withdrawal",
}

_CAP = {
    FundingKind.deposit: TRADING_MAX_DEPOSIT,
    FundingKind.withdrawal: TRADING_MAX_WITHDRAWAL,
}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _conflict(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_409_CONFLICT, detail=detail)


def _not_found() -> HTTPException:
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No such funding request")


# --------------------------------------------------------------------------- #
# Creating a request
# --------------------------------------------------------------------------- #


def _gate(uid: str) -> dict:
    """The account-level checks, run on the calling thread. Returns the stored profile so
    the caller can denormalise the email onto the request."""
    profile = users_repository.get_profile(uid) or {}
    trading_service.assert_can_trade(profile)
    if repository.count_pending(uid) >= FUNDING_MAX_PENDING_PER_USER:
        raise _conflict(
            f"You already have {FUNDING_MAX_PENDING_PER_USER} funding requests awaiting "
            "review — wait for one to be resolved or cancel it"
        )
    return profile


def _assert_within_cap(kind: FundingKind, amount) -> None:
    cap = _CAP[kind]
    if amount > cap:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"A single {kind.value} is capped at {cap}",
        )


async def _claim(uid: str, kind: FundingKind, key: str) -> dict | None:
    """Claim the idempotency key, or return the request a replay should get back.

    Same contract as the instant funding path: an in-flight key is a `409` rather than a
    guess, because "already done" and "the first attempt died halfway" are two different
    answers and only one of them is safe to repeat.
    """
    scope = _SCOPE[kind]
    existing = await asyncio.to_thread(trading_repository.claim_key, uid, scope, key)
    if existing is None:
        return None
    if existing.get("result_id"):
        request = await asyncio.to_thread(repository.get, uid, existing["result_id"])
        if request is not None:
            return request
    raise _conflict(
        f"idempotency_key {key!r} is already in flight — retry it later rather than "
        "sending a new one"
    )


async def request_deposit(uid: str, payload: DepositRequest) -> dict:
    """Record a claim that money was sent. Credits nothing — approval does that."""
    trading_service.assert_enabled()
    _assert_within_cap(FundingKind.deposit, payload.amount)
    profile = await asyncio.to_thread(_gate, uid)

    replay = await _claim(uid, FundingKind.deposit, payload.idempotency_key)
    if replay is not None:
        return replay

    try:
        request = await asyncio.to_thread(
            repository.create,
            uid=uid,
            email=profile.get("email"),
            kind=FundingKind.deposit,
            currency=payload.currency.value,
            amount=payload.amount,
            network=payload.network.value,
            destination=None,
            reference=payload.reference,
            # Nothing to fund: a deposit locks no balance on the way in.
            funded=True,
        )
    except Exception:
        await asyncio.to_thread(
            trading_repository.release_key, uid, _SCOPE[FundingKind.deposit], payload.idempotency_key
        )
        raise

    await asyncio.to_thread(
        trading_repository.complete_key,
        uid,
        _SCOPE[FundingKind.deposit],
        payload.idempotency_key,
        request["id"],
    )
    return request


async def request_withdrawal(uid: str, payload: WithdrawalRequest) -> dict:
    """Record a payout request and lock the cash behind it.

    The request is written first and the lock applied second. That order is chosen, not
    incidental: a crash in between leaves a request marked `funded: false` — visible,
    refusable on approval, cancellable by the user — while the money stays spendable.
    Locking first would strand cash with nothing pointing at it, which only an operator
    could ever unpick.
    """
    trading_service.assert_enabled()
    _assert_within_cap(FundingKind.withdrawal, payload.amount)
    profile = await asyncio.to_thread(_gate, uid)

    replay = await _claim(uid, FundingKind.withdrawal, payload.idempotency_key)
    if replay is not None:
        return replay

    scope = _SCOPE[FundingKind.withdrawal]
    currency = payload.currency.value
    request: dict | None = None
    try:
        request = await asyncio.to_thread(
            repository.create,
            uid=uid,
            email=profile.get("email"),
            kind=FundingKind.withdrawal,
            currency=currency,
            amount=payload.amount,
            network=payload.network.value,
            destination=payload.destination,
            reference=payload.reference,
            funded=False,
        )
        entry = await asyncio.to_thread(
            trading_repository.apply_to_wallet,
            uid,
            currency,
            available_delta=-payload.amount,
            reserved_delta=payload.amount,
            kind=LedgerKind.reserve,
            require_available=payload.amount,
            reference=f"withdrawal request {request['id']}",
        )
    except Exception:
        if request is not None:
            await asyncio.to_thread(repository.delete_pending, request["id"])
        await asyncio.to_thread(trading_repository.release_key, uid, scope, payload.idempotency_key)
        raise

    if entry is None:
        # The guard inside the update failed, which is the only way this reports
        # insufficient funds. Nothing moved, so the request should not exist either.
        await asyncio.to_thread(repository.delete_pending, request["id"])
        await asyncio.to_thread(trading_repository.release_key, uid, scope, payload.idempotency_key)
        balance = await asyncio.to_thread(trading_repository.get_balance, uid, currency)
        held = balance["available"] if balance else ZERO
        raise _conflict(
            f"Withdrawing {payload.amount} {currency} needs that much available and you have "
            f"{held}. Cash locked by open orders or an earlier withdrawal request does not "
            "count — cancel those first."
        )

    await asyncio.to_thread(repository.mark_funded, request["id"])
    await asyncio.to_thread(
        trading_repository.complete_key, uid, scope, payload.idempotency_key, request["id"]
    )
    request["funded"] = True
    return request


# --------------------------------------------------------------------------- #
# Resolving one
# --------------------------------------------------------------------------- #


async def _release_lock(request: dict, reason: str) -> None:
    """Put a withdrawal's locked cash back where it came from.

    Guarded by the reserved balance itself, so running it twice cannot credit twice — the
    second attempt simply finds nothing to release.
    """
    if request["kind"] != FundingKind.withdrawal.value or not request.get("funded"):
        return
    entry = await asyncio.to_thread(
        trading_repository.apply_to_wallet,
        request["uid"],
        request["currency"],
        available_delta=request["amount"],
        reserved_delta=-request["amount"],
        kind=LedgerKind.release,
        require_reserved=request["amount"],
        reference=reason,
    )
    if entry is None:
        logger.critical(
            "Funding request %s was closed but its %s reservation of %s could not be released",
            request["id"], request["currency"], request["amount"],
        )


async def cancel(uid: str, request_id: str) -> dict:
    """Withdraw your own pending request. A withdrawal's lock is released with it."""
    existing = await asyncio.to_thread(repository.get, uid, request_id)
    if existing is None:
        raise _not_found()
    if existing["status"] != FundingStatus.pending.value:
        raise _conflict(
            f"This request is already {existing['status']} — only a pending one can be cancelled"
        )

    request = await asyncio.to_thread(
        repository.resolve,
        request_id,
        FundingStatus.cancelled,
        resolved_by="user",
        note="Cancelled by the account holder",
    )
    if request is None:
        raise _conflict("This request was resolved while you were cancelling it")

    await _release_lock(request, f"withdrawal request {request_id} cancelled")
    return request


async def approve(reviewer_uid: str, request_id: str, note: str | None) -> dict:
    """Settle a pending request: credit a deposit, or pay out a locked withdrawal.

    The claim is taken before the balance moves. A crash in between leaves a request
    marked settled whose money did not move — wrong, but visible in the ledger's absence
    and repairable by hand. Moving the money first would let a retry do it twice, which is
    neither visible nor repairable.
    """
    trading_service.assert_enabled()
    existing = await asyncio.to_thread(repository.get_unscoped, request_id)
    if existing is None:
        raise _not_found()
    if existing["status"] != FundingStatus.pending.value:
        raise _conflict(f"This request is already {existing['status']}")
    if existing["kind"] == FundingKind.withdrawal.value and not existing.get("funded"):
        raise _conflict(
            "This withdrawal never locked its funds, so there is nothing to pay out — "
            "cancel it and ask the user to request it again"
        )

    request = await asyncio.to_thread(
        repository.resolve,
        request_id,
        FundingStatus.completed,
        resolved_by=reviewer_uid,
        note=note,
        # Re-asserted inside the atomic claim, so the check above cannot go stale between
        # reading it and acting on it.
        require_funded=True,
    )
    if request is None:
        raise _conflict("This request was resolved by someone else a moment ago")

    uid, currency, amount = request["uid"], request["currency"], request["amount"]
    if request["kind"] == FundingKind.deposit.value:
        await asyncio.to_thread(trading_repository.ensure_wallet, uid, currency)
        entry = await asyncio.to_thread(
            trading_repository.apply_to_wallet,
            uid,
            currency,
            available_delta=amount,
            reserved_delta=ZERO,
            kind=LedgerKind.deposit,
            reference=f"deposit request {request_id}",
        )
    else:
        # The money leaves the reservation, not `available` — it left there when the
        # request was placed. So the ledger entry's signed `amount` is zero and it is
        # `reserved_after` that drops, exactly as a filled buy consumes its reservation.
        entry = await asyncio.to_thread(
            trading_repository.apply_to_wallet,
            uid,
            currency,
            available_delta=ZERO,
            reserved_delta=-amount,
            kind=LedgerKind.withdrawal,
            require_reserved=amount,
            reference=f"withdrawal request {request_id}",
        )

    if entry is None:
        await asyncio.to_thread(repository.revert_to_pending, request_id)
        raise _conflict(
            "The balance this request settles against is no longer in the state it was "
            "approved in — nothing was moved, and the request is pending again"
        )

    await asyncio.to_thread(repository.attach_ledger_entry, request_id, entry["id"])
    request["ledger_entry_id"] = entry["id"]
    logger.info(
        "Funding request %s (%s %s %s) approved by %s",
        request_id, request["kind"], amount, currency, reviewer_uid,
    )
    return request


async def decline(reviewer_uid: str, request_id: str, note: str | None) -> dict:
    """Turn a pending request down. A withdrawal's locked cash goes straight back."""
    existing = await asyncio.to_thread(repository.get_unscoped, request_id)
    if existing is None:
        raise _not_found()
    if existing["status"] != FundingStatus.pending.value:
        raise _conflict(f"This request is already {existing['status']}")

    request = await asyncio.to_thread(
        repository.resolve,
        request_id,
        FundingStatus.cancelled,
        resolved_by=reviewer_uid,
        note=note or "Declined on review",
    )
    if request is None:
        raise _conflict("This request was resolved by someone else a moment ago")

    await _release_lock(request, f"withdrawal request {request_id} declined")
    logger.info("Funding request %s declined by %s", request_id, reviewer_uid)
    return request


# --------------------------------------------------------------------------- #
# Reads
# --------------------------------------------------------------------------- #


def summary() -> FundingSummary:
    """The review dashboard: what is waiting, and what the venue is holding.

    Per currency and with no grand total, for the same reason `GET /trading/portfolio` has
    none — adding INR to USDT needs an FX rate this API has no licensed source for.
    """
    pending = repository.count_pending_by_kind()
    balances = [
        CurrencyTotal(
            currency=row["currency"],
            available=row["available"],
            reserved=row["reserved"],
            total=row["available"] + row["reserved"],
            wallets=row["wallets"],
        )
        for row in trading_repository.venue_totals()
    ]
    return FundingSummary(
        pending_deposits=pending.get(FundingKind.deposit.value, 0),
        pending_withdrawals=pending.get(FundingKind.withdrawal.value, 0),
        balances=balances,
        at=_now(),
    )
