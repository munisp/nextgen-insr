"""
Lakehouse ETL Engine
====================
Orchestrates data ingestion from all InsurePortal infrastructure services
into the S3 lakehouse using a bronze/silver/gold tier architecture.

Services covered:
  1. PostgreSQL   – CDC via logical replication + incremental polling
  2. Fluvio       – Stream ingestion from all insurance topics
  3. TigerBeetle  – Ledger accounts, transfers, balance history
  4. Temporal     – Workflow execution history and metrics
  5. Redis        – Session, rate-limit, KPI cache, fraud score snapshots
  6. Dapr         – Pub/sub events and state store snapshots
  7. Keycloak     – Auth events, admin events, users, sessions
  8. OpenAppSec   – WAF attack events and security metrics
"""
from __future__ import annotations

import asyncio
import io
import json
import logging
import os
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq

log = logging.getLogger(__name__)

# ── Configuration ─────────────────────────────────────────────────────────────
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://postgres:postgres@postgres:5432/insureportal")
S3_ENDPOINT = os.getenv("S3_ENDPOINT_URL", os.getenv("S3_ENDPOINT", "http://minio:9000"))
S3_ACCESS_KEY = os.getenv("S3_ACCESS_KEY_ID", os.getenv("S3_ACCESS_KEY", "minioadmin"))
S3_SECRET_KEY = os.getenv("S3_SECRET_ACCESS_KEY", os.getenv("S3_SECRET_KEY", "minioadmin"))
S3_BUCKET = os.getenv("LAKEHOUSE_BUCKET", os.getenv("S3_BUCKET", "insureportal-lakehouse"))


