"""End-to-end walkthrough: fund 1000 USDT, trade it, withdraw the profit.

Run it:  python example.py

Deterministic: the exchange and the destination wallet are both seeded, so the numbers
below are the same on every run. The `feed.shock(...)` calls are the only nudges -- they
stand in for news events, and they exist so the run always contains one clear winner and
one clear loser instead of whatever a random walk felt like doing that day.
"""

from decimal import ROUND_DOWN, Decimal
from random import Random

from usdt_sim import Exchange
from usdt_sim.chain import new_address
from usdt_sim.config import MIN_WITHDRAWAL_USDT
from usdt_sim.models import WithdrawalStatus

TARGET_USDT = Decimal("1000")
# The user's own wallet, somewhere off this exchange. Seeded so it is stable.
EXTERNAL_WALLET = new_address("TRC20", Random(20260821))


def rule(title: str) -> None:
    print(f"\n{'=' * 78}\n{title}\n{'=' * 78}")


def money(value: Decimal, places: int = 2) -> str:
    return f"{value:>12,.{places}f}"


def show_balance(exchange: Exchange, label: str = "balance") -> None:
    balance = exchange.balance()
    print(
        f"{label:<22} available {money(balance.available_balance_usdt)} USDT"
        f" | locked {money(balance.locked_balance_usdt)} USDT"
        f" | deposited {money(balance.total_deposited_usdt)}"
        f" | withdrawn {money(balance.total_withdrawn_usdt)}"
    )


def show_positions(exchange: Exchange) -> None:
    positions = exchange.positions()
    if not positions:
        print("no open positions")
        return
    print(f"{'symbol':<10}{'qty':>14}{'entry':>13}{'mark':>13}"
          f"{'value':>13}{'unreal P/L':>14}{'%':>8}")
    for position in positions:
        print(
            f"{position.symbol:<10}{position.quantity:>14.8f}{position.avg_entry_price:>13,.2f}"
            f"{position.mark_price:>13,.2f}{position.market_value_usdt:>13,.2f}"
            f"{position.unrealized_pnl_usdt:>+14,.2f}{position.unrealized_pnl_pct:>+8.2f}"
        )


