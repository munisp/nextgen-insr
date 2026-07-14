"""Tests for demand-forecasting-py service."""
import pytest
from fastapi.testclient import TestClient
from forecasting import DemandForecaster, ForecastResult
from anomaly import AnomalyDetector
from main import app

client = TestClient(app)


# ── Health ──────────────────────────────────────────────────────────────────

class TestHealth:
    def test_health_returns_200(self):
        resp = client.get("/health")
        assert resp.status_code == 200

    def test_health_contains_service_name(self):
        assert client.get("/health").json()["service"] == "demand-forecasting"

    def test_health_has_algorithms(self):
        data = client.get("/health").json()
        assert "algorithms" in data
        assert "moving_average" in data["algorithms"]


# ── DemandForecaster ────────────────────────────────────────────────────────

class TestDemandForecaster:
    def test_forecast_moving_average(self):
        f = DemandForecaster()
        hist = [{"date": "2024-01-01", "quantity": 10}, {"date": "2024-01-02", "quantity": 20}]
        result = f.forecast("SKU-001", None, hist, 7, "moving_average")
        assert isinstance(result, ForecastResult)
        assert result.sku == "SKU-001"
        assert result.method == "moving_average"
        assert len(result.predictions) == 7

    def test_forecast_exponential_smoothing(self):
        f = DemandForecaster()
        result = f.forecast("SKU-002", None, [], 7, "exponential_smoothing")
        assert result.method == "exponential_smoothing"
        assert result.horizon_days == 7

    def test_forecast_seasonal(self):
        f = DemandForecaster()
        hist = [{"date": f"2024-01-0{i}", "quantity": 100 + i * 10} for i in range(1, 8)]
        result = f.forecast("SKU-003", 1, hist, 14, "seasonal")
        assert result.method == "seasonal"
        assert len(result.predictions) == 14

    def test_forecast_arima_lite(self):
        f = DemandForecaster()
        hist = [{"date": f"2024-01-0{i}", "quantity": 50 + i * 5} for i in range(1, 8)]
        result = f.forecast("SKU-004", None, hist, 7, "arima_lite")
        assert result.method == "arima_lite"

    def test_forecast_default_method(self):
        f = DemandForecaster()
        result = f.forecast("SKU-005", None, [], 7, "unknown_method")
        assert result.method == "unknown_method"

    def test_forecast_predictions_non_negative(self):
        f = DemandForecaster()
        result = f.forecast("SKU-006", None, [{"date": "2024-01-01", "quantity": 10}], 30)
        for pred in result.predictions:
            assert pred["predicted"] >= 0

    def test_forecast_confidence_intervals(self):
        f = DemandForecaster()
        result = f.forecast("SKU-007", None, [{"date": "2024-01-01", "quantity": 10}], 5)
        for i, (lo, hi) in enumerate(zip(result.confidence_lower, result.confidence_upper)):
            assert lo <= result.predictions[i]["predicted"] <= hi
            assert hi > lo

    def test_forecast_trend_detection(self):
        f = DemandForecaster()
        hist = [{"date": f"2024-01-0{i}", "quantity": 100 + i * 10} for i in range(1, 31)]
        result = f.forecast("SKU-008", None, hist, 7)
        assert result.trend in ("increasing", "decreasing", "stable")

    def test_forecast_empty_history(self):
        f = DemandForecaster()
        result = f.forecast("SKU-009", None, [], 7)
        assert len(result.predictions) == 7

    def test_forecast_result_has_all_fields(self):
        f = DemandForecaster()
        result = f.forecast("SKU-010", 1, [{"date": "2024-01-01", "quantity": 10}], 30)
        for field in ["sku", "warehouse_id", "method", "horizon_days", "predictions",
                       "confidence_lower", "confidence_upper", "seasonal_factors", "trend", "mape"]:
            assert hasattr(result, field)

    def test_forecast_to_dict(self):
        f = DemandForecaster()
        result = f.forecast("SKU-011", None, [], 7)
        d = result.to_dict()
        assert isinstance(d, dict)
        assert "sku" in d
        assert "predictions" in d

    def test_forecast_seasonal_factors_length(self):
        f = DemandForecaster()
        result = f.forecast("SKU-012", None, [{"date": "2024-01-01", "quantity": 10}], 7)
        assert len(result.seasonal_factors) >= 1


