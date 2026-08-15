from datetime import datetime, timezone

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
    fields = {k: profile.get(k) for k in ("email", "name", "picture", "provider", "email_verified")}
    get_db()[USERS].update_one(
        {"_id": uid},
        {"$set": {**fields, "updated_at": now}, "$setOnInsert": {"created_at": now, "login_count": 0}},
        upsert=True,
    )
    return get_profile(uid)


def record_login(uid: str, provider: str | None, ip: str | None, user_agent: str | None) -> None:
    """Append a login event and bump the user's login counters."""
    now = _now()
    db = get_db()
    db[LOGIN_LOGS].insert_one(
        {"uid": uid, "provider": provider, "ip": ip, "user_agent": user_agent, "at": now}
    )
    db[USERS].update_one({"_id": uid}, {"$set": {"last_login_at": now}, "$inc": {"login_count": 1}})


def get_profile(uid: str) -> dict | None:
    doc = get_db()[USERS].find_one({"_id": uid})
    if doc is None:
        return None
    doc["uid"] = doc.pop("_id")
    return doc


def get_login_history(uid: str, limit: int = 20) -> list[dict]:
    cursor = get_db()[LOGIN_LOGS].find({"uid": uid}, {"_id": 0}).sort("at", -1).limit(limit)
    return list(cursor)
