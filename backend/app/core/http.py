from fastapi import Request


def client_ip(request: Request) -> str | None:
    """Prefer the proxy-forwarded client IP, falling back to the socket peer."""
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else None
