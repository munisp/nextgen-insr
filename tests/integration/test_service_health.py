"""Integration tests for service health endpoints and inter-service communication.

Run with: python -m pytest tests/integration/ -v
Requires: All services running via docker-compose up
"""

import asyncio
import os
from typing import Dict, List, Tuple

import httpx
import pytest

# Service endpoints — matches docker-compose.yml
SERVICES: Dict[str, str] = {
    "portal": os.environ.get("PORTAL_URL", "http://localhost:3000"),
    "core-services": os.environ.get("CORE_SERVICES_URL", "http://localhost:8080"),
    "kyc-services": os.environ.get("KYC_SERVICES_URL", "http://localhost:8085"),
    "ml-services": os.environ.get("ML_SERVICES_URL", "http://localhost:8110"),
    "ai-platform": os.environ.get("AI_PLATFORM_URL", "http://localhost:8200"),
    "insurance-ops": os.environ.get("INSURANCE_OPS_URL", "http://localhost:8400"),
    "financial": os.environ.get("FINANCIAL_URL", "http://localhost:8500"),
    "compliance": os.environ.get("COMPLIANCE_URL", "http://localhost:8600"),
    "communication": os.environ.get("COMMUNICATION_URL", "http://localhost:8700"),
}


@pytest.fixture
def client():
    return httpx.AsyncClient(timeout=10.0)


# --- Health Check Tests ---

@pytest.mark.asyncio
@pytest.mark.parametrize("service_name,base_url", list(SERVICES.items()))
async def test_health_endpoint(client, service_name: str, base_url: str):
    """Every service must respond to /health with status 200."""
    try:
        resp = await client.get(f"{base_url}/health")
        assert resp.status_code == 200
        data = resp.json()
        assert "status" in data
        assert data["status"] in ("healthy", "degraded")
    except httpx.ConnectError:
        pytest.skip(f"{service_name} not running at {base_url}")


@pytest.mark.asyncio
@pytest.mark.parametrize("service_name,base_url", list(SERVICES.items()))
async def test_readiness_endpoint(client, service_name: str, base_url: str):
    """Every service must respond to /ready."""
    try:
        resp = await client.get(f"{base_url}/ready")
        assert resp.status_code in (200, 503)
        data = resp.json()
        assert "ready" in data
    except httpx.ConnectError:
        pytest.skip(f"{service_name} not running at {base_url}")


@pytest.mark.asyncio
@pytest.mark.parametrize("service_name,base_url", list(SERVICES.items()))
async def test_liveness_endpoint(client, service_name: str, base_url: str):
    """Every service must respond to /live."""
    try:
        resp = await client.get(f"{base_url}/live")
        assert resp.status_code == 200
        data = resp.json()
        assert data.get("alive") is True
    except httpx.ConnectError:
        pytest.skip(f"{service_name} not running at {base_url}")


@pytest.mark.asyncio
@pytest.mark.parametrize("service_name,base_url", [
    (k, v) for k, v in SERVICES.items() if k != "portal"
])
async def test_metrics_endpoint(client, service_name: str, base_url: str):
    """Non-portal services must expose /metrics in Prometheus text format."""
    try:
        resp = await client.get(f"{base_url}/metrics")
        assert resp.status_code == 200
        assert "counter" in resp.text or "gauge" in resp.text
    except httpx.ConnectError:
        pytest.skip(f"{service_name} not running at {base_url}")


# --- Critical Flow Tests ---

@pytest.mark.asyncio
async def test_policy_lifecycle(client):
    """Test policy creation -> quote -> list flow."""
    base = SERVICES["core-services"]
    try:
        # Create policy
        resp = await client.post(f"{base}/api/v1/policies", json={
            "product_type": "motor", "premium_amount": 50000, "currency": "NGN",
        })
        assert resp.status_code == 201
        policy = resp.json()
        assert policy["status"] == "draft"
        assert "id" in policy

        # Get quote
        resp = await client.get(f"{base}/api/v1/policies/quote")
        assert resp.status_code == 200
        quote = resp.json()
        assert "premium" in quote

        # List policies
        resp = await client.get(f"{base}/api/v1/policies")
        assert resp.status_code == 200
    except httpx.ConnectError:
        pytest.skip("core-services not running")


