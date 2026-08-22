"""Focused tests for privileged controls; no database or network required."""

import asyncio
from decimal import Decimal

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from app.admin import service
from app.funding import service as funding_service
from app.schemas.admin import (
    BalanceAdjustmentRequest,
    KycReviewRequest,
    ProductAccessRequest,
)
from app.schemas.onboarding import KycTier, OnboardingStatus
from app.schemas.platform import PlatformSettingsUpdate
from app.trading.service import _trading_block


def test_suspension_wins_even_when_open_access_is_enabled():
    assert "suspended" in (
        _trading_block(
            {"account_status": "suspended", "account_status_reason": "review"}
        )
        or ""
    )


def test_production_funding_and_admin_routes_are_registered():
    from app.main import app

    paths = app.openapi()["paths"]
    assert "/funding/deposits" in paths
    assert "/funding/withdrawals" in paths
    assert "/funding/requests/{request_id}" in paths
    assert "/admin/settings" in paths
    assert "/admin/users/{uid}/products" in paths
    assert "/trading/deposits" not in paths
    assert "/trading/withdrawals" not in paths


def test_balance_adjustment_is_signed_but_not_zero():
    credit = BalanceAdjustmentRequest(
        amount="25.50", reason="Manual reconciliation", idempotency_key="adjust-12345"
    )
    debit = BalanceAdjustmentRequest(
        amount="-10.00", reason="Chargeback correction", idempotency_key="adjust-67890"
    )
    assert credit.amount == Decimal("25.50")
    assert debit.amount == Decimal("-10.00")
    with pytest.raises(ValidationError):
        BalanceAdjustmentRequest(
            amount="0", reason="No movement", idempotency_key="adjust-00000"
        )


def test_kyc_approval_enables_requested_products_and_grants_pro(monkeypatch):
    captured: dict = {}
    monkeypatch.setattr(
        service.users_repository, "get_profile", lambda uid: {"uid": uid}
    )
    monkeypatch.setattr(
        service.onboarding_repository,
        "get_kyc_profile",
        lambda uid: {
            "enabled_products": ["domestic_equity_delivery"],
            "pending_products": ["forex"],
        },
    )

    def review(uid, **kwargs):
        captured.update(uid=uid, **kwargs)
        return {
            "uid": uid,
            "status": kwargs["status"],
            "kyc_tier": kwargs["tier"],
            "enabled_products": kwargs["enabled_products"],
            "pending_products": kwargs["pending_products"],
            "review_note": kwargs["note"],
            "reviewed_by": kwargs["reviewer_uid"],
            "reviewed_at": service.repository.now(),
        }

    monkeypatch.setattr(service.onboarding_repository, "review_application", review)
    monkeypatch.setattr(service.repository, "record_audit", lambda **kwargs: kwargs)
    result = service.review_kyc(
        "user-1",
        KycReviewRequest(decision="approve", reason="Documents verified"),
        {"uid": "admin-1", "email": "admin@example.com"},
    )
    assert result["status"] is OnboardingStatus.approved
    assert captured["tier"] is KycTier.pro
    assert captured["enabled_products"] == ["domestic_equity_delivery", "forex"]
    assert captured["pending_products"] == []


def test_kyc_review_cannot_enable_an_unrequested_product(monkeypatch):
    monkeypatch.setattr(
        service.users_repository, "get_profile", lambda uid: {"uid": uid}
    )
    monkeypatch.setattr(
        service.onboarding_repository,
        "get_kyc_profile",
        lambda uid: {"enabled_products": ["crypto_spot"], "pending_products": []},
    )
    with pytest.raises(HTTPException) as caught:
        service.review_kyc(
            "user-1",
            KycReviewRequest(
                decision="approve",
                reason="Attempt escalation",
                enabled_products=["crypto_derivatives"],
            ),
            {"uid": "admin-1"},
        )
    assert caught.value.status_code == 409