def main() -> None:
    exchange = Exchange(seed=42)

    # --- 1. deposit ---------------------------------------------------------
    rule("1. DEPOSIT -- get an address, scan the QR, send USDT")
    details = exchange.deposit_qr("TRC20")
    print(f"send USDT ({details['chain']}) to: {details['address']}")
    print(f"minimum {details['min_deposit_usdt']} USDT, credited after "
          f"{details['required_confirmations']} confirmations")
    print(exchange.qr_terminal("TRC20"))
    print(f"same QR as an inline SVG for a web UI: {details['qr_svg_data_uri'][:52]}... "
          f"({len(details['qr_svg_data_uri'])} chars)")

    print("\n-- first transfer: 400 USDT, watched through its confirmations")
    pending = exchange.deposit(Decimal("400"), auto_confirm=False)
    print(f"tx {pending.tx_hash}  status={pending.status.value}  "
          f"{pending.confirmations}/{pending.required_confirmations} confirmations")
    for _ in range(2):
        deposit = exchange.confirm_deposit(pending.tx_hash, blocks=10)
        print(f"   -> {deposit.confirmations}/{deposit.required_confirmations} "
              f"confirmations, status={deposit.status.value}")
    show_balance(exchange, "after first deposit")

    print("\n-- second transfer: the remaining 600 USDT, auto-confirmed")
    exchange.deposit(TARGET_USDT - Decimal("400"))
    show_balance(exchange, "funded")

    # --- 2. a winning market trade -----------------------------------------
    rule("2. TRADE ONE -- market buy BTC, ride it up, market close")
    btc = exchange.place_order("BTC/USDT", "buy", quote_amount="400")
    fill = btc.fills[0]
    print(f"{btc.id} {btc.side.value:<4} {fill.quantity} BTC @ {fill.price:,.2f} "
          f"({fill.liquidity.value}, slippage {fill.slippage_bps} bps, fee {fill.fee_usdt} USDT)")
    print("news: BTC +5%")
    exchange.feed.shock("BTC/USDT", "5")
    exchange.tick(3)
    show_positions(exchange)
    closed = exchange.close_position("BTC/USDT")
    print(f"closed at {closed.avg_fill_price:,.2f} -> "
          f"realized {closed.fills[0].realized_pnl_usdt:+,.6f} USDT")
    show_balance(exchange, "after trade one")

    # --- 3. a losing market trade ------------------------------------------
    rule("3. TRADE TWO -- market buy ETH, it drops, cut the loss")
    eth = exchange.place_order("USDT/ETH", "buy", quote_amount="250")  # USDT/ETH normalises
    fill = eth.fills[0]
    print(f"{eth.id} {eth.side.value:<4} {fill.quantity} ETH @ {fill.price:,.2f} "
          f"({fill.liquidity.value}, slippage {fill.slippage_bps} bps, fee {fill.fee_usdt} USDT)")
    print("news: ETH -4%")
    exchange.feed.shock("ETH/USDT", "-4")
    exchange.tick(3)
    show_positions(exchange)
    closed = exchange.close_position("ETH/USDT")
    print(f"closed at {closed.avg_fill_price:,.2f} -> "
          f"realized {closed.fills[0].realized_pnl_usdt:+,.6f} USDT")
    show_balance(exchange, "after trade two")

    # --- 4. limit orders, both sides ---------------------------------------
    rule("4. TRADE THREE -- rest a limit buy under the market, close with a limit sell")
    bid = exchange.feed.bid("BTC/USDT")
    entry = (bid * Decimal("0.97")).quantize(Decimal("0.01"))
    resting = exchange.place_order("BTC/USDT", "buy", quantity="0.005", order_type="limit",
                                   limit_price=entry)
    print(f"{resting.id} resting: buy 0.005 BTC @ {entry:,.2f} (market bid {bid:,.2f}), "
          f"{resting.locked_usdt} USDT locked")
    show_balance(exchange, "with order resting")
    print("news: BTC -4%, the market trades through our bid")
    exchange.feed.shock("BTC/USDT", "-4")
    for order in exchange.tick(1):
        print(f"   -> {order.id} filled @ {order.avg_fill_price:,.2f} as "
              f"{order.fills[-1].liquidity.value}, fee {order.fee_usdt} USDT (no slippage)")

    exit_price = (exchange.feed.ask("BTC/USDT") * Decimal("1.03")).quantize(Decimal("0.01"))
    take_profit = exchange.close_position("BTC/USDT", order_type="limit", limit_price=exit_price)
    print(f"{take_profit.id} take-profit resting: sell @ {exit_price:,.2f}, "
          f"{take_profit.locked_quantity} BTC locked in the position")
    print("news: BTC +6%")
    exchange.feed.shock("BTC/USDT", "6")
    for order in exchange.tick(1):
        print(f"   -> {order.id} filled @ {order.avg_fill_price:,.2f} as "
              f"{order.fills[-1].liquidity.value} -> realized "
              f"{order.fills[-1].realized_pnl_usdt:+,.6f} USDT")
    show_balance(exchange, "after trade three")

    # --- 5. an order that should be refused --------------------------------
    rule("5. GUARDRAILS -- the engine says no")
    for description, call in (
        ("sell BTC we do not hold", lambda: exchange.place_order("BTC/USDT", "sell", "0.01")),
        ("buy more than the balance", lambda: exchange.place_order("BTC/USDT", "buy", "10")),
        ("dust order below the minimum",
         lambda: exchange.place_order("BTC/USDT", "buy", "0.00001")),
        ("withdraw to a typo'd address",
         lambda: exchange.withdraw(EXTERNAL_WALLET[:-1] + "Z", "50")),
    ):
        try:
            call()
            print(f"{description:<32} ACCEPTED -- this should not happen")
        except Exception as error:
            print(f"{description:<32} rejected: {error}")

    # --- 6. trade history and P/L ------------------------------------------
    rule("6. TRADE HISTORY")
    print(f"{'fill':<11}{'symbol':<10}{'side':<6}{'liq':<7}{'qty':>13}{'price':>12}"
          f"{'notional':>12}{'fee':>9}{'realized':>12}")
    for trade in exchange.trades():
        booked = trade.realized_pnl_usdt
        realized = f"{booked:+,.4f}" if booked is not None else "-"
        print(f"{trade.id:<11}{trade.symbol:<10}{trade.side.value:<6}{trade.liquidity.value:<7}"
              f"{trade.quantity:>13.8f}{trade.price:>12,.2f}{trade.notional_usdt:>12,.2f}"
              f"{trade.fee_usdt:>9.4f}{realized:>12}")

    portfolio = exchange.portfolio()
    print(f"\nrealized P/L {portfolio.realized_pnl_usdt:+,.6f} USDT over "
          f"{len(exchange.trades())} fills, {portfolio.fees_paid_usdt:,.6f} USDT paid in fees")

    # --- 7. withdraw the profit --------------------------------------------
    rule("7. WITHDRAW -- send the profit to an external wallet")
    profit = portfolio.total_pnl_usdt
    amount = profit.quantize(Decimal("0.01"), rounding=ROUND_DOWN)
    print(f"equity {portfolio.equity_usdt:,.6f} USDT on a {TARGET_USDT:,.0f} USDT stake "
          f"-> profit {profit:+,.6f} USDT")
    if amount < MIN_WITHDRAWAL_USDT:
        print(f"profit is under the {MIN_WITHDRAWAL_USDT} USDT minimum withdrawal, "
              f"sending the minimum instead")
        amount = MIN_WITHDRAWAL_USDT
    print(f"destination: {EXTERNAL_WALLET} (TRC20)")

    for attempt in range(1, 4):
        withdrawal = exchange.withdraw(EXTERNAL_WALLET, amount)
        print(f"attempt {attempt}: {withdrawal.id} requested {withdrawal.amount_usdt} USDT "
              f"+ {withdrawal.fee_usdt} USDT network fee, status={withdrawal.status.value}")
        show_balance(exchange, "  funds locked")
        exchange.process_withdrawals(withdrawal.id)
        print(f"  -> {exchange.withdrawals()[-1].status.value}")
        exchange.process_withdrawals(withdrawal.id)
        settled = exchange.withdrawals()[-1]
        if settled.status is WithdrawalStatus.COMPLETED:
            print(f"  -> completed, tx {settled.tx_hash}")
            break
        print(f"  -> failed: {settled.failure_reason} (funds returned, retrying)")
    show_balance(exchange, "after withdrawal")

    # --- 8. the bottom line ------------------------------------------------
    rule("8. FINAL P/L")
    final = exchange.portfolio()
    rows = (
        ("deposited", exchange.wallet.total_deposited_usdt),
        ("withdrawn", exchange.wallet.total_withdrawn_usdt),
        ("network fees", exchange.wallet.withdrawal_fees_usdt),
        ("trading fees", final.fees_paid_usdt),
        ("cash", final.cash_usdt),
        ("open positions", final.positions_value_usdt),
        ("equity", final.equity_usdt),
        ("realized P/L", final.realized_pnl_usdt),
        ("unrealized P/L", final.unrealized_pnl_usdt),
        ("total P/L", final.total_pnl_usdt),
    )
    for label, value in rows:
        print(f"{label:<18}{money(value, 6)} USDT")
    print(f"{'USDT/USD':<18}{final.usdt_usd_rate:>12}")
    print(f"{'equity (USD)':<18}{money(final.equity_usd, 6)} USD")
    print(f"{'total P/L (USD)':<18}{money(final.total_pnl_usd, 6)} USD  "
          f"({final.total_pnl_pct:+.2f}% on capital deposited)")
    show_positions(exchange)

    rule("9. AUDIT TRAIL")
    for event in exchange.history():
        detail = ", ".join(f"{key}={value}" for key, value in event.details.items())
        print(f"{event.seq:>3}  {event.timestamp:%Y-%m-%d %H:%M:%S}  {event.type:<26} {detail}")
    counts: dict[str, int] = {}
    for event in exchange.history():
        counts[event.type.split(".")[0]] = counts.get(event.type.split(".")[0], 0) + 1
    print(f"\n{len(exchange.history())} events: " +
          ", ".join(f"{kind} {count}" for kind, count in sorted(counts.items())))


if __name__ == "__main__":
    main()
