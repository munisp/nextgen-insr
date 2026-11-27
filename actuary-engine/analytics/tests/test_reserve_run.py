"""Reserve-run persistence fail-closed (Appendix H, Leg C): no claims
source → DataSourceUnavailableError (503 at the app boundary), the exact
contract actuarial-platform ships today. Success path persists via a
documented persistence-boundary store."""

import json

import pytest

from actuary_analytics.jobs.reserve_run import (
    InMemoryReserveRunStore,
    run_monthly_reserve,
)
from actuary_analytics.reserving.data_source import (
    ClaimsSourceConfig,
    DataSourceUnavailableError,
    load_claims,
)


@pytest.fixture
def no_source_env(monkeypatch):
    for var in ("DATABASE_URL", "ACTUARIAL_CLAIMS_FILE", "ACTUARIAL_EXPERIENCE_FILE"):
        monkeypatch.delenv(var, raising=False)
    return monkeypatch


class TestFailClosed:
    def test_load_claims_raises_without_source(self, no_source_env):
        with pytest.raises(DataSourceUnavailableError) as excinfo:
            load_claims(ClaimsSourceConfig.from_env())
        assert excinfo.value.status_code == 503
        assert "no data source configured" in str(excinfo.value)

    def test_reserve_run_fails_closed(self, no_source_env):
        with pytest.raises(DataSourceUnavailableError):
            run_monthly_reserve("motor", "2026-01", "chainladder", InMemoryReserveRunStore())

    def test_app_endpoint_returns_503(self, no_source_env):
        from fastapi.testclient import TestClient

        from app.main import app

        client = TestClient(app)
        response = client.get("/api/v1/actuarial/loss-triangles")
        assert response.status_code == 503
        assert "no data source configured" in response.json()["detail"]

    def test_app_reserve_run_returns_503(self, no_source_env):
        from fastapi.testclient import TestClient

        import app.main as app_main

        client = TestClient(app_main.app)
        response = client.post(
            "/api/v1/actuarial/reserve-run",
            json={"product_line": "motor", "as_of": "2026-01", "method": "chainladder"},
        )
        assert response.status_code == 503


class TestSuccessPaths:
    @pytest.fixture
    def claims_file(self, tmp_path):
        """Legacy JSON contract (accident_year/development_period cells)."""
        payload = {
            "claims": [
                {"accident_year": 2023, "development_period": 0, "amount": 100.0},
                {"accident_year": 2023, "development_period": 1, "amount": 80.0},
                {"accident_year": 2023, "development_period": 2, "amount": 40.0},
                {"accident_year": 2024, "development_period": 0, "amount": 120.0},
                {"accident_year": 2024, "development_period": 1, "amount": 90.0},
                {"accident_year": 2025, "development_period": 0, "amount": 150.0},
            ]
        }
        path = tmp_path / "claims.json"
        path.write_text(json.dumps(payload))
        return str(path)

    @pytest.fixture
    def drizzle_claims_file(self, tmp_path):
        """Drizzle claims shape (design §2.7 camelCase columns)."""
        claims = []
        for oy, n_settle in ((2023, 3), (2024, 2), (2025, 1)):
            for i, (dev_lag, amount) in enumerate(
                [(0, 100.0 + 10 * oy % 100), (1, 80.0), (2, 40.0)][:n_settle]
            ):
                claims.append(
                    {
                        "claimNumber": f"CLM-{oy}-{i}",
                        "policyId": f"POL-{oy}",
                        "incidentDate": f"{oy}-03-15",
                        "reportedDate": f"{oy}-04-01",
                        "claimedAmount": amount * 1.2,
                        "approvedAmount": amount,
                        "paidAmount": amount,
                        "settlementDate": f"{oy + dev_lag}-09-10",
                        "status": "settled",
                        "tenantId": 1,
                    }
                )
        path = tmp_path / "drizzle_claims.json"
        path.write_text(json.dumps({"claims": claims}))
        return str(path)

    def test_reserve_run_persists(self, claims_file, monkeypatch):
        monkeypatch.setenv("ACTUARIAL_CLAIMS_FILE", claims_file)
        monkeypatch.delenv("DATABASE_URL", raising=False)
        store = InMemoryReserveRunStore()
        result = run_monthly_reserve("motor", "2026-01", "chainladder", store)
        assert result.run_id == 1
        assert result.ibnr > 0
        persisted = store.get_run(result.run_id)
        assert persisted["method"] == "chainladder"
        assert persisted["ibnr"] == result.ibnr
        assert persisted["status"] == "computed"
        # approval flow
        store.approve_run(result.run_id, "actuary@nextgen-insr")
        assert store.get_run(result.run_id)["status"] == "approved"

    def test_drizzle_claims_build_triangle(self, drizzle_claims_file, monkeypatch):
        monkeypatch.setenv("ACTUARIAL_CLAIMS_FILE", drizzle_claims_file)
        monkeypatch.delenv("DATABASE_URL", raising=False)
        store = InMemoryReserveRunStore()
        result = run_monthly_reserve("motor", "2026-01", "mack", store)
        assert len(result.triangle) == 3
        assert sorted(result.triangle) == ["2023", "2024", "2025"]
        assert result.mack_sd is not None
        assert result.data_source.startswith("file:")

    def test_bf_requires_apriori(self, claims_file, monkeypatch):
        monkeypatch.setenv("ACTUARIAL_CLAIMS_FILE", claims_file)
        monkeypatch.delenv("DATABASE_URL", raising=False)
        with pytest.raises(ValueError):
            run_monthly_reserve("motor", "2026-01", "bf", InMemoryReserveRunStore())

    def test_bf_with_priced_lr_apriori(self, claims_file, monkeypatch):
        monkeypatch.setenv("ACTUARIAL_CLAIMS_FILE", claims_file)
        monkeypatch.delenv("DATABASE_URL", raising=False)
        import numpy as np

        # priced LR 0.70 × illustrative earned premium per origin
        apriori = np.asarray([500.0, 520.0, 540.0])
        result = run_monthly_reserve(
            "motor", "2026-01", "bf", InMemoryReserveRunStore(),
            apriori_ultimates=apriori,
        )
        assert result.method == "bf"
        assert result.ibnr > 0
