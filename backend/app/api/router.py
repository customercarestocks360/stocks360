from fastapi import APIRouter

from app.admin.routes import router as admin_router
from app.auth.routes import router as auth_router
from app.crypto.routes import router as crypto_router
from app.forex.routes import router as forex_router
from app.funding.routes import admin_router as funding_admin_router
from app.funding.routes import router as funding_router
from app.health.routes import router as health_router
from app.onboarding.routes import router as onboarding_router
from app.overview.routes import router as overview_router
from app.platform.routes import router as platform_router
from app.stocks.routes import router as stocks_router
from app.trading.routes import router as trading_router
from app.users.routes import admin_router as users_admin_router
from app.users.routes import router as users_router

api_router = APIRouter()

api_router.include_router(health_router)
api_router.include_router(auth_router)
api_router.include_router(users_router)
api_router.include_router(onboarding_router)
api_router.include_router(crypto_router)
api_router.include_router(forex_router)
api_router.include_router(stocks_router)
api_router.include_router(overview_router)
api_router.include_router(platform_router)
api_router.include_router(trading_router)
api_router.include_router(funding_router)
# Last, and separately: the only surfaces here that read or edit across users.
api_router.include_router(funding_admin_router)
api_router.include_router(admin_router)
api_router.include_router(users_admin_router)
