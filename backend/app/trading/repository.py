"""Mongo access for trading: wallets, orders, trades, positions and the ledger.

Three rules hold this together, and the correctness of the whole feature rests on them.

**Money is `Decimal128`, never a float.** Every amount goes in through `_d128()` and comes
back out as a `Decimal` via `_decimals()`, which walks the document rather than naming
fields — a converter you have to keep in sync with a schema is a converter that will
eventually be out of sync with it.

**Nothing is a read-then-write.** Reserving cash, reserving a position, cancelling an
order and claiming a fill are all a single conditional `find_one_and_update`: the
condition that makes the operation legal is part of the query, so two concurrent requests
cannot both pass it. Checking a balance in Python and then decrementing it is the exact
shape of a double-spend, and it is not used anywhere in this file.

**Every balance change writes a ledger entry.** The entry records the balances the same
operation produced, so the ledger is reconstructable from itself rather than being a log
that hopefully agrees with the wallet.

The one thing this does *not* do is span documents atomically. Settling a fill touches a
wallet, a position and an order, and there is no transaction around the three. Each is
individually atomic and the order of operations is chosen so a crash strands value rather
than duplicating it, but a multi-document transaction is the honest fix — see the readme.
"""

import uuid
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any

from bson.decimal128 import Decimal128
from pymongo import ASCENDING, DESCENDING, ReturnDocument
from pymongo.errors import DuplicateKeyError

from app.core.database import get_db
from app.schemas.trading import LedgerKind, OrderStatus
from app.trading.money import ZERO, money

WALLETS = "wallets"
ORDERS = "orders"
TRADES = "trades"
POSITIONS = "positions"
LEDGER = "ledger_entries"
IDEMPOTENCY = "idempotency_keys"


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _oid() -> str:
    return uuid.uuid4().hex


def _d128(value: Decimal) -> Decimal128:
    """Every amount crosses into Mongo here, quantised, so no caller can store a scale
    the rest of the system does not expect."""
    return Decimal128(money(value))


