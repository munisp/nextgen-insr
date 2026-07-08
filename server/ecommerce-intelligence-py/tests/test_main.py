"""Tests for ecommerce-intelligence-py service."""
import pytest
from fastapi.testclient import TestClient
from recommendations import RecommendationEngine
from pricing import DynamicPricingEngine
from analytics import SalesAnalytics


class TestRecommendationEngine:
    def test_init(self):
        engine = RecommendationEngine("sqlite:///:memory:", "redis://localhost:6379")
        assert isinstance(engine, RecommendationEngine)

    def test_get_for_customer_returns_list(self):
        engine = RecommendationEngine("sqlite:///:memory:", "redis://localhost:6379")
        recs = engine.get_for_customer(1, 10)
        assert isinstance(recs, list)

    def test_get_for_customer_limit(self):
        engine = RecommendationEngine("sqlite:///:memory:", "redis://localhost:6379")
        recs = engine.get_for_customer(1, 5)
        assert len(recs) <= 5

    def test_get_similar_products_returns_list(self):
        engine = RecommendationEngine("sqlite:///:memory:", "redis://localhost:6379")
        similar = engine.get_similar_products(1, 5)
        assert isinstance(similar, list)

    def test_get_trending_returns_list(self):
        engine = RecommendationEngine("sqlite:///:memory:", "redis://localhost:6379")
        trending = engine.get_trending(0, 10)
        assert isinstance(trending, list)

    def test_record_interaction_no_error(self):
        engine = RecommendationEngine("sqlite:///:memory:", "redis://localhost:6379")
        engine.record_interaction(customer_id=1, product_id=1, interaction_type="view")

    def test_record_interaction_with_metadata(self):
        engine = RecommendationEngine("sqlite:///:memory:", "redis://localhost:6379")
        engine.record_interaction(customer_id=1, product_id=1, interaction_type="purchase",
                                  metadata={"source": "web"})


class TestDynamicPricingEngine:
    def test_init(self):
        engine = DynamicPricingEngine("sqlite:///:memory:", "redis://localhost:6379")
        assert isinstance(engine, DynamicPricingEngine)

    def test_calculate_returns_dict(self):
        engine = DynamicPricingEngine("sqlite:///:memory:", "redis://localhost:6379")
        result = engine.calculate(1, 0, 1)
        assert isinstance(result, dict)

    def test_calculate_has_dynamic_price(self):
        engine = DynamicPricingEngine("sqlite:///:memory:", "redis://localhost:6379")
        result = engine.calculate(1, 0, 1)
        assert "dynamicPrice" in result

    def test_calculate_positive_price(self):
        engine = DynamicPricingEngine("sqlite:///:memory:", "redis://localhost:6379")
        result = engine.calculate(1, 0, 1)
        assert result["dynamicPrice"] > 0

    def test_calculate_has_currency(self):
        engine = DynamicPricingEngine("sqlite:///:memory:", "redis://localhost:6379")
        result = engine.calculate(1, 0, 1)
        assert result["currency"] == "NGN"

    def test_calculate_has_line_total(self):
        engine = DynamicPricingEngine("sqlite:///:memory:", "redis://localhost:6379")
        result = engine.calculate(1, 0, 2)
        assert result["lineTotal"] == result["dynamicPrice"] * 2

    def test_add_rule(self):
        engine = DynamicPricingEngine("sqlite:///:memory:", "redis://localhost:6379")
        rule_id = engine.add_rule({"productId": 1, "minDiscount": 0.1})
        assert isinstance(rule_id, (int, str))

    def test_get_offline_cache_returns_list(self):
        engine = DynamicPricingEngine("sqlite:///:memory:", "redis://localhost:6379")
        cache = engine.get_offline_cache(0, 10)
        assert isinstance(cache, list)

    def test_last_cache_time_returns_string(self):
        engine = DynamicPricingEngine("sqlite:///:memory:", "redis://localhost:6379")
        ts = engine.last_cache_time()
        assert isinstance(ts, str)


class TestSalesAnalytics:
    def test_init(self):
        analytics = SalesAnalytics("sqlite:///:memory:")
        assert isinstance(analytics, SalesAnalytics)

    def test_get_summary_returns_dict(self):
        analytics = SalesAnalytics("sqlite:///:memory:")
        result = analytics.get_summary("7d")
        assert isinstance(result, dict)

    def test_by_category_returns_dict_with_categories(self):
        analytics = SalesAnalytics("sqlite:///:memory:")
        result = analytics.by_category("30d", 10)
        assert isinstance(result, dict)
        assert "categories" in result

    def test_by_agent_returns_dict_with_agents(self):
        analytics = SalesAnalytics("sqlite:///:memory:")
        result = analytics.by_agent("30d", 20)
        assert isinstance(result, dict)
        assert "agents" in result

    def test_forecast_returns_list(self):
        analytics = SalesAnalytics("sqlite:///:memory:")
        result = analytics.forecast(30)
        assert isinstance(result, list)

    def test_inventory_velocity_returns_list(self):
        analytics = SalesAnalytics("sqlite:///:memory:")
        result = analytics.inventory_velocity(50)
        assert isinstance(result, list)

    def test_basket_analysis_returns_list(self):
        analytics = SalesAnalytics("sqlite:///:memory:")
        result = analytics.basket_analysis(0.01, 20)
        assert isinstance(result, list)
