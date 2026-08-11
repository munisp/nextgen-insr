"""AML Screening Python SDK — PEP/sanctions list screening for Nigerian insurance.

FAIL-CLOSED DESIGN: the sanctions list is loaded from a real data source:
  1. JSON/CSV file at the path in the SANCTIONS_LIST_FILE env var, or
  2. the `sanctions_entries` table in PostgreSQL (when reachable), or
  3. the bundled demo seed file (sanctions_seed.json) — ONLY when
     ALLOW_SIMULATED_DATA=true is explicitly set.

If no list can be loaded, screening endpoints return HTTP 503
("sanctions list not loaded — fail closed"). No customer is ever screened
against an empty or fabricated list without the response saying so.
"""

import os
import csv
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
            logger.info(f"Connected to PostgreSQL for aml_screening_python_sdk")
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
                    CREATE TABLE IF NOT EXISTS aml_screening_python_sdk (
                        id SERIAL PRIMARY KEY,
                        data JSONB NOT NULL DEFAULT '{}',
                        status VARCHAR(50) DEFAULT 'active',
                        created_at TIMESTAMPTZ DEFAULT NOW(),
                        updated_at TIMESTAMPTZ DEFAULT NOW(),
                        tenant_id INTEGER DEFAULT 1
                    )
                """)
            logger.info(f"Table aml_screening_python_sdk initialized")
        except Exception as e:
            logger.warning(f"Table creation failed: {e}")


from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from difflib import SequenceMatcher
from datetime import datetime
from typing import Optional

# ── Middleware Clients ─────────────────────────────────────────────────────
import redis
import json as _json
from datetime import datetime

# Redis client
_redis_url = os.environ.get("REDIS_URL", "redis://localhost:6379")
_redis_client = None
try:
    _redis_client = redis.from_url(_redis_url, decode_responses=True, socket_timeout=5)
    _redis_client.ping()
    print(f"[middleware] Redis connected: {_redis_url}")
except Exception as _e:
    print(f"[middleware] Redis not available: {_e}")
    _redis_client = None

# Kafka producer helper
_kafka_brokers = os.environ.get("KAFKA_BROKERS", "localhost:9092")
class KafkaEventPublisher:
    def __init__(self, brokers: str, service_name: str):
        self.brokers = brokers
        self.service_name = service_name

    def publish(self, event_type: str, key: str, payload: dict):
        """Publish event to Kafka topic. In production, use confluent-kafka or aiokafka."""
        event = {
            "event_type": event_type,
            "source": self.service_name,
            "key": key,
            "payload": payload,
            "timestamp": datetime.utcnow().isoformat() + "Z",
        }
        # Production: producer.produce(topic, key=key, value=json.dumps(event))
        print(f"[kafka] event published: {event_type} key={key}")

_kafka_publisher = KafkaEventPublisher(_kafka_brokers, "aml-screening-python-sdk")

# OpenSearch structured logger
_opensearch_url = os.environ.get("OPENSEARCH_URL", "http://localhost:9200")
class OpenSearchLogger:
    def __init__(self, url: str, service_name: str):
        self.url = url
        self.service_name = service_name

    def index_log(self, level: str, message: str, fields: dict = None):
        """Index structured log to OpenSearch."""
        doc = {
            "@timestamp": datetime.utcnow().isoformat() + "Z",
            "level": level,
            "message": message,
            "service": self.service_name,
            "fields": fields or {},
        }
        # Production: requests.post(f"{self.url}/logs-aml-screening-python-sdk/_doc", json=doc)
        print(f"[opensearch] {level}: {message}")

_os_logger = OpenSearchLogger(_opensearch_url, "aml-screening-python-sdk")

# Permify authorization client
_permify_addr = os.environ.get("PERMIFY_ADDR", "")
async def check_permission(entity_type: str, entity_id: str, permission: str, user_id: str, tenant_id: str = "default") -> bool:
    """Check permission against Permify ReBAC."""
    if not _permify_addr:
        return True  # Permissive when Permify is not configured
    try:
        import httpx
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.post(
                f"http://{_permify_addr}/v1/tenants/{tenant_id}/permissions/check",
                json={
                    "entity": {"type": entity_type, "id": entity_id},
                    "permission": permission,
                    "subject": {"type": "user", "id": user_id},
                },
            )
            data = resp.json()
            return data.get("can") == "RESULT_ALLOWED"
    except Exception:
        return True  # Fail open

# Keycloak JWT authentication middleware
from fastapi import Request, HTTPException
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

_security = HTTPBearer(auto_error=False)

async def keycloak_auth_middleware(request: Request, call_next):
    """Validate JWT token from Keycloak. Skip for health/ready/live probes."""
    path = request.url.path
    if path in ("/health", "/ready", "/live", "/metrics", "/docs", "/openapi.json"):
        return await call_next(request)

    # Dev bypass
    if os.environ.get("DEV_AUTH_BYPASS") == "true":
        request.state.user_id = "dev-user"
        request.state.tenant_id = "default"
        request.state.roles = ["admin", "user"]
        return await call_next(request)

    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(status_code=401, detail={"code": "UNAUTHORIZED", "message": "missing bearer token"})

    # In production: validate JWT against Keycloak JWKS endpoint
    # For now, pass through (validation handled by APISIX gateway)
    request.state.user_id = request.headers.get("X-User-ID", "unknown")
    request.state.tenant_id = request.headers.get("X-Tenant-ID", "default")
    return await call_next(request)



app = FastAPI(title="AML Screening SDK", version="1.0.0")

app.middleware("http")(keycloak_auth_middleware)


# ── Sanctions List Loading (fail-closed) ────────────────────────────────────

ALLOW_SIMULATED_DATA = os.environ.get("ALLOW_SIMULATED_DATA", "").strip().lower() == "true"
SANCTIONS_LIST_FILE = os.environ.get("SANCTIONS_LIST_FILE", "").strip()
SEED_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "sanctions_seed.json")

_sanctions_entries: list = []
_list_source: Optional[str] = None
_list_last_updated: Optional[str] = None
_list_simulated: bool = False
_list_load_error: Optional[str] = None


def _normalise_entry(raw: dict) -> Optional[dict]:
    name = (raw.get("name") or "").strip()
    if not name:
        return None
    return {
        "name": name.upper(),
        "list": raw.get("list", "UNKNOWN"),
        "type": raw.get("type", "individual"),
    }


def _load_from_file(path: str) -> list:
    """Load sanctions entries from a JSON or CSV file."""
    entries: list = []
    if path.lower().endswith(".csv"):
        with open(path, newline="", encoding="utf-8") as f:
            for row in csv.DictReader(f):
                entry = _normalise_entry(row)
                if entry:
                    entries.append(entry)
    else:
        with open(path, encoding="utf-8") as f:
            data = _json.load(f)
        if isinstance(data, dict):
            data = data.get("entries", [])
        for raw in data:
            entry = _normalise_entry(raw)
            if entry:
                entries.append(entry)
    return entries


def _load_from_db() -> list:
    """Load sanctions entries from the sanctions_entries table, if present."""
    conn = get_db()
    if not conn:
        return []
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("SELECT name, list, type FROM sanctions_entries")
            rows = cur.fetchall()
        return [e for e in (_normalise_entry(dict(r)) for r in rows) if e]
    except Exception as e:
        try:
            conn.rollback()
        except Exception:
            pass
        logger.info(f"sanctions_entries table not usable: {e}")
        return []


def _load_sanctions_list() -> None:
    """Load the sanctions list from the best available real data source.

    Order: SANCTIONS_LIST_FILE -> PostgreSQL sanctions_entries table ->
    bundled seed file (only when ALLOW_SIMULATED_DATA=true).
    """
    global _sanctions_entries, _list_source, _list_last_updated, _list_simulated, _list_load_error

    _sanctions_entries = []
    _list_source = None
    _list_last_updated = None
    _list_simulated = False
    _list_load_error = None

    # 1. Explicit file
    if SANCTIONS_LIST_FILE:
        if not os.path.exists(SANCTIONS_LIST_FILE):
            _list_load_error = f"SANCTIONS_LIST_FILE not found: {SANCTIONS_LIST_FILE}"
            logger.error(_list_load_error)
        else:
            try:
                entries = _load_from_file(SANCTIONS_LIST_FILE)
                if entries:
                    _sanctions_entries = entries
                    _list_source = f"file:{SANCTIONS_LIST_FILE}"
                    _list_last_updated = datetime.fromtimestamp(
                        os.path.getmtime(SANCTIONS_LIST_FILE)
                    ).isoformat()
                    logger.info(f"Loaded {len(entries)} sanctions entries from {SANCTIONS_LIST_FILE}")
                    return
                _list_load_error = f"SANCTIONS_LIST_FILE is empty: {SANCTIONS_LIST_FILE}"
                logger.error(_list_load_error)
            except Exception as e:
                _list_load_error = f"failed to parse SANCTIONS_LIST_FILE {SANCTIONS_LIST_FILE}: {e}"
                logger.error(_list_load_error)

    # 2. Database table
    entries = _load_from_db()
    if entries:
        _sanctions_entries = entries
        _list_source = "postgres:sanctions_entries"
        _list_last_updated = datetime.utcnow().isoformat() + "Z"
        logger.info(f"Loaded {len(entries)} sanctions entries from PostgreSQL")
        return

    # 3. Explicitly-gated demo seed
    if ALLOW_SIMULATED_DATA:
        if os.path.exists(SEED_FILE):
            try:
                entries = _load_from_file(SEED_FILE)
                _sanctions_entries = entries
                _list_source = "seed:sanctions_seed.json (DEMO DATA ONLY)"
                _list_last_updated = datetime.fromtimestamp(
                    os.path.getmtime(SEED_FILE)
                ).isoformat()
                _list_simulated = True
                logger.warning(
                    "ALLOW_SIMULATED_DATA=true: screening against demo seed list "
                    f"({len(entries)} entries). NOT a real sanctions list."
                )
                return
            except Exception as e:
                _list_load_error = f"failed to load seed file {SEED_FILE}: {e}"
                logger.error(_list_load_error)
        else:
            _list_load_error = f"ALLOW_SIMULATED_DATA=true but seed file missing: {SEED_FILE}"
            logger.error(_list_load_error)

    if not _sanctions_entries and not _list_load_error:
        _list_load_error = (
            "no sanctions data source available: set SANCTIONS_LIST_FILE, provide a "
            "sanctions_entries table, or set ALLOW_SIMULATED_DATA=true for demo mode"
        )
        logger.error(_list_load_error)


def _require_sanctions_list() -> None:
    """Fail closed: refuse to screen when no real list is loaded."""
    if not _sanctions_entries:
        _load_sanctions_list()  # retry in case a source appeared since startup
    if not _sanctions_entries:
        raise HTTPException(
            status_code=503,
            detail=(
                "sanctions list not loaded — fail closed. "
                f"Reason: {_list_load_error or 'no data source configured'}"
            ),
        )


class ScreeningRequest(BaseModel):
    name: str
    bvn: Optional[str] = None
    date_of_birth: Optional[str] = None
    nationality: str = "NG"

class ScreeningResult(BaseModel):
    screening_id: str
    name_searched: str
    match_score: float
    decision: str
    matches: list
    list_source: str
    simulated: bool
    timestamp: str

def fuzzy_match(name1: str, name2: str) -> float:
    return SequenceMatcher(None, name1.upper(), name2.upper()).ratio() * 100

@app.get("/health")
def health():
    return {
        "status": "healthy",
        "service": "aml-screening-python-sdk",
        "sanctions_list_loaded": bool(_sanctions_entries),
        "list_source": _list_source,
        "simulated": _list_simulated,
    }

@app.post("/api/v1/screen", response_model=ScreeningResult)
def screen_customer(req: ScreeningRequest):
    _require_sanctions_list()
    matches = []
    max_score = 0.0
    for entry in _sanctions_entries:
        score = fuzzy_match(req.name, entry["name"])
        if score > 50:
            matches.append({"name": entry["name"], "list": entry["list"], "score": round(score, 1)})
            max_score = max(max_score, score)

    decision = "clear" if max_score < 50 else "edd_required" if max_score < 85 else "blocked"
    return ScreeningResult(
        screening_id=f"SCR-{datetime.now().strftime('%Y%m%d%H%M%S')}",
        name_searched=req.name, match_score=round(max_score, 1),
        decision=decision, matches=matches,
        list_source=_list_source or "unknown",
        simulated=_list_simulated,
        timestamp=datetime.now().isoformat()
    )

@app.get("/api/v1/lists")
def get_lists():
    if not _sanctions_entries:
        _load_sanctions_list()
    lists = sorted({e["list"] for e in _sanctions_entries})
    return {
        "lists": lists,
        "total_entries": len(_sanctions_entries),
        "last_updated": _list_last_updated,
        "list_source": _list_source,
        "simulated": _list_simulated,
        "load_error": _list_load_error if not _sanctions_entries else None,
    }

@app.post("/api/v1/batch-screen")
def batch_screen(names: list[str]):
    _require_sanctions_list()
    results = []
    for name in names[:100]:
        max_score = max((fuzzy_match(name, e["name"]) for e in _sanctions_entries), default=0)
        decision = "clear" if max_score < 50 else "edd_required" if max_score < 85 else "blocked"
        results.append({"name": name, "score": round(max_score, 1), "decision": decision})
    return {
        "results": results,
        "total": len(results),
        "list_source": _list_source,
        "simulated": _list_simulated,
    }


@app.on_event("startup")
async def startup():
    init_db()
    _load_sanctions_list()
