"""Full account lifecycle over the single USDT balance, and the rules that gate an order.

Plain asserts, no framework, no database: `python tests/test_account_lifecycle.py` from
`backend/`.

`test_position_math.py` checks what one fill does to one position. This checks the layer
that spends money: the wallet arithmetic in `money.wallet_delta` / `money.cash_shortfall`
that `service._settle_fill` and `service._fund_cash_leg` run on, driven through complete
lifecycles — open, mark, partially close, close, deposit, withdraw.

The invariant every lifecycle ends on is **conservation**: the account's equity has to equal
what was paid in, less the fees, plus the P&L the price moves earned. Nothing else may
appear. That is the property the old split settlement violated — a leveraged buy locked its
margin and the matching sell credited the full gross proceeds, so a round trip at one
unchanged price left the account richer by most of the notional.
"""

import sys
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.config import (  # noqa: E402
    TRADING_ACCOUNT_CURRENCY,
    TRADING_INITIAL_BALANCE,
    TRADING_LEVERAGE,
    TRADING_PEGGED_CURRENCIES,
    TRADING_SHORT_SELLING_CLASSES,
)
from app.schemas.trading import (  # noqa: E402
    AssetClass,
    HedgeSide,
    OrderRequest,
    OrderSide,
    PositionSide,
)
from app.trading import fx  # noqa: E402
from app.trading.money import (  # noqa: E402
    ZERO,
    apply_fill,
    cash_shortfall,
    fee_for,
    margin_of,
    money,
    notional_of,
    wallet_delta,
)
from app.trading.repository import _position_id  # noqa: E402
from app.trading.service import (  # noqa: E402
    _assert_no_flip,
    _assert_position_leg,
    _assert_short_selling_allowed,
    _direction,
    _net_quantity,
    _reserves_units,
)

BUY, SELL = OrderSide.buy, OrderSide.sell


