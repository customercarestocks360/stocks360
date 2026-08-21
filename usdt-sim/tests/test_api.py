"""The REST surface, walked end to end: deposit by QR, trade, close, withdraw, audit.

`test_sim.py` covers the library invariants. This file covers the layer above them --
routing, request validation and error mapping -- because the HTTP boundary is where an
unbounded amount or a mis-mapped status code actually costs something, and none of that
is reachable from the library tests.

Runs under pytest, and standalone with `python tests/test_api.py`. Needs `httpx`, which
`fastapi.testclient` uses as its transport. Without it the standalone runner skips the
file and the library invariants in `test_sim.py` still run; under pytest every test fails
with one plain "install httpx" message rather than an AttributeError three frames down.
"""

import sys
import warnings
from decimal import Decimal
from pathlib import Path
from random import Random

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

warnings.filterwarnings("ignore", message=".*httpx.*")

from usdt_sim import wallet as wallet_module  # noqa: E402
from usdt_sim.chain import new_address  # noqa: E402
from usdt_sim.exchange import Exchange  # noqa: E402

try:
    from fastapi.testclient import TestClient

    from usdt_sim import api

    MISSING = ""
except ImportError as error:  # pragma: no cover - dependency guard
    TestClient = None
    MISSING = str(error)

EXTERNAL_WALLET = new_address("TRC20", Random(20260821))


def client(seed: int = 42):
    """A fresh exchange behind a fresh client.

    `api.exchange` is a module-level singleton by design -- one process, one venue -- so
    isolating a test means replacing it, not reaching inside it.
    """
    if TestClient is None:
        raise RuntimeError(f"the REST tests need httpx: pip install httpx  ({MISSING})")
    api.exchange = Exchange(seed=seed)
    return TestClient(api.app)


def ok(response, expected: int = 200):
    assert response.status_code == expected, f"{response.status_code}: {response.text}"
    return response.json()


def dec(value) -> Decimal:
    return Decimal(str(value))


def assert_books_balance(app) -> None:
    """The same invariant test_sim.py ends on, asserted through the API instead."""
    portfolio = ok(app.get("/portfolio"))
    equity = dec(portfolio["equity_usdt"])
    assert equity == dec(portfolio["net_deposited_usdt"]) + dec(portfolio["total_pnl_usdt"])
    balance = ok(app.get("/balance"))
    assert dec(portfolio["cash_usdt"]) == dec(balance["total_balance_usdt"])
    assert dec(balance["available_balance_usdt"]) >= 0
    assert dec(balance["locked_balance_usdt"]) >= 0


