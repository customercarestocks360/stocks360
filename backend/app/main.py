from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from app.api.router import api_router
from app.core.config import CORS_ALLOW_ORIGINS, DOCS_ENABLED
from app.core.database import close, connect, ensure_indexes
from app.core.errors import register as register_error_handlers
from app.core.logging import install_credential_redaction
from app.crypto import upstream as crypto_upstream
from app.crypto.hub import hub as crypto_hub
from app.forex import upstream as forex_upstream
from app.forex.hub import hub as forex_hub
from app.stocks import upstream as stocks_upstream
from app.stocks.hub import hub as stocks_hub

STATIC_DIR = Path(__file__).resolve().parents[1] / "static"


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Before anything can log a request line carrying ?token=.
    install_credential_redaction()
    connect()
    ensure_indexes()
    crypto_upstream.start()
    forex_upstream.start()
    stocks_upstream.start()
    # Each market hub dials out and retries on its own, so a market-data outage at boot
    # does not stop the API from serving — or take the other markets down with it.
    await crypto_hub.start()
    await forex_hub.start()
    await stocks_hub.start()
    yield
    await stocks_hub.stop()
    await forex_hub.stop()
    await crypto_hub.stop()
    await stocks_upstream.stop()
    await forex_upstream.stop()
    await crypto_upstream.stop()
    close()


app = FastAPI(
    title="Stocks360 API",
    lifespan=lifespan,
    # Swagger, ReDoc and the raw schema enumerate every route, parameter and limit. That
    # is a build-time convenience, not something to publish; DOCS_ENABLED=false removes
    # all three rather than leaving the schema reachable behind a hidden UI.
    docs_url="/docs" if DOCS_ENABLED else None,
    redoc_url="/redoc" if DOCS_ENABLED else None,
    openapi_url="/openapi.json" if DOCS_ENABLED else None,
)


@app.middleware("http")
async def security_headers(request, call_next):
    """Headers that cost nothing and close off whole classes of browser attack.

    This API serves JSON and a handful of static demo pages. nosniff stops a browser
    second-guessing a JSON content type into something executable, DENY stops the pages
    being framed for clickjacking, and no-referrer keeps URLs (which may carry a token on
    the WebSocket fallback path) out of Referer headers sent to third parties.
    """
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "no-referrer")
    # Only meaningful over HTTPS; harmless on the plain-HTTP dev server, and it must be
    # present from the first production response for the policy to ever take hold.
    response.headers.setdefault(
        "Strict-Transport-Security", "max-age=31536000; includeSubDomains"
    )
    return response


# Same-origin only unless origins are named explicitly. Credentials are on because the
# API is token-authenticated, which is exactly why config.py refuses a wildcard.
if CORS_ALLOW_ORIGINS:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=CORS_ALLOW_ORIGINS,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type"],
    )

register_error_handlers(app)
app.include_router(api_router)


@app.get("/test", include_in_schema=False)
def test_page():
    """Serve the auth test page from the API origin so calls stay same-origin."""
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/test/onboarding", include_in_schema=False)
def onboarding_test_page():
    """Same-origin test page for the signup funnel."""
    return FileResponse(STATIC_DIR / "onboarding.html")


@app.get("/test/crypto", include_in_schema=False)
def crypto_test_page():
    """Same-origin demo page for the crypto endpoints and watchlist streams."""
    return FileResponse(STATIC_DIR / "crypto.html")


@app.get("/test/forex", include_in_schema=False)
def forex_test_page():
    """Same-origin demo page for the forex endpoints and watchlist streams."""
    return FileResponse(STATIC_DIR / "forex.html")


@app.get("/test/stocks", include_in_schema=False)
def stocks_test_page():
    """Same-origin demo page for the equity endpoints and watchlist streams."""
    return FileResponse(STATIC_DIR / "stocks.html")
