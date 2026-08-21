"""Invariants that must hold or the numbers in this package are worthless.

Runs under pytest, and also standalone with `python tests/test_sim.py` so there is
nothing to install before checking that the money paths still add up.
"""

import sys
from decimal import Decimal
from pathlib import Path
from random import Random

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from usdt_sim import Exchange, InsufficientFunds, InvalidAddress, OrderRejected  # noqa: E402
from usdt_sim import wallet as wallet_module  # noqa: E402
from usdt_sim.chain import new_address, validate_address  # noqa: E402
from usdt_sim.models import DepositStatus, OrderStatus, WithdrawalStatus  # noqa: E402
from usdt_sim.money import fee_of  # noqa: E402
from usdt_sim.prices import normalise_symbol  # noqa: E402


def funded(amount="1000", seed=1) -> Exchange:
    exchange = Exchange(seed=seed)
    exchange.deposit(amount)
    return exchange


def assert_books_balance(exchange: Exchange) -> None:
    """Equity must equal capital in plus P/L. Every test ends with this."""
    portfolio = exchange.portfolio()
    assert portfolio.equity_usdt == portfolio.net_deposited_usdt + portfolio.total_pnl_usdt
    assert portfolio.cash_usdt == exchange.wallet.available_usdt + exchange.wallet.locked_usdt
    assert exchange.wallet.available_usdt >= 0 and exchange.wallet.locked_usdt >= 0
    # Realized P/L is the sum of what the sell fills booked, nothing else.
    booked = sum(t.realized_pnl_usdt for t in exchange.trades() if t.realized_pnl_usdt is not None)
    assert portfolio.realized_pnl_usdt == (booked or Decimal(0))


def test_deposit_credits_only_after_confirmations():
    exchange = Exchange(seed=2)
    deposit = exchange.deposit("500", auto_confirm=False)
    assert deposit.status is DepositStatus.PENDING
    assert exchange.balance().available_balance_usdt == 0

    exchange.confirm_deposit(deposit.tx_hash, blocks=deposit.required_confirmations - 1)
    assert deposit.status is DepositStatus.PENDING, "credited one block early"
    assert exchange.balance().available_balance_usdt == 0

    exchange.confirm_deposit(deposit.tx_hash, blocks=1)
    assert deposit.status is DepositStatus.CREDITED
    assert exchange.balance().available_balance_usdt == Decimal("500")

    # The bug that costs real money: confirming again must not credit again.
    exchange.confirm_deposit(deposit.tx_hash, blocks=50)
    assert exchange.balance().available_balance_usdt == Decimal("500")
    assert exchange.balance().total_deposited_usdt == Decimal("500")
    assert_books_balance(exchange)


def test_round_trip_realizes_pnl_net_of_both_fees():
    exchange = funded()
    buy = exchange.place_order("BTC/USDT", "buy", quote_amount="400")
    position = exchange.engine.positions["BTC/USDT"]
    entry = buy.fills[0]
    # Cost basis carries the entry fee, so avg entry is the real break-even.
    assert position.cost_basis_usdt == entry.notional_usdt + entry.fee_usdt

    exchange.feed.shock("BTC/USDT", "10")
    sell = exchange.close_position("BTC/USDT")
    exit_fill = sell.fills[0]
    expected = exit_fill.notional_usdt - exit_fill.fee_usdt - (entry.notional_usdt + entry.fee_usdt)
    assert exit_fill.realized_pnl_usdt == expected
    assert exit_fill.realized_pnl_usdt > 0
    assert exchange.engine.positions["BTC/USDT"].quantity == 0
    assert exchange.engine.positions["BTC/USDT"].cost_basis_usdt == 0
    assert exchange.positions() == [], "a flat position should not be reported as open"
    assert_books_balance(exchange)


def test_losing_trade_realizes_a_loss():
    exchange = funded()
    exchange.place_order("ETH/USDT", "buy", quote_amount="300")
    exchange.feed.shock("ETH/USDT", "-10")
    assert exchange.positions()[0].unrealized_pnl_usdt < 0
    sell = exchange.close_position("ETH/USDT")
    assert sell.fills[0].realized_pnl_usdt < 0
    assert exchange.portfolio().total_pnl_usdt < 0
    assert_books_balance(exchange)


