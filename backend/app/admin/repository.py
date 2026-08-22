import uuid
from datetime import datetime, timezone

from pymongo import DESCENDING

from app.core.database import get_db

AUDIT_LOG = "admin_audit_log"


def now() -> datetime:
    return datetime.now(timezone.utc)


def overview() -> dict:
    db = get_db()
    return {
        "users": db.users.count_documents({}),
        "active_users": db.users.count_documents(
            {
                "$or": [
                    {"account_status": "active"},
                    {"account_status": {"$exists": False}},
                ]
            }
        ),
        "suspended_users": db.users.count_documents({"account_status": "suspended"}),
        "kyc_under_review": db.users.count_documents(
            {"onboarding_status": "under_review"}
        ),
        "open_orders": db.orders.count_documents({"status": "open"}),
        "open_positions": db.positions.count_documents(
            {
                "$or": [
                    {"available_quantity": {"$ne": 0}},
                    {"reserved_quantity": {"$ne": 0}},
                ]
            }
        ),
        "pending_deposits": db.funding_requests.count_documents(
            {"status": "pending", "kind": "deposit"}
        ),
        "pending_withdrawals": db.funding_requests.count_documents(
            {"status": "pending", "kind": "withdrawal"}
        ),
        "at": now(),
    }


def record_audit(
    *,
    actor_uid: str,
    actor_email: str | None,
    action: str,
    target_uid: str | None = None,
    reason: str | None = None,
    metadata: dict | None = None,
) -> dict:
    doc = {
        "_id": uuid.uuid4().hex,
        "actor_uid": actor_uid,
        "actor_email": actor_email,
        "action": action,
        "target_uid": target_uid,
        "reason": reason,
        "metadata": metadata or {},
        "at": now(),
    }
    get_db()[AUDIT_LOG].insert_one(doc)
    return {**doc, "id": doc["_id"]}


def list_audit(limit: int = 100, target_uid: str | None = None) -> list[dict]:
    query = {"target_uid": target_uid} if target_uid else {}
    rows = []
    for doc in get_db()[AUDIT_LOG].find(query).sort("at", DESCENDING).limit(limit):
        doc["id"] = doc.pop("_id")
        rows.append(doc)
    return rows
