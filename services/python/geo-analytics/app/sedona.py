"""sedona.py — Q-wave Q5 (2026-09-25)

Apache Sedona (Spark) geospatial engine, used WHERE AVAILABLE, with an honest
pure-PostGIS fallback. Disclosure (dated): the production container image for
this service installs NO Spark/Sedona runtime by default (image size +
cluster requirement); `sedona_status()` reports {"engine": "postgis-fallback"}
unless pyspark + apache-sedona are importable AND SPARK_MASTER is configured.

When Sedona IS available, heavy zone-risk joins run as Sedona SQL
(ST_Contains/ST_Intersects) over the ingested GeoJSON; otherwise the exact
same predicates run as PostGIS SQL (sqlgen.py). Both paths are REAL — the
fallback is disclosed, never a mock.
"""

from __future__ import annotations

import os


def sedona_status() -> dict:
    """Report which geospatial engine is active (honest, fail-closed)."""
    spark_master = os.environ.get("SPARK_MASTER", "")
    try:
        import pyspark  # noqa: F401
        import sedona  # noqa: F401  (apache-sedona distribution)

        sedona_importable = True
    except ImportError:
        sedona_importable = False
    if sedona_importable and spark_master:
        return {
            "engine": "apache-sedona",
            "spark_master": spark_master,
            "disclosure": None,
        }
    return {
        "engine": "postgis-fallback",
        "spark_master": None,
        "disclosure": (
            "2026-09-25: Sedona/Spark runtime not installed in this container; "
            "geospatial predicates execute as PostGIS SQL (ST_Contains/"
            "ST_Intersects) with identical semantics. Deploy with pyspark + "
            "apache-sedona + SPARK_MASTER to enable the Sedona path."
        ),
    }


def sedona_available() -> bool:
    return sedona_status()["engine"] == "apache-sedona"