class Account:
    """A wallet and one position, moved only through the real arithmetic.

    Every mutation here mirrors exactly what `service` does through the repository: the
    reservation, the top-up, the settlement delta, the position increments. Nothing is
    recomputed a second way, so if the formulas are wrong these tests are wrong with them —
    which is the point. What the tests then assert is conservation, which no formula error
    can satisfy by accident.
    """

    def __init__(self, opening: Decimal = TRADING_INITIAL_BALANCE):
        self.available = money(opening)
        self.reserved = ZERO
        self.deposited = money(opening)
        self.withdrawn = ZERO
        self.fees = ZERO
        self.realized = ZERO
        self.went_negative = False
        self.position = {
            "available_quantity": ZERO,
            "reserved_quantity": ZERO,
            "cost_basis": ZERO,
            "cost_basis_quote": ZERO,
            "margin_used": ZERO,
        }

    # --- funding ---
    def deposit(self, amount) -> None:
        amount = money(Decimal(amount))
        self.available = money(self.available + amount)
        self.deposited = money(self.deposited + amount)

    def withdraw(self, amount) -> bool:
        """False when the guard would refuse it, which is what `apply_to_wallet` reports."""
        amount = money(Decimal(amount))
        if amount > self.available:
            return False
        self.available = money(self.available - amount)
        self.withdrawn = money(self.withdrawn + amount)
        return True

    # --- orders ---
    def net(self) -> Decimal:
        return _net_quantity(self.position)

    def place(self, side: OrderSide, quantity, price, rate=Decimal(1)) -> dict:
        """Reserve for an order the way `place_order` + `_reserve_for` do."""
        quantity = money(Decimal(quantity))
        notional = fx.convert(notional_of(quantity, Decimal(price)), rate)
        order = {
            "side": side,
            "quantity": quantity,
            "rate": rate,
            "reserved_amount": ZERO,
            "reserved_quantity": ZERO,
        }
        if _reserves_units(side, self.net()):
            free = self.position["available_quantity"]
            assert quantity <= free, (
                f"cannot reserve {quantity} units, only {free} free"
            )
            self.position["available_quantity"] = money(free - quantity)
            self.position["reserved_quantity"] = money(
                self.position["reserved_quantity"] + quantity
            )
            order["reserved_quantity"] = quantity
        else:
            amount = money(margin_of(notional) + fee_for(notional))
            assert amount <= self.available, (
                f"cannot reserve {amount}, have {self.available}"
            )
            self.available = money(self.available - amount)
            self.reserved = money(self.reserved + amount)
            order["reserved_amount"] = amount
        return order

    def fill(self, order: dict, price) -> dict:
        """Settle an order at `price`, exactly as `_execute_locked` -> `_settle_fill` does."""
        quantity, rate = order["quantity"], order["rate"]
        notional_quote = notional_of(quantity, Decimal(price))
        notional = fx.convert(notional_quote, rate)
        fee = fee_for(notional)
        effect = apply_fill(
            quantity=self.net(),
            cost_basis=self.position["cost_basis"],
            cost_basis_quote=self.position["cost_basis_quote"],
            margin_used=self.position["margin_used"],
            side_sign=1 if order["side"] is BUY else -1,
            fill_quantity=quantity,
            notional=notional,
            notional_quote=notional_quote,
            fee=fee,
            margin=money(margin_of(notional) + fee),
        )

        # `_fund_cash_leg`, for every fill: a leveraged loss can exceed the margin behind it
        # whether the order reserved cash or units.
        shortfall = cash_shortfall(order["reserved_amount"], effect)
        if shortfall > 0:
            if shortfall <= self.available:
                self.available = money(self.available - shortfall)
                self.reserved = money(self.reserved + shortfall)
                order["reserved_amount"] = money(order["reserved_amount"] + shortfall)
            else:
                # Opening on credit is refused; closing into a negative balance is not.
                assert effect.closed_quantity > 0, (
                    f"an opening fill needed {shortfall} beyond its reservation with only "
                    f"{self.available} available — the real path rejects it here"
                )
                self.went_negative = True

        available_delta, reserved_delta = wallet_delta(order["reserved_amount"], effect)
        self.available = money(self.available + available_delta)
        self.reserved = money(self.reserved + reserved_delta)

        # `apply_fill_to_position`, including the reserved/available bookkeeping.
        held = order["reserved_quantity"]
        if held > 0:
            self.position["reserved_quantity"] = money(
                self.position["reserved_quantity"] - held
            )
            self.position["available_quantity"] = money(
                self.position["available_quantity"] + effect.quantity_delta + held
            )
        else:
            self.position["available_quantity"] = money(
                self.position["available_quantity"] + effect.quantity_delta
            )
        for field, delta in (
            ("cost_basis", effect.basis_delta),
            ("cost_basis_quote", effect.basis_quote_delta),
            ("margin_used", effect.margin_delta),
        ):
            self.position[field] = money(self.position[field] + delta)
        if self.net() == 0:
            for field in ("cost_basis", "cost_basis_quote", "margin_used"):
                self.position[field] = ZERO

        self.fees = money(self.fees + fee)
        self.realized = money(self.realized + effect.realized)
        return effect

    def trade(self, side: OrderSide, quantity, price, rate=Decimal(1)) -> dict:
        """Place and immediately fill, which is what a market order does."""
        return self.fill(self.place(side, quantity, price, rate), price)

    # --- reporting, the way `portfolio()` builds it ---
    def cash(self) -> Decimal:
        return money(self.available + self.reserved)

    def unrealized(self, mark, rate=Decimal(1)) -> Decimal:
        exposure = fx.convert(money(self.net() * Decimal(mark)), rate)
        return money(exposure - self.position["cost_basis"])

    def equity(self, mark=None, rate=Decimal(1)) -> Decimal:
        pnl = (
            self.unrealized(mark, rate)
            if mark is not None and self.net() != 0
            else ZERO
        )
        return money(self.cash() + self.position["margin_used"] + pnl)

    def assert_conserved(self, mark=None, rate=Decimal(1)) -> None:
        """Equity must be exactly paid-in plus P&L. Nothing may appear from nowhere.

        No separate fee term, and that is not an omission: a commission is already inside
        both P&L figures. `realized` is proceeds less a fee-bearing cost basis less the exit
        fee, and an open position's `cost_basis` carries its entry fee, so `unrealized`
        starts life negative by that fee. Subtracting `fees` here as well would count every
        commission twice.
        """
        pnl = (
            self.unrealized(mark, rate)
            if mark is not None and self.net() != 0
            else ZERO
        )
        paid_in = money(self.deposited - self.withdrawn)
        expected = money(paid_in + self.realized + pnl)
        actual = self.equity(mark, rate)
        assert actual == expected, (
            f"equity {actual} != paid-in {paid_in} + realized {self.realized} + unrealized "
            f"{pnl} = {expected}"
        )
        # A closing fill is allowed to overdraw the balance rather than leave a losing
        # position open — but only then, and the flag records that it happened.
        if not self.went_negative:
            assert self.available >= 0, f"available went negative: {self.available}"
        assert self.reserved >= 0, f"reserved went negative: {self.reserved}"
        assert self.position["reserved_quantity"] >= 0, "reserved units went negative"
        assert self.position["margin_used"] >= 0, "margin_used went negative"