def _decimals(value: Any) -> Any:
    """Recursively turn stored Decimal128s back into Decimals."""
    if isinstance(value, Decimal128):
        return value.to_decimal()
    if isinstance(value, dict):
        return {k: _decimals(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_decimals(v) for v in value]
    return value


def _shape(doc: dict) -> dict:
    doc = _decimals(doc)
    doc["id"] = doc.pop("_id")
    return doc


# --------------------------------------------------------------------------- #
# Indexes
# --------------------------------------------------------------------------- #


def ensure_indexes() -> None:
    """Called from core.database alongside the rest. Safe to re-run."""
    db = get_db()

    # Wallet ids are deterministic (uid:CURRENCY), so a user can only ever have one
    # wallet per currency — enforced by the key rather than by a uniqueness check.
    db[WALLETS].create_index([("uid", ASCENDING)], name="wallet_uid_idx")

    db[ORDERS].create_index([("uid", ASCENDING), ("created_at", DESCENDING)], name="order_uid_idx")
    db[ORDERS].create_index([("uid", ASCENDING), ("status", ASCENDING)], name="order_uid_status_idx")
    # The matcher's query: every resting order, across all users.
    db[ORDERS].create_index(
        [("status", ASCENDING), ("asset_class", ASCENDING)], name="order_resting_idx"
    )
    # A client order id is unique per user, and only for orders that carry one — the
    # partial filter is what lets everyone else leave it null without colliding.
    db[ORDERS].create_index(
        [("uid", ASCENDING), ("client_order_id", ASCENDING)],
        name="order_client_id_idx",
        unique=True,
        partialFilterExpression={"client_order_id": {"$type": "string"}},
    )

    db[TRADES].create_index([("uid", ASCENDING), ("at", DESCENDING)], name="trade_uid_idx")
    db[TRADES].create_index([("order_id", ASCENDING)], name="trade_order_idx")

    db[POSITIONS].create_index([("uid", ASCENDING)], name="position_uid_idx")

    db[LEDGER].create_index([("uid", ASCENDING), ("at", DESCENDING)], name="ledger_uid_idx")


# --------------------------------------------------------------------------- #
# Idempotency
# --------------------------------------------------------------------------- #


def claim_key(uid: str, scope: str, key: str) -> dict | None:
    """Reserve an idempotency key. Returns None when it is free and now claimed, or the
    existing claim when it is not.

    The claim is written *before* the money moves and completed *after*, so a replay can
    tell "already done, here is what happened" from "the first attempt died halfway",
    which are two different answers and only one of them is safe to repeat.
    """
    doc = {
        "_id": f"{uid}:{scope}:{key}",
        "uid": uid,
        "scope": scope,
        "key": key,
        "result_id": None,
        "at": _now(),
    }
    try:
        get_db()[IDEMPOTENCY].insert_one(doc)
        return None
    except DuplicateKeyError:
        return get_db()[IDEMPOTENCY].find_one({"_id": doc["_id"]})


def complete_key(uid: str, scope: str, key: str, result_id: str) -> None:
    get_db()[IDEMPOTENCY].update_one(
        {"_id": f"{uid}:{scope}:{key}"},
        {"$set": {"result_id": result_id, "completed_at": _now()}},
    )


def release_key(uid: str, scope: str, key: str) -> None:
    """Drop a claim whose work never happened, so a rejected attempt can be retried."""
    get_db()[IDEMPOTENCY].delete_one({"_id": f"{uid}:{scope}:{key}", "result_id": None})


# --------------------------------------------------------------------------- #
# Wallets and the ledger
# --------------------------------------------------------------------------- #


def _wallet_id(uid: str, currency: str) -> str:
    return f"{uid}:{currency}"


def ensure_wallet(uid: str, currency: str) -> None:
    """Create the wallet at zero if it does not exist.

    Separate from the crediting update on purpose: Mongo refuses an update that both
    `$inc`s and `$setOnInsert`s the same path, so an upsert-and-credit in one call is a
    runtime error waiting for the first deposit into a new currency.
    """
    now = _now()
    get_db()[WALLETS].update_one(
        {"_id": _wallet_id(uid, currency)},
        {
            "$setOnInsert": {
                "uid": uid,
                "currency": currency,
                "available": _d128(ZERO),
                "reserved": _d128(ZERO),
                "created_at": now,
                "updated_at": now,
            }
        },
        upsert=True,
    )


def apply_to_wallet(
    uid: str,
    currency: str,
    *,
    available_delta: Decimal,
    reserved_delta: Decimal,
    kind: LedgerKind,
    require_available: Decimal | None = None,
    require_reserved: Decimal | None = None,
    order_id: str | None = None,
    trade_id: str | None = None,
    reference: str | None = None,
) -> dict | None:
    """Move money within one wallet and record it. Returns the ledger entry, or None when
    the guard failed — which is the only way this reports insufficient funds.

    `require_available` / `require_reserved` become part of the query, so the balance is
    tested and changed in the same atomic operation.
    """
    query: dict[str, Any] = {"_id": _wallet_id(uid, currency)}
    if require_available is not None:
        query["available"] = {"$gte": _d128(require_available)}
    if require_reserved is not None:
        query["reserved"] = {"$gte": _d128(require_reserved)}

    now = _now()
    wallet = get_db()[WALLETS].find_one_and_update(
        query,
        {
            "$inc": {
                "available": _d128(available_delta),
                "reserved": _d128(reserved_delta),
            },
            "$set": {"updated_at": now},
        },
        return_document=ReturnDocument.AFTER,
    )
    if wallet is None:
        return None

    entry = {
        "_id": _oid(),
        "uid": uid,
        "currency": currency,
        "kind": kind.value,
        "amount": _d128(available_delta),
        "available_after": wallet["available"],
        "reserved_after": wallet["reserved"],
        "order_id": order_id,
        "trade_id": trade_id,
        "reference": reference,
        "at": now,
    }
    get_db()[LEDGER].insert_one(entry)
    return _shape(dict(entry))


def get_balance(uid: str, currency: str) -> dict | None:
    doc = get_db()[WALLETS].find_one({"_id": _wallet_id(uid, currency)})
    return _decimals(doc) if doc else None


def list_balances(uid: str) -> list[dict]:
    cursor = get_db()[WALLETS].find({"uid": uid}).sort("currency", ASCENDING)
    return [_decimals(doc) for doc in cursor]


def venue_totals() -> list[dict]:
    """Every wallet in the deployment, summed per currency.

    The one balance read that is not scoped to a uid, and the only caller is the funding
    review dashboard. It lives here rather than in `app/funding` because the wallets
    collection belongs to this module — a second file reaching into it is how two
    different ideas of what a balance is get started.
    """
    cursor = get_db()[WALLETS].aggregate(
        [
            {
                "$group": {
                    "_id": "$currency",
                    "available": {"$sum": "$available"},
                    "reserved": {"$sum": "$reserved"},
                    "wallets": {"$sum": 1},
                }
            },
            {"$sort": {"_id": ASCENDING}},
        ]
    )
    return [
        {
            "currency": row["_id"],
            "available": _decimals(row["available"]),
            "reserved": _decimals(row["reserved"]),
            "wallets": row["wallets"],
        }
        for row in cursor
    ]


def list_ledger(
    uid: str, limit: int, currency: str | None = None, kind: str | None = None
) -> list[dict]:
    query: dict[str, Any] = {"uid": uid}
    if currency:
        query["currency"] = currency
    if kind:
        query["kind"] = kind
    cursor = get_db()[LEDGER].find(query).sort("at", DESCENDING).limit(limit)
    return [_shape(doc) for doc in cursor]


def get_ledger_entry(uid: str, entry_id: str) -> dict | None:
    doc = get_db()[LEDGER].find_one({"_id": entry_id, "uid": uid})
    return _shape(doc) if doc else None


# --------------------------------------------------------------------------- #
# Positions
# --------------------------------------------------------------------------- #


def _position_id(uid: str, asset_class: str, symbol: str) -> str:
    return f"{uid}:{asset_class}:{symbol}"


def get_position(uid: str, asset_class: str, symbol: str) -> dict | None:
    doc = get_db()[POSITIONS].find_one({"_id": _position_id(uid, asset_class, symbol)})
    return _decimals(doc) if doc else None


def list_positions(uid: str, include_flat: bool = False) -> list[dict]:
    """A flat position is history, not a holding, so it is hidden unless asked for."""
    query: dict[str, Any] = {"uid": uid}
    if not include_flat:
        query["$or"] = [
            {"available_quantity": {"$gt": _d128(ZERO)}},
            {"reserved_quantity": {"$gt": _d128(ZERO)}},
        ]
    cursor = get_db()[POSITIONS].find(query).sort("symbol", ASCENDING)
    return [_decimals(doc) for doc in cursor]


def ensure_position(uid: str, asset_class: str, symbol: str, currency: str) -> None:
    now = _now()
    get_db()[POSITIONS].update_one(
        {"_id": _position_id(uid, asset_class, symbol)},
        {
            "$setOnInsert": {
                "uid": uid,
                "asset_class": asset_class,
                "symbol": symbol,
                "currency": currency,
                "available_quantity": _d128(ZERO),
                "reserved_quantity": _d128(ZERO),
                "cost_basis": _d128(ZERO),
                "realized_pnl": _d128(ZERO),
                "created_at": now,
                "updated_at": now,
            }
        },
        upsert=True,
    )


def reserve_quantity(uid: str, asset_class: str, symbol: str, quantity: Decimal) -> dict | None:
    """Lock units for an open sell. None means the position does not hold enough free
    units — the same guard as cash, expressed the same way."""
    doc = get_db()[POSITIONS].find_one_and_update(
        {
            "_id": _position_id(uid, asset_class, symbol),
            "available_quantity": {"$gte": _d128(quantity)},
        },
        {
            "$inc": {
                "available_quantity": _d128(-quantity),
                "reserved_quantity": _d128(quantity),
            },
            "$set": {"updated_at": _now()},
        },
        return_document=ReturnDocument.AFTER,
    )
    return _decimals(doc) if doc else None


def release_quantity(uid: str, asset_class: str, symbol: str, quantity: Decimal) -> dict | None:
    doc = get_db()[POSITIONS].find_one_and_update(
        {
            "_id": _position_id(uid, asset_class, symbol),
            "reserved_quantity": {"$gte": _d128(quantity)},
        },
        {
            "$inc": {
                "available_quantity": _d128(quantity),
                "reserved_quantity": _d128(-quantity),
            },
            "$set": {"updated_at": _now()},
        },
        return_document=ReturnDocument.AFTER,
    )
    return _decimals(doc) if doc else None


def add_to_position(
    uid: str, asset_class: str, symbol: str, quantity: Decimal, cost: Decimal
) -> dict:
    """Credit a buy. `cost` is what was paid including the fee, so the average price this
    implies is the true break-even rather than the headline traded price."""
    doc = get_db()[POSITIONS].find_one_and_update(
        {"_id": _position_id(uid, asset_class, symbol)},
        {
            "$inc": {"available_quantity": _d128(quantity), "cost_basis": _d128(cost)},
            "$set": {"updated_at": _now()},
        },
        return_document=ReturnDocument.AFTER,
    )
    return _decimals(doc)


def reduce_position(
    uid: str,
    asset_class: str,
    symbol: str,
    quantity: Decimal,
    basis_sold: Decimal,
    realized: Decimal,
) -> dict | None:
    """Settle a sell against the units this order had reserved."""
    doc = get_db()[POSITIONS].find_one_and_update(
        {
            "_id": _position_id(uid, asset_class, symbol),
            "reserved_quantity": {"$gte": _d128(quantity)},
        },
        {
            "$inc": {
                "reserved_quantity": _d128(-quantity),
                "cost_basis": _d128(-basis_sold),
                "realized_pnl": _d128(realized),
            },
            "$set": {"updated_at": _now()},
        },
        return_document=ReturnDocument.AFTER,
    )
    if doc is None:
        return None
    doc = _decimals(doc)
    # Selling out should leave no basis behind. Rounding on each partial sale can leave a
    # few satoshis of dust, which would show up as an average price on nothing.
    if doc["available_quantity"] == 0 and doc["reserved_quantity"] == 0 and doc["cost_basis"] != 0:
        get_db()[POSITIONS].update_one(
            {"_id": doc["_id"]}, {"$set": {"cost_basis": _d128(ZERO)}}
        )
        doc["cost_basis"] = ZERO
    return doc


# --------------------------------------------------------------------------- #
# Orders
# --------------------------------------------------------------------------- #


def create_order(doc: dict) -> dict:
    """Raises DuplicateKeyError when this user has already used the client order id."""
    stored = dict(doc)
    for field in (
        "quantity",
        "filled_quantity",
        "limit_price",
        "stop_price",
        "average_price",
        "filled_notional",
        "fee",
        "reserved_amount",
        "reserved_quantity",
    ):
        if stored.get(field) is not None:
            stored[field] = _d128(stored[field])
    get_db()[ORDERS].insert_one(stored)
    return _shape(dict(stored))


def get_order(uid: str, order_id: str) -> dict | None:
    doc = get_db()[ORDERS].find_one({"_id": order_id, "uid": uid})
    return _shape(doc) if doc else None


def get_order_unscoped(order_id: str) -> dict | None:
    """For the matcher, which acts for the system rather than for a caller. Never wired to
    a route — every client-facing read goes through `get_order()` with its uid."""
    doc = get_db()[ORDERS].find_one({"_id": order_id})
    return _shape(doc) if doc else None


def list_orders(
    uid: str,
    limit: int,
    statuses: list[str] | None = None,
    asset_class: str | None = None,
    symbol: str | None = None,
) -> list[dict]:
    query: dict[str, Any] = {"uid": uid}
    if statuses:
        query["status"] = {"$in": statuses}
    if asset_class:
        query["asset_class"] = asset_class
    if symbol:
        query["symbol"] = symbol
    cursor = get_db()[ORDERS].find(query).sort("created_at", DESCENDING).limit(limit)
    return [_shape(doc) for doc in cursor]


def count_open_orders(uid: str) -> int:
    return get_db()[ORDERS].count_documents({"uid": uid, "status": OrderStatus.open.value})


def mark_funded(order_id: str) -> None:
    """Declare an order's reservation actually held.

    An order is written before its funds are locked — that ordering is what makes the
    duplicate-client-id check happen before any money moves — so between the two writes
    there is an open order backed by nothing. `funded` is how the matcher tells the
    difference, and `unfunded_orders()` is how a crash in that gap gets cleaned up.
    """
    get_db()[ORDERS].update_one({"_id": order_id}, {"$set": {"funded": True}})


def add_reservation(order_id: str, amount: Decimal) -> None:
    get_db()[ORDERS].update_one(
        {"_id": order_id}, {"$inc": {"reserved_amount": _d128(amount)}, "$set": {"updated_at": _now()}}
    )


def unfunded_orders(before: datetime) -> list[dict]:
    cursor = get_db()[ORDERS].find(
        {"status": OrderStatus.open.value, "funded": False, "created_at": {"$lt": before}}
    ).limit(200)
    return [_shape(doc) for doc in cursor]


def resting_orders(asset_class: str | None = None) -> list[dict]:
    """Every funded open order in the system, for the matcher. Not scoped by uid — this is
    the one query in the file that is deliberately global, and nothing serves it to a
    client.
    """
    query: dict[str, Any] = {"status": OrderStatus.open.value, "funded": True}
    if asset_class:
        query["asset_class"] = asset_class
    cursor = get_db()[ORDERS].find(query).sort("created_at", ASCENDING)
    return [_shape(doc) for doc in cursor]


def resting_instruments() -> list[tuple[str, str]]:
    """The distinct (asset class, symbol) pairs the matcher has to keep priced."""
    cursor = get_db()[ORDERS].aggregate(
        [
            {"$match": {"status": OrderStatus.open.value, "funded": True}},
            {"$group": {"_id": {"asset_class": "$asset_class", "symbol": "$symbol"}}},
        ]
    )
    return [(row["_id"]["asset_class"], row["_id"]["symbol"]) for row in cursor]


def mark_triggered(order_id: str) -> dict | None:
    """Flip a stop order to triggered, exactly once."""
    doc = get_db()[ORDERS].find_one_and_update(
        {"_id": order_id, "status": OrderStatus.open.value, "triggered": False},
        {"$set": {"triggered": True, "updated_at": _now()}},
        return_document=ReturnDocument.AFTER,
    )
    return _shape(doc) if doc else None


def claim_fill(
    order_id: str,
    *,
    quantity: Decimal,
    price: Decimal,
    notional: Decimal,
    fee: Decimal,
) -> dict | None:
    """Take an open order to `filled`, atomically. None means someone else already had it.

    The status moves first and the money moves after. A fill that is claimed but not yet
    settled is visible and recoverable; two settlements of one order would not be.
    """
    now = _now()
    doc = get_db()[ORDERS].find_one_and_update(
        {"_id": order_id, "status": OrderStatus.open.value, "funded": True},
        {
            "$set": {
                "status": OrderStatus.filled.value,
                "filled_quantity": _d128(quantity),
                "average_price": _d128(price),
                "filled_notional": _d128(notional),
                "fee": _d128(fee),
                "updated_at": now,
                "closed_at": now,
            }
        },
        return_document=ReturnDocument.AFTER,
    )
    return _shape(doc) if doc else None


def claim_close(
    order_id: str, status: OrderStatus, uid: str | None = None, reason: str | None = None
) -> dict | None:
    """Take an open order to cancelled, expired or rejected, atomically.

    Passing `uid` is what makes a cancel request scoped to its owner; the matcher omits it
    because it acts on behalf of the system.
    """
    query: dict[str, Any] = {"_id": order_id, "status": OrderStatus.open.value}
    if uid is not None:
        query["uid"] = uid
    now = _now()
    changes: dict[str, Any] = {"status": status.value, "updated_at": now, "closed_at": now}
    if reason is not None:
        changes["reject_reason"] = reason
    doc = get_db()[ORDERS].find_one_and_update(
        query, {"$set": changes}, return_document=ReturnDocument.AFTER
    )
    return _shape(doc) if doc else None


def clear_reservations(order_id: str) -> None:
    """Zero the reservation fields once the funds or units are actually back."""
    get_db()[ORDERS].update_one(
        {"_id": order_id},
        {"$set": {"reserved_amount": _d128(ZERO), "reserved_quantity": _d128(ZERO)}},
    )


def stranded_reservations() -> list[dict]:
    """Closed orders still showing a reservation.

    This is the crash window made visible: an order closes, and the release that should
    follow does not happen because the process died in between. The sweep re-runs the
    release, which is safe because it is guarded by the reserved balance itself.
    """
    cursor = get_db()[ORDERS].find(
        {
            "status": {"$nin": [OrderStatus.open.value]},
            "$or": [
                {"reserved_amount": {"$gt": _d128(ZERO)}},
                {"reserved_quantity": {"$gt": _d128(ZERO)}},
            ],
        }
    ).limit(200)
    return [_shape(doc) for doc in cursor]


def expiring_orders(now: datetime) -> list[dict]:
    cursor = get_db()[ORDERS].find(
        {"status": OrderStatus.open.value, "expires_at": {"$lte": now}}
    ).limit(500)
    return [_shape(doc) for doc in cursor]


# --------------------------------------------------------------------------- #
# Trades
# --------------------------------------------------------------------------- #


def record_trade(doc: dict) -> dict:
    stored = dict(doc)
    for field in ("quantity", "price", "notional", "fee", "realized_pnl"):
        if stored.get(field) is not None:
            stored[field] = _d128(stored[field])
    get_db()[TRADES].insert_one(stored)
    return _shape(dict(stored))


def list_trades(
    uid: str, limit: int, asset_class: str | None = None, symbol: str | None = None
) -> list[dict]:
    query: dict[str, Any] = {"uid": uid}
    if asset_class:
        query["asset_class"] = asset_class
    if symbol:
        query["symbol"] = symbol
    cursor = get_db()[TRADES].find(query).sort("at", DESCENDING).limit(limit)
    return [_shape(doc) for doc in cursor]


def count_positions(uid: str) -> int:
    return get_db()[POSITIONS].count_documents(
        {
            "uid": uid,
            "$or": [
                {"available_quantity": {"$gt": _d128(ZERO)}},
                {"reserved_quantity": {"$gt": _d128(ZERO)}},
            ],
        }
    )


def new_id() -> str:
    return _oid()
