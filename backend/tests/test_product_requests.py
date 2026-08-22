"""Self-service market product changes preserve the staff approval boundary."""

import pytest
from fastapi import HTTPException

from app.onboarding import service
from app.schemas.onboarding import KycTier, Product


def test_new_products_are_pending_and_removals_are_immediate(monkeypatch):
    profile = {
        "uid": "user-1",
        "onboarding_status": "approved",
        "enabled_products": ["crypto_spot", "forex"],
        "pending_products": [],
    }
    captured: dict = {}

    monkeypatch.setattr(service.users_repository, "get_profile", lambda uid: profile)

    def save(uid, **fields):
        captured.update(uid=uid, **fields)
        profile["enabled_products"] = fields["enabled_products"]
        profile["pending_products"] = fields["pending_products"]
        profile["kyc_tier"] = fields["tier"].value
        return True

    monkeypatch.setattr(service.repository, "update_product_request", save)
    result = service.request_product_access(
        "user-1", [Product.crypto_spot, Product.domestic_derivatives]
    )

    assert captured["enabled_products"] == ["crypto_spot"]
    assert captured["pending_products"] == ["domestic_derivatives"]
    assert captured["tier"] is KycTier.verified
    assert result["enabled_products"] == ["crypto_spot"]
    assert result["pending_products"] == ["domestic_derivatives"]


def test_submitted_account_can_update_requested_products(monkeypatch):
    profile = {
        "uid": "user-1",
        "onboarding_status": "under_review",
        "enabled_products": [],
        "pending_products": ["forex"],
    }
    captured: dict = {}
    monkeypatch.setattr(
        service.users_repository,
        "get_profile",
        lambda uid: profile,
    )
    monkeypatch.setattr(
        service.repository,
        "update_product_request",
        lambda uid, **fields: captured.update(uid=uid, **fields) or True,
    )

    service.request_product_access("user-1", [Product.crypto_spot])

    assert captured["enabled_products"] == []
    assert captured["pending_products"] == ["crypto_spot"]


def test_product_changes_require_submitted_kyc(monkeypatch):
    monkeypatch.setattr(
        service.users_repository,
        "get_profile",
        lambda uid: {"uid": uid, "onboarding_status": "not_started"},
    )
    with pytest.raises(HTTPException) as caught:
        service.request_product_access("user-1", [Product.crypto_spot])
    assert caught.value.status_code == 409


def test_approved_account_can_remove_every_product(monkeypatch):
    profile = {
        "uid": "user-1",
        "onboarding_status": "approved",
        "enabled_products": ["crypto_spot"],
        "pending_products": ["forex"],
    }
    captured: dict = {}
    monkeypatch.setattr(service.users_repository, "get_profile", lambda uid: profile)
    monkeypatch.setattr(
        service.repository,
        "update_product_request",
        lambda uid, **fields: captured.update(uid=uid, **fields) or True,
    )

    service.request_product_access("user-1", [])

    assert captured["enabled_products"] == []
    assert captured["pending_products"] == []
