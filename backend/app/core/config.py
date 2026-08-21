import base64
import binascii
import json
import os
from decimal import Decimal, InvalidOperation
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

BASE_DIR = Path(__file__).resolve().parents[2]

FIREBASE_PROJECT_ID = os.getenv("FIREBASE_PROJECT_ID")
if not FIREBASE_PROJECT_ID:
    raise RuntimeError("FIREBASE_PROJECT_ID is not set — copy .env.example to .env")

_SERVICE_ACCOUNT_REQUIRED_KEYS = ("type", "project_id", "private_key", "client_email")


def _service_account_from_env() -> dict | None:
    """Read the Admin service account out of `FIREBASE_SERVICE_ACCOUNT`, if it is set.

    The key is accepted either base64-encoded or as the raw JSON object. Base64 is the
    form to prefer: it is one line with no quoting or newline escaping to get wrong, so
    it survives a `.env` file, a Docker `-e`, a CI secret box and a copy-paste equally.
    Returning None means "not configured here", and the caller falls back to a key file.
    """
    raw = (os.getenv("FIREBASE_SERVICE_ACCOUNT") or "").strip()
    # Tolerate a value that was wrapped in quotes to survive a shell or a secrets UI.
    if len(raw) >= 2 and raw[0] == raw[-1] and raw[0] in "\"'":
        raw = raw[1:-1].strip()
    if not raw:
        return None

    if not raw.startswith("{"):
        try:
            raw = base64.b64decode(raw, validate=True).decode("utf-8")
        except (binascii.Error, UnicodeDecodeError, ValueError) as exc:
            raise RuntimeError(
                "FIREBASE_SERVICE_ACCOUNT is neither a JSON object nor valid base64. "
                "Encode the service account JSON with: "
                'python -c "import base64,sys;'
                'print(base64.b64encode(open(sys.argv[1],\'rb\').read()).decode())" key.json'
            ) from exc

    try:
        info = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"FIREBASE_SERVICE_ACCOUNT does not contain valid JSON: {exc}") from exc
    # Valid JSON that is not a service account (an array, a bare string, the web config by
    # mistake) reads as "every field missing", which is what the message below says.
    if not isinstance(info, dict):
        info = {}
    missing = [k for k in _SERVICE_ACCOUNT_REQUIRED_KEYS if not info.get(k)]
    if missing:
        raise RuntimeError(
            "FIREBASE_SERVICE_ACCOUNT must be the Admin service account JSON — missing "
            f"required field(s): {', '.join(missing)}"
        )

    # A PEM pasted through a `.env` line or a secrets form usually arrives with literal
    # backslash-n instead of real newlines, which fails inside the crypto library with an
    # error that says nothing about where the key came from.
    if "\\n" in info["private_key"]:
        info["private_key"] = info["private_key"].replace("\\n", "\n")

    if info["project_id"] != FIREBASE_PROJECT_ID:
        raise RuntimeError(
            f"FIREBASE_SERVICE_ACCOUNT is for project {info['project_id']!r} but "
            f"FIREBASE_PROJECT_ID is {FIREBASE_PROJECT_ID!r} — tokens would never verify"
        )
    return info


# Two ways in, checked in this order:
#   1. FIREBASE_SERVICE_ACCOUNT — the whole key inside `.env`, so repo + `.env` is a
#      complete, runnable handoff with no second file to pass around out of band.
#   2. FIREBASE_CREDENTIALS — a path to the key file on disk, the original arrangement.
FIREBASE_CREDENTIALS_INFO = _service_account_from_env()
FIREBASE_CREDENTIALS_PATH: Path | None = None
if FIREBASE_CREDENTIALS_INFO is None:
    _creds = Path(os.getenv("FIREBASE_CREDENTIALS", "secrets/firebase-admin.json"))
    FIREBASE_CREDENTIALS_PATH = _creds if _creds.is_absolute() else BASE_DIR / _creds
    if not FIREBASE_CREDENTIALS_PATH.is_file():
        raise RuntimeError(
            "No Firebase Admin credentials. Set FIREBASE_SERVICE_ACCOUNT in .env to the "
            "base64-encoded service account JSON, or put the key file at "
            f"{FIREBASE_CREDENTIALS_PATH}"
        )

