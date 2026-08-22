from datetime import datetime, timezone

from pymongo import ReturnDocument

from app.core.config import DEPOSIT_BEP20_ADDRESS
from app.core.database import get_db

SETTINGS = "platform_settings"
SETTINGS_ID = "public"


def defaults() -> dict:
    return {
        "announcement": None,
        "support_email": None,
        "deposit_rails": [
            {
                "currency": "USDT",
                "network": "BEP20",
                "name": "BNB Smart Chain (BEP20)",
                "address": DEPOSIT_BEP20_ADDRESS,
                "address_label": "Wallet Address (BEP20)",
                "minimum": "0.01 USDT",
                "arrival": "After network confirmation and admin review",
                "fee": "0 USDT",
                "confirmations": "15 network confirmations",
                "enabled": True,
            }
        ],
        "updated_at": None,
        "updated_by": None,
    }


def get_settings() -> dict:
    doc = get_db()[SETTINGS].find_one({"_id": SETTINGS_ID})
    if doc is None:
        return defaults()
    return {**defaults(), **{key: value for key, value in doc.items() if key != "_id"}}


def update_settings(fields: dict, actor_uid: str) -> dict:
    now = datetime.now(timezone.utc)
    doc = get_db()[SETTINGS].find_one_and_update(
        {"_id": SETTINGS_ID},
        {
            "$set": {**fields, "updated_at": now, "updated_by": actor_uid},
            "$setOnInsert": {"created_at": now},
        },
        upsert=True,
        return_document=ReturnDocument.AFTER,
    )
    return {**defaults(), **{key: value for key, value in doc.items() if key != "_id"}}