# --------------------------------------------------------------------------- #
# The rules that gate an order
# --------------------------------------------------------------------------- #
def test_only_a_sell_against_a_long_reserves_units():
    assert _reserves_units(SELL, Decimal("5")) is True, (
        "selling a long must lock the stock"
    )
    assert _reserves_units(SELL, ZERO) is False, "opening a short has no units to lock"
    assert _reserves_units(SELL, Decimal("-5")) is False, "extending a short locks cash"
    assert _reserves_units(BUY, Decimal("5")) is False
    assert _reserves_units(BUY, ZERO) is False
    assert _reserves_units(BUY, Decimal("-5")) is False, (
        "closing a short needs cash, not units"
    )


def test_direction_reads_off_the_sign():
    assert _direction(Decimal("0.5")) is PositionSide.long
    assert _direction(Decimal("-0.5")) is PositionSide.short
    assert _direction(ZERO) is PositionSide.flat


def test_net_quantity_adds_reserved_to_signed_available():
    assert _net_quantity(None) == 0
    long_with_resting_sell = {
        "available_quantity": Decimal("3"),
        "reserved_quantity": Decimal("2"),
    }
    assert _net_quantity(long_with_resting_sell) == Decimal("5")
    short = {"available_quantity": Decimal("-4"), "reserved_quantity": ZERO}
    assert _net_quantity(short) == Decimal("-4")


def test_shorting_is_allowed_where_configured_and_refused_elsewhere():
    for asset_class in AssetClass:
        allowed = asset_class.value in TRADING_SHORT_SELLING_CLASSES
        try:
            _assert_short_selling_allowed(asset_class, "X", ZERO)
        except Exception as error:
            assert not allowed, f"{asset_class.value} should permit shorting: {error}"
            assert "borrow" in str(error.detail), "the refusal should say why"
        else:
            assert allowed, f"{asset_class.value} should not permit shorting"
    assert {"crypto", "forex", "stocks"} <= TRADING_SHORT_SELLING_CLASSES


def test_an_order_through_zero_is_refused_and_one_up_to_zero_is_not():
    _assert_no_flip(SELL, Decimal("5"), Decimal("5"), "X")  # exact close
    _assert_no_flip(SELL, Decimal("3"), Decimal("5"), "X")  # partial close
    _assert_no_flip(SELL, Decimal("5"), ZERO, "X")  # open a short
    _assert_no_flip(SELL, Decimal("5"), Decimal("-2"), "X")  # extend a short
    _assert_no_flip(BUY, Decimal("5"), Decimal("-5"), "X")  # exact close of a short
    _assert_no_flip(BUY, Decimal("9"), Decimal("2"), "X")  # extend a long

    for side, quantity, net in (
        (SELL, Decimal("6"), Decimal("5")),
        (BUY, Decimal("6"), Decimal("-5")),
    ):
        try:
            _assert_no_flip(side, quantity, net, "X")
        except Exception as error:
            assert "through zero" in str(error.detail)
        else:
            raise AssertionError(
                f"{side.value} {quantity} against {net} should have been refused"
            )


def test_hedge_legs_open_and_close_independently():
    long_id = _position_id("user", "stocks", "AAPL", "long")
    short_id = _position_id("user", "stocks", "AAPL", "short")
    assert long_id != short_id

    long_open = OrderRequest(
        asset_class=AssetClass.stocks,
        symbol="AAPL",
        side=BUY,
        position_side=HedgeSide.long,
        quantity="2",
    )
    short_open = OrderRequest(
        asset_class=AssetClass.stocks,
        symbol="AAPL",
        side=SELL,
        position_side=HedgeSide.short,
        quantity="3",
    )
    _assert_position_leg(long_open, ZERO)
    _assert_position_leg(short_open, ZERO)

    long_close = long_open.model_copy(update={"side": SELL, "quantity": Decimal("2")})
    short_close = short_open.model_copy(update={"side": BUY, "quantity": Decimal("3")})
    _assert_position_leg(long_close, Decimal("2"))
    _assert_position_leg(short_close, Decimal("-3"))

    for payload, net in (
        (long_close.model_copy(update={"quantity": Decimal("3")}), Decimal("2")),
        (short_close.model_copy(update={"quantity": Decimal("4")}), Decimal("-3")),
    ):
        try:
            _assert_position_leg(payload, net)
        except Exception as error:
            assert "leg only has" in str(error.detail)
        else:
            raise AssertionError("a hedge close larger than its own leg was accepted")


