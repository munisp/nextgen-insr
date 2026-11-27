"""App contract tests: absorbed actuarial-platform surface (routes,
response schemas, 503 posture, illustrative mortality labelling) plus the
new adequacy endpoint."""

import json

import pytest
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


@pytest.fixture(autouse=True)
def clean_env(monkeypatch):
    for var in ("DATABASE_URL", "ACTUARIAL_CLAIMS_FILE", "ACTUARIAL_EXPERIENCE_FILE"):
        monkeypatch.delenv(var, raising=False)
    return monkeypatch


class TestHealth:
    def test_health(self):
        response = client.get("/health")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "healthy"
        assert data["absorbs"] == "actuarial-platform"
        assert "timestamp" in data


class TestMortalityTables:
    def test_tables_official_false_with_disclaimer(self):
        response = client.get("/api/v1/actuarial/mortality-tables")
        assert response.status_code == 200
        data = response.json()
        assert "statutory valuation" in data["disclaimer"].lower()
        assert len(data["tables"]) >= 2
        for table in data["tables"]:
            assert table["official"] is False
            assert table["status"] == "illustrative_reference"

    def test_illustrative_ids_preserved(self):
        ids = {t["id"] for t in client.get("/api/v1/actuarial/mortality-tables").json()["tables"]}
        assert "ILLUSTRATIVE-NGA-2020" in ids
        assert "ILLUSTRATIVE-AFRI-STD-2023" in ids


class TestLossTriangles:
    def test_503_without_source(self):
        response = client.get("/api/v1/actuarial/loss-triangles")
        assert response.status_code == 503
        assert "no data source configured" in response.json()["detail"]

    def test_200_with_legacy_file(self, tmp_path, clean_env):
        payload = {"triangle": {"2021": [100.0, 150.0, 180.0], "2022": [110.0, 170.0],
                                "2023": [130.0]}}
        path = tmp_path / "claims.json"
        path.write_text(json.dumps(payload))
        clean_env.setenv("ACTUARIAL_CLAIMS_FILE", str(path))
        response = client.get("/api/v1/actuarial/loss-triangles")
        assert response.status_code == 200
        data = response.json()
        assert data["method"] == "chain_ladder"
        assert data["triangle"]["2021"] == [100.0, 150.0, 180.0]
        assert len(data["development_factors"]) == 2
        assert data["ibnr_reserve"] > 0
        assert data["data_source"].startswith("file:")
        # volume-weighted factor check: (150+170)/(100+110), (180)/150
        assert abs(data["development_factors"][0] - 320 / 210) < 1e-9
        assert abs(data["development_factors"][1] - 180 / 150) < 1e-9

    def test_200_with_drizzle_claims_file(self, tmp_path, clean_env):
        claims = [
            {"claimNumber": "C1", "policyId": "P1", "incidentDate": "2023-01-10",
             "reportedDate": "2023-02-01", "claimedAmount": 120, "approvedAmount": 100,
             "paidAmount": 100, "settlementDate": "2023-06-01", "status": "settled",
             "tenantId": 1},
            {"claimNumber": "C2", "policyId": "P2", "incidentDate": "2023-03-10",
             "reportedDate": "2023-04-01", "claimedAmount": 100, "approvedAmount": 90,
             "paidAmount": 90, "settlementDate": "2024-02-01", "status": "settled",
             "tenantId": 1},
            {"claimNumber": "C3", "policyId": "P3", "incidentDate": "2024-05-05",
             "reportedDate": "2024-06-01", "claimedAmount": 130, "approvedAmount": 110,
             "paidAmount": 110, "settlementDate": "2024-11-01", "status": "settled",
             "tenantId": 1},
        ]
        path = tmp_path / "claims.json"
        path.write_text(json.dumps({"claims": claims}))
        clean_env.setenv("ACTUARIAL_CLAIMS_FILE", str(path))
        response = client.get("/api/v1/actuarial/loss-triangles")
        assert response.status_code == 200
        data = response.json()
        assert data["triangle"]["2023"] == [100.0, 190.0]
        assert data["triangle"]["2024"] == [110.0]


class TestPricing:
    def test_known_product(self):
        response = client.get("/api/v1/actuarial/pricing/motor_tp")
        assert response.status_code == 200
        data = response.json()
        assert data["product"] == "Motor Third Party"
        assert data["base_premium"] == 15000
        assert data["expected_loss_ratio"] == 0.62
        assert len(data["rating_factors"]) == 5

    def test_unknown_product_404(self):
        response = client.get("/api/v1/actuarial/pricing/unknown_product")
        assert response.status_code == 404
        assert "not found" in response.json()["detail"]


class TestExperienceStudy:
    def test_503_without_source(self):
        response = client.get("/api/v1/actuarial/experience-study")
        assert response.status_code == 503

    def test_200_with_file(self, tmp_path, clean_env):
        payload = {
            "study_period": "2023-2025",
            "products": [
                {"product": "Motor TP", "expected_claims_frequency": 0.12,
                 "actual_claims_frequency": 0.135, "avg_claim_severity": 185000},
                {"product": "Life", "expected_mortality": 0.005,
                 "actual_mortality": 0.004, "avg_claim_severity": 500000},
            ],
        }
        path = tmp_path / "experience.json"
        path.write_text(json.dumps(payload))
        clean_env.setenv("ACTUARIAL_EXPERIENCE_FILE", str(path))
        response = client.get("/api/v1/actuarial/experience-study")
        assert response.status_code == 200
        data = response.json()
        assert data["products_analyzed"] == 2
        motor = next(r for r in data["results"] if r["product"] == "Motor TP")
        assert abs(motor["ae_ratio"] - round(0.135 / 0.12, 4)) < 1e-9
        assert "monitor experience" in motor["recommendation"]


class TestAdequacy:
    def test_red_alert_emitted(self):
        response = client.post(
            "/api/v1/analytics/adequacy",
            json={"product_line": "motor", "period": "2026-01",
                  "paid_claims": 700.0, "case_reserves": 100.0, "ibnr_share": 50.0,
                  "earned_premium": 1000.0, "priced_loss_ratio": 0.62,
                  "credibility": 1.0},
        )
        assert response.status_code == 200
        data = response.json()
        assert abs(data["actual_loss_ratio"] - 0.85) < 1e-9
        assert len(data["alerts"]) == 1
        assert data["alerts"][0]["severity"] == "red"
        assert data["events_sent"] == 2  # observation + alert

    def test_within_band_no_alert(self):
        response = client.post(
            "/api/v1/analytics/adequacy",
            json={"product_line": "motor", "period": "2026-01",
                  "paid_claims": 600.0, "case_reserves": 0.0, "ibnr_share": 0.0,
                  "earned_premium": 1000.0, "priced_loss_ratio": 0.62,
                  "credibility": 1.0},
        )
        data = response.json()
        assert data["alerts"] == []
        assert data["events_sent"] == 1
