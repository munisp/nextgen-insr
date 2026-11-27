"""FastAPI batch service for the actuary analytics package (Leg C).

Absorbs actuarial-platform's HTTP surface verbatim (routes, response
schemas, 503 fail-closed posture, illustrative mortality labelling) and
adds the new batch endpoints (reserve runs, GLM artefacts, registry,
capital adapter, adequacy ETL).

Data sources (preserved contract):
  * DATABASE_URL PostgreSQL claims table (ACTUARIAL_CLAIMS_TABLE, default
    "claims"), or ACTUARIAL_CLAIMS_FILE / ACTUARIAL_EXPERIENCE_FILE JSON.
  * When no source yields rows, reserving/experience endpoints return
    HTTP 503 instead of canned numbers.
"""

from .main import app

__all__ = ["app"]
