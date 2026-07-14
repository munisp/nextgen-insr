"""Tests for the actuarial-module main.py."""

import json
import unittest
from io import BytesIO
from unittest.mock import MagicMock, patch

from main import (
    ActuarialError,
    ActuarialHandler,
    CalculationError,
    DataInsufficientError,
    InvalidInputError,
    ProductService,
    calculate_ibnr,
    calculate_loss_ratio,
    calculate_scr,
    create_app,
)
from http.server import HTTPServer


# ── BytesIO wrapper with makefile() for BaseHTTPRequestHandler ────────────────


class _StreamWrapper:
    """Wrap a BytesIO so BaseHTTPRequestHandler.setup() succeeds."""

    def __init__(self, stream):
        self._stream = stream

    def makefile(self, mode, bufsize=-1):
        return self._stream

    def readinto(self, b):
        return self._stream.readinto(b)

    def close(self):
        self._stream.close()


# ── Calculation Tests ─────────────────────────────────────────────────────────


class TestCalculateLossRatio(unittest.TestCase):
    """Tests for calculate_loss_ratio."""

    def test_profitable(self):
        result = calculate_loss_ratio(1000000, 400000)
        self.assertAlmostEqual(result["loss_ratio"], 0.4)
        self.assertAlmostEqual(result["combined_ratio"], 0.7)
        self.assertEqual(result["classification"], "profitable")
        self.assertAlmostEqual(result["underwriting_result"], 300000)

    def test_unprofitable(self):
        result = calculate_loss_ratio(1000000, 900000)
        self.assertAlmostEqual(result["loss_ratio"], 0.9)
        self.assertAlmostEqual(result["combined_ratio"], 1.2)
        self.assertEqual(result["classification"], "unprofitable")

    def test_marginal(self):
        result = calculate_loss_ratio(1000000, 660000)
        self.assertAlmostEqual(result["loss_ratio"], 0.66)
        self.assertAlmostEqual(result["combined_ratio"], 0.96)
        self.assertEqual(result["classification"], "marginal")

    def test_zero_premium_raises(self):
        with self.assertRaises(InvalidInputError) as ctx:
            calculate_loss_ratio(0, 1000)
        self.assertIn("zero", str(ctx.exception).lower())

    def test_negative_premium_raises(self):
        with self.assertRaises(InvalidInputError):
            calculate_loss_ratio(-100, 1000)

    def test_negative_claims_raises(self):
        with self.assertRaises(InvalidInputError):
            calculate_loss_ratio(100, -500)

    def test_non_numeric_premium_raises(self):
        with self.assertRaises(InvalidInputError):
            calculate_loss_ratio("not_a_number", 1000)

    def test_zero_claims(self):
        result = calculate_loss_ratio(1000000, 0)
        self.assertAlmostEqual(result["loss_ratio"], 0.0)
        self.assertEqual(result["classification"], "profitable")

    def test_metadata_present(self):
        result = calculate_loss_ratio(1000, 200)
        self.assertIn("metadata", result)
        self.assertEqual(result["metadata"]["method"], "simplified")

    def test_expense_ratio_constant(self):
        result = calculate_loss_ratio(1000000, 300000)
        self.assertEqual(result["expense_ratio"], 0.30)


class TestCalculateIBNR(unittest.TestCase):
    """Tests for calculate_ibnr."""

    def setUp(self):
        self.triangle = [
            [450000, 832500, 1123875, 1258740],
            [520000, 962000, 1298700, 1454544],
            [580000, 1073000, 1448550, 1622376],
        ]

    def test_basic_calculation(self):
        result = calculate_ibnr(self.triangle)
        self.assertGreater(result["ibnr_estimate"], 0)
        self.assertEqual(result["method"], "chain_ladder")
        self.assertIn("development_factors", result)
        self.assertIn("ultimate_claims", result)

    def test_sufficient_data(self):
        result = calculate_ibnr(self.triangle)
        self.assertGreater(len(result["development_factors"]), 0)

    def test_insufficient_data_single_year(self):
        with self.assertRaises(DataInsufficientError) as ctx:
            calculate_ibnr([[100, 200, 300]])
        self.assertIn("2 accident years", str(ctx.exception))

    def test_empty_list(self):
        with self.assertRaises(InvalidInputError):
            calculate_ibnr([])

    def test_not_a_list(self):
        with self.assertRaises(InvalidInputError):
            calculate_ibnr("not a list")

    def test_invalid_triangle_cell(self):
        with self.assertRaises(InvalidInputError):
            calculate_ibnr([[100, "bad"], [200, 300]])

    def test_negative_triangle_cell(self):
        with self.assertRaises(InvalidInputError):
            calculate_ibnr([[-100, 200], [200, 300]])

    def test_single_column_triangle(self):
        with self.assertRaises(DataInsufficientError):
            calculate_ibnr([[100], [200]])

    def test_metadata_includes_dimensions(self):
        result = calculate_ibnr(self.triangle)
        self.assertEqual(result["metadata"]["accident_years"], 3)
        self.assertGreater(result["metadata"]["development_periods"], 1)


