"""Shared test fixtures and helpers (Leg C acceptance, design Appendix H)."""

import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "tests" / "data"

# Make the package importable when running pytest from the analytics dir.
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def load_golden(name: str):
    with open(DATA / name, encoding="utf-8") as fh:
        return json.load(fh)


@pytest.fixture(scope="session")
def golden():
    return load_golden