# Tolerance for clock drift between this server and Google. Without it, a server
# running even a few seconds behind rejects every freshly-issued token with
# "Token used too early". Firebase caps this at 60s.
CLOCK_SKEW_SECONDS = max(0, min(60, int(os.getenv("FIREBASE_CLOCK_SKEW_SECONDS", "30"))))

# Firebase Web SDK config, kept here rather than hardcoded in the client so the
# values live in one place and can differ per environment. Served to browsers by
# GET /auth/config. Public by design — the service account key is the real secret.
# How long a successful revocation check is trusted before Firebase is asked again.
# `verify_id_token(check_revoked=True)` costs a network round-trip to Google — measured at
# ~384ms median here, against ~0.9ms for the local signature check — and every protected
# route pays it. Caching per uid bounds how stale a revocation can be: a logout on THIS
# process evicts immediately, so the window only applies to other instances behind a load
# balancer. 0 disables the cache and checks every request.
FIREBASE_REVOCATION_TTL_SECONDS = max(0, min(300, int(os.getenv("FIREBASE_REVOCATION_TTL_SECONDS", "30"))))

FIREBASE_WEB_CONFIG = {
    "apiKey": os.getenv("FIREBASE_API_KEY"),
    "authDomain": os.getenv("FIREBASE_AUTH_DOMAIN"),
    "projectId": FIREBASE_PROJECT_ID,
    "storageBucket": os.getenv("FIREBASE_STORAGE_BUCKET"),
    "messagingSenderId": os.getenv("FIREBASE_MESSAGING_SENDER_ID"),
    "appId": os.getenv("FIREBASE_APP_ID"),
    "measurementId": os.getenv("FIREBASE_MEASUREMENT_ID"),
}

# measurementId is optional (analytics only); the rest are required to sign in at all,
# so fail at startup rather than handing the browser a config that cannot authenticate.
_missing = [k for k, v in FIREBASE_WEB_CONFIG.items() if not v and k != "measurementId"]
if _missing:
    raise RuntimeError(f"Missing Firebase web config in .env: {', '.join(sorted(_missing))}")

# --- Deployment posture ---
def _bool(name: str, default: bool) -> bool:
    return os.getenv(name, str(default)).strip().lower() in ("1", "true", "yes", "on")


def _csv(name: str) -> list[str]:
    return [v.strip() for v in os.getenv(name, "").split(",") if v.strip()]


# How many reverse proxies sit in front of this app. X-Forwarded-For is client-supplied
# and trivially forged, and the recorded IP is not decoration — it goes into the KYC
# consent record and the login audit trail. With 0 the header is ignored entirely and the
# socket peer is used. With N>0 the Nth address from the RIGHT is taken: the rightmost
# entries are appended by proxies you control, everything left of them is attacker text.
TRUSTED_PROXY_HOPS = max(0, min(10, int(os.getenv("TRUSTED_PROXY_HOPS", "0") or 0)))

# The interactive docs describe every route, its shape and its limits. Useful while
# building, unnecessary attack-surface intelligence once published.
DOCS_ENABLED = _bool("DOCS_ENABLED", True)

# Exact origins allowed to call this API from a browser. Empty means no CORS middleware,
# which is the safe default: same-origin only. A wildcard is refused outright below —
# `*` with credentials is precisely the misconfiguration that makes a session-riding
# attack work, and it is the first thing anyone reaches for when a frontend 'just won't
# connect'.
CORS_ALLOW_ORIGINS = _csv("CORS_ALLOW_ORIGINS")
if "*" in CORS_ALLOW_ORIGINS:
    raise RuntimeError(
        "CORS_ALLOW_ORIGINS=* is not allowed: this API is credentialed, so a wildcard "
        "origin would let any site call it with a user's token. List exact origins."
    )

# --- MongoDB ---
MONGODB_URI = os.getenv("MONGODB_URI")
if not MONGODB_URI:
    raise RuntimeError("MONGODB_URI is not set — copy .env.example to .env")

MONGODB_DB_NAME = os.getenv("MONGODB_DB_NAME", "stocks360")


def _bounded_int(name: str, default: int, low: int, high: int) -> int:
    """Read an int from env, clamped, so a typo degrades instead of breaking startup."""
    try:
        value = int(os.getenv(name, str(default)))
    except ValueError:
        return default
    return max(low, min(high, value))


