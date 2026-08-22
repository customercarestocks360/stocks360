"""Self-check for `onboarding.service.amend_step`: who may correct which section of an
already-submitted application, and what happens to both stored copies.

Plain asserts, no framework, no database: `python tests/test_account_amend.py` from
`backend/`. `repository.get_session` / `save_step` / `amend_kyc_profile_field` are
monkeypatched to an in-memory dict — the thing under test is the amend rule (which steps,
which states), not Mongo.
"""

import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.onboarding import repository, service  # noqa: E402
from app.schemas.onboarding import ContactStep, MarketsStep, OnboardingStep  # noqa: E402

UID = "u1"


class _FakeRepo:
    """Stands in for the onboarding_sessions/kyc_profiles collections."""

    def __init__(self, session: dict | None):
        self.session = session
        self.profile_writes: list[tuple[str, str, dict]] = []

    def get_session(self, uid: str) -> dict | None:
        return self.session

    def amend_kyc_profile_field(self, uid: str, step: str, data: dict) -> None:
        self.profile_writes.append((uid, step, data))

    def save_step(self, uid: str, step: str, data: dict) -> dict:
        steps = dict(self.session.get("steps") or {})
        steps[step] = {"data": data, "at": datetime.now(timezone.utc)}
        self.session = {**self.session, "steps": steps}
        return self.session


def _with_repo(fake: _FakeRepo, fn):
    original = {
        "get_session": repository.get_session,
        "amend_kyc_profile_field": repository.amend_kyc_profile_field,
        "save_step": repository.save_step,
    }
    repository.get_session = fake.get_session
    repository.amend_kyc_profile_field = fake.amend_kyc_profile_field
    repository.save_step = fake.save_step
    try:
        return fn()
    finally:
        repository.get_session = original["get_session"]
        repository.amend_kyc_profile_field = original["amend_kyc_profile_field"]
        repository.save_step = original["save_step"]


def _refused(fn) -> str | None:
    try:
        fn()
    except Exception as error:
        return getattr(error, "detail", str(error))
    return None


SUBMITTED_SESSION = {
    "steps": {
        "contact": {
            "data": {
                "mobile_country_code": "+91",
                "mobile_number": "9876543210",
                "country_of_residence": "IN",
                "nationality": "IN",
            },
            "at": datetime.now(timezone.utc),
        }
    },
    "submitted_at": datetime.now(timezone.utc),
}

CONTACT_PAYLOAD = ContactStep(
    step=OnboardingStep.contact,
    mobile_country_code="+91",
    mobile_number="9998887770",
    country_of_residence="IN",
    nationality="IN",
)

MARKETS_PAYLOAD = MarketsStep(step=OnboardingStep.markets, products=["crypto_spot"], base_currency="INR")


def test_no_submitted_application_is_404():
    fake = _FakeRepo(None)
    reason = _with_repo(fake, lambda: _refused(lambda: service.amend_step(UID, CONTACT_PAYLOAD)))
    assert reason is not None and "no submitted application" in reason.lower()

    fake = _FakeRepo({"steps": {}, "submitted_at": None})
    reason = _with_repo(fake, lambda: _refused(lambda: service.amend_step(UID, CONTACT_PAYLOAD)))
    assert reason is not None and "no submitted application" in reason.lower()


def test_markets_step_is_refused_even_when_submitted():
    fake = _FakeRepo(SUBMITTED_SESSION)
    reason = _with_repo(fake, lambda: _refused(lambda: service.amend_step(UID, MARKETS_PAYLOAD)))
    assert reason is not None and "cannot be corrected" in reason.lower()
    assert fake.profile_writes == [], "a refused step must not reach the frozen profile"


def test_amendable_step_writes_both_the_frozen_profile_and_the_session():
    fake = _FakeRepo(SUBMITTED_SESSION)
    view = _with_repo(fake, lambda: service.amend_step(UID, CONTACT_PAYLOAD))

    assert len(fake.profile_writes) == 1
    written_uid, written_step, written_data = fake.profile_writes[0]
    assert (written_uid, written_step) == (UID, "contact")
    assert written_data["mobile_number"] == "9998887770"

    # The session recap the account page reads must reflect the corrected value too.
    assert view.steps["contact"]["data"]["mobile_number"] != "9876543210"


def main() -> int:
    tests = [value for name, value in sorted(globals().items()) if name.startswith("test_")]
    failures = 0
    for test in tests:
        try:
            test()
            print(f"PASS  {test.__name__}")
        except AssertionError as error:
            failures += 1
            print(f"FAIL  {test.__name__}: {error}")
    print(f"\n{len(tests) - failures}/{len(tests)} passed")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