# --------------------------------------------------------------------------- #
# The whole journey, over HTTP
# --------------------------------------------------------------------------- #
def test_full_journey_deposit_trade_profit_loss_withdraw():
    app = client()

    # --- deposit: address + QR, then 400 watched through its confirmations ---
    details = ok(app.get("/deposit/address"))
    assert details["chain"] == "TRC20" and details["asset"] == "USDT"
    assert details["qr_payload"] == details["address"]
    assert details["qr_svg_data_uri"].startswith("data:image/svg+xml")

    pending = ok(
        app.post("/deposit", json={"amount_usdt": "400", "auto_confirm": False}), 201
    )
    assert pending["status"] == "pending"
    assert dec(ok(app.get("/balance"))["available_balance_usdt"]) == 0

    short = ok(app.post(f"/deposits/{pending['tx_hash']}/confirm", json={"blocks": 10}))
    assert short["status"] == "pending", "credited before the confirmation threshold"
    credited = ok(app.post(f"/deposits/{pending['tx_hash']}/confirm", json={"blocks": 10}))
    assert credited["status"] == "credited"

    # --- the remaining 600, auto-confirmed: a 1000 USDT stake ---
    ok(app.post("/deposit", json={"amount_usdt": "600"}), 201)
    assert dec(ok(app.get("/balance"))["available_balance_usdt"]) == Decimal("1000")
    assert_books_balance(app)

    # --- trade one: buy BTC, shock it up, close at a profit ---
    buy = ok(
        app.post("/order", json={"symbol": "BTC/USDT", "side": "buy", "quote_amount": "400"}),
        201,
    )
    assert buy["status"] == "filled" and buy["fills"][0]["liquidity"] == "taker"
    positions = ok(app.get("/positions"))
    assert len(positions) == 1

    # Marked at the bid -- the price the position would actually be sold into. Marking at
    # the mid flatters every open position by half the spread, so the two must not be
    # confused, and cross-checking /positions against /markets is what catches it.
    held, market = positions[0], next(
        m for m in ok(app.get("/markets")) if m["symbol"] == "BTC/USDT"
    )
    assert dec(market["bid"]) < dec(market["mid"]), "the bid is not below the mid"
    assert dec(held["mark_price"]) == dec(market["bid"]), "position is not marked at the bid"
    # Cost basis carries the entry fee, so unrealized P/L is already net of getting in.
    entry = buy["fills"][0]
    assert dec(held["cost_basis_usdt"]) == dec(entry["notional_usdt"]) + dec(entry["fee_usdt"])
    assert dec(held["unrealized_pnl_usdt"]) == (
        dec(held["market_value_usdt"]) - dec(held["cost_basis_usdt"])
    )

    api.exchange.feed.shock("BTC/USDT", "10")
    ok(app.post("/tick", json={"steps": 3}))
    # The slash spelling has to route, which is the whole point of `{symbol:path}`.
    won = ok(app.post("/positions/BTC/USDT/close", json={}), 201)
    assert dec(won["fills"][0]["realized_pnl_usdt"]) > 0, "a +10% shock booked no profit"
    assert ok(app.get("/positions")) == [], "position survived a full close"

    # --- trade two: buy ETH, shock it down, cut the loss ---
    ok(
        app.post("/order", json={"symbol": "ETH/USDT", "side": "buy", "quote_amount": "250"}),
        201,
    )
    api.exchange.feed.shock("ETH/USDT", "-10")
    # The compact spelling has to resolve to the same market.
    lost = ok(app.post("/positions/ETHUSDT/close", json={}), 201)
    assert dec(lost["fills"][0]["realized_pnl_usdt"]) < 0, "a -10% shock booked no loss"
    assert_books_balance(app)

    # --- trade three: a resting limit buy, filled by a tick that trades through it ---
    bid = api.exchange.feed.bid("BTC/USDT")
    entry = (bid * Decimal("0.97")).quantize(Decimal("0.01"))
    resting = ok(
        app.post(
            "/order",
            json={
                "symbol": "BTC/USDT",
                "side": "buy",
                "quantity": "0.005",
                "type": "limit",
                "limit_price": str(entry),
            },
        ),
        201,
    )
    assert resting["status"] == "open" and dec(resting["locked_usdt"]) > 0
    assert dec(ok(app.get("/balance"))["locked_balance_usdt"]) == dec(resting["locked_usdt"])

    api.exchange.feed.shock("BTC/USDT", "-5")
    tick = ok(app.post("/tick", json={"steps": 1}))
    assert [o["id"] for o in tick["filled_orders"]] == [resting["id"]]
    filled = next(o for o in ok(app.get("/orders")) if o["id"] == resting["id"])
    assert filled["status"] == "filled" and filled["fills"][-1]["liquidity"] == "maker"
    assert dec(filled["fills"][-1]["slippage_bps"]) == 0, "a maker fill paid slippage"
    assert dec(ok(app.get("/balance"))["locked_balance_usdt"]) == 0, "reserve not released"

    ok(app.post("/positions/BTC/USDT/close", json={}), 201)

    # --- trade history and P/L ---
    trades = ok(app.get("/trades"))
    assert len(trades) == 6, f"expected 3 round trips, got {len(trades)} fills"
    booked = sum(dec(t["realized_pnl_usdt"]) for t in trades if t["realized_pnl_usdt"])
    portfolio = ok(app.get("/portfolio"))
    assert dec(portfolio["realized_pnl_usdt"]) == booked
    assert dec(portfolio["fees_paid_usdt"]) == sum(dec(t["fee_usdt"]) for t in trades)
    assert dec(portfolio["usdt_usd_rate"]) > 0 and dec(portfolio["equity_usd"]) > 0
    assert_books_balance(app)

    # --- withdraw to an external wallet ---
    before = dec(ok(app.get("/balance"))["available_balance_usdt"])
    withdrawal = ok(
        app.post("/withdraw", json={"address": EXTERNAL_WALLET, "amount_usdt": "50"}), 201
    )
    assert withdrawal["status"] == "pending" and withdrawal["chain"] == "TRC20"
    locked = dec(withdrawal["amount_usdt"]) + dec(withdrawal["fee_usdt"])
    balance = ok(app.get("/balance"))
    assert dec(balance["locked_balance_usdt"]) == locked
    assert dec(balance["available_balance_usdt"]) == before - locked

    staged = ok(app.post("/withdrawals/process"))
    assert [w["status"] for w in staged] == ["processing"], "queue skipped the in-flight stage"
    settled = ok(app.post("/withdrawals/process", params={"until_settled": True}))[0]
    assert settled["status"] in ("completed", "failed")
    if settled["status"] == "completed":
        assert settled["tx_hash"], "a completed withdrawal has no transaction hash"
    assert dec(ok(app.get("/balance"))["locked_balance_usdt"]) == 0
    assert_books_balance(app)

    # --- the audit trail has a line for every movement ---
    history = ok(app.get("/history"))
    types = [event["type"] for event in history]
    for expected in (
        "exchange.started",
        "deposit.detected",
        "deposit.credited",
        "order.placed",
        "order.filled",
        "withdrawal.requested",
        "withdrawal.processing",
    ):
        assert expected in types, f"{expected} missing from the audit trail"
    assert [e["seq"] for e in history] == list(range(1, len(history) + 1)), "audit trail has gaps"
    deposits_only = ok(app.get("/history", params={"kind": "deposit"}))
    assert all(e["type"].startswith("deposit") for e in deposits_only)
    assert len(ok(app.get("/history", params={"limit": 3}))) == 3


