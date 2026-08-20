"""Self-check for the one guard that keeps unverified emails out.

Plain asserts, no framework: `python tests/test_email_verification.py` from `backend/`.
It only touches the guard, so it needs no Firebase round-trip and no database.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi import HTTPException  # noqa: E402

from app.auth.dependencies import get_current_user, require_verified_email  # noqa: E402


def status_of(claims: dict) -> int | None:
    try:
        require_verified_email(claims)
        return None
    except HTTPException as exc:
        return exc.status_code


def test_verified_email_passes():
    assert status_of({"email_verified": True}) is None


def test_unverified_email_is_forbidden():
    # A missing claim and a non-bool one both have to fail closed — only `True` is verified.
    for claims in ({"email_verified": False}, {}, {"email_verified": "yes"}, {"email_verified": 1}):
        assert status_of(claims) == 403, claims


def test_missing_bearer_header_is_unauthorized():
    for header in (None, "", "Basic abc", "token abc"):
        try:
            get_current_user(header)
            raise AssertionError(f"accepted {header!r}")
        except HTTPException as exc:
            assert exc.status_code == 401, header


if __name__ == "__main__":
    for name, case in sorted(globals().items()):
        if name.startswith("test_"):
            case()
            print(f"ok  {name}")