class LakehouseETL:
    """
    Manages ETL pipelines from all InsurePortal services to the data lakehouse.

    Architecture:
      Bronze – raw data as ingested (immutable)
      Silver – cleaned, deduped, enriched data
      Gold   – aggregated KPIs and analytics-ready datasets
    """

    def __init__(self):
        self._s3_client = None
        self._db_engine = None

    # ── Shared helpers ─────────────────────────────────────────────────────────

    def _get_s3(self):
        if self._s3_client is None:
            try:
                import boto3
                self._s3_client = boto3.client(
                    "s3",
                    endpoint_url=S3_ENDPOINT,
                    aws_access_key_id=S3_ACCESS_KEY,
                    aws_secret_access_key=S3_SECRET_KEY,
                )
            except Exception as e:
                log.warning(f"S3 client unavailable: {e}")
        return self._s3_client

    def _get_db(self):
        if self._db_engine is None:
            try:
                from sqlalchemy import create_engine
                self._db_engine = create_engine(DATABASE_URL, pool_pre_ping=True)
            except Exception as e:
                log.warning(f"DB engine unavailable: {e}")
        return self._db_engine

    # ── PostgreSQL full-table snapshot (legacy / backfill) ─────────────────────

    def export_table(
        self,
        table_name: str,
        tenant_id: Optional[str] = None,
        since: Optional[datetime] = None,
        limit: int = 100_000,
    ) -> Dict[str, Any]:
        """Export a PostgreSQL table to Parquet in S3 (full snapshot)."""
        engine = self._get_db()
        if engine is None:
            return {"status": "error", "error": "database_unavailable", "rows": 0}

        try:
            query = f"SELECT * FROM {table_name}"
            conditions = []
            if tenant_id:
                conditions.append(f"tenant_id = '{tenant_id}'")
            if since:
                conditions.append(f"created_at > '{since.isoformat()}'")
            if conditions:
                query += " WHERE " + " AND ".join(conditions)
            query += f" LIMIT {limit}"

            df = pd.read_sql(query, engine)
            rows = len(df)

            if rows == 0:
                return {"status": "ok", "rows": 0, "table": table_name}

            table = pa.Table.from_pandas(df)
            buf = io.BytesIO()
            pq.write_table(table, buf, compression="snappy")
            buf.seek(0)

            timestamp = datetime.now(timezone.utc).strftime("%Y/%m/%d/%H%M%S")
            key = f"exports/{table_name}/{timestamp}.parquet"
            if tenant_id:
                key = f"tenants/{tenant_id}/{table_name}/{timestamp}.parquet"

            s3 = self._get_s3()
            if s3:
                s3.put_object(Bucket=S3_BUCKET, Key=key, Body=buf.getvalue())
                log.info(f"Exported {rows} rows from {table_name} to s3://{S3_BUCKET}/{key}")

            return {
                "status": "ok",
                "table": table_name,
                "rows": rows,
                "s3_key": key,
                "tenant_id": tenant_id,
                "exported_at": datetime.now(timezone.utc).isoformat(),
            }

        except Exception as e:
            log.error(f"ETL export failed for {table_name}: {e}")
            return {"status": "error", "error": str(e), "table": table_name}

    def run_postgres_snapshot(self, tenant_id: Optional[str] = None) -> Dict[str, Any]:
        """Run a full PostgreSQL snapshot of all insurance domain tables."""
        tables = [
            "policies", "policy_versions", "claims", "claim_items",
            "premiums", "premium_payments", "actuarial_reserves",
            "gl_entries", "reinsurance_treaties", "compliance_reports",
            "risk_assessments", "underwriting_cases",
        ]
        results = {}
        total_rows = 0
        for table in tables:
            result = self.export_table(table, tenant_id=tenant_id)
            results[table] = result
            total_rows += result.get("rows", 0)

        return {
            "status": "ok",
            "tables": results,
            "total_rows": total_rows,
            "tenant_id": tenant_id,
            "completed_at": datetime.now(timezone.utc).isoformat(),
        }

    # Keep legacy name for backward compatibility
    def run_full_export(self, tenant_id: Optional[str] = None) -> Dict[str, Any]:
        return self.run_postgres_snapshot(tenant_id=tenant_id)

    # ── Per-connector async runners ────────────────────────────────────────────

    async def run_postgres_cdc(self) -> Dict[str, Any]:
        """Run PostgreSQL CDC (logical replication with polling fallback)."""
        try:
            from .connectors.postgres_cdc_connector import run_full_export
            return run_full_export(use_logical_replication=True)
        except Exception as e:
            log.error(f"[ETL] PostgreSQL CDC failed: {e}")
            return {"status": "error", "error": str(e)}

    async def run_fluvio_ingestion(self) -> Dict[str, Any]:
        """Ingest all Fluvio insurance topics."""
        try:
            from .connectors.fluvio_connector import ingest_all_topics
            return await ingest_all_topics()
        except Exception as e:
            log.error(f"[ETL] Fluvio ingestion failed: {e}")
            return {"status": "error", "error": str(e)}

    async def run_tigerbeetle_export(self) -> Dict[str, Any]:
        """Export TigerBeetle ledger data."""
        try:
            from .connectors.tigerbeetle_connector import run_full_export
            return await run_full_export()
        except Exception as e:
            log.error(f"[ETL] TigerBeetle export failed: {e}")
            return {"status": "error", "error": str(e)}

    async def run_temporal_export(self) -> Dict[str, Any]:
        """Export Temporal workflow history."""
        try:
            from .connectors.temporal_connector import run_full_export
            return await run_full_export()
        except Exception as e:
            log.error(f"[ETL] Temporal export failed: {e}")
            return {"status": "error", "error": str(e)}

    async def run_redis_export(self) -> Dict[str, Any]:
        """Snapshot Redis cache data."""
        try:
            from .connectors.redis_connector import run_full_export
            return run_full_export()
        except Exception as e:
            log.error(f"[ETL] Redis export failed: {e}")
            return {"status": "error", "error": str(e)}

    async def run_dapr_export(self) -> Dict[str, Any]:
        """Export Dapr pub/sub events and state store."""
        try:
            from .connectors.dapr_connector import run_full_export
            return await run_full_export()
        except Exception as e:
            log.error(f"[ETL] Dapr export failed: {e}")
            return {"status": "error", "error": str(e)}

    async def run_keycloak_export(self) -> Dict[str, Any]:
        """Export Keycloak auth events and user data."""
        try:
            from .connectors.keycloak_connector import run_full_export
            return await run_full_export()
        except Exception as e:
            log.error(f"[ETL] Keycloak export failed: {e}")
            return {"status": "error", "error": str(e)}

    async def run_openappsec_export(self) -> Dict[str, Any]:
        """Export OpenAppSec WAF events."""
        try:
            from .connectors.openappsec_connector import run_full_export
            return await run_full_export()
        except Exception as e:
            log.error(f"[ETL] OpenAppSec export failed: {e}")
            return {"status": "error", "error": str(e)}

    # ── Full pipeline orchestrator ─────────────────────────────────────────────

    async def run_full_pipeline(
        self,
        include_postgres_snapshot: bool = False,
        tenant_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Run all 8 service connectors in parallel.

        Args:
            include_postgres_snapshot: Also run a full table snapshot in addition to CDC.
            tenant_id: Optional tenant filter (passed to PostgreSQL snapshot only).

        Returns:
            Aggregated results dict with per-connector status and row counts.
        """
        start = datetime.now(timezone.utc)
        log.info("[ETL] Starting full lakehouse pipeline...")

        # Run all async connectors in parallel
        (
            pg_cdc_r,
            fluvio_r,
            tb_r,
            temporal_r,
            redis_r,
            dapr_r,
            keycloak_r,
            openappsec_r,
        ) = await asyncio.gather(
            self.run_postgres_cdc(),
            self.run_fluvio_ingestion(),
            self.run_tigerbeetle_export(),
            self.run_temporal_export(),
            self.run_redis_export(),
            self.run_dapr_export(),
            self.run_keycloak_export(),
            self.run_openappsec_export(),
            return_exceptions=False,
        )

        # Optionally run full PostgreSQL snapshot (synchronous)
        pg_snapshot_r: Optional[Dict] = None
        if include_postgres_snapshot:
            try:
                pg_snapshot_r = self.run_postgres_snapshot(tenant_id=tenant_id)
            except Exception as e:
                pg_snapshot_r = {"status": "error", "error": str(e)}

        end = datetime.now(timezone.utc)
        duration_s = (end - start).total_seconds()

        connectors = {
            "postgres_cdc": pg_cdc_r,
            "fluvio": fluvio_r,
            "tigerbeetle": tb_r,
            "temporal": temporal_r,
            "redis": redis_r,
            "dapr": dapr_r,
            "keycloak": keycloak_r,
            "openappsec": openappsec_r,
        }
        if pg_snapshot_r:
            connectors["postgres_snapshot"] = pg_snapshot_r

        total_rows = sum(
            v.get("total_rows", v.get("rows", 0))
            for v in connectors.values()
            if isinstance(v, dict)
        )

        failed = [k for k, v in connectors.items() if isinstance(v, dict) and v.get("status") == "error"]
        overall_status = "partial_failure" if failed else "ok"

        log.info(
            f"[ETL] Pipeline complete: {total_rows} total rows, "
            f"{len(failed)} failures, duration={duration_s:.1f}s"
        )

        return {
            "status": overall_status,
            "connectors": connectors,
            "total_rows": total_rows,
            "failed_connectors": failed,
            "duration_seconds": round(duration_s, 2),
            "started_at": start.isoformat(),
            "completed_at": end.isoformat(),
        }

    # ── Utility ────────────────────────────────────────────────────────────────

    def list_snapshots(self, prefix: str = "bronze/") -> List[Dict[str, Any]]:
        """List available snapshots in the lakehouse."""
        s3 = self._get_s3()
        if not s3:
            return []
        try:
            response = s3.list_objects_v2(Bucket=S3_BUCKET, Prefix=prefix, MaxKeys=1000)
            return [
                {
                    "key": obj["Key"],
                    "size": obj["Size"],
                    "last_modified": obj["LastModified"].isoformat(),
                    "tier": obj["Key"].split("/")[0],
                    "source": obj["Key"].split("/")[1] if "/" in obj["Key"] else "",
                }
                for obj in response.get("Contents", [])
            ]
        except Exception as e:
            log.warning(f"Failed to list snapshots: {e}")
            return []

    def get_data_catalog(self) -> Dict[str, Any]:
        """Return a catalog of all available datasets in the lakehouse."""
        s3 = self._get_s3()
        if not s3:
            return {"status": "no_s3", "datasets": []}

        datasets: Dict[str, Dict] = {}
        try:
            paginator = s3.get_paginator("list_objects_v2")
            for page in paginator.paginate(Bucket=S3_BUCKET):
                for obj in page.get("Contents", []):
                    parts = obj["Key"].split("/")
                    if len(parts) >= 3:
                        tier = parts[0]
                        source = parts[1]
                        dataset = parts[2]
                        key = f"{tier}/{source}/{dataset}"
                        if key not in datasets:
                            datasets[key] = {
                                "path": key,
                                "tier": tier,
                                "source": source,
                                "dataset": dataset,
                                "file_count": 0,
                                "total_bytes": 0,
                                "last_updated": "",
                            }
                        datasets[key]["file_count"] += 1
                        datasets[key]["total_bytes"] += obj["Size"]
                        ts = obj["LastModified"].isoformat()
                        if ts > datasets[key]["last_updated"]:
                            datasets[key]["last_updated"] = ts
        except Exception as e:
            log.warning(f"Failed to build data catalog: {e}")

        return {
            "status": "ok",
            "dataset_count": len(datasets),
            "datasets": list(datasets.values()),
            "generated_at": datetime.now(timezone.utc).isoformat(),
        }

    def health(self) -> str:
        return "ok"