def test_partial_close_leaves_proportional_basis():
    exchange = funded()
    exchange.place_order("BTC/USDT", "buy", quantity="0.010")
    basis = exchange.engine.positions["BTC/USDT"].cost_basis_usdt
    entry_price = exchange.engine.positions["BTC/USDT"].avg_entry_price
    exchange.close_position("BTC/USDT", quantity="0.004")
    position = exchange.engine.positions["BTC/USDT"]
    assert position.quantity == Decimal("0.006")
    assert position.cost_basis_usdt < basis
    # Selling part of a position must not move the entry price of what is left. The
    # basis is stored at the 6dp USDT scale, so one quantum of it spread over the
    # remaining quantity is the tightest bound this can honestly claim.
    tolerance = Decimal("0.000001") / position.quantity
    assert abs(position.avg_entry_price - entry_price) <= tolerance
    assert_books_balance(exchange)


def test_no_short_selling_and_no_overspending():
    exchange = funded("100")
    try:
        exchange.place_order("BTC/USDT", "sell", "0.001")
        raise AssertionError("sold BTC we never bought")
    except OrderRejected:
        pass
    try:
        exchange.place_order("BTC/USDT", "buy", "1")
        raise AssertionError("spent more USDT than the balance")
    except InsufficientFunds:
        pass
    try:
        exchange.place_order("BTC/USDT", "buy", "0.000001")
        raise AssertionError("accepted an order below the minimum size")
    except OrderRejected:
        pass
    assert exchange.balance().available_balance_usdt == Decimal("100")
    assert [o.status for o in exchange.orders()] == [OrderStatus.REJECTED] * 3
    assert len(exchange.history("order.rejected")) == 3
    assert_books_balance(exchange)


def test_resting_limit_buy_locks_then_settles_exactly():
    exchange = funded()
    before = exchange.balance().available_balance_usdt
    order = exchange.place_order(
        "BTC/USDT", "buy", quantity="0.005", order_type="limit", limit_price="60000"
    )
    assert order.status is OrderStatus.OPEN
    assert exchange.balance().locked_balance_usdt == order.locked_usdt
    assert exchange.balance().available_balance_usdt == before - order.locked_usdt

    exchange.feed.shock("BTC/USDT", "-10")  # market trades through the bid
    filled = exchange.tick(1)
    assert [o.id for o in filled] == [order.id]
    assert order.status is OrderStatus.FILLED
    assert order.avg_fill_price == Decimal("60000"), "a maker fill happens at the limit price"
    assert order.fills[0].slippage_bps == 0
    assert exchange.balance().locked_balance_usdt == 0, "reservation not fully released"
    # Maker fee is cheaper than the taker fee the same notional would have paid.
    assert order.fee_usdt < fee_of(order.fills[0].notional_usdt, 10)
    assert_books_balance(exchange)


def test_cancel_refunds_the_reservation_and_unlocks_inventory():
    exchange = funded()
    before = exchange.balance().available_balance_usdt
    buy = exchange.place_order(
        "BTC/USDT", "buy", quantity="0.005", order_type="limit", limit_price="50000"
    )
    exchange.cancel_order(buy.id)
    assert exchange.balance().available_balance_usdt == before
    assert exchange.balance().locked_balance_usdt == 0

    exchange.place_order("BTC/USDT", "buy", quantity="0.005")
    sell = exchange.close_position("BTC/USDT", order_type="limit", limit_price="999999")
    assert exchange.engine.positions["BTC/USDT"].locked_quantity == Decimal("0.005")
    try:
        exchange.place_order("BTC/USDT", "sell", "0.005")
        raise AssertionError("sold inventory that a resting order had reserved")
    except OrderRejected:
        pass
    exchange.cancel_order(sell.id)
    assert exchange.engine.positions["BTC/USDT"].locked_quantity == 0
    exchange.close_position("BTC/USDT")  # now sellable again
    assert_books_balance(exchange)


def test_withdrawal_locks_then_settles():
    exchange = funded()
    destination = new_address("TRC20", Random(5))
    before = exchange.balance().available_balance_usdt
    withdrawal = exchange.withdraw(destination, "200")
    total = withdrawal.amount_usdt + withdrawal.fee_usdt
    assert exchange.balance().locked_balance_usdt == total
    assert exchange.balance().available_balance_usdt == before - total

    exchange.process_withdrawals(until_settled=True)
    settled = exchange.withdrawals()[0]
    assert settled.status is WithdrawalStatus.COMPLETED
    assert settled.tx_hash
    assert exchange.balance().locked_balance_usdt == 0
    assert exchange.balance().available_balance_usdt == before - total
    assert exchange.balance().total_withdrawn_usdt == Decimal("200")
    assert_books_balance(exchange)