# --------------------------------------------------------------------------- #
# The boundary: bad input must be refused at the door
# --------------------------------------------------------------------------- #
def test_unbounded_and_malformed_input_is_refused():
    app = client()
    for description, path, body in (
        ("a 10^41 USDT deposit", "/deposit", {"amount_usdt": "1" + "0" * 41}),
        ("a zero deposit", "/deposit", {"amount_usdt": "0"}),
        ("a negative order quantity", "/order",
         {"symbol": "BTC/USDT", "side": "buy", "quantity": "-1"}),
        ("an unbounded order quantity", "/order",
         {"symbol": "BTC/USDT", "side": "buy", "quantity": "1" + "0" * 20}),
        ("an unknown side", "/order",
         {"symbol": "BTC/USDT", "side": "long", "quantity": "1"}),
        ("a chain we do not support", "/withdraw",
         {"address": EXTERNAL_WALLET, "amount_usdt": "50", "chain": "BEP20"}),
        ("a negative withdrawal", "/withdraw",
         {"address": EXTERNAL_WALLET, "amount_usdt": "-50"}),
        ("an address too short to be one", "/withdraw", {"address": "T1", "amount_usdt": "50"}),
    ):
        response = app.post(path, json=body)
        assert response.status_code == 422, f"{description} was not a 422: {response.text}"

    # A 10001-step tick would run the price feed for a month inside one request.
    assert app.post("/tick", json={"steps": 10_001}).status_code == 422
    assert app.post("/tick", json={"steps": 0}).status_code == 422
    assert app.get("/history", params={"limit": 0}).status_code == 422


def test_domain_errors_map_to_their_own_status_and_body():
    app = client()
    ok(app.post("/deposit", json={"amount_usdt": "1000"}), 201)

    for expected_status, expected_error, path, body in (
        # A typo'd address is the one failure here that would mean money gone.
        (400, "InvalidAddress", "/withdraw",
         {"address": EXTERNAL_WALLET[:-1] + "Z", "amount_usdt": "50"}),
        (400, "SimError", "/withdraw", {"address": EXTERNAL_WALLET, "amount_usdt": "1"}),
        (400, "InsufficientFunds", "/withdraw",
         {"address": EXTERNAL_WALLET, "amount_usdt": "99999"}),
        (400, "OrderRejected", "/order",
         {"symbol": "BTC/USDT", "side": "sell", "quantity": "0.01"}),
        (400, "OrderRejected", "/order",
         {"symbol": "BTC/USDT", "side": "buy", "quantity": "0.00001"}),
        (400, "OrderRejected", "/order",
         {"symbol": "BTC/USDT", "side": "buy", "quantity": "0.01", "type": "limit"}),
        (400, "InsufficientFunds", "/order",
         {"symbol": "BTC/USDT", "side": "buy", "quantity": "100"}),
        (404, "NotFound", "/order", {"symbol": "DOGE/USDT", "side": "buy", "quantity": "1"}),
        (404, "NotFound", "/positions/BTC/USDT/close", {}),
        (404, "NotFound", "/deposits/deadbeefcafe/confirm", {"blocks": 1}),
    ):
        response = app.post(path, json=body)
        assert response.status_code == expected_status, f"{path} {body}: {response.text}"
        assert response.json()["error"] == expected_error, response.text
        assert response.json()["detail"], f"{path} returned an error with no detail"

    assert app.delete("/order/nope").status_code == 404
    # Nothing above may have moved the balance.
    assert dec(ok(app.get("/balance"))["available_balance_usdt"]) == Decimal("1000")
    assert_books_balance(app)


