# Stocks360 Backend

FastAPI + Firebase Auth (Admin SDK). Email/password and Google OAuth.

## Setup

```
cp .env.example .env                       # then put the service account key at secrets/
.venv\Scripts\python.exe -m uvicorn app.main:app --reload
```

`secrets/` and `.env` are gitignored — never commit the service account key.

All Firebase config lives in `.env` — nothing is hardcoded in the app or the test page.

| Env var | Purpose |
|---|---|
| `FIREBASE_PROJECT_ID` | Firebase project (`stock360bitntech`) |
| `FIREBASE_CREDENTIALS` | Path to Admin service account key, default `secrets/firebase-admin.json` |
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
| `YAHOO_REST_URL` / `YAHOO_USER_AGENT` | Equity upstream. The browser UA is **required** — Yahoo refuses requests without one |
| `STOCKS_POLL_SECONDS` / `STOCKS_POLL_CONCURRENCY` | Poll cadence and burst cap, default `15` / `6` |
| `STOCKS_STALE_SECONDS` | Quote age before it is flagged stale, default `1800` (the feed is ~15m delayed) |
| `STOCKS_INSTRUMENT_TTL_SECONDS` | How long a resolved instrument is cached, default `3600` |
| `STOCKS_MAX_WATCHLISTS` / `STOCKS_MAX_SYMBOLS_PER_WATCHLIST` / `STOCKS_MAX_SOCKETS_PER_USER` | Per-user caps, default `20` / `25` / `5` |
| `STOCKS_HEARTBEAT_SECONDS` | Silence before a heartbeat frame, 5–300, default `20` |

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
│   └── stocks.py       # instruments, equity quotes, candles, market state
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
└── health/routes.py
static/index.html       # browser test page
secrets/                # service account key (gitignored)
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

`POST /auth/login` upserts the user and appends a login event, so repeat logins increment
`login_count` rather than duplicating the record.

The two onboarding collections are deliberately split. The session is editable and
disposable — an abandoned one is swept by the TTL index after 30 days, which keeps
half-finished KYC data from lingering. The profile is the record of what the user actually
attested to, so it is written once at submit and the signup flow never edits it again.
Submit also unsets `expires_at`, so a submitted application is outside the TTL index twice
over: the partial filter only covers `status: "in_progress"`, *and* the field is gone.

The unique index on the identity document is what enforces one account per PAN/passport —
a read-then-write check in the service would lose that race between two concurrent submits.

## Routes

