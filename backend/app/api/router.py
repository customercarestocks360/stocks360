from fastapi import APIRouter

from app.auth.routes import router as auth_router
from app.crypto.routes import router as crypto_router
from app.forex.routes import router as forex_router
from app.health.routes import router as health_router
from app.stocks.routes import router as stocks_router
from app.onboarding.routes import router as onboarding_router
from app.users.routes import router as users_router

api_router = APIRouter()

api_router.include_router(health_router)
api_router.include_router(auth_router)
api_router.include_router(users_router)
api_router.include_router(onboarding_router)
api_router.include_router(crypto_router)
api_router.include_router(forex_router)
api_router.include_router(stocks_router)