# ── AnomalyDetector ────────────────────────────────────────────────────────

class TestAnomalyDetector:
    def test_detect_returns_list(self):
        d = AnomalyDetector()
        data = [{"date": f"2024-01-0{i}", "quantity": 10} for i in range(1, 11)]
        result = d.detect(data)
        assert isinstance(result, list)

    def test_detect_few_points_returns_empty(self):
        d = AnomalyDetector()
        data = [{"date": "2024-01-01", "quantity": 10}, {"date": "2024-01-02", "quantity": 10}]
        assert d.detect(data) == []

    def test_detect_normal_data_no_anomalies(self):
        d = AnomalyDetector()
        data = [{"date": f"2024-01-0{i}", "quantity": 10} for i in range(1, 21)]
        result = d.detect(data)
        assert len(result) == 0

    def test_detect_spike_anomaly(self):
        d = AnomalyDetector()
        data = [{"date": f"2024-01-0{i}", "quantity": 10} for i in range(1, 11)]
        data.append({"date": "2024-01-11", "quantity": 500})
        result = d.detect(data)
        assert len(result) > 0

    def test_detect_drop_anomaly(self):
        d = AnomalyDetector()
        data = [{"date": f"2024-01-0{i}", "quantity": 100} for i in range(1, 11)]
        data.append({"date": "2024-01-11", "quantity": 1})
        result = d.detect(data)
        assert isinstance(result, list)

    def test_anomaly_has_date(self):
        d = AnomalyDetector()
        data = [{"date": f"2024-01-0{i}", "quantity": 10} for i in range(1, 11)]
        data.append({"date": "2024-01-11", "quantity": 500})
        anomalies = d.detect(data)
        if anomalies:
            assert "date" in anomalies[0]

    def test_anomaly_has_value(self):
        d = AnomalyDetector()
        data = [{"date": f"2024-01-0{i}", "quantity": 10} for i in range(1, 11)]
        data.append({"date": "2024-01-11", "quantity": 500})
        anomalies = d.detect(data)
        if anomalies:
            assert "value" in anomalies[0]

    def test_anomaly_has_severity(self):
        d = AnomalyDetector()
        data = [{"date": f"2024-01-0{i}", "quantity": 10} for i in range(1, 11)]
        data.append({"date": "2024-01-11", "quantity": 500})
        anomalies = d.detect(data)
        if anomalies:
            assert anomalies[0]["severity"] in ("low", "medium", "high", "critical")

    def test_anomaly_has_expected_range(self):
        d = AnomalyDetector()
        data = [{"date": f"2024-01-0{i}", "quantity": 10} for i in range(1, 11)]
        data.append({"date": "2024-01-11", "quantity": 500})
        anomalies = d.detect(data)
        if anomalies:
            assert "expectedRange" in anomalies[0]
            assert "lower" in anomalies[0]["expectedRange"]
            assert "upper" in anomalies[0]["expectedRange"]

    def test_anomaly_has_deviation(self):
        d = AnomalyDetector()
        data = [{"date": f"2024-01-0{i}", "quantity": 10} for i in range(1, 11)]
        data.append({"date": "2024-01-11", "quantity": 500})
        anomalies = d.detect(data)
        if anomalies:
            assert "deviation" in anomalies[0]

    def test_anomaly_has_methods(self):
        d = AnomalyDetector()
        data = [{"date": f"2024-01-0{i}", "quantity": 10} for i in range(1, 11)]
        data.append({"date": "2024-01-11", "quantity": 500})
        anomalies = d.detect(data)
        if anomalies:
            assert "methods" in anomalies[0]

    def test_anomaly_has_type(self):
        d = AnomalyDetector()
        data = [{"date": f"2024-01-0{i}", "quantity": 10} for i in range(1, 11)]
        data.append({"date": "2024-01-11", "quantity": 500})
        anomalies = d.detect(data)
        if anomalies:
            assert anomalies[0]["type"] in ("spike", "drop")


# ── Forecast Accuracy ──────────────────────────────────────────────────────

