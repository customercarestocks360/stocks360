"""Mongo access for the funding request queue.

This file stores *requests*, not money. Every balance change a request eventually causes
goes through `app.trading.repository` — the same `apply_to_wallet` an order settlement
uses, so a deposit credit and a withdrawal debit land in the one ledger the account page
already reads, rather than in a second set of books that has to be reconciled with it.

The one rule that matters here is the same one that holds the rest of the venue together:
**nothing is a read-then-write.** `resolve()` puts `status: "pending"` inside the query, so
two reviewers pressing approve at the same moment produce one settlement and one `409` —
not two credits.
"""

import uuid
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any

from bson.decimal128 import Decimal128
from pymongo import ASCENDING, DESCENDING, ReturnDocument

from app.core.database import get_db
from app.schemas.funding import FundingKind, FundingStatus
from app.trading.money import money

REQUESTS = "funding_requests"


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _oid() -> str:
    return uuid.uuid4().hex


def _d128(value: Decimal) -> Decimal128:
    """Quantised on the way in, like every other amount this system stores.

    A local copy of the trading repository's converter rather than a shared import: that
    one is private to the module that owns the wallets, and a request document has exactly
    one amount in it. If a third module ever needs this, promote it then.
    """
    return Decimal128(money(value))


def _shape(doc: dict) -> dict:
    doc = dict(doc)
    doc["id"] = doc.pop("_id")
    amount = doc.get("amount")
    if isinstance(amount, Decimal128):
        doc["amount"] = amount.to_decimal()
    return doc


# --------------------------------------------------------------------------- #
# Indexes
# --------------------------------------------------------------------------- #


def ensure_indexes() -> None:
    """Called from core.database alongside the rest. Safe to re-run."""
    db = get_db()
    # A user's own history, newest first.
    db[REQUESTS].create_index(
        [("uid", ASCENDING), ("created_at", DESCENDING)], name="funding_uid_idx"
    )
    # The review queue: every user's pending requests, newest first. This is the one query
    # that is not scoped by uid, and it is the reason the index exists separately.
    db[REQUESTS].create_index(
        [("status", ASCENDING), ("created_at", DESCENDING)], name="funding_queue_idx"
    )
    # Counting a user's open requests against the per-user cap.
    db[REQUESTS].create_index(
        [("uid", ASCENDING), ("status", ASCENDING)], name="funding_uid_status_idx"
    )


# --------------------------------------------------------------------------- #
# Writes
# --------------------------------------------------------------------------- #


def create(
    *,
    uid: str,
    email: str | None,
    kind: FundingKind,
    currency: str,
    amount: Decimal,
    network: str,
    destination: str | None,
    deposit_address: str | None,
    reference: str | None,
    funded: bool,
) -> dict:
    """Insert a pending request.

    A withdrawal is inserted **before** its cash is locked and flipped to `funded` after,
    which is the safe order of the two: a crash in between leaves a request that cannot be
    approved, and the money still spendable. The other order would strand locked cash with
    nothing pointing at it, which only an operator could unpick.
    """
    now = _now()
    doc = {
        "_id": _oid(),
        "uid": uid,
        "email": email,
        "kind": kind.value,
        "status": FundingStatus.pending.value,
        "currency": currency,
        "amount": _d128(amount),
        "network": network,
        "destination": destination,
        "deposit_address": deposit_address,
        "reference": reference,
        "funded": funded,
        "resolution_note": None,
        "resolved_by": None,
        "resolved_at": None,
        "ledger_entry_id": None,
        "created_at": now,
        "updated_at": now,
    }
    get_db()[REQUESTS].insert_one(doc)
    return _shape(doc)


def mark_funded(request_id: str) -> None:
    get_db()[REQUESTS].update_one(
        {"_id": request_id}, {"$set": {"funded": True, "updated_at": _now()}}
    )


def delete_pending(request_id: str) -> None:
    """Drop a request whose reservation never succeeded, so the attempt leaves no trace.

    Only ever called on the synchronous failure path, and guarded on `pending` so it can
    never remove something a reviewer has already acted on.
    """
    get_db()[REQUESTS].delete_one(
        {"_id": request_id, "status": FundingStatus.pending.value}
    )