def _bounded_decimal(name: str, default: str, low: str, high: str) -> Decimal:
    """Same, for money. `Decimal` rather than float: these bound real balances."""
    try:
        value = Decimal(os.getenv(name, default))
    except (InvalidOperation, TypeError):
        return Decimal(default)
    return max(Decimal(low), min(Decimal(high), value))


# --- Crypto market data (Binance public endpoints, no API key needed) ---
# Only public market data is used, so there is no key or secret here. Overridable so a
# deployment can point at a regional mirror (api1..api4, api-gcp) or a testnet.
BINANCE_REST_URL = os.getenv("BINANCE_REST_URL", "https://api.binance.com")
BINANCE_WS_URL = os.getenv("BINANCE_WS_URL", "wss://stream.binance.com:9443/ws")
BINANCE_TIMEOUT_SECONDS = _bounded_int("BINANCE_TIMEOUT_SECONDS", 10, 1, 60)

# How long the tradable-symbol list is trusted before being refetched. Listings change
# rarely, and every watchlist write validates against this, so caching it matters.
CRYPTO_SYMBOLS_TTL_SECONDS = _bounded_int("CRYPTO_SYMBOLS_TTL_SECONDS", 21600, 60, 86400)

# Per-user ceilings. Each open socket holds an upstream subscription and a queue, so these
# bound both memory and the fan-out cost of one abusive account.
CRYPTO_MAX_WATCHLISTS = _bounded_int("CRYPTO_MAX_WATCHLISTS", 20, 1, 200)
CRYPTO_MAX_SYMBOLS_PER_WATCHLIST = _bounded_int("CRYPTO_MAX_SYMBOLS_PER_WATCHLIST", 50, 1, 500)
CRYPTO_MAX_SOCKETS_PER_USER = _bounded_int("CRYPTO_MAX_SOCKETS_PER_USER", 5, 1, 50)

# Seconds of silence before the server sends a heartbeat frame, so a client can tell a
# quiet market from a dead connection.
CRYPTO_HEARTBEAT_SECONDS = _bounded_int("CRYPTO_HEARTBEAT_SECONDS", 20, 5, 300)

# A crypto quote older than this is not a price to trade on. Unlike forex and equities,
# this feed has no staleness notion of its own — the market never closes, so anything
# other than a live tick means the connection is degraded. Binance publishes roughly once
# a second, so this is generous.
CRYPTO_STALE_SECONDS = _bounded_int("CRYPTO_STALE_SECONDS", 120, 10, 3600)

# --- Forex market data (AwesomeAPI public endpoints, no API key) ---
# This provider has no upstream WebSocket, so the hub polls its batch endpoint: one
# request covers every subscribed pair, which keeps the one-upstream-for-everyone
# property that the crypto stream gets from a single socket.
FOREX_REST_URL = os.getenv("FOREX_REST_URL", "https://economia.awesomeapi.com.br")
FOREX_TIMEOUT_SECONDS = _bounded_int("FOREX_TIMEOUT_SECONDS", 10, 1, 60)

# The supported-pair list changes rarely and every watchlist write validates against it.
FOREX_PAIRS_TTL_SECONDS = _bounded_int("FOREX_PAIRS_TTL_SECONDS", 21600, 60, 86400)

# How often the hub asks for the subscribed pairs. FX moves far slower than crypto and
# the provider is a courtesy service, so polling harder buys nothing.
FOREX_POLL_SECONDS = _bounded_int("FOREX_POLL_SECONDS", 3, 1, 60)

# A quote older than this is reported as stale. FX is 24/5, so on a weekend every pair
# goes stale and the market reads as closed — that is correct, not a fault.
FOREX_STALE_SECONDS = _bounded_int("FOREX_STALE_SECONDS", 180, 30, 86400)

FOREX_MAX_WATCHLISTS = _bounded_int("FOREX_MAX_WATCHLISTS", 20, 1, 200)
FOREX_MAX_SYMBOLS_PER_WATCHLIST = _bounded_int("FOREX_MAX_SYMBOLS_PER_WATCHLIST", 30, 1, 200)
FOREX_MAX_SOCKETS_PER_USER = _bounded_int("FOREX_MAX_SOCKETS_PER_USER", 5, 1, 50)
FOREX_HEARTBEAT_SECONDS = _bounded_int("FOREX_HEARTBEAT_SECONDS", 20, 5, 300)

