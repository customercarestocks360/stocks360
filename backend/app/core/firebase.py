import firebase_admin
from firebase_admin import credentials

from app.core.config import (
    FIREBASE_CREDENTIALS_INFO,
    FIREBASE_CREDENTIALS_PATH,
    FIREBASE_PROJECT_ID,
)


def init_firebase() -> firebase_admin.App:
    """Initialize the Firebase Admin app once, reusing it on repeat calls."""
    try:
        return firebase_admin.get_app()
    except ValueError:
        # `Certificate` takes either the parsed key or a path to it; config decides which
        # of the two is in play and guarantees exactly one is set.
        cred = credentials.Certificate(
            FIREBASE_CREDENTIALS_INFO
            if FIREBASE_CREDENTIALS_INFO is not None
            else str(FIREBASE_CREDENTIALS_PATH)
        )
        return firebase_admin.initialize_app(cred, {"projectId": FIREBASE_PROJECT_ID})
