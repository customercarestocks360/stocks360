from starlette.requests import HTTPConnection

from app.core.config import TRUSTED_PROXY_HOPS


# HTTPConnection rather than Request: a WebSocket is one too, and the public overview
# stream needs the same peer address for its per-IP cap. Both carry .client and .headers,
# which is all this reads.
def client_ip(request: HTTPConnection) -> str | None:
    """Best available client IP, without trusting what the client claims to be.

    `X-Forwarded-For` is just a request header: any caller can send one, and the value
    ends up in the login audit trail and — more importantly — in the consent record
    frozen into the KYC profile. Taking the leftmost entry, the usual shortcut, means the
    recorded IP is whatever the client typed.

    Each proxy *appends* the peer it saw, so the rightmost entries are the trustworthy
    ones. With TRUSTED_PROXY_HOPS=N the Nth from the right is the real client; anything
    further left was supplied by the caller. With 0 (the default, and correct when nothing
    fronts the app) the header is ignored entirely.
    """
    peer = request.client.host if request.client else None
    if TRUSTED_PROXY_HOPS <= 0:
        return peer

    forwarded = request.headers.get("x-forwarded-for")
    if not forwarded:
        return peer
    hops = [h.strip() for h in forwarded.split(",") if h.strip()]
    if not hops:
        return peer
    # Fewer hops than configured means the chain is shorter than expected; fall back to
    # the leftmost known entry rather than indexing past the start of the list.
    index = len(hops) - TRUSTED_PROXY_HOPS
    return hops[index] if 0 <= index < len(hops) else hops[0]
