import logging

from pymongo import ASCENDING, DESCENDING, MongoClient
from pymongo.database import Database

from app.core.config import MONGODB_DB_NAME, MONGODB_URI

logger = logging.getLogger(__name__)

_client: MongoClient | None = None


def connect() -> Database:
    """Open the MongoDB connection. Called once on app startup."""
    global _client
    if _client is None:
        _client = MongoClient(MONGODB_URI, serverSelectionTimeoutMS=15000, tz_aware=True)
        _client.admin.command("ping")  # fail fast instead of on first query
        logger.info("Connected to MongoDB database %r", MONGODB_DB_NAME)
    return _client[MONGODB_DB_NAME]


def get_db() -> Database:
    if _client is None:
        raise RuntimeError("MongoDB is not connected — connect() runs on app startup")
    return _client[MONGODB_DB_NAME]


def close() -> None:
    global _client
    if _client is not None:
        _client.close()
        _client = None


def ensure_indexes() -> None:
    """Create the indexes the app relies on. Safe to re-run."""
    db = get_db()
    # _id already holds the Firebase uid, so lookups by user are covered.
    db.users.create_index([("email", ASCENDING)], name="email_idx")
    db.login_logs.create_index([("uid", ASCENDING), ("at", DESCENDING)], name="uid_at_idx")

    # Abandoned signup sessions expire on their own. The partial filter keeps the TTL
    # confined to in-progress sessions, and submit unsets expires_at as a second guard,
    # so a submitted application is never swept.
    db.onboarding_sessions.create_index(
        [("expires_at", ASCENDING)],
        name="session_ttl_idx",
        expireAfterSeconds=0,
        partialFilterExpression={"status": "in_progress"},
    )
    # One account per identity document — enforced by the database, not by a race-prone
    # read-then-write in the service.
    db.kyc_profiles.create_index(
        [("identity.document_type", ASCENDING), ("identity.document_number", ASCENDING)],
        name="kyc_document_idx",
        unique=True,
    )
    db.kyc_profiles.create_index([("submitted_at", DESCENDING)], name="kyc_submitted_idx")

    # Watchlist names are unique per user, not globally, so two people may both have
    # "Majors". Listing is by newest first, which the second index serves.
    for collection in (db.watchlists, db.forex_watchlists, db.stock_watchlists):
        collection.create_index(
            [("uid", ASCENDING), ("name", ASCENDING)], name="uid_name_idx", unique=True
        )
        collection.create_index(
            [("uid", ASCENDING), ("created_at", DESCENDING)], name="uid_created_idx"
        )
