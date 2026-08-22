. `403` while the email is unverified# Stocks360 Backend

FastAPI + Firebase Auth (Admin SDK). Email/password and Google OAuth.

## Setup

```
cp .env.example .env                       # fill in FIREBASE_SERVICE_ACCOUNT and MONGODB_URI
.venv\Scripts\python.exe -m uvicorn app.main:app --reload
```

A populated `.env` is the only thing needed — there is no second file to obtain. The Admin
service account goes into `FIREBASE_SERVICE_ACCOUNT` as one base64 line, so handing someone
the repo plus a `.env` gives them a server that starts. To produce the value from a key file:

```
python -c "import base64,sys;print(base64.b64encode(open(sys.argv[1],'rb').read()).decode())" secrets/firebase-admin.json
```

Raw JSON is accepted in that variable too, and `\n` inside `private_key` is unescaped for
you. Leave it empty and startup falls back to a key file at `FIREBASE_CREDENTIALS` — same
behaviour as before, for anyone who prefers the file on disk.

`secrets/` and `.env` are gitignored — never commit the service account key. `.env.example`
**is** committed, so `FIREBASE_SERVICE_ACCOUNT` is deliberately blank there.

All Firebase config lives in `.env` — nothing is hardcoded in the app or the test page.

| Env var | Purpose |
|---|---|
| `FIREBASE_PROJECT_ID` | Firebase project (`stock360bitntech`) |
| `FIREBASE_SERVICE_ACCOUNT` | Admin service account key inline — base64 of the JSON, or the raw JSON. Preferred: makes `.env` self-sufficient. Must match `FIREBASE_PROJECT_ID` |
| `FIREBASE_CREDENTIALS` | Fallback path to the Admin key file when the above is empty, default `secrets/firebase-admin.json` |
| `FIREBASE_CLOCK_SKEW_SECONDS` | Clock-drift tolerance, 0–60, default `30` |
| `FIREBASE_API_KEY` | Web SDK — from the console's web-app snippet |
| `FIREBASE_AUTH_DOMAIN` | Web SDK |
| `FIREBASE_STORAGE_BUCKET` | Web SDK |
| `FIREBASE_MESSAGING_SENDER_ID` | Web SDK |
| `FIREBASE_APP_ID` | Web SDK |
| `FIREBASE_MEASUREMENT_ID` | Web SDK, optional (analytics only) |
| `MONGODB_URI` / `MONGODB_DB_NAME` | Atlas connection, db defaults to `stocks360` |
| `BINANCE_REST_URL` / `BINANCE_WS_URL` | Crypto market-data upstream. Public endpoints — no key or secret |
| `BINANCE_TIMEOUT_SECONDS` | Upstream REST timeout, 1–60, default `10` |
| `CRYPTO_SYMBOLS_TTL_SECONDS` | How long the symbol universe is cached, default `21600` (6h) |
| `CRYPTO_MAX_WATCHLISTS` | Watchlists per user, default `20` |
| `CRYPTO_MAX_SYMBOLS_PER_WATCHLIST` | Symbols per watchlist, default `50` |
| `CRYPTO_MAX_SOCKETS_PER_USER` | Concurrent open streams per user, default `5` |
| `CRYPTO_HEARTBEAT_SECONDS` | Silence before a heartbeat frame, 5–300, default `20` |
| `FOREX_REST_URL` | Forex market-data upstream (AwesomeAPI). Public endpoints — no key or secret |
| `FOREX_TIMEOUT_SECONDS` | Upstream REST timeout, 1–60, default `10` |
| `FOREX_PAIRS_TTL_SECONDS` | How long the pair universe is cached, default `21600` (6h) |
| `FOREX_POLL_SECONDS` | How often the hub polls for subscribed pairs, 1–60, default `3` |
| `FOREX_STALE_SECONDS` | Quote age before it is flagged stale, default `180` |
| `FOREX_MAX_WATCHLISTS` / `FOREX_MAX_SYMBOLS_PER_WATCHLIST` / `FOREX_MAX_SOCKETS_PER_USER` | Per-user caps, default `20` / `30` / `5` |
| `FOREX_HEARTBEAT_SECONDS` | Silence before a heartbeat frame, 5–300, default `20` |
| `FOREX_TWELVEDATA_API_KEY` | Optional second forex candle source ([twelvedata.com](https://twelvedata.com/pricing), free, no card). Tried first when set — real OHLC at every interval, unlike AwesomeAPI's ~77-minute tick cap or Yahoo's near-flat fine-interval FX bars. Blank (default) skips it entirely |
| `FOREX_TWELVEDATA_URL` | Twelve Data base URL, default `https://api.twelvedata.com` |
| `YAHOO_REST_URL` / `YAHOO_USER_AGENT` | Equity upstream. The browser UA is **required** — Yahoo refuses requests without one |
| `STOCKS_POLL_SECONDS` / `STOCKS_POLL_CONCURRENCY` | Poll cadence and burst cap, default `15` / `6` |
| `STOCKS_STALE_SECONDS` | Quote age before it is flagged stale, default `1800` (the feed is ~15m delayed) |
| `STOCKS_INSTRUMENT_TTL_SECONDS` | How long a resolved instrument is cached, default `3600` |
| `STOCKS_MAX_WATCHLISTS` / `STOCKS_MAX_SYMBOLS_PER_WATCHLIST` / `STOCKS_MAX_SOCKETS_PER_USER` | Per-user caps, default `20` / `25` / `5` |
| `STOCKS_HEARTBEAT_SECONDS` | Silence before a heartbeat frame, 5–300, default `20` |
| `CRYPTO_STALE_SECONDS` | Crypto quote age before it is too old to trade on, default `120`. The feed has no staleness notion of its own — it never closes |
| `TRADING_ENABLED` | `false` stops orders and funding; the reads keep working |
| `TRADING_OPEN_ACCESS` | Default `false`: onboarding, KYC and per-product permissions gate trading and funding. Set `true` only for an intentionally open-access simulator |
| `TRADING_FEE_BPS` | Commission in basis points of notional, default `10` (0.1%), rounded up |
| `TRADING_PRICE_BAND_PERCENT` | How far a limit or stop price may sit from the last trade, default `20` |
| `TRADING_MAX_OPEN_ORDERS` | Resting orders per user, default `50` |
| `TRADING_MIN_ORDER_NOTIONAL` / `TRADING_MAX_ORDER_NOTIONAL` | Per-order bounds in the **account** currency, default `1` / `1000000`. Converted first, so they mean the same thing in every market |
| `TRADING_MAX_DEPOSIT` / `TRADING_MAX_WITHDRAWAL` | Per-movement bounds, default `1000000` each |
| `TRADING_ACCOUNT_CURRENCY` | The one currency an account holds, default `USDT`. Has to be something `app/trading/fx.py` can price everything against — in practice `USDT` or `USD` |
| `TRADING_INITIAL_BALANCE` | What a new account opens with, default `1000`. Credited once via `$setOnInsert` and recorded as an `Opening balance` ledger entry |
| `TRADING_LEVERAGE` | Venue-wide leverage, default `200`, both directions and all three asset classes |
| `TRADING_SHORT_SELLING_CLASSES` | Where a sell with nothing behind it opens a short, default `crypto,forex,stocks` for the simulated margin venue |
| `TRADING_PEGGED_CURRENCIES` | Currencies converting 1:1 with each other, default `USDT,USDC,USD`. There is no licensed source for the peg's deviation, so pretending to one would be worse |
| `TRADING_FX_TTL_SECONDS` | How long a fetched conversion rate is reused, 1–3600, default `60`. A rate scales a notional; it is not what the order fills at |
| `TRADING_SWEEP_SECONDS` | How often the matcher expires day orders and re-checks resting ones, 5–300, default `15` |
| `TRADING_DOMESTIC_SUFFIXES` | Ticker suffixes treated as domestic equity, default `.NS,.BO` |
| `ADMIN_EMAILS` | Who may resolve a funding request, comma-separated. Matched against the verified token — there is no admin password. Empty means nobody, and every `/admin` route answers `403` |
| `FUNDING_MAX_PENDING_PER_USER` | Requests one account may have awaiting review, 1–100, default `10` |

The crypto limits are clamped rather than validated, so a typo degrades to the nearest
sane value instead of stopping the app from booting. The Firebase and Mongo values still
fail fast, because there is no sane default for a credential.

The app refuses to boot if the project id, key file, or any required web config value is
missing, so it can never start in a state where tokens are accepted without validation or
where the browser gets a config that cannot authenticate.

The web values are public by design — they ship to every browser, and are protected by
authorized domains plus security rules, not secrecy. The service account key is the real
secret. Clients read the web config from `GET /auth/config` instead of embedding it.

## Structure

```
app/
├── main.py             # FastAPI app, lifespan (Mongo + market hub), /test pages
├── api/router.py       # mounts every feature router
├── core/
│   ├── config.py       # env config, fails fast on missing values
│   ├── firebase.py     # Admin SDK init (once)
│   ├── database.py     # Mongo client, index setup
│   └── http.py         # client_ip(), shared by anything that logs a request
├── schemas/            # pydantic models, one file per feature
│   ├── common.py       # shared responses + reusable OpenAPI error blocks
│   ├── auth.py
│   ├── user.py
│   ├── onboarding.py   # step union, enums, session/submit responses
│   ├── streaming.py    # the stream frame contract shared by every market feed
│   ├── crypto.py       # crypto market data + watchlists
│   ├── forex.py        # forex pairs, quotes, pip sizing, session state
│   ├── stocks.py       # instruments, equity quotes, candles, market state
│   ├── overview.py     # one normalised tick shape across all three feeds
│   ├── trading.py      # orders, trades, positions, balances, the ledger
│   └── funding.py      # deposit/withdrawal requests, rails, the review decision
├── auth/               # feature module
│   ├── routes.py       # endpoints
│   ├── service.py      # token verification, user create/revoke
│   └── dependencies.py # get_current_user
├── users/
│   ├── routes.py       # stored profile + login history
│   └── repository.py   # Mongo reads/writes
├── onboarding/
│   ├── routes.py       # step / session / submit
│   ├── service.py      # step order, eligibility rules, submit hand-off
│   └── repository.py   # session + kyc_profiles writes
├── streaming/          # shared by every market feed
│   ├── hub.py          # BaseHub: refcounted symbols, fan-out, re-bind, cache warming
│   └── watchlists.py   # WatchlistStore, parameterised by collection
├── crypto/
│   ├── routes.py       # market data, watchlist CRUD, the per-instance WebSocket
│   ├── upstream.py     # Binance REST + the symbol cache everything validates against
│   ├── hub.py          # holds ONE Binance socket; the rest comes from BaseHub
│   └── repository.py   # watchlist reads/writes
├── forex/
│   ├── routes.py       # same surface as crypto, minus the book, plus /session
│   ├── upstream.py     # AwesomeAPI REST + the pair cache
│   ├── hub.py          # polls the batch endpoint; the rest comes from BaseHub
│   └── repository.py   # watchlist reads/writes
├── stocks/
│   ├── routes.py       # same surface again; /instruments is a search
│   ├── upstream.py     # Yahoo REST — the ONLY file that knows the provider
│   ├── hub.py          # polls per ticker; the rest comes from BaseHub
│   └── repository.py   # watchlist reads/writes
├── overview/
│   └── routes.py       # the public socket: subscribes to all three hubs, one tick shape
├── trading/            # the simulated venue, sitting on top of all three feeds
│   ├── routes.py       # funding, orders, trades, positions, portfolio
│   ├── service.py      # the rules: who may trade, what an order must satisfy, settlement
│   ├── engine.py       # the matcher — a hub subscriber, plus a repair sweep
│   ├── pricing.py      # one `Mark` over three feeds: currency, price, state, staleness
│   ├── repository.py   # wallets, orders, trades, positions, ledger — all Decimal128
│   └── money.py        # quantisation and the fee, in one place
├── funding/            # money in and out, with a human in the loop
│   ├── routes.py       # the user's queue, and the admin review queue behind it
│   ├── service.py      # the asymmetry: a deposit locks nothing, a withdrawal locks now
│   └── repository.py   # the request documents — every balance move goes through trading
└── health/routes.py
static/index.html       # browser test page
secrets/                # optional service account key file (gitignored) — only used when
                        # FIREBASE_SERVICE_ACCOUNT is empty in .env
```

New feature = folder with `routes.py` (+ `service.py`/`repository.py`/`dependencies.py` as needed), schemas in `schemas/<feature>.py`, then include its router in `api/router.py`.

## Data model

Firebase remains the source of truth for credentials; Mongo holds the app-side mirror so
the rest of the system can query users without calling Firebase on every request.

| Collection | Key | Contents |
|---|---|---|
| `users` | `_id` = Firebase uid | `email, name, picture, provider, email_verified, created_at, updated_at, last_login_at, login_count` + the denormalised onboarding outcome `onboarding_status, kyc_tier, enabled_products, pending_products` |
| `login_logs` | indexed `(uid, at desc)` | `uid, provider, ip, user_agent, at` — one document per login |
| `onboarding_sessions` | `_id` = uid, TTL on `expires_at` | the live signup session: `status, steps.<step>.{data, at}, created_at, updated_at, expires_at, submitted_at` |
| `kyc_profiles` | `_id` = uid, unique `(identity.document_type, identity.document_number)` | the frozen application written once at submit — every step's data flattened to a top-level key, plus `step_timestamps, status, kyc_tier, enabled_products, pending_products, submitted_at` |
| `watchlists` | `_id` = uuid4 hex, unique `(uid, name)` | `uid, name, symbols, version, created_at, updated_at` — one document per streamable crypto instance |
| `stock_watchlists` | same shape and indexes | the equities equivalent |
| `forex_watchlists` | same shape and indexes | the forex equivalent. A separate collection on purpose: the two symbol universes come from different providers, so a pair being delisted must not be able to invalidate a crypto watchlist |
| `wallets` | `_id` = `uid:CURRENCY` | `uid, currency, available, reserved` — cash. In practice one document per account, in `TRADING_ACCOUNT_CURRENCY`, created at `TRADING_INITIAL_BALANCE` via `$setOnInsert` (which is what makes the opening credit impossible to apply twice however many callers race). `reserved` is held by open orders *and* by pending withdrawal requests. The key stays per-currency so a wallet written by an older build is still readable and withdrawable rather than orphaned |
| `funding_requests` | `_id` = uuid4 hex, indexed `(uid, created_at desc)` and `(status, created_at desc)` | a deposit or withdrawal awaiting review: `uid, email, kind, status, currency, amount, network, destination, reference, funded, resolved_by, resolution_note, ledger_entry_id`. `email` is denormalised so a queue spanning users costs no per-row lookup |
| `orders` | `_id` = uuid4 hex, unique `(uid, client_order_id)` where present | the order and its lifecycle: `side, type, time_in_force, status, quantity, limit_price, stop_price, triggered, funded, reserved_amount, reserved_quantity, average_price, fee, expires_at`, plus `currency` / `account_currency` / `fx_rate` — the rate is stored so the order settles at the same one it was placed at |
| `trades` | indexed `(uid, at desc)` and `order_id` | one immutable record per fill: `quantity, price, notional, fee, fx_rate, opened, closed, realized_pnl`. `opened` and `closed` split the fill, since only the closing part books P&L |
| `positions` | `_id` = `uid:asset_class:symbol` | `available_quantity` (**signed** — negative is a short), `reserved_quantity` (never negative; units of a long locked by a resting sell), `cost_basis` (signed, in account currency), `cost_basis_quote` (the same in the instrument's currency), `margin_used`, `realized_pnl`. Two bases rather than one, tracked in parallel rather than derived through a stored rate, so `average_price` stays exact against the price on the screen. The average is derived from the basis rather than stored, so it cannot drift from it |
| `ledger_entries` | indexed `(uid, at desc)` | every balance movement, with the balances that same operation produced |
| `idempotency_keys` | `_id` = `uid:scope:key` | claimed before a funding movement, completed after — which is what lets a replay tell "already done" from "died halfway" |

`POST /auth/login` upserts the user and appends a login event, so repeat logins increment
`login_count` rather than duplicating the record.

**An unverified email reaches nothing.** Anyone can type an address they do not own, so
until Firebase has seen the confirmation link the identity behind a token is only a claim.
`get_current_user` refuses it with `403` — one guard, and every protected route depends on
that function, so there is no route to forget. `POST /auth/login` verifies its token
directly rather than through the dependency, so it repeats the same check. `POST
/auth/signup` still creates the account, because the client needs to sign in for a moment
to make the Web SDK send the verification mail (the Admin SDK can mint a link but has no
mailer). Clicking the link refreshes the token, and the next request simply carries
`email_verified: true`. Google accounts arrive verified and are unaffected.
`tests/test_email_verification.py` is the self-check: `python tests/test_email_verification.py`.

The two onboarding collections are deliberately split. The session is editable and
disposable — an abandoned one is swept by the TTL index after 30 days, which keeps
half-finished KYC data from lingering. The profile is the record of what the user actually
attested to, so it is written once at submit and the signup flow never edits it again.
Submit also unsets `expires_at`, so a submitted application is outside the TTL index twice
over: the partial filter only covers `status: "in_progress"`, *and* the field is gone.

The unique index on the identity document is what enforces one account per PAN/passport —
a read-then-write check in the service would lose that race between two concurrent submits.

## Routes

`{id}` is the 32-char hex watchlist id. Routes with no body show their query string
instead; `—` means the request carries nothing but the bearer token.

| Route | Purpose | Sample request | Response |
|---|---|---|---|
| `GET /` | API identity | — | `{ "message": "Stocks360 API" }` |
| `GET /health` | Liveness + MongoDB check. `503` when the DB is unreachable | — | `{ status, database }` |
| `GET /auth/config` | Firebase Web SDK config from `.env`, so clients never hardcode it | — | `{ apiKey, authDomain, projectId, storageBucket, messagingSenderId, appId, measurementId }` |
| `POST /auth/signup` | Create an email/password user from `{ email, password, display_name? }`. The account can reach nothing until the address is verified; the client sends that email via the Web SDK. `409` if the email exists, `422` on bad email / password under 6 chars | `{"email": "you@example.com", "password": "hunter2secret", "display_name": "Ada L"}` | `201` + user |
| `POST /auth/login` | Verify a client-obtained ID token from `{ id_token }` — works for both email/password and Google. Upserts the user and logs the login. `403` while the email is unverified | `{"id_token": "eyJhbGciOiJSUzI1NiIs…"}` | user |
| `GET /auth/me` | Current user, from `Authorization: Bearer <id_token>` | — | user |
| `POST /auth/logout` | Revoke the user's refresh tokens, ending existing sessions | — (no body) | `{ message }` |
| `GET /users/me` | Stored MongoDB profile. `404` before the first login | — | profile |
| `GET /users/me/logins` | Login history, newest first. `?limit=` 1–100, default 20 | `?limit=20` | list of events |
| `PATCH /users/me` | Update your display name — the only profile field editable directly; KYC sections go through `PATCH /onboarding/kyc` | `{"name": "Ada Lovelace"}` | profile |
| `POST /onboarding/step` | Submit one signup step. `step` in the body selects the shape and the rules. `409` out of order / ineligible / already submitted | `{"step": "contact", "mobile_country_code": "+91", "mobile_number": "9876543210", "country_of_residence": "IN", "nationality": "IN"}` | session |
| `GET /onboarding/session` | Resume — progress + everything captured, identifiers masked | — | session |
| `PATCH /onboarding/kyc` | Correct one section of an **already-submitted** application — same per-step bodies as `POST /onboarding/step`. `404` nothing submitted yet, `409` for `markets`/`agreements` (out of scope) or a duplicate identity document | `{"step": "contact", "mobile_country_code": "+91", "mobile_number": "9998887770", "country_of_residence": "IN", "nationality": "IN"}` | session |
| `POST /onboarding/submit` | Freeze the session into `kyc_profiles` and open the products. `404` no session, `409` incomplete or duplicate document | — (no body) | outcome |
| `WS /market/overview/stream` | **Public, no token.** Headline crypto, forex and equity prices with percent change, all on one socket | connect, then `{"action": "ping"}` or `{"action": "resync"}` | overview frames |
| `GET /crypto/symbols` | Tradable spot symbols. `?quote_asset=`, `?search=`, `?tradable_only=`, `?limit=` 1–2000 | `?quote_asset=USDT&search=btc&tradable_only=true&limit=100` | list of symbols |
| `GET /crypto/ticker/{symbol}` | 24h ticker, served from the live cache when available | `/crypto/ticker/BTCUSDT` | quote |
| `GET /crypto/tickers` | Batch tickers. `?symbols=BTCUSDT,ETHUSDT` or repeated `?symbols=`, max 50 | `?symbols=BTCUSDT,ETHUSDT` | list of quotes |
| `GET /crypto/orderbook/{symbol}` | Depth. `?limit=` one of 5/10/20/50/100/500/1000 | `/crypto/orderbook/BTCUSDT?limit=20` | order book |
| `GET /crypto/klines/{symbol}` | **Public — no token.** Candles. `?interval=` 1m–1M, `?limit=` 1–1000 | `/crypto/klines/BTCUSDT?interval=1h&limit=200` | series |
| `GET /crypto/stream/stats` | Fan-out diagnostics for this process | — | stats |
| `POST /crypto/watchlists` | Create an instance from `{ name, symbols }`. `409` duplicate name or cap reached | `{"name": "Majors", "symbols": ["BTCUSDT", "ETHUSDT"]}` | `201` + watchlist |
| `GET /crypto/watchlists` | Your watchlists, newest first. `?limit=` 1–200 | `?limit=50` | list |
| `GET /crypto/watchlists/{id}` | One watchlist | — | watchlist |
| `GET /crypto/watchlists/{id}/quotes` | The same snapshot a socket gets on connect | — | quotes |
| `PATCH /crypto/watchlists/{id}` | Rename and/or replace symbols; re-binds open sockets | `{"name": "Majors v2", "symbols": ["BTCUSDT", "SOLUSDT"]}` | watchlist |
| `POST /crypto/watchlists/{id}/symbols` | Add symbols, idempotent; re-binds open sockets | `{"symbols": ["SOLUSDT"]}` | watchlist |
| `DELETE /crypto/watchlists/{id}/symbols/{symbol}` | Remove one symbol. `409` if it is the last one | `/crypto/watchlists/{id}/symbols/SOLUSDT` | watchlist |
| `DELETE /crypto/watchlists/{id}` | Delete it and close its sockets | — | `204` |
| `WS /crypto/watchlists/{id}/stream` | Live quotes for that instance. `?token=<id_token>` | connect `?token=eyJhbGciOi…`, then `{"action": "ping"}` or `{"action": "resync"}` | stream frames |
| `GET /forex/pairs` | Supported pairs. `?base=`, `?quote=`, `?search=`, `?limit=` 1–1000 | `?base=EUR&quote=USD&limit=100` | list of pairs |
| `GET /forex/session` | Whether the interbank market is open | — | session |
| `GET /forex/quote/{pair}` | Quote with bid, ask, mid and the spread in price and pips | `/forex/quote/EUR-USD` | quote |
| `GET /forex/quotes` | Batch quotes. `?symbols=EUR-USD,GBP-USD` or repeated, max 30 | `?symbols=EUR-USD,GBP-USD` | list of quotes |
| `GET /forex/candles/{pair}` | **Public — no token.** `?interval=` 1m–1mo, `?range=` 1d–max. Two sources, picked by interval: at `1m`/`2m`/`5m` the bars are **aggregated from AwesomeAPI ticks** (its `/json/{pair}/100` feed, ~46s apart, ~77 min of history) because Yahoo's own fine FX intervals are price-rounded before publication — an hour of `1m` came back 100 % flat (`o==h==l==c`) and `5m` held barely two distinct price levels, which draws as a row of dashes. Ticks are unrounded, so aggregating them gives 2 % flat at `2m`. Coarser intervals come from the Yahoo chart feed (`EURUSD=X`), since 100 ticks cannot cover a day. AwesomeAPI's raw rows are never used as candles directly: its `high`/`low` are session extremes repeated identically on every row and `varBid` is change against the session open. | `/forex/candles/EUR-USD?interval=2m&range=1d` | series |
| `GET /forex/stream/stats` | Fan-out diagnostics for this process | — | stats |
| `POST /forex/watchlists` | Create an instance from `{ name, symbols }` | `{"name": "Majors", "symbols": ["EUR-USD", "USD-JPY"]}` | `201` + watchlist |
| `GET /forex/watchlists` | Your watchlists, newest first | `?limit=50` | list |
| `GET /forex/watchlists/{id}` | One watchlist | — | watchlist |
| `GET /forex/watchlists/{id}/quotes` | The snapshot a socket gets on connect, plus market state | — | quotes |
| `PATCH /forex/watchlists/{id}` | Rename and/or replace pairs; re-binds open sockets | `{"name": "FX majors", "symbols": ["EUR-USD", "GBP-USD"]}` | watchlist |
| `POST /forex/watchlists/{id}/symbols` | Add pairs, idempotent; re-binds open sockets | `{"symbols": ["GBP-USD"]}` | watchlist |
| `DELETE /forex/watchlists/{id}/symbols/{pair}` | Remove one pair. `409` if it is the last | `/forex/watchlists/{id}/symbols/GBP-USD` | watchlist |
| `DELETE /forex/watchlists/{id}` | Delete it and close its sockets | — | `204` |
| `WS /forex/watchlists/{id}/stream` | Live quotes for that instance. `?token=<id_token>` | connect `?token=eyJhbGciOi…`, then `{"action": "ping"}` or `{"action": "resync"}` | stream frames |
| `GET /stocks/instruments` | Search the instrument master. `?search=`, `?limit=` 1–50 | `?search=reliance&limit=10` | list of instruments |
| `GET /stocks/quote/{symbol}` | Quote with price, change, day range, volume, market state | `/stocks/quote/RELIANCE.NS` | quote |
| `GET /stocks/quotes` | Batch quotes. `?symbols=AAPL,RELIANCE.NS`, max 20 | `?symbols=AAPL,RELIANCE.NS` | list of quotes |
| `GET /stocks/candles/{symbol}` | **Public — no token.** `?interval=` 1m–1mo, `?range=` 1d–max | `/stocks/candles/AAPL?interval=1d&range=1mo` | series |
| `GET /stocks/stream/stats` | Fan-out diagnostics for this process | — | stats |
| `POST /stocks/watchlists` | Create an instance from `{ name, symbols }` | `{"name": "Nifty picks", "symbols": ["RELIANCE.NS", "AAPL"]}` | `201` + watchlist |
| `GET /stocks/watchlists` | Your watchlists, newest first | `?limit=50` | list |
| `GET /stocks/watchlists/{id}` | One watchlist | — | watchlist |
| `GET /stocks/watchlists/{id}/quotes` | The snapshot a socket gets on connect | — | quotes |
| `PATCH /stocks/watchlists/{id}` | Rename and/or replace tickers; re-binds open sockets | `{"name": "India + US", "symbols": ["TCS.NS", "MSFT"]}` | watchlist |
| `POST /stocks/watchlists/{id}/symbols` | Add tickers, idempotent; re-binds open sockets | `{"symbols": ["MSFT"]}` | watchlist |
| `DELETE /stocks/watchlists/{id}/symbols/{symbol}` | Remove one ticker. `409` if it is the last | `/stocks/watchlists/{id}/symbols/MSFT` | watchlist |
| `DELETE /stocks/watchlists/{id}` | Delete it and close its sockets | — | `204` |
| `WS /stocks/watchlists/{id}/stream` | Live quotes for that instance. `?token=<id_token>` | connect `?token=eyJhbGciOi…`, then `{"action": "ping"}` or `{"action": "resync"}` | stream frames |
| `GET /trading/account` | Balances, the onboarding outcome that gates trading, and what is currently open | — | account |
| `GET /trading/eligibility` | What you may trade and why not — the order endpoint's gates, answered up front | — | eligibility |
| `GET /trading/balances` | The account balance. One wallet, in `TRADING_ACCOUNT_CURRENCY`, opened at `TRADING_INITIAL_BALANCE` (1000 USDT) on first read. `reserved` is locked by open orders and pending withdrawals | — | list of balances |
| `GET /trading/fx-rate` | What `currency` is worth in the account balance right now — `app.trading.fx.rate_for` exposed for a client pricing an order before it exists to carry its own `fx_rate`. `1` for the account currency and anything pegged to it, no network call. `409` if nothing prices it | `?currency=INR` | fx rate |
| `GET /trading/ledger` | Every balance movement, newest first. `?currency=`, `?kind=`, `?limit=` 1–200 | `?currency=USDT&kind=trade_debit&limit=50` | list of entries |
| `POST /trading/orders` | Place an order, long or short. `403` product not enabled, `404` unknown instrument, `409` closed market / insufficient funds / duplicate id / short not allowed on this class / would flip through zero, `422` price band or stop side | `{"asset_class": "crypto", "symbol": "BTCUSDT", "side": "buy", "type": "limit", "quantity": "0.05", "limit_price": "58000.00", "time_in_force": "gtc", "client_order_id": "ui-7f3a2b91"}` | `201` + order |
| `GET /trading/orders` | Your orders, newest first. Repeat `?status=`, plus `?asset_class=`, `?symbol=`, `?limit=` 1–200 | `?status=open&status=filled&asset_class=crypto` | list of orders |
| `GET /trading/orders/{id}` | One order | — | order |
| `DELETE /trading/orders/{id}` | Cancel an open order and release its reservation. `409` if it already filled | — | order |
| `GET /trading/trades` | Your fills, newest first. `?asset_class=`, `?symbol=`, `?limit=` 1–200 | `?symbol=BTCUSDT&asset_class=crypto` | list of trades |
| `GET /trading/positions` | What you hold, in base units, **signed** — negative is a short, with `direction` saying which. `?include_flat=` to show closed ones | `?include_flat=false` | list of positions |
| `GET /trading/positions/{asset_class}/{symbol}` | One position | `/trading/positions/crypto/BTCUSDT` | position |
| `GET /trading/portfolio` | Positions marked to market, with a real grand total: `cash`, `margin_used`, `equity`, `market_value` (net signed exposure), `free_margin` | — | portfolio |
| `GET /platform/settings` | Public announcement, support address and enabled QR deposit rails | — | settings |
| `POST /funding/deposits` | Report a deposit **for review**. Credits nothing. The currency/network must match an enabled platform QR rail and `reference` must identify the blockchain transaction | `{"amount": "1000.00", "network": "BEP20", "reference": "0xabc123", "idempotency_key": "dep-2026-08-19-001"}` | `201` + request |
| `POST /funding/withdrawals` | Request a payout. **Locks the amount immediately.** `409` when `available` is short | `{"amount": "400.00", "network": "TRC20", "destination": "TXk9aQ1bV2c3D4e5F6g7H8j9K0l", "idempotency_key": "wd-2026-08-19-001"}` | `201` + request |
| `GET /funding/requests` | Your requests, newest first. `?kind=`, `?status=`, `?currency=`, `?limit=` 1–200 | `?kind=withdrawal&status=pending` | list of requests |
| `GET /funding/requests/{id}` | One request | — | request |
| `DELETE /funding/requests/{id}` | Cancel your own pending request; releases a withdrawal's lock. `409` once resolved | — | request |
| `GET /admin/funding/requests` | **Admin.** Every user's requests — the review queue. `?kind=`, `?status=`, `?currency=`, `?uid=`, `?limit=` | `?status=pending` | list of requests |
| `GET /admin/funding/summary` | **Admin.** Pending counts, and what the venue holds per currency | — | summary |
| `POST /admin/funding/requests/{id}/approve` | **Admin.** Settle it: credit a deposit, pay out a withdrawal from its lock. `409` if not pending | `{"note": "tx confirmed"}` | request |
| `POST /admin/funding/requests/{id}/decline` | **Admin.** Turn it down and release a withdrawal's lock | `{"note": "address not whitelisted"}` | request |
| `GET /admin/overview` | **Admin.** User, KYC, order, position and pending-funding totals | — | overview |
| `GET/PATCH /admin/settings` | **Admin.** Control the announcement, support email and QR deposit rails | see `PlatformSettingsUpdate` in OpenAPI | settings |
| `GET /admin/users/directory` | **Admin.** Search and paginate every account | `?search=ada&limit=50&offset=0` | paginated users |
| `GET /admin/users/{uid}/operations` | **Admin.** Balances, orders, fills, positions, ledger and login history | — | operational detail |
| `PATCH /admin/users/{uid}/control` | **Admin.** Suspend/restore an account; suspension also cancels open orders | `{"status":"suspended","reason":"Compliance review"}` | profile |
| `POST /admin/users/{uid}/kyc-review` | **Admin.** Approve or reject submitted KYC | `{"decision":"approve","reason":"Documents verified"}` | review result |
| `PATCH /admin/users/{uid}/products` | **Admin.** Replace an approved account's enabled product set | `{"enabled_products":["crypto_spot"],"reason":"Access review"}` | review result |
| `POST /admin/users/{uid}/balance-adjustments` | **Admin.** Audited signed ledger adjustment with idempotency | see OpenAPI | ledger entry |
| `POST /admin/users/{uid}/revoke-sessions` | **Admin.** Revoke all Firebase refresh tokens for a user | `{"reason":"Compromised device"}` | revocation result |
| `DELETE /admin/users/{uid}/orders/{order_id}` | **Admin.** Cancel an open order and release reservations | — | order |
| `GET /admin/audit` | **Admin.** Newest privileged actions, optionally filtered by target user | `?target_uid=...` | audit entries |
| `GET /admin/users` | **Admin.** Find a user by exact email. `404` if none | `?email=ada@example.com` | profile |
| `GET /admin/users/{uid}` | **Admin.** Stored profile plus the same masked KYC recap the user sees on their own account page | — | profile + KYC |
| `PATCH /admin/users/{uid}` | **Admin.** Update a user's display name on their behalf | `{"name": "Ada Lovelace"}` | profile |
| `PATCH /admin/users/{uid}/kyc` | **Admin.** Correct one section of a user's submitted application — same rules as `PATCH /onboarding/kyc` | `{"step": "identity", "document_type": "pan", "document_number": "ABCDE1234F", "issuing_country": "IN"}` | session |
| `GET /test` | Browser test page (not in OpenAPI schema) | — | HTML |
| `GET /test/onboarding` | Onboarding test page (not in OpenAPI schema) | — | HTML |

User shape: `{ uid, email, name, picture, provider, email_verified }`, where `provider`
is `password` or `google.com`. The stored profile adds `created_at, updated_at,
last_login_at, login_count`.

Sign-in itself always happens **client-side** via the Firebase Web SDK — the Admin SDK
cannot verify passwords. The client signs in, gets an ID token, and sends it here.

## Onboarding

Firebase sign-up only creates a login. Trading needs a KYC application on top of it, so
onboarding is a separate, resumable funnel of ten steps — all authenticated, all keyed on
the caller's uid from the bearer token. There is no client-supplied session id: a session
belongs to a uid, so it resumes on any device and cannot be pointed at someone else's.

| # | `step` | Captures |
|---|---|---|
| 1 | `contact` | mobile + country code, country of residence, nationality |
| 2 | `personal` | legal name, date of birth, gender, country of birth |
| 3 | `address` | residential address, and permanent if it differs |
| 4 | `identity` | document type + number, issuing country, expiry |
| 5 | `tax` | tax residency, TIN or a reason there is none, US-person, PEP status, source of funds |
| 6 | `financial` | occupation, employer, income + net-worth band, experience, risk tolerance, objectives |
| 7 | `markets` | requested products, base currency |
| 8 | `funding` | primary method + bank account (IFSC/SWIFT/IBAN/ABA/sort code) or crypto networks |
| 9 | `security` | 2FA method, anti-phishing code, withdrawal whitelist, new-device alerts |
| 10 | `agreements` | versioned consent per document |

One endpoint serves all ten. `POST /onboarding/step` takes a **discriminated union** on
`step`, so the body shape and the validation rules follow the step the client names — a
`contact` body with `identity` fields is a `422`, not a partially-applied write. Every call
returns the whole session, so the client never has to track its own position in the funnel.

**Order is enforced by the server.** A step is accepted only once every earlier step
exists, which is what lets the later rules trust the data they check against. A step may be
re-submitted to correct it, right up until submit.

**`markets` has no eligibility gate.** A client may select any combination of products
regardless of the declared financial profile — the only checks are the ones on `MarketsStep`
itself (at least one product, no duplicates). What varies by product is handled after
submit: `REVIEW_GATED_PRODUCTS` decides which selected products go live immediately versus
wait on a human review of the income proof.

**Consent is derived, not trusted.** The required agreement set is computed from the chosen
products — crypto implies the crypto risk disclosure, foreign equity implies the
cross-border remittance declaration, anything leveraged implies the derivatives disclosure.
Consent is stored per document *and* version, with the IP and user agent it was given from,
so a reissued policy needs fresh consent.

**Submit is the state transition.** `POST /onboarding/submit` requires all ten steps, then
writes `kyc_profiles`, closes the session to edits, and denormalises the outcome onto the
user. Non-leveraged products go live immediately; review-gated ones come back as
`pending_products` and wait on the income proof. Tiers run
`unverified` → `basic` (identity captured) → `verified` (submitted) → `pro`, where `pro` is
granted by the review that clears the pending products.

Two things this deliberately does **not** do, because they need services that are not
configured yet: it does not verify the mobile number (no SMS provider — the `contact` step
captures it, an OTP check belongs in front of it), and it does not store field-level
encrypted identifiers. `kyc_profiles` holds full document, tax and bank numbers because
verification needs them; responses mask all four via `_MASKED_PATHS` in
`onboarding/service.py`, so the full values never travel back out. Encrypting them at rest
is the next step and should land before real applications are accepted.

## Crypto market data and streams

Prices come from Binance's **public** market-data endpoints — no key, no secret, no
signing. Symbols, tickers, depth and candles are plain reads; the interesting part is the
streaming.

### One socket per watchlist, one upstream connection for everyone

A watchlist is the streamable instance: create one, and its `stream_url` is a WebSocket
carrying just its symbols. Behind all of them sits a **single** upstream connection with
reference-counted symbols, in `crypto/hub.py`. A hundred sockets watching BTCUSDT cost one
upstream subscription, and the subscription is dropped the moment the last interested
socket goes away.

The alternative — one upstream connection per watchlist — would multiply the exchange's
connection limits by our user count and get the server IP banned. It also makes a network
blip N reconnects instead of one.

```
GET  /crypto/watchlists                    -> your instances
POST /crypto/watchlists  {name, symbols}   -> 201 + stream_url
WS   /crypto/watchlists/{id}/stream?token= -> subscribed, snapshot, quote…
```

### Stream protocol

The server sends JSON frames, each with a `type` and an `at`:

| `type` | When | Carries |
|---|---|---|
| `subscribed` | Immediately on connect | `symbols`, `version`, upstream `state` |
| `snapshot` | Right after `subscribed`, and after a resync | `quotes` for every symbol |
| `quote` | Every upstream tick | one `quote` |
| `resynced` | The watchlist was edited over REST | new `symbols`, `version`, `quotes` |
| `deleted` | The watchlist was deleted | then closes with `4410` |
| `heartbeat` | After `CRYPTO_HEARTBEAT_SECONDS` of silence | `dropped` count |
| `upstream` | Upstream connectivity changed | `state`: connected / disconnected / reconnected |
| `pong` / `error` | Answering a client command | `detail` on error |

Clients may send only `{"action": "ping"}` or `{"action": "resync"}`; anything else comes
back as an `error` frame and the socket stays open. Close codes are in the application
range so a client can branch without parsing text: `4401` unauthenticated, `4404` no such
watchlist for this user, `4429` too many open sockets, `4410` watchlist deleted.

Editing a watchlist over REST **re-binds any open socket in place** — it gets a `resynced`
frame and the new symbol starts ticking without a reconnect. Deleting it pushes `deleted`
and closes. That is what makes the instance and its socket feel like one object.

The initial `snapshot` is filled from REST when the hub has no cached tick yet. A freshly
subscribed symbol has nothing cached until the exchange next publishes, which on a quiet
pair is long enough to look broken.

### Things worth knowing

- **Auth on a WebSocket** goes in `?token=`, because browsers cannot set headers on a
  WebSocket handshake. A bearer header is also accepted for non-browser clients. The token
  is verified with `check_revoked=True`, like every other protected route.
- **Prices are JSON strings**, not numbers. They are `Decimal` server-side and serialise as
  strings, so a float round-trip cannot lose precision on satoshi-level increments.
- **Symbols are validated against the live symbol universe** before any watchlist write or
  subscription. Subscribing to something the exchange will not stream would otherwise
  produce a socket that silently never delivers a tick.
- **Slow clients shed data, not memory.** Each socket has a 64-frame queue; when it fills,
  the oldest tick is dropped and counted in `dropped` on the next heartbeat. For a ticker
  feed the newest price is the only one that matters.
- **Backpressure never reaches the hub.** Fan-out is `put_nowait` only, so one stalled
  client cannot stall the upstream read loop or any other socket.
- **The hub state is per process.** Under multiple uvicorn workers each worker keeps its own
  upstream connection and its own subscriber set — correct, but not shared, so a watchlist
  edit handled by worker A cannot re-bind a socket held by worker B. Run a single worker,
  or move the hub to Redis pub/sub, before scaling out.
- **A market-data outage does not stop the API.** The hub dials out on its own with
  backoff (1, 2, 5, 10, 20, 30s), so the app boots and serves with the stream down; REST
  reads still work, sockets still open, and open sockets get an `upstream` frame when it
  returns. On reconnect the subscription set is rebuilt from the refcounts, including
  symbols added while it was down.
- **Reading market data is not KYC-gated.** It is authenticated but does not check the
  onboarding `enabled_products`; quotes are public data. Gate order placement, not quotes.
- `logger.info` from app modules is invisible under uvicorn's default logging config — the
  hub's connect and reconnect lines only show up if you configure logging.

## Forex

Same idea as crypto, and deliberately the same route surface and stream contract, so a
client learns one shape. Data comes from AwesomeAPI's **public** endpoints — no key, no
secret. Three things genuinely differ, and the design says so rather than pretending
otherwise:

**There is no order book.** FX is over-the-counter; there is no central book to publish.
The honest analogue of depth is the bid/ask spread, so every quote carries `spread` in
quote-currency terms and `spread_pips` alongside the `pip_size` used to compute it. Pip
size follows convention: `0.01` for JPY-quoted pairs and the metals, `0.0001` otherwise.
Getting that wrong puts every spread reading out by two orders of magnitude.

**The upstream is polled, not pushed.** This provider has no WebSocket, so the hub asks
for the subscribed pairs on an interval. One batched request covers every pair, so the
one-upstream-for-everyone property still holds — the cost is one request per interval no
matter how many clients are connected. Two consequences a push feed does not have:

- A `quote` frame means the price **actually moved**. An unchanged poll broadcasts nothing;
  re-sending an identical quote every few seconds would flood clients for no information.
- With nobody subscribed there is nothing to poll, so a slow canary poll keeps
  `upstream_connected` meaningful instead of unknowable.

**The market is 24/5.** The interbank week runs Sunday 21:00 UTC to Friday 21:00 UTC, so
`GET /forex/session` reports the state, every quote carries `market_state` and `stale`, and
`/forex/watchlists/{id}/quotes` reports it too. Over a weekend nothing ticks: you get
heartbeats, no `quote` frames, and every pair flagged `stale` holding Friday's close. That
is the market being shut, not a broken feed. Holidays are not modelled — a holiday looks
exactly like a weekend from the data's side, and `stale` covers it.

Pairs are canonically `BASE-QUOTE` (`EUR-USD`). `EURUSD`, `EUR/USD` and `eur_usd` are all
accepted and normalised; the hyphenated form is canonical because currency codes are not
always three characters (the provider lists `BRLT`), so splitting a compact string is
ambiguous in general — only the unambiguous 6-character case is split.

Candles reconstruct the open as `close - change`: the provider publishes high, low, the
closing bid and the change, but no explicit open. Each day's derived open chains exactly to
the previous day's close, which is the check that it is right.

### What the two feeds share

`streaming/hub.py` holds everything that is not about a particular provider —
reference-counted symbols, fan-out to per-socket queues, re-binding a live socket when its
watchlist changes, backpressure, and cache warming. Each feed subclasses it and supplies
only its upstream: crypto holds one Binance socket and sends SUBSCRIBE/UNSUBSCRIBE frames,
forex polls a batch endpoint and needs neither. `schemas/streaming.py` holds the frame
contract, generic over the quote type, so both feeds emit identical frames with their own
quote shape. `streaming/watchlists.py` is the storage, parameterised by collection.

One subtlety worth keeping: `register()` and `rebind()` **warm the cache** for symbols the
hub has not seen. Without it a newly added pair has no quote in the `resynced` frame until
the upstream next publishes it — which on a closed market is never — and on a polled feed
the first poll after connect would re-broadcast a price the client was just handed,
breaking the "a quote means it moved" rule.

## Equities (instruments)

The third feed, same route surface and stream contract as the other two. Data comes from
**Yahoo Finance**, which is the honest compromise: it is the only keyless source covering
NSE, BSE and US listings through one API, so the instrument gap closes today without
waiting on a key.

**It is undocumented and unsanctioned.** Fine for development and demos; not something to
put real customers on. Every Yahoo-specific detail lives in `stocks/upstream.py`, so moving
to Alpaca or Finnhub (US, both with a real WebSocket on the free tier) or to a broker API
like Angel One / Dhan / Upstox / Fyers (the only realistic route to live NSE/BSE ticks) is
a rewrite of that one file.

Three things equities do differently:

**The instrument master is a search, not a download.** Crypto and forex publish a universe
this app caches; the equity universe spans every exchange on earth. So `/stocks/instruments`
queries upstream, and a ticker is validated by resolving it rather than by a set lookup.

Yahoo's search is also **not deterministic** — asking it for "reliance" can come back
without `RELIANCE.NS` at all. Re-ranking cannot recover a row that is absent, so when
nothing in the result is a strong ticker match the code falls back to resolving
`<QUERY>`, `<QUERY>.NS` and `<QUERY>.BO` directly and puts whatever exists at the front.
That is the difference between the endpoint being dependable and being a curiosity:
`reliance` → `RELIANCE.NS`, `hdfc bank` → `HDFCBANK.NS`, `tcs` → `TCS.NS`.

**Market state is per symbol.** A watchlist can hold NSE and Nasdaq side by side and they
keep different hours, so each quote carries its own `market_state` with the exchange's
`session_start` / `session_end` — read from Yahoo's own trading period rather than a
hand-built calendar. NSE resolves to 03:45–10:00 UTC, Nasdaq to 13:30–20:00 UTC.

**Polling costs one request per ticker.** `/v7/finance/quote` now answers `401` without a
session crumb, so there is no working unauthenticated batch endpoint. Reference counting is
what keeps this affordable — a hundred sockets on the same ticker still cost one request
per cycle — and the interval defaults to 15s with bounded concurrency, because the data is
~15 minutes delayed anyway and polling harder would only earn a ban.

Two smaller notes: prices are rounded with the instrument's own `priceHint`, since Yahoo
rounds its headline figures but ships candle arrays as raw floats (a close of 305.93
arrives as 305.92999267578125); and a **browser user agent is mandatory** — without one the
request fails outright, which does not look like an auth problem when you first hit it.

## Public market overview

`WS /market/overview/stream` — the one route in this API that needs **no token**. It carries
the headline symbols from all three feeds on a single socket: five crypto, five forex, five
equities, each with a price and a percent change. It exists for the pre-login landing page,
where asking a visitor to authenticate to see a public price makes no sense.

**It adds no upstream cost.** This is not a fourth feed; it registers with the same three
hubs the authenticated watchlist streams use, so the headline symbols are reference-counted
alongside everyone else's. Verified: one viewer subscribes 5 symbols per market, three
viewers still subscribe 5, and when the last viewer leaves the count returns to zero unless
a watchlist still wants them.

**One tick shape, not three.** Each feed mirrors its provider, so a crypto quote has
`last_price` / `price_change_percent`, forex has `mid` / `change_percent`, equities have
`price` / `change_percent`. A ticker strip should not care, so all three are normalised into
`MarketTick`:

```json
{ "market": "crypto", "symbol": "BTCUSDT", "price": "64345.41000000",
  "change": "717.20000000", "change_percent": "1.128",
  "at": "2026-08-18T14:08:56.106000Z", "stale": false }
```

For forex, `price` is the **mid** — a headline rate should not favour one side of the spread.
`change_percent` is nullable, because the equity provider does not always supply it. `stale`
follows each feed's own rule, so on a weekend every forex and equity row reads stale; that is
the market being closed, not a fault.

**Forex ticks also carry `bid` / `ask` / `spread` / `spread_pips`** (`null` for crypto and
equities). FX has no central order book to publish (see `/forex`'s own docs below), so the
real quoted spread is the honest analogue — and since it rides the same live tick as `price`,
it updates in real time on this socket instead of waiting on a REST poll.

**Frames** are the same vocabulary as the authenticated streams — `subscribed`, `snapshot`,
`quote`, `heartbeat`, `upstream`, `pong`, `error` — but a separate model, because this feed
spans three upstreams at once and has no watchlist to resync or delete. So `subscribed`
carries the symbol set *and* the connectivity of all three upstreams, and an `upstream` frame
names which `market` changed. There is no `resynced`: the symbol set is fixed configuration,
so `{"action":"resync"}` simply returns a fresh `snapshot`.

**"Top 5" is curated, not ranked.** Binance could rank by 24h volume, but the forex and
equity providers expose no ranking at all, so a live ranking would mean one definition for
crypto and a hardcoded list for the other two. A fixed list per market at least means the
same thing everywhere. Override `OVERVIEW_CRYPTO_SYMBOLS`, `OVERVIEW_FOREX_SYMBOLS` or
`OVERVIEW_STOCKS_SYMBOLS` to change them; a typo, a duplicate or more than 25 entries fails
at startup rather than serving a row nothing can ever price.

**Abuse limits, because there is no account to attribute.** `OVERVIEW_MAX_SOCKETS_PER_IP`
(default 4) and `OVERVIEW_MAX_SOCKETS` (default 500) both close with **4429**. The per-IP cap
is deliberately looser than the per-user stream caps since many people share one NAT address,
and the process-wide cap is there because addresses are cheap to come by.

## Trading

The three feeds so far only let a user *watch* a market. This is the part that lets them
act on it: cash, orders, fills, positions and a portfolio, across all three asset classes
through one order model.

**It is a simulated venue, and that is the first thing to know about it.** Orders execute
against the same live market data the read endpoints serve, and the cash is simulated book
money created as the configured opening balance or through an administrator-reviewed funding
request. There is no broker, no clearing member and no
custody behind any of it. The accounting is built to be correct — that is a different
claim from being real, and the two must not be confused before anyone is asked for money.

### The shape

**One balance funds everything.** An account holds a single wallet, in
**`TRADING_ACCOUNT_CURRENCY`** (`USDT`), and every asset class settles into it. A new
account opens with **`TRADING_INITIAL_BALANCE`** (`1000`), credited the first time the
wallet is touched and recorded as an `Opening balance` deposit in the ledger — so the
balance reconciles against the ledger from its very first row rather than starting from a
number nothing explains.

Positions are still **per instrument**. Buying `BTCUSDT` gives a position in `BTCUSDT`
measured in BTC. An instrument priced in something other than the account currency —
`EUR-USD` in USD, `RELIANCE.NS` in INR — has its notional converted by `app/trading/fx.py`,
so the same USDT funds a Mumbai listing and a Bitcoin position. The rate is fetched once
when the order is placed and carried on the order as `fx_rate`, for two reasons: the same
order can then never settle at two different rates, and the matcher — which fills resting
orders from the quote cache and must never make a network call — can settle without looking
one up. A currency nothing can price against the account currency is a `409` at placement.

This splits every money field in two, and each one says which it is:

| In the instrument's `currency` | In `account_currency` |
|---|---|
| `limit_price`, `stop_price`, `average_price`, `last_price` | `fee`, `filled_notional`, `reserved_amount`, `cost_basis`, `margin_used`, `realized_pnl`, `market_value`, every balance |

**Positions are signed, and both directions are real.** `quantity` is positive for a long
and negative for a short, one document per instrument either way, with `direction` stating
which so nothing has to infer it from a minus sign. A sell against a long reduces it and
reserves the units; a sell with nothing behind it opens a short and reserves cash instead.

Shorting is allowed on the asset classes in **`TRADING_SHORT_SELLING_CLASSES`** — all three
desks by default. A cash-delivery deployment can remove equities from that setting. An order
that would carry a position *through* zero (selling 6 against a long of 5) is a `409`: one
fill carries one fee, and splitting it across a close and an open makes both halves
approximate, so "close it, then open the other way" is two orders that each price honestly.

Both directions are leveraged at a fixed **`TRADING_LEVERAGE`** (200 by default), applied
the same way across all three asset classes: opening locks only
`notional / TRADING_LEVERAGE` plus the fee rather than the full notional (see "Leverage and
margin calls" below) — that is the one place "no margin" stopped being true. Derivatives
and intraday are in the product catalogue because onboarding asks about them; they are not
implemented here, and an order needing one is refused on the product gate rather than
half-supported.

### One settlement path, and the bug that made it necessary

`money.apply_fill` turns one fill into a complete set of deltas — quantity, cost basis,
margin, realized P&L, and the cash the wallet moves — and `service._settle_fill` applies
them. There is no branch on side or direction anywhere in it.

That is not tidying. There used to be a `_settle_buy` and a `_settle_sell`, and the split is
what let a leveraged round trip **mint money**: a buy took only its margin out of the wallet
while the matching sell credited the *full gross proceeds* back in, so buying and selling at
one unchanged price left the account richer by almost the whole notional. Closing now
returns the margin released plus the P&L realized, which is the only pair of numbers that
conserves. `tests/test_account_lifecycle.py` asserts exactly that, on every lifecycle it
runs: equity must equal what was paid in plus P&L, and nothing else may appear.

The same rewrite fixed a second one: the margin sweep tested `margin_used < cost_basis` to
mean "leveraged", and a short's `cost_basis` is negative — so **every short was silently
exempt from margin calls**, on the one side whose loss is not bounded by the price reaching
zero. The test is now `margin_used > 0`, which covers both.

### What an order has to satisfy

The checks run in this order, each cheap one before the expensive one after it:

| Gate | Failure |
|---|---|
| Onboarding submitted and KYC tier reached — skipped only when `TRADING_OPEN_ACCESS=true` | `403` |
| Instrument exists on that feed | `404` |
| Its quote currency can be priced against the account currency | `409` |
| The product it needs is enabled — `crypto_spot`, `forex`, `domestic_equity_delivery` or `foreign_equity` — skipped only when `TRADING_OPEN_ACCESS=true` | `403` |
| Any supplied price is inside `TRADING_PRICE_BAND_PERCENT` of the last trade | `422` |
| A stop sits on the side it can be reached from | `422` |
| Quantity is at least `TRADING_MIN_QUANTITY` | `422` |
| Converted notional inside the per-order bounds, and under the open-order cap | `422` / `409` |
| For anything that must fill now: the market is open and the price is fresh | `409` |
| It does not carry the position through zero | `409` |
| If it opens a short, the asset class permits one | `409` |
| The cash or the units are actually there | `409` |

The notional bounds are checked on the **converted** figure, which is the first time they
have meant the same thing across markets — the old per-quote-currency band compared a number
of rupees against a number of dollars.

`TRADING_OPEN_ACCESS=true` can explicitly make every instrument on all three feeds tradable.
It defaults to `false`; with it on, the first and fourth rows above never fire: any
authenticated account may trade any crypto pair, any FX pair, and any listed equity, with
no per-product permission to hold and no onboarding step to complete first. A verified
Firebase token is the only requirement, and it always has been — every route here sits
behind one. The same flag also bypasses the onboarding/product portion of the reviewed
`/funding/*` gate; it never bypasses authentication or account suspension.

This is a deliberate call for what this venue *is*: a simulator holding book money it
creates itself, with no broker, no custody and nothing to launder. The onboarding/KYC/product
gates are modelled on a real brokerage's and remain enabled by default. Set
`TRADING_OPEN_ACCESS=true` only for a deliberately unrestricted paper-trading deployment;
the normal product keeps KYC and per-market permissions enforced.

With the flag off, the product gate distinguishes **under review** from **never requested**,
because the user can do something about one of them and not the other, and equities split on
the listing venue: `.NS` and `.BO` need the domestic product, everything else needs
`foreign_equity` (`TRADING_DOMESTIC_SUFFIXES`, because "domestic" is a deployment's fact, not
a constant). `GET /trading/eligibility` answers all of this up front either way, so a client
can disable a button rather than discover a `403` when someone presses it — under open access
every asset class simply reports `enabled: true`.

### Execution

Fills are **all-or-nothing at one price**. Simulating a partial fill means inventing depth
the feeds do not publish, so `partially_filled` is not in the status enum rather than being
a status nothing ever produces. `fok` is missing from the time-in-force enum for the same
reason — without partial fills it would be `ioc` under a second name.

A buy pays the ask and a sell hits the bid **where the feed publishes both**. Crypto and
forex do; the Yahoo equity feed publishes only a last traded price, so that is what is
used. Inventing a spread there would be inventing the number that matters most.

**Nothing fills against a closed or stale market.** A market order into one is a `409`; a
resting order simply waits, which is why a limit order can be placed out of hours. Each
feed's own staleness rule applies — forex and equity quotes carry `stale` themselves, and
crypto, which has no such notion because it never closes, is measured against
`CRYPTO_STALE_SECONDS`.

A `day` order expires at the end of the **UTC day** it was placed. Not the exchange's
session end: one endpoint spans three feeds whose sessions differ per symbol and per
exchange, and a rule a client can predict beats one that is marginally more faithful to
one of them.

### The matcher

A market order is filled by the request that places it. Everything else has to wait for
the market, and `trading/engine.py` is what watches.

It watches by **subscribing, not polling**: it registers with each hub as an ordinary
subscriber under a reserved id, holding exactly the symbols that have resting orders. The
hub's reference counting then keeps those symbols subscribed upstream for as long as an
order needs them and drops them when the last one closes — so a resting order on a symbol
nobody has in a watchlist still gets a live price, which a matcher reading only the quote
cache would not. Ticks arrive as frames in a bounded queue, exactly like a client socket.

A sweep runs alongside it every `TRADING_SWEEP_SECONDS`, because a tick is not the only
thing that can change an order's fate: a `day` order expires with no tick involved, an
order placed while the price was already past its trigger has no new tick coming, and a
crash between closing an order and releasing its reservation strands value. The sweep
re-reads state rather than trusting anything it remembers.

### Leverage and margin calls

Opening a position — in **either** direction — locks up `notional / TRADING_LEVERAGE` plus
the fee in cash instead of the full notional. A fixed, venue-wide rule (default 200, all
three asset classes alike), not a per-order choice, so there is no field for it on
`OrderRequest`. Crucially, a position's cost basis still carries the **full** notional:
unrealized P&L is `quantity * mark - cost_basis` either way, so leverage changes what a
position costs in cash and nothing about what a price move is worth.
`GET /trading/positions` reports the cash actually posted as `margin_used`, alongside the
unchanged `cost_basis`.

That is also what makes a margin position risky in a way a 1:1 one is not: it can reach
zero equity — `margin_used + unrealized P&L <= 0` — long before the price itself reaches
zero. And a **short** is worse still: its loss is not bounded by the price reaching zero at
all, which is why it is the side that most needs a liquidator watching. `trading/engine.py`
watches every margin-backed position's live ticks for exactly that (the same
subscribe-not-poll mechanism the matcher uses for resting orders) and, on a breach,
force-closes the position at the current mark through the ordinary order path — selling out
of a long, buying back a short, decided by the sign of the quantity. The resulting order and
trade both carry `liquidation: true`, so a margin call is never mistaken for something the
user placed. The periodic sweep re-checks every one as a backstop, the same way it re-tries
every resting order.

Because the engine reads FX rates from cache only (it runs per tick and must not touch the
network), a position in a currency nothing has priced yet is skipped rather than guessed at.
`fx.cached_rate` deliberately ignores its own TTL here: a rate a few minutes old is a far
better basis for a margin check than no check at all.

**When the engine is too slow.** A gap or a stale feed can leave a position losing more than
the account can cover. Closing it is still right — refusing would leave the user holding
something that only gets worse — so the fill goes through and the balance is allowed to go
negative, with a `critical` log. It is contained rather than open-ended: every reservation
and every withdrawal guards on available cash, so nothing can be traded or paid out of a
negative balance. An **opening** fill that cannot be funded is always rejected instead; this
venue does not lend to open a position.

Positions opened before this shipped are not retroactively at risk: one-time startup
backfills set their `margin_used` to their own `cost_basis` (i.e. fully collateralized) and
seed `cost_basis_quote` from `cost_basis`, since nothing about the price they were bought at
changed after the fact.

**What migration cannot fix.** A position opened before the balance became universal has its
`cost_basis` in the instrument's *own* currency, and restating it in USDT would need the rate
from the day it was opened, which nothing recorded. So it is left alone and **labelled
honestly**: orders, trades and positions all carry `account_currency`, and where it is absent
on the stored document the response reports `currency` instead. For anything USDT-quoted —
which is most crypto — the two are the same and nothing changed. For an old INR equity
position the figure is in rupees and says so, rather than wearing a USDT label it does not
deserve. New rows always carry the field explicitly, which is what makes the absence
meaningful rather than ambiguous.

### How the money is kept honest

- **`Decimal128`, never a float.** Every amount is quantised to eight places on the way in.
  A float round-trip on a balance is not a rounding inconvenience, it is a wrong number in
  someone's account.
- **Nothing is a read-then-write.** Reserving cash, reserving a position, cancelling an
  order and claiming a fill are each a single conditional `find_one_and_update`, with the
  condition that makes the operation legal inside the query. Checking a balance in Python
  and then decrementing it is the exact shape of a double-spend, and it appears nowhere.
- **Every balance change writes a ledger entry**, recording the balances that same
  operation produced. The ledger sums to the wallet rather than hoping to agree with it.
- **Reserve, then settle.** An order locks what it actually consumes before it is visible
  to the matcher: units when it is a sell against a long, cash in every other case
  including a sell that opens a short. A stop reserves at its stop price, and if the market
  gaps through it the difference is topped up from available cash — or an opening order is
  rejected, because this venue does not lend beyond the fixed leverage it already grants.
  The top-up runs on **every** fill, not only the cash-reserving ones: an order that
  reserved units can still settle a leveraged loss deeper than the margin behind it, and
  that difference comes out of the balance.
- **One conversion per order.** The FX rate is fixed at placement and stored on the order,
  so an order cannot settle at two different rates and settlement is pure arithmetic with
  no network call inside the matcher.
- **Money movements are idempotent by construction.** `idempotency_key` is required on
  deposits and withdrawals, claimed before the balance moves and completed after, so a
  replay can tell "already done, here is the original entry" from "the first attempt died
  halfway" instead of guessing. A retried deposit that credits twice is the one bug here
  nobody would notice until the numbers stopped adding up.
- **Order ids are scoped by uid on every read**, so someone else's order is a `404`, not a
  `403` — a 403 confirms the thing exists.

Two limits worth stating plainly rather than discovering:

**There is no multi-document transaction.** Settling a fill touches a wallet, a position,
an order and a trade. Each is individually atomic and the sequence is chosen so a crash
strands value rather than duplicating it — cash leaves before a position appears, a
position is reduced before proceeds arrive — and the sweep repairs the reservation half of
that window. A real transaction (Atlas is a replica set, so they are available) is the
honest fix, and it is the first thing to do before real money is involved.

**The matcher is per process**, like the hubs it rides on. Settlement is serialised by an
in-process lock; the atomic claim on a fill means two workers cannot both fill one order,
but the lock does not span processes. Run a single worker, or move the matcher behind a
shared queue, before scaling out.

`TRADING_ENABLED=false` stops new activity and leaves the reads working. Being unable to
place an order is a policy decision; being unable to see your own balance while one is
disabled is just a broken account page.

### Not built

- **No order-update WebSocket.** A resting order fills asynchronously and a client learns
  about it by polling `GET /trading/orders`. The frame contract in `schemas/streaming.py`
  would carry order events perfectly well; it is a decision, not an oversight.
- **No corporate actions.** A split or a dividend will silently misprice an equity
  position, because the feed reports the adjusted price and the stored cost basis is not
  adjusted with it.
- **FX is a mid, not a tradable rate.** `app/trading/fx.py` converts an instrument's quote
  currency to the account currency off the forex feed's mid, and the pegged currencies
  (`USDT`, `USDC`, `USD`) convert 1:1 because this API has no licensed source for the peg's
  deviation. So a conversion carries no spread of its own. The rate is also fixed at
  placement, so a GTC order resting for days settles at the rate it was placed at — stored
  on the order, so the number is explainable rather than merely stale.
- **No position flips in one order.** Selling 6 against a long of 5 is a `409`, not a close
  plus a short. One fill carries one fee and splitting it makes both halves approximate.
- **Configurable equity shorting.** `TRADING_SHORT_SELLING_CLASSES` includes `stocks` by
  default because this is a simulated margin venue. A cash-delivery deployment can remove it.

### Validation

Request bodies use `extra="forbid"`, so an unexpected field is a `422` rather than being
silently ignored — an unknown `"role": "admin"` can never slip through. Strings are
whitespace-stripped, `password` is 6–128 chars, `id_token` is 20–8192, and `limit` is
bounded 1–100. Onboarding closes every choice into an enum, so an unknown product or
document type is a `422`; identity numbers, IFSC/SWIFT/IBAN codes, PAN and Aadhaar are
checked against their real formats; date of birth must be 18–100 years ago; and lists
(`products`, `investment_objectives`, `accepted`) reject repeats. Country codes and
document numbers are normalised to upper case *before* the pattern runs, so `in` is
accepted as `IN`. Crypto symbols normalise the same way, order-book depth is an `IntEnum`
of the values the upstream actually accepts, and batch `?symbols=` is capped at 50 to stay
inside the upstream request weight. Every endpoint declares a `response_model`, and error shapes are declared
in OpenAPI via the reusable blocks in `schemas/common.py`.

Auth is enforced *before* body and query validation, so an unauthenticated request with a
bad `?limit` or a malformed onboarding step returns `401`, not `422` — failures never leak
schema details to strangers.

Two pydantic traps this codebase has already hit, both worth knowing before touching the
constrained types:

- In `schemas/onboarding.py` and `schemas/crypto.py`, `CountryCode` / `UpperCode` / `Symbol`
  list `StringConstraints` **before** `BeforeValidator`. Reversed, the normaliser wraps the
  constrained string and pydantic silently drops `pattern` from the generated schema —
  validation still works, but `/docs` stops documenting the format.
- A `BeforeValidator` on a **list query param** never runs: FastAPI validates a sequence
  query param item by item, so it cannot be used to split a comma-joined value. That is why
  `?symbols=` is parsed by `split_symbols()` in the endpoint rather than in the type. For
  the same reason `limit` on the order book is an `IntEnum` — pydantic will not coerce a
  query string into a `Literal[5, 10, …]`.

### Notes

- Token verification uses the Admin SDK, which checks signature, expiry, audience **and**
  issuer against the project tied to the service account, so tokens minted by other
  Firebase projects are rejected.
- Protected routes verify with `check_revoked=True`, so logout takes effect immediately.
  That costs one extra Firebase call per request — drop it in `dependencies.py` if the
  latency matters more than instant revocation.
- Logout floors the revocation timestamp just past the presenting token's `iat`. The SDK
  otherwise derives it from local time, so a server behind Google's clock would let a
  token survive its own logout.

## Funding and the review queue

There is no direct balance-minting funding endpoint. `/funding/*` is the only user-facing
path: a user reports a transfer against an administrator-configured QR rail and the balance
moves only after review. Withdrawals likewise remain reserved until an administrator records
the payout transaction reference or declines the request.

A request is **recorded** first. A balance moves only when a reviewer resolves it, and the
two directions are deliberately asymmetric:

| | On request | On approval | On cancel or decline |
|---|---|---|---|
| **Deposit** | nothing — the money is not here yet, and recording an unverified claim as a credit would be inventing funds | `available` is credited | nothing to undo |
| **Withdrawal** | the amount moves `available` → `reserved` at once | debited out of `reserved` | released back to `available` |

Locking a withdrawal immediately is what keeps the spendable balance honest at every
instant in between: the cash cannot be traded away, or withdrawn a second time, while a
reviewer is looking at the first request. It shares the `reserved` bucket with open buy
orders, so **`reserved` no longer means "locked by an order"** — it means locked, by
whatever is holding it. The two never collide, because an order's release is keyed to its
own order id and the sweep in `trading/engine.py` reads the *orders* collection.

Every movement goes through the same `apply_to_wallet` an order settlement uses, so
deposits and payouts land in the one ledger `GET /trading/ledger` already serves. There is
no second set of books to reconcile.

**Three states, not four.** `pending`, `completed`, `cancelled` — because those are the
three a user can act on. An admin declining and a user cancelling both land on
`cancelled`; which happened is in `resolved_by` and `resolution_note`, rather than in a
fourth status nothing would render any differently.

**Rails are closed and matched to the currency.** `FundingNetwork` enumerates the bank and
chain rails, and `NETWORKS_FOR` says which can carry which currency, so `INR` on `TRC20`
is a `422` the client can show next to the field instead of a request that sits in the
queue until somebody reads it closely. "BEP-20", "bep20" and "BSC" naming one chain is how
a verification queue turns into guesswork.

**Admin is an email allowlist, not a second password.** `ADMIN_EMAILS` is checked against
the same verified Firebase token every other route trusts, so there is no new secret to
leak or hardcode into a client, and `check_revoked=True` means signing an admin out ends
their staff session with it. It needs no email check of its own — `get_current_user`
already refuses an unverified address, which the allowlist depends on, since it keys on an
address that would otherwise be an unproven claim. Empty means nobody is an admin and every `/admin` route answers `403`: a deployment
that forgets to configure it gets a locked queue, not an open one.

### Two orderings that are chosen, not incidental

**A withdrawal request is written before its cash is locked**, then flipped to
`funded: true`. A crash in between leaves a request that cannot be approved — visible,
refusable, cancellable by the user — while the money stays spendable. The other order
would strand locked cash with nothing pointing at it, which only an operator could unpick.
Approval re-asserts `funded` *inside* the atomic claim, so the check cannot go stale.

**Approval claims the status before it moves the money.** `resolve()` puts
`status: "pending"` in the query, so two reviewers pressing approve at the same moment
produce one settlement and one `409`. A crash after the claim leaves a request marked
settled whose balance did not change — wrong, but visible as a missing `ledger_entry_id`
and repairable. Crediting first would let a retry credit twice, which is neither.

The same caveat as the rest of trading applies: there is no multi-document transaction
here either, so the sequence is chosen to strand value rather than duplicate it.

## Before you publish

| Setting | Dev | Production |
|---|---|---|
| `DOCS_ENABLED` | `true` | **`false`** — `/docs`, `/redoc` and `/openapi.json` publish every route, parameter and limit |
| `CORS_ALLOW_ORIGINS` | empty | exact origins, comma-separated. `*` is refused at startup |
| `TRUSTED_PROXY_HOPS` | `0` | number of proxies in front of the app (`1` behind one nginx/ALB/Cloudflare) |
| `FIREBASE_REVOCATION_TTL_SECONDS` | `30` | `30`, or `0` to trade ~400x latency for instant multi-instance revocation |
| `ADMIN_EMAILS` | empty | the staff addresses that may resolve funding requests. Empty locks the review queue, so this is required for `/admin/*` to do anything at all |

Still open before real customers — deliberately not built, since each needs a decision:

- **Rate limiting.** `POST /auth/signup` creates a Firebase user for anyone who asks, and
  every authenticated route will now happily serve from a warm token cache. Put a limiter
  at the edge (nginx `limit_req`, Cloudflare) or in front of the auth dependency.
- **Yahoo is unlicensed.** Fine for a demo, not for paying users. Swap
  `app/stocks/upstream.py` for Alpaca/Finnhub or a broker feed.
- **KYC data at rest.** `kyc_profiles` stores full PAN, TIN and bank account numbers.
  Atlas encrypts the disk, but anyone with a read connection string sees plaintext.
  Consider field-level encryption (Atlas CSFLE) and a retention policy.
- **Trading is a simulation.** `/trading/*` executes against live prices but there is no
  broker, no clearing and no custody. Nothing about it may be presented to a user as a real
  account. Before it could
  be: a real venue or broker behind the fills, multi-document transactions around
  settlement, and the matcher moved off a single process. See the Trading section.
- **Funding is reviewed, not settled.** `/funding/*` records what a user says they sent
  and what they want paid out, and an admin marks it done. Nothing here watches a chain or
  talks to a bank, so approving a deposit is a human asserting the money arrived. The
  accounting around that assertion is correct; the assertion itself is the part that needs
  a payment provider or a node behind it. The reviewed queue is therefore the only exposed
  user funding path; the old direct simulated deposit/withdrawal routes are not registered.

### Auth latency

`verify_id_token` does two very different jobs. Signature, expiry, audience and issuer
are checked locally against cached Google certificates — **~0.6ms**. `check_revoked=True`
additionally calls Google to compare the token's `iat` against the user's `validSince` —
**~384ms measured**, on every single protected request.

So a successful revocation check is cached per uid for
`FIREBASE_REVOCATION_TTL_SECONDS`. The signature is *always* verified, every request, so
a tampered or expired token is still rejected in full — only the network round-trip is
skipped. `revoke_tokens()` evicts the entry, which is why logout still takes effect
immediately rather than after the TTL. Behind a load balancer that guarantee holds only
for the instance that served the logout; the others catch up within the TTL.

## Credentials in logs

Browsers cannot set an `Authorization` header on a WebSocket handshake, so the stream
routes accept `?token=<jwt>`. Uvicorn's access log writes the full request line, which
put a live bearer credential into plaintext logs — replayable by anyone who could read
them, for the token's remaining hour.

Two changes, because either alone is insufficient:

- `app/streaming/ws_auth.py` prefers `Sec-WebSocket-Protocol: bearer, <token>` — the one
  header a browser *will* set on a handshake — so the token need not be in the URL at
  all. `?token=` still works for clients that cannot do this.
- `app/core/logging.py` installs a filter on the uvicorn loggers that rewrites any
  `token=`/`access_token=`/`Bearer …` value to `[REDACTED]`, so the guarantee does not
  depend on every client choosing the better path.

## When MongoDB goes away

The database can disappear long after a clean startup — a dropped network, a paused Atlas
cluster, an access-list entry expiring. `app/core/errors.py` maps that to **`503`** with
`{"detail": "Database temporarily unavailable, please retry"}` instead of letting the
driver error escape as a `500` and an ASGI stack trace.

The handler is registered for `pymongo.errors.ConnectionFailure` and nothing wider. That
class covers exactly the connectivity failures — `ServerSelectionTimeoutError`,
`AutoReconnect`, `NetworkTimeout`, `WaitQueueTimeoutError`. Catching the parent
`PyMongoError` would be the tempting one-liner and would break real behaviour:
`DuplicateKeyError` is a `PyMongoError` too, and it is how "you already have a watchlist
by that name" and "one account per identity document" become `409`s. Those are answers
from a healthy server and must keep reaching the route that knows what they mean.

Market data is unaffected by a DB outage — quotes, candles, instrument search and
`stream/stats` never touch Mongo, so they keep serving `200` while the watchlist and
onboarding routes return `503`.

Startup is still fail-fast: `connect()` pings and raises, so a process that cannot reach
Mongo at boot refuses to start rather than serving a half-working API.

**If every route suddenly returns `503` and the log shows
`SSL handshake failed ... TLSV1_ALERT_INTERNAL_ERROR`, it is not TLS.** Atlas's proxy
rejects the handshake for a source IP that is not in the project's Access List, which
looks identical to a certificate failure. Confirm with a plain socket — if TCP connects
but TLS fails on every shard, at every TLS version, with and without SNI, it is the
access list or a paused cluster. Add the current IP under **Network Access**, and untick
"temporary" unless you want it to expire in 6 hours.

## Testing

### Self-checks

Plain `assert`, no framework, no database. Each file runs on its own from `backend/`:

```
python tests/test_position_math.py       14 checks — the signed-position fill arithmetic
python tests/test_account_lifecycle.py   26 checks — whole lifecycles over the one balance
python tests/test_leverage_margin.py      5 checks — leverage leaves P&L unchanged
python tests/test_email_verification.py   3 checks — the verified-email dependency
```

The two money files are worth knowing the shape of, because they are what stands between
this and a wrong balance:

`test_position_math.py` drives `money.apply_fill` directly — one fill, one position, both
directions, opens, partial closes, flips, and an INR-priced instrument. The load-bearing
assertion is that `quantity * mark - cost_basis` agrees with what closing at that mark
actually realizes, since that one identity is what makes unrealized and realized P&L the
same number measured at two times.

`test_account_lifecycle.py` runs a wallet and a position through complete sessions — deposit,
open, mark, partially close, close, short, withdraw — and ends every one on **conservation**:
equity must equal what was paid in plus P&L, with nothing appearing from nowhere. That is the
invariant the old split settlement violated, and writing it is what surfaced a second hole
that no unit test would have: a sell reserves *units*, so it looks as though it needs no cash
— but a leveraged position can lose far more than the margin behind it, and that difference
has to leave the balance. The funding top-up now runs on every fill because that test failed.

### Browser pages

Both served from the API origin so the calls are same-origin and no CORS config is needed.
Use `localhost`, not `127.0.0.1`, since Firebase only authorizes `localhost` by default.

The `webfrontend` app calls this API cross-origin, so `.env` now ships
`CORS_ALLOW_ORIGINS=http://localhost:5173` for its Vite dev server. That value is read at
import, so **changing it needs a process restart** — `--reload` only watches Python files.
Any other origin the app is served from has to be added there, exactly, scheme and port
included.

| Page | Covers |
|---|---|
| **http://localhost:8000/test** | Firebase sign-in and the `/auth` + `/users` endpoints |
| **http://localhost:8000/test/onboarding** | The signup funnel |
| **http://localhost:8000/test/crypto** | Market data, watchlist instances and the live stream |
| **http://localhost:8000/test/forex** | The same, for FX — plus session state and spreads |
| **http://localhost:8000/test/stocks** | The same, for equities — instrument search and day-change bars |

The onboarding page signs in, then drives the funnel. **Run 10 steps** posts every step
with valid sample data for whichever products you select; the step editor sends the
textarea **verbatim**, so you can break a body on purpose and see the `422`; and the guard
buttons fire known-bad requests to show each rule rejecting. The expected-fields panel is
read from the live `/openapi.json`, so it cannot drift from the API.

Because a submitted application is frozen and the identity document is unique per account,
each full run needs a **fresh user** — the page picks a new random PAN whenever you sign
up. To re-run as an existing user, clear that uid from `onboarding_sessions` and
`kyc_profiles` and reset the sample to get a new PAN.

The crypto page signs in, loads the symbol universe, creates watchlist instances and opens
their sockets. The thing worth watching is section 4: with a socket open, **Add symbol**
re-binds it in place — a `resynced` frame arrives, the new row appears and starts ticking,
and no reconnect happens. Rows flash green or red on each tick, the counters track
quotes / snapshots / resyncs / heartbeats / dropped, and every frame is logged raw at the
bottom. Section 5's chart pair (a close-price sparkline with a crosshair, and an order-book
depth ladder) covers the plain REST reads.

The forex page is the same shape, with a spread-by-pair bar chart where crypto has the
depth ladder, an FX-session banner, and `stale` badges with relative quote ages. Its pair
picker leads with the majors when unfiltered: the provider carries 540 mostly-exotic pairs
and alphabetically `USD-JPY` sits past any sane truncation, so a plain sorted list made the
most-wanted pairs look unsupported. Expect no `quote` frames at all on a weekend — that is
the market being shut, and the heartbeat counter is what tells you the socket is alive.

Two notes on that page's charts, since both were bugs found by rendering it rather than
reading it: the sparkline sets its `viewBox` to the **measured pixel width** — a scaled
viewBox shrinks the 11px axis labels along with the geometry — and the depth ladder scales
each side to its **own** cumulative total. A single shared scale sounds fairer but reads
worse: one large top-of-book order pins every row on the heavier side at ~100% and
flattens the other side into identical stubs. The one genuine cross-side comparison is the
labelled depth-split bar instead. The chart colors are validated (lightness band, chroma
floor, colorblind separation, contrast) against that page's own surface — re-run the check
if you change them.