| Route | Purpose | Response |
|---|---|---|
| `GET /` | API identity | `{ "message": "Stocks360 API" }` |
| `GET /health` | Liveness + MongoDB check. `503` when the DB is unreachable | `{ status, database }` |
| `GET /auth/config` | Firebase Web SDK config from `.env`, so clients never hardcode it | `{ apiKey, authDomain, projectId, storageBucket, messagingSenderId, appId, measurementId }` |
| `POST /auth/signup` | Create an email/password user from `{ email, password, display_name? }`. `409` if the email exists, `422` on bad email / password under 6 chars | `201` + user |
| `POST /auth/login` | Verify a client-obtained ID token from `{ id_token }` — works for both email/password and Google. Upserts the user and logs the login | user |
| `GET /auth/me` | Current user, from `Authorization: Bearer <id_token>` | user |
| `POST /auth/logout` | Revoke the user's refresh tokens, ending existing sessions | `{ message }` |
| `GET /users/me` | Stored MongoDB profile. `404` before the first login | profile |
| `GET /users/me/logins` | Login history, newest first. `?limit=` 1–100, default 20 | list of events |
| `POST /onboarding/step` | Submit one signup step. `step` in the body selects the shape and the rules. `409` out of order / ineligible / already submitted | session |
| `GET /onboarding/session` | Resume — progress + everything captured, identifiers masked | session |
| `POST /onboarding/submit` | Freeze the session into `kyc_profiles` and open the products. `404` no session, `409` incomplete or duplicate document | outcome |
| `GET /crypto/symbols` | Tradable spot symbols. `?quote_asset=`, `?search=`, `?tradable_only=`, `?limit=` 1–2000 | list of symbols |
| `GET /crypto/ticker/{symbol}` | 24h ticker, served from the live cache when available | quote |
| `GET /crypto/tickers` | Batch tickers. `?symbols=BTCUSDT,ETHUSDT` or repeated `?symbols=`, max 50 | list of quotes |
| `GET /crypto/orderbook/{symbol}` | Depth. `?limit=` one of 5/10/20/50/100/500/1000 | order book |
| `GET /crypto/klines/{symbol}` | Candles. `?interval=` 1m–1M, `?limit=` 1–1000 | series |
| `GET /crypto/stream/stats` | Fan-out diagnostics for this process | stats |
| `POST /crypto/watchlists` | Create an instance from `{ name, symbols }`. `409` duplicate name or cap reached | `201` + watchlist |
| `GET /crypto/watchlists` | Your watchlists, newest first. `?limit=` 1–200 | list |
| `GET /crypto/watchlists/{id}` | One watchlist | watchlist |
| `GET /crypto/watchlists/{id}/quotes` | The same snapshot a socket gets on connect | quotes |
| `PATCH /crypto/watchlists/{id}` | Rename and/or replace symbols; re-binds open sockets | watchlist |
| `POST /crypto/watchlists/{id}/symbols` | Add symbols, idempotent; re-binds open sockets | watchlist |
| `DELETE /crypto/watchlists/{id}/symbols/{symbol}` | Remove one symbol. `409` if it is the last one | watchlist |
| `DELETE /crypto/watchlists/{id}` | Delete it and close its sockets | `204` |
| `WS /crypto/watchlists/{id}/stream` | Live quotes for that instance. `?token=<id_token>` | stream frames |
| `GET /forex/pairs` | Supported pairs. `?base=`, `?quote=`, `?search=`, `?limit=` 1–1000 | list of pairs |
| `GET /forex/session` | Whether the interbank market is open | session |
| `GET /forex/quote/{pair}` | Quote with bid, ask, mid and the spread in price and pips | quote |
| `GET /forex/quotes` | Batch quotes. `?symbols=EUR-USD,GBP-USD` or repeated, max 30 | list of quotes |
| `GET /forex/candles/{pair}` | `?series=daily\|intraday`, `?limit=` 1–360 | series |
| `GET /forex/stream/stats` | Fan-out diagnostics for this process | stats |
| `POST /forex/watchlists` | Create an instance from `{ name, symbols }` | `201` + watchlist |
| `GET /forex/watchlists` | Your watchlists, newest first | list |
| `GET /forex/watchlists/{id}` | One watchlist | watchlist |
| `GET /forex/watchlists/{id}/quotes` | The snapshot a socket gets on connect, plus market state | quotes |
| `PATCH /forex/watchlists/{id}` | Rename and/or replace pairs; re-binds open sockets | watchlist |
| `POST /forex/watchlists/{id}/symbols` | Add pairs, idempotent; re-binds open sockets | watchlist |
| `DELETE /forex/watchlists/{id}/symbols/{pair}` | Remove one pair. `409` if it is the last | watchlist |
| `DELETE /forex/watchlists/{id}` | Delete it and close its sockets | `204` |
| `WS /forex/watchlists/{id}/stream` | Live quotes for that instance. `?token=<id_token>` | stream frames |
| `GET /stocks/instruments` | Search the instrument master. `?search=`, `?limit=` 1–50 | list of instruments |
| `GET /stocks/quote/{symbol}` | Quote with price, change, day range, volume, market state | quote |
| `GET /stocks/quotes` | Batch quotes. `?symbols=AAPL,RELIANCE.NS`, max 20 | list of quotes |
| `GET /stocks/candles/{symbol}` | `?interval=` 1m–1mo, `?range=` 1d–max | series |
| `GET /stocks/stream/stats` | Fan-out diagnostics for this process | stats |
| `POST /stocks/watchlists` | Create an instance from `{ name, symbols }` | `201` + watchlist |
| `GET /stocks/watchlists` | Your watchlists, newest first | list |
| `GET /stocks/watchlists/{id}` | One watchlist | watchlist |
| `GET /stocks/watchlists/{id}/quotes` | The snapshot a socket gets on connect | quotes |
| `PATCH /stocks/watchlists/{id}` | Rename and/or replace tickers; re-binds open sockets | watchlist |
| `POST /stocks/watchlists/{id}/symbols` | Add tickers, idempotent; re-binds open sockets | watchlist |
| `DELETE /stocks/watchlists/{id}/symbols/{symbol}` | Remove one ticker. `409` if it is the last | watchlist |
| `DELETE /stocks/watchlists/{id}` | Delete it and close its sockets | `204` |
| `WS /stocks/watchlists/{id}/stream` | Live quotes for that instance. `?token=<id_token>` | stream frames |
| `GET /test` | Browser test page (not in OpenAPI schema) | HTML |
| `GET /test/onboarding` | Onboarding test page (not in OpenAPI schema) | HTML |

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

**Products are gated on the steps before them.** Leveraged products — domestic
derivatives, intraday, commodities, forex, crypto derivatives — need at least a year of
experience, a non-`low` risk tolerance and an income above the lowest band. `markets` is
re-checked at submit, since the `financial` step it depends on can be edited afterwards.
`RESTRICTED_JURISDICTIONS` in `onboarding/service.py` gates products by country of
residence; it ships empty, to be filled from the compliance matrix rather than guessed.

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

Two browser pages, both served from the API origin so the calls are same-origin and no
CORS config is needed. Use `localhost`, not `127.0.0.1`, since Firebase only authorizes
`localhost` by default. Signing in from a different origin (e.g. the Vite dev server on
`:5173`) will need CORS middleware added.

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