class TestAccuracy:
    def test_get_accuracy_returns_dict(self):
        f = DemandForecaster()
        hist = [{"date": f"2024-01-0{i}", "quantity": 10 + i} for i in range(1, 31)]
        f.forecast("SKU-ACC", None, hist, 7)
        result = f.get_accuracy("SKU-ACC", 30)
        assert isinstance(result, dict)

    def test_accuracy_has_mape(self):
        f = DemandForecaster()
        result = f.get_accuracy("SKU-ACC", 30)
        assert "mape" in result
        assert 0 <= result["mape"] <= 1

    def test_accuracy_has_mae(self):
        f = DemandForecaster()
        result = f.get_accuracy("SKU-ACC", 30)
        assert "mae" in result

    def test_accuracy_has_rmse(self):
        f = DemandForecaster()
        result = f.get_accuracy("SKU-ACC", 30)
        assert "rmse" in result

    def test_accuracy_has_sample_size(self):
        f = DemandForecaster()
        result = f.get_accuracy("SKU-ACC", 30)
        assert "sampleSize" in result


# ── Seasonal Factors ────────────────────────────────────────────────────────

class TestSeasonalFactors:
    def test_get_seasonal_factors_returns_list(self):
        f = DemandForecaster()
        result = f.get_seasonal_factors("SKU-SEASONAL", 12)
        assert isinstance(result, list)

    def test_seasonal_factors_has_period(self):
        f = DemandForecaster()
        result = f.get_seasonal_factors("SKU-SEASONAL", 7)
        for item in result:
            assert "period" in item
            assert "factor" in item


# ── Trend Analysis ──────────────────────────────────────────────────────────

class TestTrends:
    def test_analyze_trends_returns_dict(self):
        f = DemandForecaster()
        result = f.analyze_trends("SKU-TREND", 30)
        assert isinstance(result, dict)

    def test_trends_has_trend(self):
        f = DemandForecaster()
        result = f.analyze_trends("SKU-TREND", 30)
        assert result["trend"] in ("increasing", "decreasing", "stable")

    def test_trends_has_average_demand(self):
        f = DemandForecaster()
        result = f.analyze_trends("SKU-TREND", 30)
        assert "averageDemand" in result

    def test_trends_has_volatility(self):
        f = DemandForecaster()
        result = f.analyze_trends("SKU-TREND", 30)
        assert "volatility" in result

    def test_trends_has_data_points(self):
        f = DemandForecaster()
        result = f.analyze_trends("SKU-TREND", 30)
        assert result["dataPoints"] == 30

    def test_trends_peak_gt_trough(self):
        f = DemandForecaster()
        result = f.analyze_trends("SKU-TREND", 30)
        assert result["peakDemand"] >= result["troughDemand"]


# ── Reorder Point Calculation ───────────────────────────────────────────────

class TestReorderPoint:
    def test_calculate_reorder_point_returns_200(self):
        resp = client.post("/api/v1/reorder/calculate", json={
            "sku": "SKU-001", "leadTimeDays": 7, "serviceLevel": 0.95,
            "avgDailyDemand": 10, "demandStdDev": 3,
        })
        assert resp.status_code == 200

    def test_reorder_point_has_reorderPoint(self):
        data = client.post("/api/v1/reorder/calculate", json={
            "sku": "SKU-001", "leadTimeDays": 7, "serviceLevel": 0.95,
            "avgDailyDemand": 10, "demandStdDev": 3,
        }).json()
        assert "reorderPoint" in data

    def test_reorder_point_has_safetyStock(self):
        data = client.post("/api/v1/reorder/calculate", json={
            "sku": "SKU-001", "leadTimeDays": 7, "serviceLevel": 0.95,
            "avgDailyDemand": 10, "demandStdDev": 3,
        }).json()
        assert "safetyStock" in data

    def test_reorder_point_has_eoq(self):
        data = client.post("/api/v1/reorder/calculate", json={
            "sku": "SKU-001", "leadTimeDays": 7, "serviceLevel": 0.95,
            "avgDailyDemand": 10, "demandStdDev": 3,
        }).json()
        assert "economicOrderQuantity" in data

    def test_different_service_levels(self):
        r90 = client.post("/api/v1/reorder/calculate", json={
            "sku": "SKU-A", "leadTimeDays": 7, "serviceLevel": 0.90,
            "avgDailyDemand": 10, "demandStdDev": 3,
        }).json()
        r99 = client.post("/api/v1/reorder/calculate", json={
            "sku": "SKU-A", "leadTimeDays": 7, "serviceLevel": 0.99,
            "avgDailyDemand": 10, "demandStdDev": 3,
        }).json()
        assert r99["reorderPoint"] > r90["reorderPoint"]