def test_overselling_any_enabled_class_hits_the_flip_guard():
    """All default desks support shorts, but a single netting order still cannot cross zero."""
    stocks, crypto = AssetClass.stocks, AssetClass.crypto
    held, wanted = Decimal("5"), Decimal("10")

    # The gate order `place_order` uses.
    def gates(asset_class, quantity, net):
        if quantity > max(net, ZERO):
            _assert_short_selling_allowed(asset_class, "X", net)
        _assert_no_flip(SELL, quantity, net, "X")

    for asset_class in (stocks, crypto):
        try:
            gates(asset_class, wanted, held)
        except Exception as error:
            assert "through zero" in str(error.detail), f"wrong refusal: {error.detail}"
        else:
            raise AssertionError(f"a {asset_class.value} position flip was allowed")

    # Selling exactly what is held is a plain close on both.
    gates(stocks, held, held)
    gates(crypto, held, held)


def test_pegged_currencies_convert_one_to_one():
    assert TRADING_ACCOUNT_CURRENCY in TRADING_PEGGED_CURRENCIES
    for currency in TRADING_PEGGED_CURRENCIES:
        assert fx.cached_rate(currency) == 1, (
            f"{currency} should be 1:1 with the account"
        )
    assert fx.cached_rate("") is None
    assert fx.convert(Decimal("100"), Decimal("0.012")) == Decimal("1.2")
    assert fx.unconvert(Decimal("1.2"), Decimal("0.012")) == Decimal("100")
    assert fx.unconvert(Decimal("5"), ZERO) == Decimal("5"), (
        "a zero rate must not divide"
    )


# --------------------------------------------------------------------------- #
# Lifecycles
# --------------------------------------------------------------------------- #
def test_a_new_account_opens_with_the_configured_balance():
    account = Account()
    assert account.available == TRADING_INITIAL_BALANCE
    assert TRADING_INITIAL_BALANCE == Decimal("1000"), "the brief says 1000 to start"
    account.assert_conserved()


def test_long_round_trip_at_one_price_costs_only_the_fees():
    """The regression that matters: this used to end richer than it started."""
    account = Account()
    opening = account.available
    account.trade(BUY, "1", "100")
    account.trade(SELL, "1", "100")
    assert account.available < opening, "a flat round trip did not cost anything"
    assert account.available == money(opening - account.fees), (
        f"flat round trip moved {opening - account.available}, fees were {account.fees}"
    )
    assert account.net() == 0 and account.position["margin_used"] == 0
    account.assert_conserved()


def test_short_round_trip_at_one_price_costs_only_the_fees():
    account = Account()
    opening = account.available
    account.trade(SELL, "1", "100")
    assert account.net() < 0 and _direction(account.net()) is PositionSide.short
    account.trade(BUY, "1", "100")
    assert account.available == money(opening - account.fees)
    account.assert_conserved()


def test_a_winning_long_pays_out_the_move():
    account = Account()
    opening = account.available
    account.trade(BUY, "2", "50")
    account.assert_conserved(mark="55")
    assert account.unrealized("55") > 0, "a long did not gain on a rally"
    account.trade(SELL, "2", "55")
    gross = money((Decimal("55") - Decimal("50")) * 2)
    assert account.available == money(opening + gross - account.fees)
    account.assert_conserved()


def test_a_losing_long_gives_back_the_move():
    account = Account()
    opening = account.available
    account.trade(BUY, "2", "50")
    assert account.unrealized("45") < 0
    account.trade(SELL, "2", "45")
    gross = money((Decimal("45") - Decimal("50")) * 2)
    assert account.available == money(opening + gross - account.fees)
    account.assert_conserved()


