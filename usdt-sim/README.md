# usdt-sim

A USDT exchange simulation. Deposit via QR, trade BTC/USDT and ETH/USDT with realistic
fees and slippage, track per-trade and portfolio P/L, withdraw to an external wallet, and
read the whole thing back off an append-only audit trail.

It is built to be swapped, not thrown away: the seams where a real price feed, a real
chain, and a real database plug in are the module boundaries, and each one is called out
under [Going real](#going-real).

```
pip install -r requirements.txt
python example.py                  # full walkthrough: fund 1000 USDT, trade, withdraw
python tests/test_sim.py           # 14 library invariants, no test framework needed
python tests/test_api.py           # 7 REST journeys, same deal (needs httpx)
python -m pytest tests/ -q         # or all 21 at once
uvicorn usdt_sim.api:app --reload  # REST API on http://127.0.0.1:8000 (docs at /docs)
```

The library on its own needs only `pydantic` and `segno`; `fastapi` and `uvicorn` are for
the REST layer, and `httpx` only for `tests/test_api.py`.

## The 60-second version

```python
from usdt_sim import Exchange

ex = Exchange(seed=42)                  # seed it and every number below is reproducible

print(ex.deposit_qr()["address"])       # TQKrscjLoTkjm8AxdRZcMB7LNYtSuEgSQJ
print(ex.qr_terminal())                 # scannable QR, straight to stdout
ex.deposit("1000")                      # mock an inbound transfer, auto-confirmed

ex.place_order("BTC/USDT", "buy", quote_amount="400")
ex.tick(6)                              # 30 minutes of market movement
print(ex.positions()[0].unrealized_pnl_usdt)

ex.close_position("BTC/USDT")
print(ex.portfolio().total_pnl_usdt, ex.portfolio().total_pnl_usd)

ex.withdraw("TJBbQT8pj4uVnN19191jKUy3QkPoM8FecG", "15")
ex.process_withdrawals(until_settled=True)

for event in ex.history():               # the audit trail, oldest first
    print(event.seq, event.type, event.details)
```

`example.py` is the same story at full length, with two market orders (one winner, one
loser), a resting limit buy closed by a limit take-profit, four rejected operations, a
trade-history table, the final P/L in USDT and USD, and the complete audit trail.

## Architecture

Nine modules, each owning one concern. Arrows are the only direction dependencies run.

```
                 ┌─────────────┐
   callers ─────►│  exchange   │  facade: the only thing that advances the clock
                 └──┬───┬───┬──┘
        ┌───────────┘   │   └───────────┐
        ▼               ▼               ▼
  ┌──────────┐   ┌────────────┐   ┌──────────┐
  │  wallet  │   │   engine   │   │  prices  │  GBM walk, spread, size impact
  │ balances │◄──┤ orders     │──►│  feed    │
  │ deposits │   │ positions  │   └──────────┘
  │ withdraw │   │ P/L        │
  └────┬─────┘   └──────┬─────┘
       │  ┌─────────────┘
       ▼  ▼
  ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐
  │  ledger  │   │  chain   │   │  models  │   │  money   │
  │  audit   │   │ addr/QR  │   │  types   │   │ Decimal  │
  └──────────┘   └──────────┘   └──────────┘   └──────────┘
```

| Module | Owns |
| --- | --- |
| `money.py` | The two Decimal scales (USDT 6dp, base assets 8dp), fee rounding, tick/lot snapping. No float touches a balance anywhere in the package. |
| `models.py` | Every domain type and error. They are pydantic models, so the REST layer reuses them verbatim as `response_model` and there is one definition of an order. |
| `config.py` | Venue parameters: fees, confirmations, withdrawal minimums and fees, failure rate, market seed data. Tune the simulation here. |
| `chain.py` | Deposit addresses, base58check validation, transaction hashes, QR rendering. |
| `prices.py` | The price feed: geometric Brownian motion per market, bid/ask, size-dependent fill prices, the USDT/USD peg. |
| `wallet.py` | `available` / `locked` balances and the deposit and withdrawal state machines. |
| `engine.py` | Order placement, limit-order matching, positions, realized and unrealized P/L. |
| `ledger.py` | The append-only audit trail and history queries. |
| `exchange.py` | The facade every caller uses. Advances the simulated clock and records failures. |
| `api.py` | FastAPI REST surface over one in-process `Exchange`. |

### How money moves

Every balance change goes through one of four wallet primitives, which is what makes
"where did my USDT go" answerable from the audit trail alone:

```
deposit credited ──► credit()  ──────────────►  available
                                                 │  ▲
resting limit order / withdrawal ── lock() ──────┘  │ unlock()  (cancelled, failed)
                                                    │
                                     locked ────────┘
                                       └── spend_locked()  (order filled, withdrawal sent)
```

A market order debits `available` directly. A resting limit buy locks
`quantity × limit + maker fee` up front, settles the real cost out of `locked` when it
fills, and hands back any over-reservation. A resting limit sell locks base-asset
quantity inside the position instead, so the same coins cannot be sold twice.

## Modelling decisions, and what they cost

These are the choices that determine whether the numbers mean anything. Each one is a
deliberate trade-off, not an oversight.

**Spot, long-only.** Buying opens or adds to a position; selling reduces or closes it. A
sell with nothing behind it is rejected, not silently turned into a short. Shorts need a
real margin system — collateral, maintenance margin, liquidation — and bolting a
`quantity: -0.5` onto a spot model would make every P/L number here a fiction.

**Cost basis carries the entry fee.** `avg_entry_price` is therefore the true break-even,
and unrealized P/L is already net of what it cost to get in. Realized P/L on an exit is
`proceeds − exit fee − cost basis`, so both fees are inside every number the package
reports. Nothing is quoted gross.

**Positions are marked at the bid.** The bid is the price the position would actually be
sold into. Marking at the mid flatters every open position by half the spread.

**Market orders pay half the spread plus size impact.** Impact scales with the order's own
notional (`impact_bps` per 100k USDT), so a 50k order fills measurably worse than a 500
one. A limit order that rests and gets hit pays the maker fee and zero slippage. That
difference is the whole reason a strategy prefers one over the other, so it is modelled
rather than assumed away.

**Prices are geometric Brownian motion.** One tick is five minutes of market time. GBM is
the cheapest model that gets the two things right that a trading simulator has to: prices
stay positive, and returns compound. It has no fat tails, no volatility clustering, and no
correlation between BTC and ETH — see [Going real](#going-real) for the swap.

**P/L is measured against capital still in the account**, not against total deposits:
`total_pnl = equity − (deposited − withdrawn − network fees)`. Depositing more does not
register as a profit and withdrawing does not register as a loss.

**Deposits and withdrawals are state machines.** A deposit is seen before it is spendable
(20 confirmations on TRC-20, 12 on ERC-20) and crediting is idempotent — confirming an
already-credited deposit a second time is a no-op, because double-crediting is the single
most expensive bug an exchange can ship. A withdrawal locks funds on request, then walks
`pending → processing → completed | failed`, one stage per `process_withdrawals()` call so
the in-flight state is observable. Failures (8% by default) unlock the full amount plus
fee, down to the last microUSDT.

**Addresses are the real encoding.** A generated TRC-20 address is a genuine base58check
string, so a single mistyped character is rejected by checksum exactly the way TRON would
reject it. A withdrawal is the one place here where a bad string means money gone, so it
gets a real checksum rather than a length check.

**State is in memory.** Restarting the API loses everything. That is the right default for
a simulator and the wrong one for anything else; the swap is in
[Going real](#going-real).

**Pair names are normalised.** `BTC/USDT`, `USDT/BTC`, `BTCUSDT`, `BTC-USDT` and `btc` all
resolve to `BTC/USDT`. USDT is always the quote asset, so `USDT/BTC` is accepted as the
same market rather than rejected — but it is normalised, because a pair whose name can be
spelled two ways is a position-keying bug waiting to happen.

### Known ceilings

* **ERC-20 addresses are shape-checked only.** EIP-55 checksum casing needs keccak256,
  which `hashlib` does not ship (`sha3_256` is the NIST variant, not Keccak). Add
  `eth-utils` and verify in `chain.validate_address` if mixed-case typos must be caught.
  TRC-20 — the default chain — is fully checksum-validated.
* **Orders fill all-or-nothing.** There is no order book with depth, so no partial fills.
  `Order.filled_quantity` and the `partially_filled` status exist and are wired through,
  so adding depth means changing `Engine._settle_fill`, not the model.
* **One account per process.** No user ids anywhere. Multi-account means keying `Wallet`
  and `Engine` by account id in `Exchange`.

## REST API

`uvicorn usdt_sim.api:app --reload`, interactive docs at `/docs`. Set `USDT_SIM_SEED` for
a reproducible session. Every numeric field is bounded — an exchange API is the definition
of a trust boundary, and an unbounded amount is how you get a 10^40 USDT order overflowing
a Decimal context three layers down instead of a 422 at the door.

| Method | Path | Does |
| --- | --- | --- |
| `GET` | `/balance` | Available, locked, total deposited/withdrawn, deposit address |
| `GET` | `/deposit/address` | Address + QR as an inline SVG data URI (`?rotate=true` for a fresh one) |
| `POST` | `/deposit` | Mock an inbound transfer (`auto_confirm: false` to watch confirmations) |
| `POST` | `/deposits/{tx_hash}/confirm` | Add block confirmations; credits at the threshold |
| `GET` | `/deposits` | Deposit history |
| `POST` | `/withdraw` | Validate destination, lock amount + network fee |
| `POST` | `/withdrawals/process` | Advance the queue one stage (`?until_settled=true` to finish) |
| `GET` | `/withdrawals` | Withdrawal history |
| `GET` | `/markets` | Bid/ask/mid, spread, lot and tick sizes |
| `POST` | `/tick` | Advance prices `steps` × 5 minutes, fill any resting order crossed |
| `POST` | `/order` | Market or limit, `quantity` or `quote_amount` |
| `GET` | `/orders` | All orders, `?status=open\|filled\|cancelled\|rejected` |
| `DELETE` | `/order/{id}` | Cancel a resting order, releasing its reservation |
| `GET` | `/positions` | Open positions marked at the bid, with unrealized P/L |
| `POST` | `/positions/{symbol}/close` | Market or limit close, whole or partial |
| `GET` | `/trades` | Every fill, with fee, slippage and realized P/L |
| `GET` | `/portfolio` | Equity, realized/unrealized/total P/L in USDT **and** USD |
| `GET` | `/history` | The audit trail, `?kind=deposit\|order\|withdrawal\|error`, `?limit=` |

The symbol in `/positions/{symbol}/close` takes any accepted spelling, so both
`/positions/BTC/USDT/close` and `/positions/BTCUSDT/close` work.

Domain errors return their own status with a typed body — `400` for
`InsufficientFunds`, `InvalidAddress`, `OrderRejected`, `404` for `NotFound`:

```json
{ "error": "InvalidAddress", "detail": "TRC-20 address checksum does not match -- check for a typo" }
```

## Audit trail

`GET /history` or `Exchange.history(kind, limit)`. Event types are dotted strings, so
`kind` filters on either a full type or its prefix (`deposit`, `order`, `withdrawal`,
`error`). Every event carries `seq`, `timestamp`, `type` and a JSON-safe `details` dict —
details are flattened to primitives on the way in, because an audit line that still holds
live `Decimal` objects is a line whose meaning depends on how it is later serialised.

```
deposit.address_issued  deposit.detected  deposit.confirmed  deposit.credited
order.placed            order.filled      order.cancelled    order.rejected
withdrawal.requested    withdrawal.processing                withdrawal.completed
withdrawal.failed       exchange.started  error
```

Order failures appear as `order.rejected` (carrying the order id, side and reason) rather
than as generic `error` lines; `error` covers everything else that failed — a bad
withdrawal address, an unknown deposit hash. To see every failure in one query, read both.

## Going real

Four seams, in the order you would most likely need them.

**Live prices.** `prices.PriceFeed` is the only thing that knows what a price is. Keep the
interface — `mid`, `bid`, `ask`, `quote`, `fill_price`, `to_usd` — and back it with a
websocket ticker (Binance `bookTicker`, Coinbase `ticker`) writing into `markets[symbol]`.
`fill_price` is where a real order book replaces the impact model: walk the actual depth
levels and return the volume-weighted price. Nothing above `PriceFeed` changes. The same
seam is how you get better statistics without leaving the simulation: a jump-diffusion or
a GARCH process is a change to `PriceFeed.tick` alone.

**Real order routing.** `engine.Engine` is the boundary. Replace `_settle_fill` with a
REST call to the venue (`POST /api/v3/order`) and let the exchange's fill report drive
position updates instead of the local calculation, keeping `_open_or_add` / `_reduce` for
the accounting. Reconcile against the venue's own balance and position endpoints on start
— your books and theirs will disagree eventually, and the one you can act on is theirs.
Expect `partially_filled` to start appearing.

**Real chain movements.** `chain.py` holds every chain-shaped detail in one place.
`new_address` becomes key derivation or a call to your custody provider; `validate_address`
gains EIP-55 for ERC-20; `new_tx_hash` disappears, replaced by hashes the chain gives you.
`Wallet.receive` and `Wallet.confirm` are then driven by a deposit scanner polling
TronGrid or an Ethereum node for `Transfer` logs to your addresses, and
`Wallet._settle` becomes a real broadcast whose receipt you poll. Keep the confirmation
threshold and the idempotent credit exactly as they are — those are the parts that stop a
reorg from paying a user twice.

**Persistence.** `Wallet`, `Engine` and `Ledger` hold their state in plain dicts and lists.
The audit trail is already append-only, so it maps to an insert-only table directly and
should be written first, in the same transaction as the balance change it describes.
Balances and positions need row-level locking (`SELECT ... FOR UPDATE` on the account) or
concurrent orders will interleave and double-spend the same available balance — the
in-memory version gets away with it only because it is single-threaded.

Two things worth keeping when the rest is gone: the seeded, deterministic run — being able
to replay a bug exactly is worth more than it costs — and both test files, which are
written against behaviour rather than internals and stay valid against a real venue.
`test_sim.py` asserts the money invariants; `test_api.py` asserts that the HTTP boundary
refuses what it should and maps domain errors to their own status codes, which is the part
that survives unchanged when everything behind it becomes real.

## Layout

```
usdt-sim/
├── README.md
├── requirements.txt
├── example.py              end-to-end walkthrough
├── tests/
│   ├── test_sim.py         14 library invariants, runs with or without pytest
│   └── test_api.py         7 REST journeys: routing, validation, error mapping
└── usdt_sim/
    ├── __init__.py         exports Exchange and the domain types
    ├── config.py           fees, confirmations, limits, market seed data
    ├── money.py            Decimal scales and rounding
    ├── models.py           domain types and errors
    ├── chain.py            addresses, tx hashes, QR
    ├── prices.py           price simulation and execution pricing
    ├── wallet.py           balances, deposits, withdrawals
    ├── engine.py           orders, positions, P/L
    ├── ledger.py           audit trail
    ├── exchange.py         the facade
    └── api.py              FastAPI REST surface
```