# Optional second candle source (https://twelvedata.com), free tier, one API key, no card.
# AwesomeAPI's own intraday feed is ticks capped at 100 rows (~77 minutes — probed directly;
# asking for more does not return more) and Yahoo's FX bars are close to flat at the finest
# intervals (probed: 1-minute EUR/USD came back 100% `open == high == low == close`, 5-minute
# ~18%), so `forex/upstream.candles()` tries Twelve Data first when a key is set — real OHLC
# at every interval this app uses — and only falls back to the Yahoo/tick path on a miss.
# Blank by default (Twelve Data is skipped entirely): get a free key at
# https://twelvedata.com/pricing. Its own `demo` key is not a substitute — it 401s every
# pair except EUR/USD and USD/JPY, which is fine for trying the API and not for a watchlist.
FOREX_TWELVEDATA_API_KEY = os.getenv("FOREX_TWELVEDATA_API_KEY", "").strip()
FOREX_TWELVEDATA_URL = os.getenv("FOREX_TWELVEDATA_URL", "https://api.twelvedata.com")

# --- Equities / instruments (Yahoo Finance) ---
# These endpoints are undocumented and unsanctioned: fine for development, not something
# to put real customers on. Everything is isolated behind stocks/upstream.py so swapping
# to a licensed provider is one file.
YAHOO_REST_URL = os.getenv("YAHOO_REST_URL", "https://query1.finance.yahoo.com")

# Yahoo refuses requests without a browser user agent — the connection simply fails, which
# is not obviously an auth problem when you hit it. Keep this set.
YAHOO_USER_AGENT = os.getenv(
    "YAHOO_USER_AGENT",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
)
STOCKS_TIMEOUT_SECONDS = _bounded_int("STOCKS_TIMEOUT_SECONDS", 12, 1, 60)

# Resolved instruments (name, exchange, currency) barely change; cache them.
STOCKS_INSTRUMENT_TTL_SECONDS = _bounded_int("STOCKS_INSTRUMENT_TTL_SECONDS", 3600, 60, 86400)

# There is no batch quote endpoint that still works unauthenticated, so a poll costs one
# request per distinct symbol. Equities move slower than crypto and this feed is delayed
# anyway, so poll gently and bound the burst.
STOCKS_POLL_SECONDS = _bounded_int("STOCKS_POLL_SECONDS", 15, 2, 300)
STOCKS_POLL_CONCURRENCY = _bounded_int("STOCKS_POLL_CONCURRENCY", 6, 1, 32)

# Yahoo's free data is delayed by roughly 15 minutes, so the staleness window has to be
# wider than a real-time feed's or every quote would look stale.
STOCKS_STALE_SECONDS = _bounded_int("STOCKS_STALE_SECONDS", 1800, 60, 86400)

STOCKS_MAX_WATCHLISTS = _bounded_int("STOCKS_MAX_WATCHLISTS", 20, 1, 200)
STOCKS_MAX_SYMBOLS_PER_WATCHLIST = _bounded_int("STOCKS_MAX_SYMBOLS_PER_WATCHLIST", 25, 1, 100)
STOCKS_MAX_SOCKETS_PER_USER = _bounded_int("STOCKS_MAX_SOCKETS_PER_USER", 5, 1, 50)
STOCKS_HEARTBEAT_SECONDS = _bounded_int("STOCKS_HEARTBEAT_SECONDS", 20, 5, 300)

# --- Public market overview (unauthenticated) ---
# "Top" here is a curated list, not a live ranking. Binance could rank by 24h volume, but
# the forex and equity providers expose no ranking at all, so a per-market fixed list is
# the only definition that means the same thing across all three feeds. Override any of
# them to re-point a deployment at different headline symbols.
OVERVIEW_CRYPTO_SYMBOLS = _csv("OVERVIEW_CRYPTO_SYMBOLS") or [
    "BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "XRPUSDT",
]
OVERVIEW_FOREX_SYMBOLS = _csv("OVERVIEW_FOREX_SYMBOLS") or [
    "EUR-USD", "USD-JPY", "GBP-USD", "USD-INR", "AUD-USD",
]
OVERVIEW_STOCKS_SYMBOLS = _csv("OVERVIEW_STOCKS_SYMBOLS") or [
    "RELIANCE.NS", "TCS.NS", "HDFCBANK.NS", "INFY.NS", "ICICIBANK.NS",
]

