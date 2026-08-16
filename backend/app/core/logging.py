"""Keep bearer credentials out of the logs.

Browsers cannot set headers on a WebSocket handshake, so the ID token may arrive as
`?token=<jwt>`. Uvicorn's access logger writes the full request line, which puts a live
bearer credential into plaintext logs — and those get shipped to aggregators, tailed by
operators and retained far longer than the token's one-hour life. Anyone reading them
could replay the token and act as that user until it expires.

RFC 6750 §2.3 discourages tokens in query strings for exactly this reason. The handshake
now prefers the `Sec-WebSocket-Protocol` header (see `app/streaming/ws_auth.py`); this
filter covers the query-param fallback and anything else that leaks a token into a log
line, so the guarantee does not depend on every caller doing the right thing.
"""

import logging
import re

# Any `token`/`access_token`/`id_token` query value, plus bearer values in a stray header.
_PATTERNS = (
    re.compile(r"((?:access_|id_)?token=)[^&\s\"']+", re.IGNORECASE),
    re.compile(r"(bearer\s+)[A-Za-z0-9._\-]{10,}", re.IGNORECASE),
)
_REDACTED = r"\1[REDACTED]"


def scrub(text: str) -> str:
    for pattern in _PATTERNS:
        text = pattern.sub(_REDACTED, text)
    return text


class RedactCredentialsFilter(logging.Filter):
    """Strip credentials from a record before any handler formats it."""

    def filter(self, record: logging.LogRecord) -> bool:
        if isinstance(record.msg, str) and ("token" in record.msg.lower() or "bearer" in record.msg.lower()):
            record.msg = scrub(record.msg)
        if record.args:
            # Uvicorn's access logger passes the request line through args, not msg.
            if isinstance(record.args, tuple):
                record.args = tuple(scrub(a) if isinstance(a, str) else a for a in record.args)
            elif isinstance(record.args, dict):
                record.args = {k: scrub(v) if isinstance(v, str) else v for k, v in record.args.items()}
        return True


def install_credential_redaction() -> None:
    """Attach the filter to the loggers that render request lines.

    Filters on a logger do not apply to its children, so each one is named explicitly
    rather than relying on propagation from the root.
    """
    f = RedactCredentialsFilter()
    for name in ("uvicorn.access", "uvicorn.error", "uvicorn", "gunicorn.access", ""):
        logging.getLogger(name).addFilter(f)