def test_cancelling_a_resting_order_refunds_the_reservation():
    app = client()
    ok(app.post("/deposit", json={"amount_usdt": "1000"}), 201)
    far_below = (api.exchange.feed.bid("BTC/USDT") * Decimal("0.5")).quantize(Decimal("0.01"))
    resting = ok(
        app.post(
            "/order",
            json={
                "symbol": "BTC/USDT",
                "side": "buy",
                "quantity": "0.005",
                "type": "limit",
                "limit_price": str(far_below),
            },
        ),
        201,
    )

    open_ids = [o["id"] for o in ok(app.get("/orders", params={"status": "open"}))]
    assert open_ids == [resting["id"]]
    assert dec(ok(app.get("/balance"))["available_balance_usdt"]) < Decimal("1000")

    cancelled = ok(app.delete(f"/order/{resting['id']}"))
    assert cancelled["status"] == "cancelled" and dec(cancelled["locked_usdt"]) == 0
    assert dec(ok(app.get("/balance"))["available_balance_usdt"]) == Decimal("1000")
    assert ok(app.get("/orders", params={"status": "open"})) == []
    # A cancelled order is not cancellable twice, and must not refund twice either.
    assert app.delete(f"/order/{resting['id']}").status_code == 400
    assert dec(ok(app.get("/balance"))["available_balance_usdt"]) == Decimal("1000")
    assert_books_balance(app)


def test_failed_withdrawal_refunds_through_the_api():
    app = client()
    ok(app.post("/deposit", json={"amount_usdt": "1000"}), 201)
    original_rate = wallet_module.WITHDRAWAL_FAILURE_RATE
    wallet_module.WITHDRAWAL_FAILURE_RATE = 1.0
    try:
        ok(app.post("/withdraw", json={"address": EXTERNAL_WALLET, "amount_usdt": "500"}), 201)
        failed = ok(app.post("/withdrawals/process", params={"until_settled": True}))[0]
        assert failed["status"] == "failed" and failed["failure_reason"]
        assert failed["tx_hash"] is None, "a failed withdrawal reported a transaction hash"
    finally:
        wallet_module.WITHDRAWAL_FAILURE_RATE = original_rate

    balance = ok(app.get("/balance"))
    assert dec(balance["available_balance_usdt"]) == Decimal("1000"), "refund lost a fraction"
    assert dec(balance["locked_balance_usdt"]) == 0
    assert dec(balance["total_withdrawn_usdt"]) == 0
    assert dec(balance["withdrawal_fees_usdt"]) == 0, "a failed broadcast charged a network fee"
    assert_books_balance(app)


def test_deposit_address_is_sticky_per_chain_and_rotatable():
    app = client()
    first = ok(app.get("/deposit/address"))["address"]
    assert ok(app.get("/deposit/address"))["address"] == first, "address is not sticky"
    assert ok(app.get("/deposit/address", params={"rotate": True}))["address"] != first
    erc20 = ok(app.get("/deposit/address", params={"chain": "ERC20"}))
    assert erc20["address"].startswith("0x") and erc20["required_confirmations"] == 12
    # ERC-20 needs 12 confirmations against TRC-20's 20, and both must credit.
    ok(app.post("/deposit", json={"amount_usdt": "100", "chain": "ERC20"}), 201)
    assert dec(ok(app.get("/balance"))["available_balance_usdt"]) == Decimal("100")
    assert app.get("/deposit/address", params={"chain": "BEP20"}).status_code == 422
    assert_books_balance(app)


def test_openapi_documents_every_route():
    app = client()
    paths = ok(app.get("/openapi.json"))["paths"]
    for expected in (
        "/balance",
        "/deposit",
        "/deposit/address",
        "/deposits",
        "/withdraw",
        "/withdrawals",
        "/withdrawals/process",
        "/markets",
        "/tick",
        "/order",
        "/orders",
        "/positions",
        "/trades",
        "/portfolio",
        "/history",
    ):
        assert expected in paths, f"{expected} is missing from the OpenAPI schema"


def main() -> int:
    if TestClient is None:
        print(f"SKIP  the REST tests need httpx: pip install httpx  ({MISSING})")
        return 0
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