# This socket is unauthenticated, so there is no account to attribute abuse to and the peer
# address is the only key available. Deliberately looser than the per-user stream caps:
# many people legitimately share one NAT address.
OVERVIEW_MAX_SOCKETS_PER_IP = _bounded_int("OVERVIEW_MAX_SOCKETS_PER_IP", 4, 1, 100)

# Total concurrent public sockets on this process. The per-IP cap alone does not bound the
# server, since addresses are cheap to come by.
OVERVIEW_MAX_SOCKETS = _bounded_int("OVERVIEW_MAX_SOCKETS", 500, 1, 100_000)

OVERVIEW_HEARTBEAT_SECONDS = _bounded_int("OVERVIEW_HEARTBEAT_SECONDS", 20, 5, 300)

# --- Trading ---
# This is a simulated venue: orders execute against the same live market data the read
# endpoints serve, and cash is book money this API creates. There is no broker, no
# clearing and no custody behind any of it. Everything below is a venue rule, so it is
# configuration rather than a constant buried in the matching code.
TRADING_ENABLED = _bool("TRADING_ENABLED", True)

# Whether every authenticated account may trade every instrument, regardless of onboarding
# status, KYC tier, or which products it asked for during onboarding.
#
# On by default, and the reason is what this venue *is*: a simulator holding book money it
# creates itself, with no broker, no custody and nothing to launder. The gates it used to
# apply were modelled on a real brokerage's — finish ten onboarding steps, reach the
# `verified` tier, have the exact product granted — and their only effect here was to refuse
# a funded account access to its own paper market, per asset class, with "it was not
# requested during onboarding".
#
# Set this to false to put the gates back. Everything that enforced them is still here and
# still tested; this only decides whether they are asked. What it does **not** touch is
# authentication: every `/trading/*` route still requires a verified Firebase token, so
# "open" means open to account holders, not to the internet.
TRADING_OPEN_ACCESS = _bool("TRADING_OPEN_ACCESS", True)

# Commission in basis points of notional, charged in the instrument's quote currency and
# rounded up. 10 bps = 0.1%.
TRADING_FEE_BPS = _bounded_int("TRADING_FEE_BPS", 10, 0, 1000)

# A limit or stop price further than this from the last traded price is refused. Real
# venues call this a price band; here it is the difference between a fat-fingered extra
# zero being a 422 and being a resting order nobody notices for a month.
TRADING_PRICE_BAND_PERCENT = _bounded_int("TRADING_PRICE_BAND_PERCENT", 20, 1, 100)

# Per-user ceiling on resting orders. Each one holds a reservation and keeps its symbol
# subscribed upstream, so this bounds both locked funds and fan-out cost.
TRADING_MAX_OPEN_ORDERS = _bounded_int("TRADING_MAX_OPEN_ORDERS", 50, 1, 500)

# Notional bounds per order, in the instrument's quote currency. Crude by definition —
# one unit means something different in INR and in USD — but they are here to stop
# absurdity, not to price risk.
TRADING_MIN_ORDER_NOTIONAL = _bounded_decimal("TRADING_MIN_ORDER_NOTIONAL", "1", "0", "1000000")
TRADING_MAX_ORDER_NOTIONAL = _bounded_decimal(
    "TRADING_MAX_ORDER_NOTIONAL", "1000000", "1", "1000000000"
)

# The smallest order this venue accepts, in the instrument's own units (0.1 BTC, 0.1
# EUR-USD, 0.1 shares) — a floor under the notional band above, not a substitute for it.
TRADING_MIN_QUANTITY = _bounded_decimal("TRADING_MIN_QUANTITY", "0.1", "0.00000001", "1000000000")

# Venue-wide leverage, applied to every asset class alike: a buy only has to reserve
# 1/TRADING_LEVERAGE of its notional in cash rather than all of it. This is a fixed rule,
# not a per-order choice — there is no field on `OrderRequest` for it. It changes nothing
# about a position's cost basis or its P&L, which stay full-notional (see
# `service.place_order`'s docstring on why): leverage only shrinks the cash a buy locks up,
# which is exactly why a position can now go to zero equity before the market reaches zero,
# and why `TradingEngine` watches every leveraged position for that (see `engine.py`).
TRADING_LEVERAGE = _bounded_int("TRADING_LEVERAGE", 200, 1, 1000)