def test_a_winning_short_pays_out_the_fall():
    account = Account()
    opening = account.available
    account.trade(SELL, "2", "50")
    assert account.unrealized("45") > 0, "a short did not gain on a fall"
    account.trade(BUY, "2", "45")
    gross = money((Decimal("50") - Decimal("45")) * 2)
    assert account.available == money(opening + gross - account.fees)
    account.assert_conserved()


def test_a_losing_short_gives_back_the_rally():
    account = Account()
    opening = account.available
    account.trade(SELL, "2", "50")
    assert account.unrealized("58") < 0
    account.trade(BUY, "2", "58")
    gross = money((Decimal("50") - Decimal("58")) * 2)
    assert account.available == money(opening + gross - account.fees)
    account.assert_conserved()


def test_a_resting_sell_locks_the_stock_and_settles_out_of_it():
    account = Account()
    account.trade(BUY, "4", "20")
    order = account.place(SELL, "3", "25")
    assert order["reserved_quantity"] == Decimal("3") and order["reserved_amount"] == 0
    assert account.position["available_quantity"] == Decimal("1"), (
        "units were not locked"
    )
    assert account.net() == Decimal("4"), "locking units changed the position size"

    # The locked units cannot be sold a second time while that order rests.
    try:
        account.place(SELL, "2", "25")
    except AssertionError:
        pass
    else:
        raise AssertionError("the same units were reserved twice")

    account.fill(order, "25")
    assert account.net() == Decimal("1")
    assert account.position["reserved_quantity"] == 0
    assert account.position["available_quantity"] == Decimal("1")
    account.assert_conserved(mark="25")


def test_partial_closes_walk_a_position_down_to_flat():
    account = Account()
    opening = account.available
    account.trade(BUY, "10", "20")
    for _ in range(4):
        account.trade(SELL, "2.5", "20")
        account.assert_conserved(mark="20")
    assert account.net() == 0
    assert account.position["cost_basis"] == 0 and account.position["margin_used"] == 0
    assert account.available == money(opening - account.fees), (
        "partial exits leaked value"
    )


def test_adding_to_a_position_then_closing_it_all():
    account = Account()
    opening = account.available
    account.trade(BUY, "1", "100")
    account.trade(BUY, "1", "120")
    assert account.net() == Decimal("2")
    account.assert_conserved(mark="120")
    account.trade(SELL, "2", "110")
    # In at 100 and 120, out at 110 twice: the two halves cancel.
    assert account.available == money(opening - account.fees)
    account.assert_conserved()


def test_leverage_changes_the_cash_locked_and_not_the_outcome():
    account = Account()
    notional = notional_of(Decimal("1"), Decimal("100"))
    order = account.place(BUY, "1", "100")
    if TRADING_LEVERAGE > 1:
        assert order["reserved_amount"] < notional, "an open locked the full notional"
    assert order["reserved_amount"] == money(margin_of(notional) + fee_for(notional))
    account.fill(order, "100")
    assert account.position["margin_used"] == order["reserved_amount"]
    account.trade(SELL, "1", "110")
    assert account.realized == money(
        Decimal("10")
        - fee_for(notional)
        - fee_for(notional_of(Decimal("1"), Decimal("110")))
    ), "leverage changed the realized P&L"
    account.assert_conserved()


def test_an_inr_priced_instrument_settles_in_the_account_currency():
    """The whole point of one balance: a Mumbai listing funded by the same USDT as Bitcoin."""
    account = Account()
    opening = account.available
    rate = Decimal("0.012")  # ~83 INR to the dollar
    account.trade(BUY, "10", "2400", rate)

    # The cash that moved is the converted figure, not the rupee one.
    assert account.position["cost_basis"] < Decimal("500"), (
        "an INR notional was not converted"
    )
    assert account.position["cost_basis_quote"] == Decimal("24000"), (
        "quote basis was converted"
    )
    # `average_price` is reported off the quote basis, so it matches the screen.
    assert money(account.position["cost_basis_quote"] / account.net()) == Decimal(
        "2400"
    )

    account.assert_conserved(mark="2400", rate=rate)
    account.trade(SELL, "10", "2500", rate)
    gross = fx.convert(money((Decimal("2500") - Decimal("2400")) * 10), rate)
    assert account.available == money(opening + gross - account.fees)
    account.assert_conserved()