def test_admin_can_replace_product_access_after_approval(monkeypatch):
    captured: dict = {}
    audits: list[dict] = []
    monkeypatch.setattr(
        service.users_repository,
        "get_profile",
        lambda uid: {"uid": uid, "onboarding_status": "approved"},
    )
    monkeypatch.setattr(
        service.onboarding_repository,
        "get_kyc_profile",
        lambda uid: {"uid": uid},
    )

    def review(uid, **kwargs):
        captured.update(uid=uid, **kwargs)
        return {"uid": uid, **kwargs}

    monkeypatch.setattr(service.onboarding_repository, "review_application", review)
    monkeypatch.setattr(
        service.repository, "record_audit", lambda **kwargs: audits.append(kwargs)
    )
    service.set_product_access(
        "user-1",
        ProductAccessRequest(
            enabled_products=["crypto_spot", "forex"],
            reason="Approved requested market access",
        ),
        {"uid": "admin-1", "email": "admin@example.com"},
    )

    assert captured["enabled_products"] == ["crypto_spot", "forex"]
    assert captured["pending_products"] == []
    assert captured["tier"] is KycTier.pro
    assert audits[0]["action"] == "products.access.update"


def test_product_access_requires_approved_kyc(monkeypatch):
    monkeypatch.setattr(
        service.users_repository,
        "get_profile",
        lambda uid: {"uid": uid, "onboarding_status": "under_review"},
    )
    monkeypatch.setattr(
        service.onboarding_repository,
        "get_kyc_profile",
        lambda uid: {"uid": uid},
    )
    with pytest.raises(HTTPException) as caught:
        service.set_product_access(
            "user-1",
            ProductAccessRequest(
                enabled_products=["crypto_spot"], reason="Premature grant"
            ),
            {"uid": "admin-1"},
        )
    assert caught.value.status_code == 409


def test_platform_deposit_rails_are_strict_and_bounded():
    settings = PlatformSettingsUpdate(
        announcement="Maintenance at 18:00 UTC",
        deposit_rails=[
            {
                "currency": "USDT",
                "network": "BEP20",
                "name": "BNB Smart Chain",
                "address": "0x1234567890",
                "address_label": "Wallet address",
                "minimum": "1 USDT",
                "arrival": "After confirmation",
                "fee": "0 USDT",
                "confirmations": "15 confirmations",
                "enabled": True,
            }
        ],
    )
    assert settings.deposit_rails and settings.deposit_rails[0].network.value == "BEP20"
    with pytest.raises(ValidationError):
        PlatformSettingsUpdate(
            deposit_rails=[
                {
                    "currency": "USDT",
                    "network": "NOT_A_NETWORK",
                    "name": "Bad rail",
                    "address": "1234",
                    "address_label": "Wallet",
                    "minimum": "1",
                    "arrival": "Soon",
                    "fee": "0",
                    "confirmations": "1",
                }
            ]
        )

    with pytest.raises(ValidationError):
        PlatformSettingsUpdate(support_email="not-an-email")

    with pytest.raises(ValidationError):
        PlatformSettingsUpdate(
            deposit_rails=[settings.deposit_rails[0], settings.deposit_rails[0]]
        )


def test_admin_can_revoke_all_user_sessions(monkeypatch):
    audits: list[dict] = []
    revoked: list[str] = []
    monkeypatch.setattr(
        service.users_repository, "get_profile", lambda uid: {"uid": uid}
    )
    monkeypatch.setattr(service.firebase_auth, "revoke_refresh_tokens", revoked.append)
    monkeypatch.setattr(
        service.repository, "record_audit", lambda **kwargs: audits.append(kwargs)
    )

    result = service.revoke_sessions(
        "user-1",
        "Reported compromised device",
        {"uid": "admin-1", "email": "admin@example.com"},
    )

    assert result["revoked"] is True
    assert revoked == ["user-1"]
    assert audits[0]["action"] == "security.sessions.revoke"


def test_funding_decline_requires_a_reason_before_touching_storage():
    with pytest.raises(HTTPException) as caught:
        asyncio.run(funding_service.decline("admin-1", "request-1", " "))
    assert caught.value.status_code == 409