# Bounds on a single simulated funding movement.
TRADING_MAX_DEPOSIT = _bounded_decimal("TRADING_MAX_DEPOSIT", "1000000", "1", "1000000000")
TRADING_MAX_WITHDRAWAL = _bounded_decimal("TRADING_MAX_WITHDRAWAL", "1000000", "1", "1000000000")

# --- The account balance ---
# One balance per account, in one currency, funding every asset class. An instrument
# priced in INR or EUR does not get its own wallet: its notional is converted at the live
# rate (see `app.trading.fx`) and the cash leg settles here. So a user has one number to
# reason about, and a Mumbai listing is funded by the same balance as Bitcoin.
#
# Overridable, but it has to be a currency `app.trading.fx` can price everything against —
# in practice USDT or USD. Changing it on a live deployment does not re-denominate the
# wallets already written; those keep their own currency and stay withdrawable.
TRADING_ACCOUNT_CURRENCY = (os.getenv("TRADING_ACCOUNT_CURRENCY", "USDT") or "USDT").strip().upper()

# What a new account opens with, credited once, the first time its wallet is touched. It
# lands as an ordinary `deposit` ledger entry rather than a magic starting number, so the
# balance still reconciles against the ledger from the first row.
TRADING_INITIAL_BALANCE = _bounded_decimal("TRADING_INITIAL_BALANCE", "1000", "0", "1000000")

# How many decimal places the USDT/USD peg is worth modelling to. USDT is pegged, not
# fixed, but this venue has no licensed source for the deviation, so the pegged currencies
# convert 1:1 and the honest thing is to say so rather than invent a drift.
TRADING_PEGGED_CURRENCIES = frozenset(
    s.upper() for s in _csv("TRADING_PEGGED_CURRENCIES")
) or frozenset({"USDT", "USDC", "USD"})

# Asset classes where a sell with nothing behind it opens a short position instead of
# being refused. Equities are excluded on purpose: shorting a listed share is a stock
# loan, which needs a borrow, a locate and a recall process this venue has none of.
# Crypto perps and FX are natively two-sided, so a sell there is just the other direction.
TRADING_SHORT_SELLING_CLASSES = frozenset(
    s.lower() for s in _csv("TRADING_SHORT_SELLING_CLASSES")
) or frozenset({"crypto", "forex"})

# How long a fetched FX rate is reused before being refreshed. A conversion rate is not a
# traded price: it scales a notional into account currency, so seconds of staleness are
# worth far less than a network round trip on every order.
TRADING_FX_TTL_SECONDS = _bounded_int("TRADING_FX_TTL_SECONDS", 60, 1, 3600)

# How often the matcher re-checks resting orders outside of a tick arriving. Ticks do the
# real work; this sweep expires day orders and catches conditions that became true while
# no quote was flowing.
TRADING_SWEEP_SECONDS = _bounded_int("TRADING_SWEEP_SECONDS", 15, 5, 300)

# Equity tickers ending in one of these are treated as domestic, which decides whether an
# order needs the domestic or the foreign equity product. India-first, like the rest.
TRADING_DOMESTIC_SUFFIXES = tuple(s.upper() for s in _csv("TRADING_DOMESTIC_SUFFIXES")) or (
    ".NS",
    ".BO",
)

# --- Funding requests and the review queue ---
# A deposit or withdrawal here is a *request* first: it is recorded, a human checks that
# the money actually moved on the rail the user named, and only then does a balance
# change. So the venue needs to know who is allowed to resolve one.
#
# Admin is an email allowlist checked against the verified Firebase token, not a second
# credential store. There is deliberately no admin password in this file: a password in
# .env is one more secret to leak and to hardcode into a client, while the identity is
# already established by the same token every other route trusts, complete with instant
# revocation on logout.
#
# Empty means nobody is an admin and every /admin route answers 403. That is the correct
# default: a deployment that forgets to set this gets a locked review queue, not an open
# one.
ADMIN_EMAILS = frozenset(e.lower() for e in _csv("ADMIN_EMAILS"))

# Open requests per user. A pending withdrawal locks cash, so this bounds how much of a
# balance one account can tie up in a queue nobody has looked at yet — and it bounds how
# much noise one account can push into the review queue.
FUNDING_MAX_PENDING_PER_USER = _bounded_int("FUNDING_MAX_PENDING_PER_USER", 10, 1, 100)
