from pydantic import BaseModel, Field


class MessageResponse(BaseModel):
    """Generic acknowledgement for actions with no resource to return."""

    message: str = Field(examples=["Signed out, refresh tokens revoked"])


class ErrorResponse(BaseModel):
    """Shape FastAPI uses for HTTPException, declared so it shows up in OpenAPI."""

    detail: str = Field(examples=["Invalid token"])


class RootResponse(BaseModel):
    message: str = Field(examples=["Stocks360 API"])


class HealthResponse(BaseModel):
    status: str = Field(examples=["ok"])
    database: str = Field(examples=["ok"], description="MongoDB connectivity")


# Reusable OpenAPI response blocks so every endpoint documents its failure modes.
UNAUTHORIZED = {
    401: {
        "model": ErrorResponse,
        "description": "Missing, invalid, expired or revoked token",
    }
}
FORBIDDEN = {403: {"model": ErrorResponse, "description": "Email address not verified"}}
NOT_FOUND = {404: {"model": ErrorResponse, "description": "Resource not found"}}
CONFLICT = {409: {"model": ErrorResponse, "description": "Already exists"}}
UNAVAILABLE = {
    503: {"model": ErrorResponse, "description": "Upstream dependency unavailable"}
}
