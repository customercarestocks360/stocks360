"""Mongo access for watchlists, parameterised by collection.

Crypto and forex keep separate collections so a symbol universe change in one cannot
invalidate the other, but the storage shape and the guarantees are identical.

Every query is scoped by `uid` as well as `_id`, so a watchlist id guessed or leaked from
another account reads as a plain 404 rather than someone else's data.
"""

import uuid
from datetime import datetime, timezone

from pymongo import ReturnDocument

from app.core.database import get_db


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _shape(doc: dict) -> dict:
    doc["id"] = doc.pop("_id")
    return doc


class WatchlistStore:
    def __init__(self, collection: str) -> None:
        self.collection = collection

    def _col(self):
        return get_db()[self.collection]

    def count_for_user(self, uid: str) -> int:
        return self._col().count_documents({"uid": uid})

    def create(self, uid: str, name: str, symbols: list[str]) -> dict:
        """Raises DuplicateKeyError when the user already has a watchlist by this name."""
        now = _now()
        doc = {
            "_id": uuid.uuid4().hex,
            "uid": uid,
            "name": name,
            "symbols": symbols,
            "version": 1,
            "created_at": now,
            "updated_at": now,
        }
        self._col().insert_one(doc)
        return _shape(dict(doc))

    def list_for_user(self, uid: str, limit: int) -> list[dict]:
        cursor = self._col().find({"uid": uid}).sort("created_at", -1).limit(limit)
        return [_shape(doc) for doc in cursor]

    def get(self, uid: str, watchlist_id: str) -> dict | None:
        doc = self._col().find_one({"_id": watchlist_id, "uid": uid})
        return _shape(doc) if doc else None

    def update(self, uid: str, watchlist_id: str, changes: dict) -> dict | None:
        """Apply a patch and bump `version` in the same operation, so a live socket can
        never observe new symbols under the old version number."""
        doc = self._col().find_one_and_update(
            {"_id": watchlist_id, "uid": uid},
            {"$set": {**changes, "updated_at": _now()}, "$inc": {"version": 1}},
            return_document=ReturnDocument.AFTER,
        )
        return _shape(doc) if doc else None

    def add_symbols(self, uid: str, watchlist_id: str, symbols: list[str]) -> dict | None:
        """`$addToSet` makes this idempotent — re-adding a held symbol is not an error, and
        two concurrent adds cannot produce a duplicate."""
        doc = self._col().find_one_and_update(
            {"_id": watchlist_id, "uid": uid},
            {
                "$addToSet": {"symbols": {"$each": symbols}},
                "$set": {"updated_at": _now()},
                "$inc": {"version": 1},
            },
            return_document=ReturnDocument.AFTER,
        )
        return _shape(doc) if doc else None

    def remove_symbol(self, uid: str, watchlist_id: str, symbol: str) -> dict | None:
        doc = self._col().find_one_and_update(
            {"_id": watchlist_id, "uid": uid},
            {"$pull": {"symbols": symbol}, "$set": {"updated_at": _now()}, "$inc": {"version": 1}},
            return_document=ReturnDocument.AFTER,
        )
        return _shape(doc) if doc else None

    def delete(self, uid: str, watchlist_id: str) -> bool:
        return self._col().delete_one({"_id": watchlist_id, "uid": uid}).deleted_count == 1