def test_a_gapped_stop_tops_up_from_available_rather_than_filling_on_credit():
    account = Account()
    # Reserved at the stop, filled well past it: the margin owed is larger than reserved.
    order = account.place(BUY, "1", "100")
    reserved_at_stop = order["reserved_amount"]
    account.fill(order, "140")
    assert order["reserved_amount"] > reserved_at_stop, "the gap was not topped up"
    account.assert_conserved(mark="140")


def test_a_leveraged_loss_deeper_than_its_margin_comes_out_of_cash():
    """The hole the lifecycle harness found: a sell reserves *units*, so it looks as though
    it needs no funding — but at 200x the position can lose far more than the margin behind
    it, and the difference has to leave the balance rather than being conjured."""
    account = Account()
    account.trade(BUY, "2", "50")
    margin = account.position["margin_used"]
    before = account.available

    account.trade(SELL, "2", "45")  # a 10.00 gross loss against ~0.6 of margin
    assert account.realized < -margin, "the loss did not exceed the margin posted"
    assert account.available < before, (
        "a loss beyond the margin did not touch the balance"
    )
    assert account.available == money(before + margin + account.realized)
    account.assert_conserved()


def test_a_loss_bigger_than_the_account_closes_anyway_into_a_negative_balance():
    """Refusing to close would leave the user holding something that only gets worse, so the
    balance is allowed to go under. It is contained: every reservation and every withdrawal
    guards on available cash, so nothing can be traded or paid out of a negative balance."""
    account = Account(opening=Decimal("50"))
    account.trade(BUY, "10", "100")  # 1000 notional on 50 of cash, via leverage
    account.trade(SELL, "10", "20")  # an 800 gross loss

    assert account.went_negative, "the account absorbed a loss it could not afford"
    assert account.available < 0
    account.assert_conserved()
    # And it is a dead end, not a licence: nothing more can be opened.
    try:
        account.place(BUY, "1", "10")
    except AssertionError:
        pass
    else:
        raise AssertionError("an order was reserved against a negative balance")
    assert account.withdraw("1") is False, "withdrew out of a negative balance"


def test_an_opening_fill_that_gaps_past_the_balance_is_refused_not_funded():
    account = Account(opening=Decimal("1"))
    order = account.place(BUY, "1", "100")  # margin ~0.6 of a 1.00 balance: fits
    try:
        account.fill(order, "10000")  # gapped 100x: the margin owed is ~50
    except AssertionError as error:
        assert "opening fill" in str(error), error
    else:
        raise AssertionError("an opening fill was funded on credit")


def test_deposit_and_withdraw_move_the_one_balance():
    account = Account()
    opening = account.available
    account.deposit("500")
    assert account.available == money(opening + 500)
    assert account.withdraw("200") is True
    assert account.available == money(opening + 300)
    account.assert_conserved()

    # Cash locked by a resting order is not available to withdraw.
    account.place(BUY, "5", "100")
    locked = account.reserved
    assert locked > 0
    assert account.withdraw(money(account.available + 1)) is False, (
        "withdrew more than available"
    )
    account.assert_conserved()


def test_withdrawing_everything_leaves_a_flat_but_valid_account():
    account = Account()
    assert account.withdraw(account.available) is True
    assert account.available == 0
    account.assert_conserved()
    # And nothing can be opened against nothing.
    try:
        account.place(BUY, "1", "100")
    except AssertionError:
        pass
    else:
        raise AssertionError("an order was reserved against an empty balance")


def test_a_full_session_of_wins_losses_and_both_directions():
    """One account, every step the brief names, ending on conservation."""
    account = Account()
    account.deposit("1000")

    account.trade(BUY, "1", "100")  # long
    account.trade(SELL, "1", "120")  # win
    account.trade(BUY, "2", "50")  # long again
    account.trade(SELL, "2", "45")  # loss
    account.trade(SELL, "3", "30")  # open a short
    account.assert_conserved(mark="28")
    account.trade(BUY, "1", "28")  # partial close, in profit
    account.assert_conserved(mark="33")
    account.trade(BUY, "2", "33")  # close the rest, at a loss
    assert account.net() == 0

    resting = account.place(BUY, "1", "10")  # something still open
    assert account.reserved > 0
    account.fill(resting, "10")
    account.trade(SELL, "1", "10")

    assert account.withdraw("100") is True
    account.assert_conserved()
    assert account.net() == 0 and account.reserved == 0
    assert account.position["margin_used"] == 0 and account.position["cost_basis"] == 0
    assert account.realized != 0, "a session of six round trips realized nothing"


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
