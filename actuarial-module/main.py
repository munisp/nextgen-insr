"""
Actuarial Module (Python)


"""
import os
import psycopg2
import psycopg2.extras
import logging

logger = logging.getLogger(__name__)

# ── Database Connection ──────────────────────────────────────────────────────
DATABASE_URL = os.environ.get("DATABASE_URL", "postgresql://ngapp:ngapp@localhost:5432/ngapp")
_db_conn = None

def get_db():
    global _db_conn
    if _db_conn is None or _db_conn.closed:
        try:
            _db_conn = psycopg2.connect(DATABASE_URL)
            _db_conn.autocommit = True
            logger.info(f"Connected to PostgreSQL for actuarial_module")
        except Exception as e:
            logger.warning(f"Database connection failed: {e} (running in degraded mode)")
            return None
    return _db_conn

def init_db():
    conn = get_db()
    if conn:
        try:
            with conn.cursor() as cur:
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS actuarial_module (
                        id SERIAL PRIMARY KEY,
                        data JSONB NOT NULL DEFAULT '{}',
                        status VARCHAR(50) DEFAULT 'active',
                        created_at TIMESTAMPTZ DEFAULT NOW(),
                        updated_at TIMESTAMPTZ DEFAULT NOW(),
                        tenant_id INTEGER DEFAULT 1
                    )
                """)
            logger.info(f"Table actuarial_module initialized")
        except Exception as e:
            logger.warning(f"Table creation failed: {e}")


import json
import math
import logging
import os
from http.server import HTTPServer, BaseHTTPRequestHandler
from datetime import datetime
from typing import Dict, List, Optional
from enum import Enum

logger = logging.getLogger(__name__)
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s - %(message)s",
)


# ── Custom Exceptions ──────────────────────────────────────────────────────────


class ActuarialError(Exception):
    """Base exception for actuarial module errors."""

    def __init__(self, message: str, code: int = 400):
        super().__init__(message)
        self.code = code
        self.details = message


class InvalidInputError(ActuarialError):
    """Raised when input validation fails."""

    pass


class DataInsufficientError(ActuarialError):
    """Raised when there is insufficient data for a calculation."""

    pass


class CalculationError(ActuarialError):
    """Raised when a calculation error occurs."""

    pass


class ProductService(Enum):
    """Supported insurance product types."""

    MOTOR = "motor"
    HEALTH = "health"
    LIFE = "life"
    HOME = "home"
    MARINE = "marine"
    TRAVEL = "travel"


# ── Input Validation ───────────────────────────────────────────────────────────


def _validate_positive_float(value: float, name: str) -> float:
    """Validate that a value is a non-negative float."""
    if not isinstance(value, (int, float)):
        raise InvalidInputError(f"{name} must be a number, got {type(value).__name__}")
    value = float(value)
    if value < 0:
        raise InvalidInputError(f"{name} must be non-negative, got {value}")
    return value


def _validate_non_empty_list(value: list, name: str) -> list:
    """Validate that a list is non-empty."""
    if not isinstance(value, list):
        raise InvalidInputError(f"{name} must be a list, got {type(value).__name__}")
    if len(value) == 0:
        raise InvalidInputError(f"{name} must not be empty")
    return value


def _validate_triangle(value: list, name: str) -> list:
    """Validate a claims triangle structure (list of lists of numbers)."""
    validated = _validate_non_empty_list(value, name)
    for i, row in enumerate(validated):
        if not isinstance(row, list):
            raise InvalidInputError(f"claims_triangle row {i} must be a list")
        if len(row) == 0:
            raise InvalidInputError(f"claims_triangle row {i} must not be empty")
        for j, cell in enumerate(row):
            if not isinstance(cell, (int, float)):
                raise InvalidInputError(
                    f"claims_triangle cell [{i}][{j}] must be a number"
                )
            if cell < 0:
                raise InvalidInputError(
                    f"claims_triangle cell [{i}][{j}] must be non-negative, got {cell}"
                )
    return validated


def _validate_product(product_id: Optional[str]) -> Optional[ProductService]:
    """Validate a product ID string against known products."""
    if product_id is None:
        return None
    try:
        return ProductService(product_id)
    except ValueError:
        valid = [p.value for p in ProductService]
        raise InvalidInputError(
            f"Invalid product: {product_id}. Valid products: {valid}"
        )


# ── Actuarial Calculations ─────────────────────────────────────────────────────


def calculate_loss_ratio(earned_premium: float, incurred_claims: float) -> Dict:
    """Calculate loss ratio and classify profitability.

    Args:
        earned_premium: Total premium earned during the period.
        incurred_claims: Total claims incurred during the period.

    Returns:
        Dict with loss ratio, combined ratio, classification, and result.

    Raises:
        InvalidInputError: If earned_premium is zero or inputs are invalid.
    """
    earned_premium = _validate_positive_float(earned_premium, "earned_premium")
    incurred_claims = _validate_positive_float(incurred_claims, "incurred_claims")

    if earned_premium == 0:
        raise InvalidInputError("earned_premium cannot be zero", code=422)

    loss_ratio = incurred_claims / earned_premium
    expense_ratio = 0.30
    combined_ratio = loss_ratio + expense_ratio

    if combined_ratio > 1.0:
        classification = "unprofitable"
    elif combined_ratio > 0.95:
        classification = "marginal"
    else:
        classification = "profitable"

    underwriting_result = round(earned_premium * (1 - combined_ratio), 2)

    logger.info(
        "Loss ratio calc: earned=%.2f claims=%.2f ratio=%.4f class=%s",
        earned_premium,
        incurred_claims,
        loss_ratio,
        classification,
    )

    return {
        "loss_ratio": round(loss_ratio, 4),
        "expense_ratio": expense_ratio,
        "combined_ratio": round(combined_ratio, 4),
        "classification": classification,
        "underwriting_result": underwriting_result,
        "metadata": {
            "method": "simplified",
            "expense_ratio_assumption": expense_ratio,
            "calculated_at": datetime.utcnow().isoformat() + "Z",
        },
    }


def calculate_ibnr(paid_claims: List[List[float]]) -> Dict:
    """Chain-ladder IBNR estimation from claims triangle.

    Args:
        paid_claims: Triangular claims data (accident year vs development year).

    Returns:
        Dict with IBNR estimate, development factors, and ultimate claims.

    Raises:
        InvalidInputError: If the triangle is malformed.
        DataInsufficientError: If there is insufficient data to calculate.
    """
    validated = _validate_triangle(paid_claims, "claims_triangle")

    if len(validated) < 2:
        raise DataInsufficientError(
            "At least 2 accident years of claims data required for chain-ladder estimation",
            code=422,
        )

    num_cols = max(len(row) for row in validated)
    if num_cols < 2:
        raise DataInsufficientError(
            "Claims triangle must have at least 2 development periods",
            code=422,
        )

    # Compute chain-ladder development factors
    development_factors = []
    for col in range(num_cols - 1):
        sum_curr = 0.0
        sum_prev = 0.0
        for row in validated:
            if col + 1 < len(row):
                sum_curr += row[col + 1]
            if col < len(row):
                sum_prev += row[col]

        if sum_prev > 0:
            development_factors.append(round(sum_curr / sum_prev, 4))
        else:
            development_factors.append(1.0)
            logger.warning(
                "Development factor for col %d: prev sum is 0, using 1.0", col
            )

    # Ultimate claims for the most recent accident year
    latest_row = validated[-1]
    latest = latest_row[-1] if latest_row else 0.0
    cumulative_factor = 1.0
    for f in development_factors:
        cumulative_factor *= f

    ultimate = latest * cumulative_factor
    ibnr = ultimate - latest

    logger.info(
        "IBNR calc: ultimate=%.2f ibnr=%.2f factors=%s",
        ultimate,
        max(ibnr, 0),
        development_factors,
    )

    return {
        "ibnr_estimate": round(max(ibnr, 0), 2),
        "development_factors": development_factors,
        "cumulative_factor": round(cumulative_factor, 4),
        "ultimate_claims": round(ultimate, 2),
        "method": "chain_ladder",
        "metadata": {
            "accident_years": len(validated),
            "development_periods": num_cols,
            "calculated_at": datetime.utcnow().isoformat() + "Z",
        },
    }


def calculate_scr(
    assets: float, liabilities: float, premium_volume: float
) -> Dict:
    """Simplified Solvency Capital Requirement per NAICOM RBS.

    Args:
        assets: Total assets of the insurer.
        liabilities: Total liabilities of the insurer.
        premium_volume: Annual premium volume.

    Returns:
        Dict with SCR, solvency ratio, risk breakdown, and status.
    """
    assets = _validate_positive_float(assets, "assets")
    liabilities = _validate_positive_float(liabilities, "liabilities")
    premium_volume = _validate_positive_float(premium_volume, "premium_volume")

    minimum_capital = 3_000_000_000

    # Risk charges (simplified)
    market_risk = assets * 0.08
    underwriting_risk = premium_volume * 0.15
    credit_risk = assets * 0.03
    operational_risk = premium_volume * 0.05

    # Diversification benefit (20%)
    gross_scr = market_risk + underwriting_risk + credit_risk + operational_risk
    diversification = gross_scr * 0.20
    net_scr = gross_scr - diversification

    available_capital = assets - liabilities
    solvency_ratio = available_capital / net_scr if net_scr > 0 else 0

    if solvency_ratio >= 1.5:
        status = "adequate"
    elif solvency_ratio >= 1.0:
        status = "warning"
    else:
        status = "breach"

    logger.info(
        "SCR calc: assets=%.2f liabilities=%.2f net_scr=%.2f status=%s",
        assets,
        liabilities,
        net_scr,
        status,
    )

    return {
        "scr": round(net_scr, 2),
        "available_capital": round(available_capital, 2),
        "solvency_ratio": round(solvency_ratio, 4),
        "meets_minimum": available_capital >= minimum_capital,
        "minimum_capital": minimum_capital,
        "risk_breakdown": {
            "market_risk": round(market_risk, 2),
            "underwriting_risk": round(underwriting_risk, 2),
            "credit_risk": round(credit_risk, 2),
            "operational_risk": round(operational_risk, 2),
            "diversification_benefit": round(-diversification, 2),
        },
        "status": status,
        "metadata": {
            "regime": "NAICOM_RBS",
            "method": "simplified_standard_formula",
            "calculated_at": datetime.utcnow().isoformat() + "Z",
        },
    }


# ── Request Handler ────────────────────────────────────────────────────────────

VALID_PRODUCTS = [p.value for p in ProductService]


class ActuarialHandler(BaseHTTPRequestHandler):
    """HTTP request handler for the actuarial module."""

    def do_GET(self):
        if self.path == "/health":
            self._respond(200, {"status": "healthy", "service": "actuarial-module"})
        elif self.path == "/api/v1/products":
            self._respond(200, {"products": VALID_PRODUCTS})
        else:
            self._respond(404, {"error": "not found", "path": self.path})

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        try:
            body = json.loads(self.rfile.read(length)) if length > 0 else {}
        except json.JSONDecodeError as exc:
            self._respond(400, {"error": "invalid JSON", "detail": str(exc)})
            return

        if self.path == "/api/v1/loss-ratio":
            self._handle_loss_ratio(body)
        elif self.path == "/api/v1/ibnr":
            self._handle_ibnr(body)
        elif self.path == "/api/v1/scr":
            self._handle_scr(body)
        else:
            self._respond(404, {"error": "not found", "path": self.path})

    def _handle_loss_ratio(self, body):
        try:
            earned_premium = body.get("earned_premium")
            incurred_claims = body.get("incurred_claims")
            if earned_premium is None or incurred_claims is None:
                raise InvalidInputError(
                    "Both earned_premium and incurred_claims are required"
                )
            result = calculate_loss_ratio(
                float(earned_premium), float(incurred_claims)
            )
            self._respond(200, result)
        except InvalidInputError as exc:
            self._respond(exc.code or 422, {"error": exc.args[0]})
        except Exception as exc:
            logger.exception("Error in loss-ratio calculation")
            self._respond(500, {"error": "internal server error"})

    def _handle_ibnr(self, body):
        try:
            claims_triangle = body.get("claims_triangle")
            if claims_triangle is None:
                raise InvalidInputError("claims_triangle is required")
            result = calculate_ibnr(claims_triangle)
            self._respond(200, result)
        except (InvalidInputError, DataInsufficientError) as exc:
            self._respond(exc.code or 422, {"error": exc.args[0]})
        except Exception as exc:
            logger.exception("Error in IBNR calculation")
            self._respond(500, {"error": "internal server error"})

    def _handle_scr(self, body):
        try:
            assets = body.get("assets", 0)
            liabilities = body.get("liabilities", 0)
            premium_volume = body.get("premium_volume", 0)
            result = calculate_scr(float(assets), float(liabilities), float(premium_volume))
            self._respond(200, result)
        except InvalidInputError as exc:
            self._respond(exc.code or 422, {"error": exc.args[0]})
        except Exception as exc:
            logger.exception("Error in SCR calculation")
            self._respond(500, {"error": "internal server error"})

    def _respond(self, code: int, data: dict):
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())

    def log_message(self, format, *args):
        logger.info(format, *args)


# ── Entry Point ────────────────────────────────────────────────────────────────


def create_app() -> HTTPServer:
    """Factory function to create the HTTP server (useful for testing)."""
    port = int(os.environ.get("ACTUARIAL_PORT", "8100"))
    server = HTTPServer(("0.0.0.0", port), ActuarialHandler)
    logger.info("Actuarial Module starting on port %d", port)
    return server


init_db()

if __name__ == "__main__":
    server = create_app()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        logger.info("Shutting down actuarial module")
        server.shutdown()
