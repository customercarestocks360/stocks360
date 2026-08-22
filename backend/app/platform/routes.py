import asyncio

from fastapi import APIRouter

from app.platform import repository
from app.schemas.platform import PlatformSettings

router = APIRouter(prefix="/platform", tags=["platform"])


@router.get(
    "/settings", response_model=PlatformSettings, summary="Public platform settings"
)
async def platform_settings():
    settings = await asyncio.to_thread(repository.get_settings)
    settings["deposit_rails"] = [
        rail for rail in settings["deposit_rails"] if rail.get("enabled")
    ]
    return settings
