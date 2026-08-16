"""Shared WebSocket authentication for the market streams.

Crypto, forex and equities had a byte-identical copy of this each. One copy means the
three cannot drift — an auth fix applied to two routers and missed on the third is
exactly the sort of hole that survives review.
"""

import asyncio

from fastapi import HTTPException, WebSocket, status

from app.auth.service import verify_token
from app.schemas.streaming import WS_CLOSE_UNAUTHENTICATED

# Offered by clients as `Sec-WebSocket-Protocol: bearer, <token>`.
_BEARER_SUBPROTOCOL = "bearer"


def token_from_subprotocol(ws: WebSocket) -> str | None:
    """Read a token offered through the WebSocket subprotocol header.

    Browsers refuse to set an Authorization header on a handshake, which is why the token
    is otherwise passed as `?token=`. A query string lands in access logs, proxy logs and
    browser history as a live bearer credential (RFC 6750 §2.3 advises against it). The
    subprotocol header is the one header a browser *will* set, so it carries the token
    without it appearing in a URL.

    A server that accepts a subprotocol must echo one back, so callers pass the return of
    `accepted_subprotocol()` to `ws.accept()`.
    """
    offered = [p.strip() for p in ws.headers.get("sec-websocket-protocol", "").split(",") if p.strip()]
    if len(offered) >= 2 and offered[0].lower() == _BEARER_SUBPROTOCOL:
        return offered[1]
    return None


def accepted_subprotocol(ws: WebSocket) -> str | None:
    """The subprotocol to echo on accept, or None when the client offered none."""
    return _BEARER_SUBPROTOCOL if token_from_subprotocol(ws) else None


async def authenticate(ws: WebSocket, token: str | None) -> dict | None:
    """Resolve the caller's claims, closing the socket with 4401 if that is not possible.

    Token sources in order of preference: the `bearer` subprotocol (browser-safe, stays
    out of logs), a normal Authorization header (non-browser clients), then the `?token=`
    query param (browser fallback, redacted from logs by app/core/logging.py).
    """
    token = token_from_subprotocol(ws) or token
    if token is None:
        header = ws.headers.get("authorization", "")
        if header.lower().startswith("bearer "):
            token = header.split(" ", 1)[1]
    if not token:
        await ws.close(code=WS_CLOSE_UNAUTHENTICATED, reason="Missing token")
        return None
    try:
        # verify_token is blocking (it may call Firebase), so keep it off the loop.
        return await asyncio.to_thread(verify_token, token, True)
    except HTTPException as exc:
        code = (
            WS_CLOSE_UNAUTHENTICATED
            if exc.status_code == status.HTTP_401_UNAUTHORIZED
            else status.WS_1011_INTERNAL_ERROR
        )
        await ws.close(code=code, reason=str(exc.detail)[:120])
        return None
