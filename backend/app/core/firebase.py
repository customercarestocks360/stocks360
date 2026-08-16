import firebase_admin
from firebase_admin import credentials

from app.core.config import FIREBASE_CREDENTIALS_PATH, FIREBASE_PROJECT_ID


def init_firebase() -> firebase_admin.App:
    """Initialize the Firebase Admin app once, reusing it on repeat calls."""
    try:
        return firebase_admin.get_app()
    except ValueError:
        cred = credentials.Certificate(str(FIREBASE_CREDENTIALS_PATH))
        return firebase_admin.initialize_app(cred, {"projectId": FIREBASE_PROJECT_ID})