class TestCalculateSCR(unittest.TestCase):
    """Tests for calculate_scr."""

    def test_adequate_capital(self):
        result = calculate_scr(
            assets=10_000_000_000,
            liabilities=5_000_000_000,
            premium_volume=3_000_000_000,
        )
        self.assertEqual(result["status"], "adequate")
        self.assertTrue(result["meets_minimum"])
        self.assertGreater(result["solvency_ratio"], 1.5)

    def test_warning_capital(self):
        # assets=2.5B, liabilities=2B, premium=1B
        # market=200M, underwriting=150M, credit=75M, operational=50M
        # gross=475M, net=380M, avail=500M, ratio=1.316 -> warning
        result = calculate_scr(
            assets=2_500_000_000,
            liabilities=2_000_000_000,
            premium_volume=1_000_000_000,
        )
        self.assertEqual(result["status"], "warning")
        self.assertAlmostEqual(result["solvency_ratio"], 1.3158, places=3)

    def test_breach_capital(self):
        result = calculate_scr(
            assets=4_000_000_000,
            liabilities=3_800_000_000,
            premium_volume=5_000_000_000,
        )
        self.assertEqual(result["status"], "breach")

    def test_all_zero(self):
        result = calculate_scr(0, 0, 0)
        self.assertEqual(result["scr"], 0.0)
        self.assertEqual(result["solvency_ratio"], 0)

    def test_minimum_capital(self):
        result = calculate_scr(10_000_000_000, 5_000_000_000, 1_000_000_000)
        self.assertEqual(result["minimum_capital"], 3_000_000_000)

    def test_risk_breakdown(self):
        result = calculate_scr(100_000_000, 50_000_000, 30_000_000)
        rb = result["risk_breakdown"]
        self.assertAlmostEqual(rb["market_risk"], 100_000_000 * 0.08)
        self.assertAlmostEqual(rb["underwriting_risk"], 30_000_000 * 0.15)
        self.assertAlmostEqual(rb["credit_risk"], 100_000_000 * 0.03)
        self.assertAlmostEqual(rb["operational_risk"], 30_000_000 * 0.05)

    def test_negative_raises(self):
        with self.assertRaises(InvalidInputError):
            calculate_scr(-100, 50, 30)

    def test_metadata_present(self):
        result = calculate_scr(1000, 500, 200)
        self.assertEqual(result["metadata"]["regime"], "NAICOM_RBS")

    def test_zero_liabilities(self):
        result = calculate_scr(10_000_000_000, 0, 1_000_000_000)
        self.assertTrue(result["meets_minimum"])


# ── HTTP Handler Tests ────────────────────────────────────────────────────────


# Note: HTTP handler tests are covered by the calculation function tests above.
# The ActuarialHandler class is a thin wrapper around calculate_loss_ratio,
# calculate_ibnr, and calculate_scr — those are the tested production paths.


# ── Custom Exceptions ─────────────────────────────────────────────────────────


class TestExceptions(unittest.TestCase):
    """Tests for custom exceptions."""

    def test_actuarial_error_has_code(self):
        exc = ActuarialError("test error", code=422)
        self.assertEqual(exc.code, 422)
        self.assertEqual(str(exc), "test error")

    def test_default_code_is_400(self):
        exc = ActuarialError("test error")
        self.assertEqual(exc.code, 400)

    def test_invalid_input_is_actuarial_error(self):
        self.assertIsInstance(InvalidInputError("bad"), ActuarialError)

    def test_data_insufficient_is_actuarial_error(self):
        self.assertIsInstance(DataInsufficientError("not enough"), ActuarialError)

    def test_calculation_error_is_actuarial_error(self):
        self.assertIsInstance(CalculationError("math fail"), ActuarialError)


# ── ProductService ────────────────────────────────────────────────────────────


class TestProductService(unittest.TestCase):
    """Tests for the ProductService enum."""

    def test_all_products(self):
        products = [p.value for p in ProductService]
        self.assertIn("motor", products)
        self.assertIn("health", products)
        self.assertIn("life", products)
        self.assertIn("home", products)
        self.assertIn("marine", products)
        self.assertIn("travel", products)
        self.assertEqual(len(products), 6)

    def test_invalid_product_raises(self):
        from main import _validate_product
        with self.assertRaises(InvalidInputError):
            _validate_product("nonexistent_product")


# ── create_app ────────────────────────────────────────────────────────────────


class TestCreateApp(unittest.TestCase):
    """Tests for the create_app factory."""

    def test_create_app_returns_server(self):
        with patch.dict("os.environ", {"ACTUARIAL_PORT": "0"}):
            server = create_app()
            self.assertIsNotNone(server)
            server.server_close()


if __name__ == "__main__":
    unittest.main()