def test_failed_withdrawal_returns_every_cent():
    exchange = funded()
    original_rate = wallet_module.WITHDRAWAL_FAILURE_RATE
    wallet_module.WITHDRAWAL_FAILURE_RATE = 1.0
    try:
        before = exchange.balance().available_balance_usdt
        exchange.withdraw(new_address("ERC20", Random(6)), "300")
        exchange.process_withdrawals(until_settled=True)
        failed = exchange.withdrawals()[0]
        assert failed.status is WithdrawalStatus.FAILED
        assert failed.failure_reason
        assert exchange.balance().available_balance_usdt == before, "refund was short"
        assert exchange.balance().locked_balance_usdt == 0
        assert exchange.balance().total_withdrawn_usdt == 0
    finally:
        wallet_module.WITHDRAWAL_FAILURE_RATE = original_rate
    assert_books_balance(exchange)


def test_withdrawal_needs_a_valid_address_and_funds():
    exchange = funded("50")
    good = new_address("TRC20", Random(7))
    for bad in (good[:-1] + ("Z" if good[-1] != "Z" else "Y"), good[:20], "0xdeadbeef", ""):
        try:
            exchange.withdraw(bad, "20")
            raise AssertionError(f"accepted the invalid address {bad!r}")
        except InvalidAddress:
            pass
    try:
        exchange.withdraw(good, "10000")
        raise AssertionError("withdrew more than the balance")
    except InsufficientFunds:
        pass
    assert exchange.balance().available_balance_usdt == Decimal("50")
    assert len(exchange.history("error")) == 5


def test_generated_addresses_validate_and_typos_do_not():
    for chain in ("TRC20", "ERC20"):
        for seed in range(25):
            address = new_address(chain, Random(seed))
            canonical = address.lower() if chain == "ERC20" else address
            assert validate_address(address) == (chain, canonical)
    trc = new_address("TRC20", Random(99))
    for index in (1, 10, 33):
        swapped = "A" if trc[index] != "A" else "B"
        typo = trc[:index] + swapped + trc[index + 1 :]
        try:
            validate_address(typo)
            raise AssertionError(f"base58check accepted a typo at index {index}")
        except InvalidAddress:
            pass


def test_fees_round_up_and_symbols_normalise():
    # A fee that rounds down is the venue paying the user to trade.
    assert fee_of(Decimal("0.0000001"), 10) == Decimal("0.000001")
    assert fee_of(Decimal("1000"), 10) == Decimal("1")
    for spelling in ("BTC/USDT", "USDT/BTC", "btcusdt", "btc", "BTC-USDT"):
        assert normalise_symbol(spelling) == "BTC/USDT"


def test_market_orders_pay_the_spread_and_size_impact():
    exchange = funded("100000")
    small = exchange.place_order("BTC/USDT", "buy", quantity="0.001").fills[0]
    big = exchange.place_order("BTC/USDT", "buy", quantity="0.5").fills[0]
    assert small.slippage_bps > 0, "a market buy must cross the spread"
    assert big.slippage_bps > small.slippage_bps, "size must cost more"
    assert big.price > small.price
    assert_books_balance(exchange)


def test_audit_trail_covers_every_movement():
    exchange = funded()
    exchange.place_order("BTC/USDT", "buy", quote_amount="100")
    exchange.close_position("BTC/USDT")
    exchange.withdraw(new_address("TRC20", Random(8)), "50")
    exchange.process_withdrawals(until_settled=True)
    types = [event.type for event in exchange.history()]
    for expected in (
        "exchange.started",
        "deposit.detected",
        "deposit.credited",
        "order.filled",
        "withdrawal.requested",
        "withdrawal.processing",
    ):
        assert expected in types, f"{expected} missing from the audit trail"
    assert types[-1] in ("withdrawal.completed", "withdrawal.failed")
    assert [event.seq for event in exchange.history()] == list(range(1, len(types) + 1))
    assert all(event.type.startswith("deposit") for event in exchange.history("deposit"))
    assert len(exchange.history(limit=3)) == 3


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
