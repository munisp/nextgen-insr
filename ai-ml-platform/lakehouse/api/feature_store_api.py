"""
Feature Store REST API

Production-grade API for the Lakehouse Feature Store:
- CRUD operations on feature tables
- SQL queries via DuckDB engine
- Real-time feature serving endpoints
- Schema registry management
- Lineage exploration
- Access control enforcement
- Health and metrics endpoints
"""

from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
from fastapi import FastAPI, HTTPException, Header, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

# Lakehouse components
import sys
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from lakehouse.serving.feature_server import OnlineFeatureServer, ServingConfig
from lakehouse.streaming.ingestion import StreamingIngestionEngine, StreamConfig
from lakehouse.schema.registry import SchemaRegistry, FeatureSchema, SchemaField, FieldType, CompatibilityMode
from lakehouse.lineage.tracker import DataLineageTracker, MutationEvent
from lakehouse.access_control.rbac import AccessControlManager, Role, TablePolicy
from lakehouse.storage.object_store import create_store, StorageConfig

# ---------------------------------------------------------------------------
# App setup
# ---------------------------------------------------------------------------

app = FastAPI(
    title="NGApp Lakehouse Feature Store API",
    description="Production-grade feature store with Delta Lake, streaming ingestion, and online serving",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Global state (initialized on startup)
# ---------------------------------------------------------------------------

LAKEHOUSE_PATH = Path(__file__).parent.parent.parent / "lakehouse_store"

feature_server: OnlineFeatureServer | None = None
streaming_engine: StreamingIngestionEngine | None = None
schema_registry: SchemaRegistry | None = None
lineage_tracker: DataLineageTracker | None = None
access_control: AccessControlManager | None = None
duckdb_conn: Any = None


# ---------------------------------------------------------------------------
# Request/Response models
# ---------------------------------------------------------------------------

class FeatureRequest(BaseModel):
    table_name: str
    entity_id: str
    feature_names: list[str] | None = None


class BatchFeatureRequest(BaseModel):
    table_name: str
    entity_ids: list[str]
    feature_names: list[str] | None = None


class SQLQueryRequest(BaseModel):
    query: str
    limit: int = Field(default=1000, le=10000)


class IngestEventRequest(BaseModel):
    topic: str
    key: str | None = None
    payload: dict[str, Any]


class SchemaRegistrationRequest(BaseModel):
    name: str
    primary_key: str
    timestamp_field: str | None = None
    description: str = ""
    compatibility: str = "backward"
    fields: list[dict[str, Any]]


class TablePolicyRequest(BaseModel):
    table_name: str
    allowed_roles: list[str]
    denied_columns: dict[str, list[str]] = {}
    require_audit: bool = True
    max_rows_per_query: int | None = None


class PointInTimeRequest(BaseModel):
    table_name: str
    entity_id: str
    timestamp: float
    feature_names: list[str] | None = None


class TrainingDataRequest(BaseModel):
    table_name: str
    feature_names: list[str]
    label_col: str
    limit: int | None = None


# ---------------------------------------------------------------------------
# Startup / Shutdown
# ---------------------------------------------------------------------------

@app.on_event("startup")
async def startup():
    global feature_server, streaming_engine, schema_registry, lineage_tracker, access_control, duckdb_conn

    LAKEHOUSE_PATH.mkdir(parents=True, exist_ok=True)

    # Initialize feature server
    feature_server = OnlineFeatureServer(ServingConfig(lakehouse_path=str(LAKEHOUSE_PATH)))
    feature_server.start()

    # Initialize streaming engine
    streaming_engine = StreamingIngestionEngine(
        config=StreamConfig(),
        lakehouse_path=LAKEHOUSE_PATH,
    )
    streaming_engine.register_default_routes()

    # Initialize schema registry
    schema_registry = SchemaRegistry(str(LAKEHOUSE_PATH / "_schemas"))

    # Initialize lineage tracker
    lineage_tracker = DataLineageTracker(str(LAKEHOUSE_PATH / "_lineage"))
    lineage_tracker.register_platform_lineage()

    # Initialize access control
    access_control = AccessControlManager(str(LAKEHOUSE_PATH / "_access_control"))
    access_control.register_default_policies()

    # Initialize DuckDB
    try:
        import duckdb
        duckdb_conn = duckdb.connect(":memory:")
        _register_tables_with_duckdb()
    except ImportError:
        duckdb_conn = None

    print("[LakehouseAPI] Started — all subsystems initialized")


@app.on_event("shutdown")
async def shutdown():
    if feature_server:
        feature_server.stop()
    if streaming_engine:
        streaming_engine.stop()
    if duckdb_conn:
        duckdb_conn.close()
    print("[LakehouseAPI] Shutdown complete")


def _register_tables_with_duckdb():
    """Register parquet/delta tables with DuckDB for SQL queries."""
    if duckdb_conn is None:
        return

    for table_dir in LAKEHOUSE_PATH.iterdir():
        if table_dir.is_dir() and not table_dir.name.startswith("_"):
            parquet_files = list(table_dir.glob("*.parquet"))
            if parquet_files:
                try:
                    view_name = table_dir.name
                    paths = [str(f) for f in parquet_files]
                    if len(paths) == 1:
                        duckdb_conn.execute(
                            f"CREATE OR REPLACE VIEW {view_name} AS SELECT * FROM read_parquet('{paths[0]}')"
                        )
                    else:
                        paths_str = "', '".join(paths)
                        duckdb_conn.execute(
                            f"CREATE OR REPLACE VIEW {view_name} AS SELECT * FROM read_parquet(['{paths_str}'])"
                        )
                except Exception:
                    pass


def _serialize_value(v: Any) -> Any:
    """Serialize numpy/pandas types to JSON-safe values."""
    if isinstance(v, (np.integer,)):
        return int(v)
    if isinstance(v, (np.floating,)):
        return float(v)
    if isinstance(v, (np.bool_,)):
        return bool(v)
    if isinstance(v, np.ndarray):
        return v.tolist()
    if pd.isna(v):
        return None
    return v


# ---------------------------------------------------------------------------
# Health & Metrics
# ---------------------------------------------------------------------------

@app.get("/health")
async def health():
    return {
        "status": "healthy",
        "timestamp": time.time(),
        "components": {
            "feature_server": feature_server is not None,
            "streaming_engine": streaming_engine is not None,
            "schema_registry": schema_registry is not None,
            "lineage_tracker": lineage_tracker is not None,
            "access_control": access_control is not None,
            "duckdb": duckdb_conn is not None,
        },
    }


@app.get("/metrics")
async def metrics():
    result: dict[str, Any] = {"timestamp": time.time()}
    if feature_server:
        result["serving"] = feature_server.get_status()
    if streaming_engine:
        result["streaming"] = streaming_engine.get_status()
    if lineage_tracker:
        result["lineage"] = lineage_tracker.get_status()
    if access_control:
        result["access_control"] = access_control.get_status()
    return result


# ---------------------------------------------------------------------------
# Feature Serving Endpoints
# ---------------------------------------------------------------------------

@app.post("/features/get")
async def get_features(req: FeatureRequest):
    """Get features for a single entity (online serving)."""
    if not feature_server:
        raise HTTPException(500, "Feature server not initialized")

    fv = feature_server.get_features(req.table_name, req.entity_id, req.feature_names)
    if fv is None:
        raise HTTPException(404, f"Entity '{req.entity_id}' not found in '{req.table_name}'")

    return {
        "entity_id": fv.entity_id,
        "table": fv.source_table,
        "features": {k: _serialize_value(v) for k, v in fv.features.items()},
        "timestamp": fv.timestamp,
    }


@app.post("/features/batch")
async def get_features_batch(req: BatchFeatureRequest):
    """Get features for multiple entities (batch serving)."""
    if not feature_server:
        raise HTTPException(500, "Feature server not initialized")

    results = feature_server.get_features_batch(req.table_name, req.entity_ids, req.feature_names)
    return {
        "table": req.table_name,
        "results": {
            eid: {
                "features": {k: _serialize_value(v) for k, v in fv.features.items()},
                "timestamp": fv.timestamp,
            } if fv else None
            for eid, fv in results.items()
        },
    }


@app.post("/features/point-in-time")
async def point_in_time_lookup(req: PointInTimeRequest):
    """Get features as they were at a specific point in time."""
    if not feature_server:
        raise HTTPException(500, "Feature server not initialized")

    fv = feature_server.point_in_time_lookup(req.table_name, req.entity_id, req.timestamp, req.feature_names)
    if fv is None:
        raise HTTPException(404, f"No features found for entity '{req.entity_id}' at time {req.timestamp}")

    return {
        "entity_id": fv.entity_id,
        "table": fv.source_table,
        "features": {k: _serialize_value(v) for k, v in fv.features.items()},
        "as_of_timestamp": req.timestamp,
    }


@app.post("/features/training-data")
async def get_training_data(req: TrainingDataRequest):
    """Get training dataset (X, y) from the offline store."""
    if not feature_server:
        raise HTTPException(500, "Feature server not initialized")

    X, y = feature_server.get_training_dataset(req.table_name, req.feature_names, req.label_col, req.limit)
    if len(X) == 0:
        raise HTTPException(404, f"No training data found for table '{req.table_name}'")

    return {
        "table": req.table_name,
        "n_samples": len(X),
        "n_features": X.shape[1] if len(X.shape) > 1 else 0,
        "feature_names": req.feature_names,
        "label_col": req.label_col,
        "X_shape": list(X.shape),
        "y_shape": list(y.shape),
        "X_sample": X[:5].tolist(),
        "y_sample": y[:5].tolist(),
    }


# ---------------------------------------------------------------------------
# SQL Query Engine (DuckDB)
# ---------------------------------------------------------------------------

@app.post("/query/sql")
async def execute_sql(req: SQLQueryRequest):
    """Execute a SQL query against the feature store using DuckDB."""
    if duckdb_conn is None:
        raise HTTPException(500, "DuckDB not available — install duckdb package")

    # Security: block destructive queries
    dangerous_keywords = ["DROP", "DELETE", "TRUNCATE", "ALTER", "INSERT", "UPDATE", "CREATE"]
    query_upper = req.query.upper().strip()
    for kw in dangerous_keywords:
        if query_upper.startswith(kw):
            raise HTTPException(400, f"Destructive queries ({kw}) are not allowed via the API")

    try:
        _register_tables_with_duckdb()
        result = duckdb_conn.execute(f"{req.query} LIMIT {req.limit}").fetchdf()
        records = result.to_dict(orient="records")
        # Serialize numpy types
        clean_records = [
            {k: _serialize_value(v) for k, v in row.items()}
            for row in records
        ]
        return {
            "query": req.query,
            "n_rows": len(clean_records),
            "columns": list(result.columns),
            "data": clean_records,
        }
    except Exception as e:
        raise HTTPException(400, f"Query error: {str(e)}")


@app.get("/query/tables")
async def list_tables():
    """List all available tables for SQL queries."""
    tables = []
    for table_dir in LAKEHOUSE_PATH.iterdir():
        if table_dir.is_dir() and not table_dir.name.startswith("_"):
            parquet_files = list(table_dir.glob("*.parquet"))
            if parquet_files:
                # Get row count from first file
                try:
                    df = pd.read_parquet(parquet_files[0])
                    tables.append({
                        "name": table_dir.name,
                        "n_rows": len(df),
                        "n_columns": len(df.columns),
                        "columns": list(df.columns),
                        "size_bytes": sum(f.stat().st_size for f in parquet_files),
                    })
                except Exception:
                    tables.append({"name": table_dir.name, "n_rows": 0, "error": "unreadable"})
    return {"tables": tables}


# ---------------------------------------------------------------------------
# Streaming Ingestion Endpoints
# ---------------------------------------------------------------------------

@app.post("/ingest/event")
async def ingest_event(req: IngestEventRequest):
    """Ingest a single event into the streaming pipeline."""
    if not streaming_engine:
        raise HTTPException(500, "Streaming engine not initialized")

    from lakehouse.streaming.ingestion import StreamMessage
    msg = StreamMessage(
        topic=req.topic,
        key=req.key,
        value=json.dumps(req.payload).encode(),
        offset=0,
        partition=0,
        timestamp=time.time(),
    )
    streaming_engine._process_message(msg)
    return {"status": "accepted", "topic": req.topic}


@app.post("/ingest/batch")
async def ingest_batch(events: list[IngestEventRequest]):
    """Ingest a batch of events."""
    if not streaming_engine:
        raise HTTPException(500, "Streaming engine not initialized")

    from lakehouse.streaming.ingestion import StreamMessage
    accepted = 0
    for req in events:
        msg = StreamMessage(
            topic=req.topic,
            key=req.key,
            value=json.dumps(req.payload).encode(),
            offset=accepted,
            partition=0,
            timestamp=time.time(),
        )
        streaming_engine._process_message(msg)
        accepted += 1

    return {"status": "accepted", "count": accepted}


@app.post("/ingest/flush")
async def flush_ingestion():
    """Force-flush all pending micro-batches to disk."""
    if not streaming_engine:
        raise HTTPException(500, "Streaming engine not initialized")

    remaining = streaming_engine.accumulator.flush_all()
    flushed = 0
    for table_name, df in remaining.items():
        streaming_engine._write_batch(table_name, df)
        flushed += len(df)

    return {"status": "flushed", "rows_written": flushed}


@app.get("/ingest/status")
async def ingestion_status():
    """Get streaming ingestion status and metrics."""
    if not streaming_engine:
        raise HTTPException(500, "Streaming engine not initialized")
    return streaming_engine.get_status()


# ---------------------------------------------------------------------------
# Schema Registry Endpoints
# ---------------------------------------------------------------------------

@app.get("/schemas")
async def list_schemas():
    """List all registered schemas."""
    if not schema_registry:
        raise HTTPException(500, "Schema registry not initialized")
    return {"schemas": schema_registry.list_schemas()}


@app.get("/schemas/{name}")
async def get_schema(name: str, version: int | None = None):
    """Get a schema by name and optional version."""
    if not schema_registry:
        raise HTTPException(500, "Schema registry not initialized")

    schema = schema_registry.get_schema(name, version)
    if not schema:
        raise HTTPException(404, f"Schema '{name}' not found")
    return schema.to_dict()


@app.post("/schemas/register")
async def register_schema(req: SchemaRegistrationRequest):
    """Register a new schema or evolve an existing one."""
    if not schema_registry:
        raise HTTPException(500, "Schema registry not initialized")

    fields = [SchemaField.from_dict(f) for f in req.fields]
    schema = FeatureSchema(
        name=req.name,
        version=0,
        fields=fields,
        primary_key=req.primary_key,
        timestamp_field=req.timestamp_field,
        description=req.description,
        compatibility=CompatibilityMode(req.compatibility),
    )

    try:
        registered = schema_registry.register(schema)
        return {"status": "registered", "schema": registered.to_dict()}
    except Exception as e:
        raise HTTPException(400, f"Schema registration failed: {str(e)}")


@app.get("/schemas/{name}/history")
async def schema_history(name: str):
    """Get the evolution history of a schema."""
    if not schema_registry:
        raise HTTPException(500, "Schema registry not initialized")
    return {"name": name, "evolutions": schema_registry.get_evolution_history(name)}


# ---------------------------------------------------------------------------
# Lineage Endpoints
# ---------------------------------------------------------------------------

@app.get("/lineage/graph")
async def get_lineage_graph():
    """Get the full data lineage graph."""
    if not lineage_tracker:
        raise HTTPException(500, "Lineage tracker not initialized")
    return lineage_tracker.get_full_graph()


@app.get("/lineage/table/{table_name}")
async def get_table_lineage(table_name: str):
    """Get lineage for a specific table (upstream + downstream)."""
    if not lineage_tracker:
        raise HTTPException(500, "Lineage tracker not initialized")
    return lineage_tracker.get_lineage(table_name)


@app.get("/lineage/quality/{table_name}")
async def get_data_quality(table_name: str):
    """Get data quality metrics for a table."""
    if not lineage_tracker:
        raise HTTPException(500, "Lineage tracker not initialized")

    # Compute fresh quality metrics
    table_path = LAKEHOUSE_PATH / table_name
    if not table_path.exists():
        raise HTTPException(404, f"Table '{table_name}' not found")

    parquet_files = list(table_path.glob("*.parquet"))
    if not parquet_files:
        raise HTTPException(404, f"No data in table '{table_name}'")

    df = pd.read_parquet(parquet_files[0])
    metrics = lineage_tracker.compute_quality_metrics(table_name, df)
    return metrics.to_dict()


@app.get("/lineage/mutations")
async def get_mutations(table_name: str | None = None, limit: int = 50):
    """Get recent data mutation events."""
    if not lineage_tracker:
        raise HTTPException(500, "Lineage tracker not initialized")
    return {"mutations": lineage_tracker.get_recent_mutations(table_name, limit)}


@app.get("/lineage/alerts")
async def get_alerts(limit: int = 20):
    """Get recent quality/freshness alerts."""
    if not lineage_tracker:
        raise HTTPException(500, "Lineage tracker not initialized")
    return {"alerts": lineage_tracker.get_alerts(limit)}


# ---------------------------------------------------------------------------
# Access Control Endpoints
# ---------------------------------------------------------------------------

@app.get("/access/status")
async def access_status():
    """Get RBAC system status."""
    if not access_control:
        raise HTTPException(500, "Access control not initialized")
    return access_control.get_status()


@app.get("/access/audit")
async def get_audit_log(principal_id: str | None = None, limit: int = 100):
    """Get access audit log."""
    if not access_control:
        raise HTTPException(500, "Access control not initialized")
    return {"audit_log": access_control.get_audit_log(principal_id, limit)}


@app.post("/access/policy")
async def set_policy(req: TablePolicyRequest):
    """Set or update a table access policy."""
    if not access_control:
        raise HTTPException(500, "Access control not initialized")

    policy = TablePolicy(
        table_name=req.table_name,
        allowed_roles=[Role(r) for r in req.allowed_roles],
        denied_columns=req.denied_columns,
        require_audit=req.require_audit,
        max_rows_per_query=req.max_rows_per_query,
    )
    access_control.set_table_policy(policy)
    return {"status": "policy_set", "table": req.table_name}


# ---------------------------------------------------------------------------
# Feature Materialization
# ---------------------------------------------------------------------------

@app.post("/materialize/{table_name}")
async def materialize_table(table_name: str):
    """Materialize features from offline store into the online serving cache."""
    if not feature_server:
        raise HTTPException(500, "Feature server not initialized")

    count = feature_server.materialize(table_name)
    return {"status": "materialized", "table": table_name, "entities_cached": count}


@app.post("/materialize/all")
async def materialize_all():
    """Materialize all feature tables into the online cache."""
    if not feature_server:
        raise HTTPException(500, "Feature server not initialized")

    tables = ["fraud_features", "churn_features", "claims_features", "anomaly_features", "credit_features", "risk_features"]
    results = {}
    for table in tables:
        results[table] = feature_server.materialize(table)
    return {"status": "materialized", "results": results}


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def run_server(host: str = "0.0.0.0", port: int = 8200) -> None:
    """Run the Feature Store API server."""
    import uvicorn
    uvicorn.run(app, host=host, port=port)


if __name__ == "__main__":
    run_server()
