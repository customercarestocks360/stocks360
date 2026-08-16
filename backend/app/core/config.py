import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

BASE_DIR = Path(__file__).resolve().parents[2]

FIREBASE_PROJECT_ID = os.getenv("FIREBASE_PROJECT_ID")
if not FIREBASE_PROJECT_ID:
    raise RuntimeError("FIREBASE_PROJECT_ID is not set — copy .env.example to .env")

_creds = Path(os.getenv("FIREBASE_CREDENTIALS", "secrets/firebase-admin.json"))
FIREBASE_CREDENTIALS_PATH = _creds if _creds.is_absolute() else BASE_DIR / _creds
if not FIREBASE_CREDENTIALS_PATH.is_file():
    raise RuntimeError(f"Firebase service account key not found at {FIREBASE_CREDENTIALS_PATH}")

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
