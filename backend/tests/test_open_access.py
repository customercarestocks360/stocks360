"""Self-check for `TRADING_OPEN_ACCESS`: who may trade what, under both settings.

Plain asserts, no framework, no database: `python tests/test_open_access.py` from
`backend/`.

The flag is read once per call as a module-level name inside `app.trading.service`
(`from app.core.config import TRADING_OPEN_ACCESS`), so a test flips it by monkeypatching
that name on the already-imported module — the same thing changing the env var and
restarting the process would do, without paying for a restart. Every test restores the
flag in a `finally`, because leaving it wrong would make every test after it lie.

No Mongo: `eligibility()` and `_assert_funding_allowed` reach into `users_repository` and
`onboarding_repository` for a profile, and those are monkeypatched here to plain dicts
rather than touched for real — the thing under test is the gate, not the lookup.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.onboarding import repository as onboarding_repository  # noqa: E402
from app.schemas.onboarding import KycTier, OnboardingStatus, Product  # noqa: E402
from app.schemas.trading import AssetClass  # noqa: E402
from app.trading import service  # noqa: E402
from app.users import repository as users_repository  # noqa: E402

UNONBOARDED = {}
REJECTED = {"onboarding_status": OnboardingStatus.rejected.value}
INCOMPLETE = {"onboarding_status": OnboardingStatus.not_started.value}
LOW_TIER = {
    "onboarding_status": OnboardingStatus.approved.value,
    "kyc_tier": KycTier.unverified.value,
}
QUALIFIED_NO_PRODUCTS = {
    "onboarding_status": OnboardingStatus.approved.value,
    "kyc_tier": KycTier.verified.value,
    "enabled_products": [],
    "pending_products": [],
}
QUALIFIED_CRYPTO_ONLY = {
    **QUALIFIED_NO_PRODUCTS,
    "enabled_products": [Product.crypto_spot.value],
}


class _open_access:
    """Force `TRADING_OPEN_ACCESS` to a value for the duration of a `with` block, on the
    already-imported `service` module, and put it back no matter what happens inside."""

    def __init__(self, value: bool):
        self.value = value

    def __enter__(self):
        self.original = service.TRADING_OPEN_ACCESS
        service.TRADING_OPEN_ACCESS = self.value
        return self

    def __exit__(self, *exc):
        service.TRADING_OPEN_ACCESS = self.original
        return False


def _refused(fn) -> str | None:
    """Run `fn`, returning the HTTPException detail on refusal or None on success."""
    try:
        fn()
    except Exception as error:
        return getattr(error, "detail", str(error))
    return None


# --------------------------------------------------------------------------- #
# assert_can_trade / _trading_block
# --------------------------------------------------------------------------- #
def test_open_access_lets_every_account_state_through():
    with _open_access(True):
        for user in (UNONBOARDED, REJECTED, INCOMPLETE, LOW_TIER, QUALIFIED_NO_PRODUCTS):
            assert _refused(lambda u=user: service.assert_can_trade(u)) is None, (
                f"open access blocked a user with state {user}"
            )


def test_closed_access_still_enforces_onboarding_and_kyc():
    with _open_access(False):
        for user, must_mention in (
            (UNONBOARDED, "onboarding"),
            (REJECTED, "rejected"),
            (INCOMPLETE, "onboarding"),
            (LOW_TIER, "KYC"),
        ):
            reason = _refused(lambda u=user: service.assert_can_trade(u))
            assert reason is not None, f"closed access let through {user}"
            assert must_mention.lower() in reason.lower(), (
                f"refusal for {user} did not explain why: {reason!r}"
            )
        assert _refused(lambda: service.assert_can_trade(QUALIFIED_NO_PRODUCTS)) is None, (
            "closed access blocked a fully qualified account"
        )


def test_the_flag_changes_nothing_about_a_qualified_account():
    """Open access removes a restriction, it does not add a new allowance beyond what a
    qualified account already had — the same user passes under both settings."""
    with _open_access(True):
        assert _refused(lambda: service.assert_can_trade(QUALIFIED_NO_PRODUCTS)) is None
    with _open_access(False):
        assert _refused(lambda: service.assert_can_trade(QUALIFIED_NO_PRODUCTS)) is None


# --------------------------------------------------------------------------- #
# assert_product_enabled
# --------------------------------------------------------------------------- #
def test_open_access_needs_no_product_grant_at_all():
    with _open_access(True):
        for product in Product:
            assert _refused(
                lambda p=product: service.assert_product_enabled(QUALIFIED_NO_PRODUCTS, p)
            ) is None, f"open access still required {product.value}"


def test_closed_access_distinguishes_under_review_from_never_requested():
    pending_user = {
        **QUALIFIED_NO_PRODUCTS,
        "pending_products": [Product.forex.value],
    }
    with _open_access(False):
        assert _refused(
            lambda: service.assert_product_enabled(QUALIFIED_CRYPTO_ONLY, Product.crypto_spot)
        ) is None, "an enabled product was refused"

        never_requested = _refused(
            lambda: service.assert_product_enabled(QUALIFIED_NO_PRODUCTS, Product.forex)
        )
        assert never_requested is not None and "not enabled" in never_requested

        under_review = _refused(
            lambda: service.assert_product_enabled(pending_user, Product.forex)
        )
        assert under_review is not None and "under review" in under_review
        assert under_review != never_requested, (
            "pending and never-requested must read differently — one is actionable"
        )


# --------------------------------------------------------------------------- #
# eligibility() — every asset class, both settings
# --------------------------------------------------------------------------- #
def _with_profile(user: dict, fn):
    """Run `fn` with `users_repository.get_profile` / `onboarding_repository.get_kyc_profile`
    standing in for the database."""
    original_profile = users_repository.get_profile
    original_kyc = onboarding_repository.get_kyc_profile
    users_repository.get_profile = lambda uid: user
    onboarding_repository.get_kyc_profile = lambda uid: {}
    try:
        return fn()
    finally:
        users_repository.get_profile = original_profile
        onboarding_repository.get_kyc_profile = original_kyc


def test_eligibility_reports_every_class_enabled_under_open_access():
    with _open_access(True):
        result = _with_profile(UNONBOARDED, lambda: service.eligibility("u1"))
    assert result.can_trade is True, "eligibility disagreed with assert_can_trade"
    assert len(result.asset_classes) == len(list(AssetClass))
    for row in result.asset_classes:
        assert row.enabled is True, f"{row.asset_class.value} was not reported enabled"
        assert row.pending_review is False
        assert row.reason is None, f"{row.asset_class.value} carried a reason with nothing wrong"
        assert len(row.products) > 0, "the products list should still describe the class"


def test_eligibility_reports_the_real_gaps_under_closed_access():
    with _open_access(False):
        blocked = _with_profile(UNONBOARDED, lambda: service.eligibility("u2"))
        assert blocked.can_trade is False
        assert all(not row.enabled for row in blocked.asset_classes)
        assert all(row.reason for row in blocked.asset_classes), "a blocked account needs a reason"

        partial = _with_profile(QUALIFIED_CRYPTO_ONLY, lambda: service.eligibility("u3"))
        assert partial.can_trade is True
        by_class = {row.asset_class: row for row in partial.asset_classes}
        assert by_class[AssetClass.crypto].enabled is True
        assert by_class[AssetClass.forex].enabled is False
        assert by_class[AssetClass.forex].pending_review is False


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
