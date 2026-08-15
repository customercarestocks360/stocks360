from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse

from app.api.router import api_router
from app.core.database import close, connect, ensure_indexes
from app.core.errors import register as register_error_handlers
from app.crypto import upstream as crypto_upstream
from app.crypto.hub import hub as crypto_hub
from app.forex import upstream as forex_upstream
from app.forex.hub import hub as forex_hub
from app.stocks import upstream as stocks_upstream
from app.stocks.hub import hub as stocks_hub

STATIC_DIR = Path(__file__).resolve().parents[1] / "static"


@asynccontextmanager
async def lifespan(app: FastAPI):
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


app = FastAPI(title="Stocks360 API", lifespan=lifespan)

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
