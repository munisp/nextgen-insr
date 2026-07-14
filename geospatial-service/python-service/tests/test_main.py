"""Tests for geospatial-service/python-service."""
import pytest
from unittest.mock import patch, AsyncMock
from fastapi.testclient import TestClient
from main import app, NIGERIAN_STATES, normalize_nigerian_address, calculate_distance, get_state_code

client = TestClient(app)


# ── Health / Readiness ──────────────────────────────────────────────────────

class TestHealth:
    def test_health_returns_200(self):
        resp = client.get("/health")
        assert resp.status_code == 200

    def test_health_status_healthy(self):
        data = client.get("/health").json()
        assert data["status"] == "healthy"

    def test_health_has_timestamp(self):
        data = client.get("/health").json()
        assert "timestamp" in data


class TestReadiness:
    def test_ready_returns_200_with_mock(self):
        with patch('main.db_pool', None):
            resp = client.get("/ready")
            assert resp.status_code in (200, 503)


# ── Nigerian States ─────────────────────────────────────────────────────────

class TestNigerianStates:
    def test_get_states_returns_200(self):
        resp = client.get("/api/v1/states")
        assert resp.status_code == 200

    def test_get_states_returns_list(self):
        data = client.get("/api/v1/states").json()
        assert len(data) > 0

    def test_states_count_36_plus_fct(self):
        data = client.get("/api/v1/states").json()
        assert len(data) == 37  # 36 states + FCT

    def test_state_has_required_fields(self):
        data = client.get("/api/v1/states").json()
        for state in data:
            for field in ["code", "name", "capital", "region"]:
                assert field in state

    def test_get_specific_state(self):
        resp = client.get("/api/v1/states/LA")
        assert resp.status_code == 200

    def test_get_state_lagos(self):
        data = client.get("/api/v1/states/LA").json()
        assert data["name"] == "Lagos"

    def test_get_unknown_state(self):
        resp = client.get("/api/v1/states/XX")
        assert resp.status_code == 404

    def test_get_state_case_insensitive(self):
        r1 = client.get("/api/v1/states/LA")
        r2 = client.get("/api/v1/states/la")
        assert r1.status_code == 200
        assert r2.status_code == 200

    def test_state_regions_exist(self):
        data = client.get("/api/v1/states").json()
        regions = set(s["region"] for s in data)
        assert "South-West" in regions
        assert "North-East" in regions
        assert "South-South" in regions


# ── State Code Helpers ──────────────────────────────────────────────────────

class TestHelpers:
    def test_get_state_code_lagos(self):
        assert get_state_code("Lagos") == "LA"

    def test_get_state_code_case_insensitive(self):
        assert get_state_code("lagos") == "LA"

    def test_get_state_code_unknown(self):
        assert get_state_code("UnknownState") is None

    def test_normalize_address(self):
        addr = normalize_nigerian_address(type('Address', (), {
            'address_line1': ' 10 Broad Street  ',
            'address_line2': ' Suite 5',
            'city': 'lagos',
            'state': 'lagos',
            'postal_code': None,
            'country': 'Nigeria'
        })())
        assert addr.state == "Lagos"
        assert addr.city == "Lagos"


# ── Distance Calculation ────────────────────────────────────────────────────

class TestDistance:
    def test_distance_returns_200(self):
        resp = client.post("/api/v1/distance", json={
            "origin_lat": 6.5244, "origin_lon": 3.3792,
            "destination_lat": 9.0579, "destination_lon": 7.4951,
        })
        assert resp.status_code == 200

    def test_distance_lagos_abuja(self):
        data = client.post("/api/v1/distance", json={
            "origin_lat": 6.5244, "origin_lon": 3.3792,
            "destination_lat": 9.0579, "destination_lon": 7.4951,
        }).json()
        # Lagos to Abuja is ~530 km
        assert data["distance_km"] > 400
        assert data["distance_km"] < 600

    def test_distance_same_point(self):
        data = client.post("/api/v1/distance", json={
            "origin_lat": 6.5244, "origin_lon": 3.3792,
            "destination_lat": 6.5244, "destination_lon": 3.3792,
        }).json()
        assert data["distance_km"] == 0

    def test_distance_symmetric(self):
        d1 = client.post("/api/v1/distance", json={
            "origin_lat": 6.5, "origin_lon": 3.3,
            "destination_lat": 9.0, "destination_lon": 7.5,
        }).json()["distance_km"]
        d2 = client.post("/api/v1/distance", json={
            "origin_lat": 9.0, "origin_lon": 7.5,
            "destination_lat": 6.5, "destination_lon": 3.3,
        }).json()["distance_km"]
        assert abs(d1 - d2) < 0.01

    def test_distance_has_bearing(self):
        data = client.post("/api/v1/distance", json={
            "origin_lat": 6.5, "origin_lon": 3.3,
            "destination_lat": 9.0, "destination_lon": 7.5,
        }).json()
        assert 0 <= data["bearing_degrees"] < 360

    def test_distance_has_meters(self):
        data = client.post("/api/v1/distance", json={
            "origin_lat": 6.5, "origin_lon": 3.3,
            "destination_lat": 9.0, "destination_lon": 7.5,
        }).json()
        # distance_meters ≈ distance_km * 1000 (allow rounding tolerance)
        ratio = data["distance_meters"] / (data["distance_km"] * 1000)
        assert 0.99 <= ratio <= 1.01


# ── Within Nigeria ──────────────────────────────────────────────────────────

class TestWithinNigeria:
    def test_within_returns_200(self):
        resp = client.get("/api/v1/within-nigeria?latitude=6.5&longitude=3.3")
        assert resp.status_code == 200

    def test_lagos_within_nigeria(self):
        data = client.get("/api/v1/within-nigeria?latitude=6.5&longitude=3.3").json()
        assert data["is_within_nigeria"] is True

    def test_new_york_not_within_nigeria(self):
        data = client.get("/api/v1/within-nigeria?latitude=40.7&longitude=-74.0").json()
        assert data["is_within_nigeria"] is False

    def test_return_has_coordinates(self):
        data = client.get("/api/v1/within-nigeria?latitude=6.5&longitude=3.3").json()
        assert data["latitude"] == 6.5
        assert data["longitude"] == 3.3


# ── Error Handling ──────────────────────────────────────────────────────────

class TestErrorHandling:
    def test_404_unknown_route(self):
        assert client.get("/api/v1/nonexistent").status_code == 404

    def test_post_to_get_endpoint(self):
        resp = client.post("/health")
        assert resp.status_code in (200, 405)