@pytest.mark.asyncio
async def test_claim_submission(client):
    """Test claim submission -> adjudication flow."""
    base = SERVICES["core-services"]
    try:
        resp = await client.post(f"{base}/api/v1/claims", json={
            "description": "Vehicle accident", "claim_amount": 250000,
        })
        assert resp.status_code == 201
        claim = resp.json()
        assert claim["status"] == "submitted"

        resp = await client.get(f"{base}/api/v1/claims/adjudicate")
        assert resp.status_code == 200
        adj = resp.json()
        assert "decision" in adj
    except httpx.ConnectError:
        pytest.skip("core-services not running")


@pytest.mark.asyncio
async def test_payment_flow(client):
    """Test payment creation and mobile money providers."""
    base = SERVICES["financial"]
    try:
        resp = await client.post(f"{base}/api/v1/payments", json={
            "amount": 15000, "currency": "NGN", "method": "mobile_money",
        })
        assert resp.status_code == 201
        payment = resp.json()
        assert payment["status"] == "pending"

        resp = await client.get(f"{base}/api/v1/payments/mobile-money")
        assert resp.status_code == 200
        providers = resp.json()
        assert len(providers["providers"]) > 0
    except httpx.ConnectError:
        pytest.skip("financial not running")


@pytest.mark.asyncio
async def test_kyc_liveness_verification(client):
    """Test KYC liveness and OCR flow."""
    base = SERVICES["ml-services"]
    try:
        resp = await client.post(f"{base}/api/v1/liveness/verify", json={})
        assert resp.status_code == 200
        result = resp.json()
        assert result["is_live"] is True
        assert result["confidence"] > 0.8

        resp = await client.post(f"{base}/api/v1/ocr/extract", json={})
        assert resp.status_code == 200
        ocr = resp.json()
        assert "fields" in ocr
        assert ocr["confidence"] > 0.8
    except httpx.ConnectError:
        pytest.skip("ml-services not running")


@pytest.mark.asyncio
async def test_risk_scoring(client):
    """Test AI risk scoring and fraud detection."""
    base = SERVICES["ai-platform"]
    try:
        resp = await client.post(f"{base}/api/v1/inference/risk-score", json={})
        assert resp.status_code == 200
        risk = resp.json()
        assert 0 <= risk["risk_score"] <= 1
        assert risk["risk_category"] in ("low", "medium", "high", "critical")

        resp = await client.post(f"{base}/api/v1/inference/fraud-detection", json={})
        assert resp.status_code == 200
        fraud = resp.json()
        assert "fraud_probability" in fraud
    except httpx.ConnectError:
        pytest.skip("ai-platform not running")


@pytest.mark.asyncio
async def test_compliance_solvency(client):
    """Test NAICOM solvency and NDPR compliance."""
    base = SERVICES["compliance"]
    try:
        resp = await client.get(f"{base}/api/v1/naicom/solvency")
        assert resp.status_code == 200
        solv = resp.json()
        assert solv["solvency_ratio"] > solv["minimum_required"]
        assert solv["status"] == "compliant"

        resp = await client.get(f"{base}/api/v1/ndpr/consent")
        assert resp.status_code == 200
        ndpr = resp.json()
        assert ndpr["compliance_score"] > 0.9
    except httpx.ConnectError:
        pytest.skip("compliance not running")


@pytest.mark.asyncio
async def test_underwriting_assessment(client):
    """Test underwriting risk assessment."""
    base = SERVICES["insurance-ops"]
    try:
        resp = await client.get(f"{base}/api/v1/underwriting/assess")
        assert resp.status_code == 200
        assess = resp.json()
        assert assess["decision"] in ("standard", "substandard", "decline", "preferred")
        assert 0 <= assess["score"] <= assess["max_score"]
    except httpx.ConnectError:
        pytest.skip("insurance-ops not running")


@pytest.mark.asyncio
async def test_notification_send(client):
    """Test notification sending."""
    base = SERVICES["communication"]
    try:
        resp = await client.post(f"{base}/api/v1/notifications/send", json={
            "customer_id": "test-123", "template_id": "welcome", "channel": "sms",
        })
        assert resp.status_code == 200
        notif = resp.json()
        assert notif["status"] == "queued"
    except httpx.ConnectError:
        pytest.skip("communication not running")
