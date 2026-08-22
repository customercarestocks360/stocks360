"""Self-check that the funds-request `currency` field only ever accepts the one account
currency (USDT by default) at the *schema* level — not just via a runtime rejection.

Plain asserts, no framework, no database: `python tests/test_account_currency.py` from
`backend/`.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from pydantic import ValidationError  # noqa: E402

from app.core.config import TRADING_ACCOUNT_CURRENCY  # noqa: E402
from app.schemas.funding import DepositRequest  # noqa: E402
from app.schemas.trading import AccountCurrency, FundsRequest  # noqa: E402

assert TRADING_ACCOUNT_CURRENCY == "USDT", (
    f"these checks assume the default account currency; got {TRADING_ACCOUNT_CURRENCY!r}"
)


def _rejected(fn) -> bool:
    try:
        fn()
    except ValidationError:
        return True
    return False


def test_account_currency_enum_has_exactly_one_member():
    assert [c.value for c in AccountCurrency] == ["USDT"], (
        "USD (or anything else) must not be a member of the account currency type"
    )


def test_omitting_currency_defaults_to_the_account_currency():
    req = FundsRequest(amount="100.00", idempotency_key="dep-00001")
    assert req.currency is not None and req.currency.value == "USDT"


def test_usd_is_rejected_by_the_field_itself():
    assert _rejected(
        lambda: FundsRequest(
            amount="100.00", idempotency_key="dep-00002", currency="USD"
        )
    ), "USD must be a 422 from field validation, not merely from app logic"


def test_lowercase_usdt_is_still_accepted():
    req = FundsRequest(amount="100.00", idempotency_key="dep-00003", currency="usdt")
    assert req.currency is not None and req.currency.value == "USDT"


def test_deposit_request_rejects_usd_the_same_way():
    assert _rejected(
        lambda: DepositRequest(
            amount="100.00",
            network="TRC20",
            idempotency_key="dep-00004",
            currency="USD",
            reference="tx-00004",
        )
    )
    deposit = DepositRequest(
        amount="100.00",
        network="TRC20",
        idempotency_key="dep-00005",
        reference="tx-00005",
    )
    assert deposit.currency is not None and deposit.currency.value == "USDT"


def main() -> int:
    tests = [
        value for name, value in sorted(globals().items()) if name.startswith("test_")
    ]
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