def resolve(
    request_id: str,
    status: FundingStatus,
    *,
    resolved_by: str,
    note: str | None = None,
    require_funded: bool | None = None,
) -> dict | None:
    """Claim a pending request. Returns the updated document, or None when it was not
    pending — which is how a double approval reports itself.

    The claim happens *before* the money moves. A crash in between leaves a request marked
    settled whose balance did not change, which is visible and repairable; crediting first
    would let a retry credit twice, which is not.
    """
    query: dict[str, Any] = {"_id": request_id, "status": FundingStatus.pending.value}
    if require_funded is not None:
        query["funded"] = require_funded

    doc = get_db()[REQUESTS].find_one_and_update(
        query,
        {
            "$set": {
                "status": status.value,
                "resolved_by": resolved_by,
                "resolution_note": note,
                "resolved_at": _now(),
                "updated_at": _now(),
            }
        },
        return_document=ReturnDocument.AFTER,
    )
    return _shape(doc) if doc else None


def revert_to_pending(request_id: str) -> None:
    """Undo a claim whose settlement then failed, so the request stays actionable.

    Guarded on nothing having been recorded against it, so it cannot resurrect a request
    that actually did move money.
    """
    get_db()[REQUESTS].update_one(
        {"_id": request_id, "ledger_entry_id": None},
        {
            "$set": {
                "status": FundingStatus.pending.value,
                "resolved_by": None,
                "resolution_note": None,
                "resolved_at": None,
                "updated_at": _now(),
            }
        },
    )


def attach_ledger_entry(request_id: str, entry_id: str) -> None:
    get_db()[REQUESTS].update_one(
        {"_id": request_id},
        {"$set": {"ledger_entry_id": entry_id, "updated_at": _now()}},
    )


# --------------------------------------------------------------------------- #
# Reads
# --------------------------------------------------------------------------- #


def get(uid: str, request_id: str) -> dict | None:
    """Scoped by uid, so someone else's request is a plain 404 rather than a 403 — the
    same rule orders and watchlists follow, for the same reason."""
    doc = get_db()[REQUESTS].find_one({"_id": request_id, "uid": uid})
    return _shape(doc) if doc else None


def get_unscoped(request_id: str) -> dict | None:
    """For the review queue, which is allowed to see every user's requests."""
    doc = get_db()[REQUESTS].find_one({"_id": request_id})
    return _shape(doc) if doc else None


def _filtered(
    base: dict[str, Any],
    kind: str | None,
    status: str | None,
    currency: str | None,
) -> dict[str, Any]:
    query = dict(base)
    if kind:
        query["kind"] = kind
    if status:
        query["status"] = status
    if currency:
        query["currency"] = currency
    return query


def list_for_user(
    uid: str,
    limit: int,
    kind: str | None = None,
    status: str | None = None,
    currency: str | None = None,
) -> list[dict]:
    query = _filtered({"uid": uid}, kind, status, currency)
    cursor = get_db()[REQUESTS].find(query).sort("created_at", DESCENDING).limit(limit)
    return [_shape(doc) for doc in cursor]


def list_all(
    limit: int,
    kind: str | None = None,
    status: str | None = None,
    currency: str | None = None,
    uid: str | None = None,
) -> list[dict]:
    query = _filtered({} if uid is None else {"uid": uid}, kind, status, currency)
    cursor = get_db()[REQUESTS].find(query).sort("created_at", DESCENDING).limit(limit)
    return [_shape(doc) for doc in cursor]


def count_pending(uid: str) -> int:
    return get_db()[REQUESTS].count_documents(
        {"uid": uid, "status": FundingStatus.pending.value}
    )


def count_pending_by_kind() -> dict[str, int]:
    """Across every user — the two counters on the review dashboard."""
    cursor = get_db()[REQUESTS].aggregate(
        [
            {"$match": {"status": FundingStatus.pending.value}},
            {"$group": {"_id": "$kind", "count": {"$sum": 1}}},
        ]
    )
    return {row["_id"]: row["count"] for row in cursor}
