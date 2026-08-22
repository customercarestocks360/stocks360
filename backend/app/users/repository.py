import re
from datetime import datetime, timezone

from pymongo import ReturnDocument

from app.core.database import get_db

USERS = "users"
LOGIN_LOGS = "login_logs"


def _now() -> datetime:
    return datetime.now(timezone.utc)


def upsert_user(profile: dict) -> dict:
    """Mirror the Firebase identity into Mongo, creating the record on first sight.

    Firebase stays the source of truth for credentials; this is the app-side profile
    so the rest of the system can query users without calling Firebase.
    """
    now = _now()
    uid = profile["uid"]
    fields = {
        k: profile.get(k)
        for k in ("email", "name", "picture", "provider", "email_verified")
    }
    get_db()[USERS].update_one(
        {"_id": uid},
        {
            "$set": {**fields, "updated_at": now},
            "$setOnInsert": {"created_at": now, "login_count": 0},
        },
        upsert=True,
    )
    return get_profile(uid)


def record_login(
    uid: str, provider: str | None, ip: str | None, user_agent: str | None
) -> None:
    """Append a login event and bump the user's login counters."""
    now = _now()
    db = get_db()
    db[LOGIN_LOGS].insert_one(
        {
            "uid": uid,
            "provider": provider,
            "ip": ip,
            "user_agent": user_agent,
            "at": now,
        }
    )
    db[USERS].update_one(
        {"_id": uid}, {"$set": {"last_login_at": now}, "$inc": {"login_count": 1}}
    )


def get_profile(uid: str) -> dict | None:
    doc = get_db()[USERS].find_one({"_id": uid})
    if doc is None:
        return None
    doc["uid"] = doc.pop("_id")
    return doc


def get_profile_by_email(email: str) -> dict | None:
    exact = f"^{re.escape(email.strip())}$"
    doc = get_db()[USERS].find_one({"email": {"$regex": exact, "$options": "i"}})
    if doc is None:
        return None
    doc["uid"] = doc.pop("_id")
    return doc


def update_profile_fields(uid: str, fields: dict) -> dict | None:
    """Patch editable profile fields (currently just display name) onto the stored record.
    Returns None rather than upserting — there is nothing sensible to attach an edit to
    before `POST /auth/login` has created the record."""
    if not fields:
        return get_profile(uid)
    result = get_db()[USERS].update_one(
        {"_id": uid}, {"$set": {**fields, "updated_at": _now()}}
    )
    if result.matched_count == 0:
        return None
    return get_profile(uid)


def get_login_history(uid: str, limit: int = 20) -> list[dict]:
    cursor = (
        get_db()[LOGIN_LOGS].find({"uid": uid}, {"_id": 0}).sort("at", -1).limit(limit)
    )
    return list(cursor)


def list_profiles(
    *,
    limit: int = 50,
    offset: int = 0,
    search: str | None = None,
    account_status: str | None = None,
    onboarding_status: str | None = None,
) -> tuple[list[dict], int]:
    """Paginated staff directory. Search is escaped before becoming a regex."""
    query: dict = {}
    if search:
        pattern = re.escape(search.strip())
        query["$or"] = [
            {"email": {"$regex": pattern, "$options": "i"}},
            {"name": {"$regex": pattern, "$options": "i"}},
            {"_id": {"$regex": pattern, "$options": "i"}},
        ]
    if account_status:
        if account_status == "active":
            query["$and"] = query.get("$and", []) + [
                {
                    "$or": [
                        {"account_status": "active"},
                        {"account_status": {"$exists": False}},
                    ]
                }
            ]
        else:
            query["account_status"] = account_status
    if onboarding_status:
        query["onboarding_status"] = onboarding_status

    collection = get_db()[USERS]
    total = collection.count_documents(query)
    cursor = collection.find(query).sort("created_at", -1).skip(offset).limit(limit)
    rows: list[dict] = []
    for doc in cursor:
        doc["uid"] = doc.pop("_id")
        rows.append(doc)
    return rows, total


def set_account_control(
    uid: str, account_status: str, reason: str, actor_uid: str
) -> dict | None:
    now = _now()
    result = get_db()[USERS].find_one_and_update(
        {"_id": uid},
        {
            "$set": {
                "account_status": account_status,
                "account_status_reason": reason,
                "account_status_updated_at": now,
                "account_status_updated_by": actor_uid,
                "updated_at": now,
            }
        },
        return_document=ReturnDocument.AFTER,
    )
    if result is None:
        return None
    result["uid"] = result.pop("_id")
    return result
