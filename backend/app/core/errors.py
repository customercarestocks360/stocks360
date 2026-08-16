import logging

from fastapi import FastAPI, Request, status
from fastapi.responses import JSONResponse
from pymongo.errors import ConnectionFailure

logger = logging.getLogger(__name__)


async def database_unavailable(request: Request, exc: ConnectionFailure) -> JSONResponse:
    """Turn a MongoDB outage into 503 instead of an unhandled 500.

    The database can go away long after startup — a dropped network, a paused Atlas
    cluster, an access-list change — and every route that touches it would otherwise
    raise through the ASGI stack, answering 500 with a stack trace in the log and no
    usable body for the caller. 503 is the honest answer: the request was fine, the
    dependency is not, and a client or load balancer may retry.

    Deliberately narrow: `ConnectionFailure` covers only connectivity
    (ServerSelectionTimeoutError, AutoReconnect, NetworkTimeout, WaitQueueTimeoutError).
    Its siblings under PyMongoError — DuplicateKeyError above all — are real answers from
    a healthy server and must keep reaching the route that knows what they mean.
    """
    logger.error("MongoDB unavailable serving %s %s: %s", request.method, request.url.path, exc)
    return JSONResponse(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        content={"detail": "Database temporarily unavailable, please retry"},
    )


def register(app: FastAPI) -> None:
    app.add_exception_handler(ConnectionFailure, database_unavailable)
