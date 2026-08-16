from fastapi import APIRouter, Response, status
from pymongo.errors import PyMongoError

from app.core.database import get_db
from app.schemas.common import HealthResponse, RootResponse

router = APIRouter(tags=["health"])


@router.get("/", response_model=RootResponse, summary="API identity")
def root():
    return RootResponse(message="Stocks360 API")


@router.get(
    "/health",
    response_model=HealthResponse,
    summary="Liveness and dependency check",
    description="Returns 503 when MongoDB is unreachable, so a load balancer "
    "stops routing to an instance that cannot serve requests.",
)
def health(response: Response):
    try:
        get_db().command("ping")
        database = "ok"
    except (PyMongoError, RuntimeError):
        database = "unreachable"
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    return HealthResponse(status="ok" if database == "ok" else "degraded", database=database)
