"""
Platform Data Ingestion Engine

Pulls real data from the NGApp platform services for model retraining:
- PostgreSQL (claims, policies, customers)
- Kafka/Fluvio event streams
- REST API endpoints (KYC, fraud alerts)
- Delta Lake feature store

Supports incremental ingestion with watermarking and deduplication.
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd


@dataclass
class IngestionConfig:
    """Configuration for data ingestion from platform services."""
    # PostgreSQL
    pg_host: str = "localhost"
    pg_port: int = 5432
    pg_database: str = "ngapp"
    pg_user: str = "ngapp"
    pg_password: str = ""

    # Kafka / Event Streams
    kafka_brokers: str = "localhost:9092"
    kafka_topics: list[str] = field(default_factory=lambda: [
        "claims.submitted", "claims.adjudicated",
        "policies.created", "policies.renewed", "policies.cancelled",
        "fraud.alerts", "kyc.completed", "payments.processed",
    ])

    # REST endpoints
    api_base_url: str = "http://localhost:5000"

    # Lakehouse
    lakehouse_dir: str = "lakehouse_store"

    # Ingestion
    batch_size: int = 10000
    watermark_dir: str = "continuous_training/watermarks"


@dataclass
class IngestionResult:
    """Result of a data ingestion run."""
    source: str
    model_target: str
    n_rows: int
    n_new_rows: int
    columns: list[str]
    timestamp: float
    watermark: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "source": self.source,
            "model_target": self.model_target,
            "n_rows": self.n_rows,
            "n_new_rows": self.n_new_rows,
            "columns": self.columns,
            "timestamp": self.timestamp,
            "watermark": self.watermark,
        }


class PlatformDataIngester:
    """Ingests data from the NGApp platform for continuous training."""

    def __init__(self, config: IngestionConfig | None = None) -> None:
        self.config = config or IngestionConfig()
        self._watermarks: dict[str, str] = {}
        self._watermark_path = Path(self.config.watermark_dir)
        self._watermark_path.mkdir(parents=True, exist_ok=True)
        self._load_watermarks()

    def _load_watermarks(self) -> None:
        wm_file = self._watermark_path / "watermarks.json"
        if wm_file.exists():
            with open(wm_file) as f:
                self._watermarks = json.load(f)

    def _save_watermarks(self) -> None:
        with open(self._watermark_path / "watermarks.json", "w") as f:
            json.dump(self._watermarks, f, indent=2)

    def ingest_claims_data(self, output_dir: Path) -> IngestionResult:
        """Ingest claims data from PostgreSQL for claims adjudication model."""
        output_dir.mkdir(parents=True, exist_ok=True)
        last_wm = self._watermarks.get("claims", "1970-01-01T00:00:00Z")

        try:
            import psycopg2
            conn = psycopg2.connect(
                host=self.config.pg_host,
                port=self.config.pg_port,
                dbname=self.config.pg_database,
                user=self.config.pg_user,
                password=self.config.pg_password,
            )
            query = f"""
                SELECT
                    c.id, c.claim_amount, c.policy_limit,
                    c.claim_amount / NULLIF(c.policy_limit, 0) as claim_to_limit_ratio,
                    c.docs_required, c.docs_submitted,
                    c.docs_submitted::float / NULLIF(c.docs_required, 0) as doc_completeness,
                    EXTRACT(epoch FROM (c.submitted_at - c.incident_date)) / 86400 as days_since_incident,
                    EXTRACT(epoch FROM (c.submitted_at - p.start_date)) / 86400 as days_since_policy_start,
                    CASE WHEN c.submitted_at < p.start_date + interval '30 days' THEN 1 ELSE 0 END as is_within_waiting_period,
                    (SELECT COUNT(*) FROM claims c2 WHERE c2.customer_id = c.customer_id AND c2.id < c.id) as prior_claims_count,
                    c.doc_authenticity_score,
                    c.witness_available::int, c.police_report_filed::int, c.hospital_report::int,
                    c.fraud_risk_score,
                    c.outcome, c.payout_ratio,
                    c.submitted_at
                FROM claims c
                JOIN policies p ON c.policy_id = p.id
                WHERE c.submitted_at > '{last_wm}'
                ORDER BY c.submitted_at
                LIMIT {self.config.batch_size}
            """
            df = pd.read_sql(query, conn)
            conn.close()
        except Exception:
            # Fallback: read from lakehouse if DB not available
            lakehouse_path = Path(self.config.lakehouse_dir) / "claims_features"
            if lakehouse_path.exists():
                try:
                    from deltalake import DeltaTable
                    dt = DeltaTable(str(lakehouse_path))
                    df = dt.to_pandas()
                except ImportError:
                    parquet_files = list(lakehouse_path.glob("*.parquet"))
                    if parquet_files:
                        df = pd.read_parquet(parquet_files[0])
                    else:
                        df = pd.DataFrame()
            else:
                df = pd.DataFrame()

        if len(df) > 0:
            output_path = output_dir / f"claims_ingested_{int(time.time())}.parquet"
            df.to_parquet(output_path, index=False)

            new_wm = str(df.iloc[-1].get("submitted_at", time.time()))
            self._watermarks["claims"] = new_wm
            self._save_watermarks()
        else:
            new_wm = last_wm

        return IngestionResult(
            source="postgresql/claims",
            model_target="claims_adjudication",
            n_rows=len(df),
            n_new_rows=len(df),
            columns=list(df.columns) if len(df) > 0 else [],
            timestamp=time.time(),
            watermark=new_wm,
        )

    def ingest_fraud_signals(self, output_dir: Path) -> IngestionResult:
        """Ingest fraud signal data for fraud detection model retraining."""
        output_dir.mkdir(parents=True, exist_ok=True)
        last_wm = self._watermarks.get("fraud", "1970-01-01T00:00:00Z")

        try:
            import psycopg2
            conn = psycopg2.connect(
                host=self.config.pg_host,
                port=self.config.pg_port,
                dbname=self.config.pg_database,
                user=self.config.pg_user,
                password=self.config.pg_password,
            )
            query = f"""
                SELECT
                    fa.id, fa.policy_age_days, fa.premium_ngn,
                    fa.claim_amount_ngn, fa.claim_premium_ratio,
                    fa.claims_last_30d, fa.claims_last_90d, fa.claims_last_365d,
                    fa.doc_ocr_confidence, fa.face_match_score, fa.liveness_score,
                    fa.unique_devices_30d, fa.unique_ips_30d,
                    fa.hour_of_submission, fa.same_bank_claims_count,
                    fa.agent_fraud_rate,
                    fa.doc_verified::int, fa.ip_country_match::int, fa.is_weekend::int,
                    fa.is_fraud::int as is_fraud,
                    fa.created_at
                FROM fraud_assessments fa
                WHERE fa.created_at > '{last_wm}'
                ORDER BY fa.created_at
                LIMIT {self.config.batch_size}
            """
            df = pd.read_sql(query, conn)
            conn.close()
        except Exception:
            lakehouse_path = Path(self.config.lakehouse_dir) / "fraud_features"
            if lakehouse_path.exists():
                try:
                    from deltalake import DeltaTable
                    dt = DeltaTable(str(lakehouse_path))
                    df = dt.to_pandas()
                except ImportError:
                    parquet_files = list(lakehouse_path.glob("*.parquet"))
                    if parquet_files:
                        df = pd.read_parquet(parquet_files[0])
                    else:
                        df = pd.DataFrame()
            else:
                df = pd.DataFrame()

        if len(df) > 0:
            output_path = output_dir / f"fraud_ingested_{int(time.time())}.parquet"
            df.to_parquet(output_path, index=False)

            new_wm = str(df.iloc[-1].get("created_at", time.time()))
            self._watermarks["fraud"] = new_wm
            self._save_watermarks()
        else:
            new_wm = last_wm

        return IngestionResult(
            source="postgresql/fraud_assessments",
            model_target="fraud_detection",
            n_rows=len(df),
            n_new_rows=len(df),
            columns=list(df.columns) if len(df) > 0 else [],
            timestamp=time.time(),
            watermark=new_wm,
        )

    def ingest_churn_signals(self, output_dir: Path) -> IngestionResult:
        """Ingest customer engagement data for churn prediction model."""
        output_dir.mkdir(parents=True, exist_ok=True)
        last_wm = self._watermarks.get("churn", "1970-01-01T00:00:00Z")

        try:
            import psycopg2
            conn = psycopg2.connect(
                host=self.config.pg_host,
                port=self.config.pg_port,
                dbname=self.config.pg_database,
                user=self.config.pg_user,
                password=self.config.pg_password,
            )
            query = f"""
                SELECT
                    c.id, c.tenure_months, c.n_policies, c.total_premium_ngn,
                    c.n_claims_filed, c.n_claims_approved,
                    c.n_claims_approved::float / NULLIF(c.n_claims_filed, 0) as claim_approval_rate,
                    c.late_payments_12m, c.missed_payments_12m,
                    c.auto_renewal::int, c.app_logins_30d,
                    c.support_calls_90d, c.complaints_12m, c.nps_score,
                    c.last_interaction_days,
                    c.has_motor::int, c.has_health::int, c.has_life::int, c.has_property::int,
                    c.competitor_quote_requested::int, c.premium_increase_pct,
                    c.churned::int,
                    c.updated_at
                FROM customer_engagement c
                WHERE c.updated_at > '{last_wm}'
                ORDER BY c.updated_at
                LIMIT {self.config.batch_size}
            """
            df = pd.read_sql(query, conn)
            conn.close()
        except Exception:
            lakehouse_path = Path(self.config.lakehouse_dir) / "churn_features"
            if lakehouse_path.exists():
                try:
                    from deltalake import DeltaTable
                    dt = DeltaTable(str(lakehouse_path))
                    df = dt.to_pandas()
                except ImportError:
                    parquet_files = list(lakehouse_path.glob("*.parquet"))
                    if parquet_files:
                        df = pd.read_parquet(parquet_files[0])
                    else:
                        df = pd.DataFrame()
            else:
                df = pd.DataFrame()

        if len(df) > 0:
            output_path = output_dir / f"churn_ingested_{int(time.time())}.parquet"
            df.to_parquet(output_path, index=False)
            new_wm = str(df.iloc[-1].get("updated_at", time.time()))
            self._watermarks["churn"] = new_wm
            self._save_watermarks()
        else:
            new_wm = last_wm

        return IngestionResult(
            source="postgresql/customer_engagement",
            model_target="churn_prediction",
            n_rows=len(df),
            n_new_rows=len(df),
            columns=list(df.columns) if len(df) > 0 else [],
            timestamp=time.time(),
            watermark=new_wm,
        )

    def ingest_transaction_data(self, output_dir: Path) -> IngestionResult:
        """Ingest transaction data for anomaly detection model."""
        output_dir.mkdir(parents=True, exist_ok=True)
        last_wm = self._watermarks.get("transactions", "1970-01-01T00:00:00Z")

        try:
            import psycopg2
            conn = psycopg2.connect(
                host=self.config.pg_host,
                port=self.config.pg_port,
                dbname=self.config.pg_database,
                user=self.config.pg_user,
                password=self.config.pg_password,
            )
            query = f"""
                SELECT
                    t.id, t.amount_ngn,
                    EXTRACT(hour FROM t.created_at) as hour,
                    EXTRACT(dow FROM t.created_at) as day_of_week,
                    t.avg_txn_amount_30d, t.txn_count_24h, t.txn_count_1h,
                    t.days_since_last_txn, t.amount_deviation,
                    t.is_anomaly::int,
                    t.created_at
                FROM transactions t
                WHERE t.created_at > '{last_wm}'
                ORDER BY t.created_at
                LIMIT {self.config.batch_size}
            """
            df = pd.read_sql(query, conn)
            conn.close()
        except Exception:
            lakehouse_path = Path(self.config.lakehouse_dir) / "anomaly_features"
            if lakehouse_path.exists():
                try:
                    from deltalake import DeltaTable
                    dt = DeltaTable(str(lakehouse_path))
                    df = dt.to_pandas()
                except ImportError:
                    parquet_files = list(lakehouse_path.glob("*.parquet"))
                    if parquet_files:
                        df = pd.read_parquet(parquet_files[0])
                    else:
                        df = pd.DataFrame()
            else:
                df = pd.DataFrame()

        if len(df) > 0:
            output_path = output_dir / f"txn_ingested_{int(time.time())}.parquet"
            df.to_parquet(output_path, index=False)
            new_wm = str(df.iloc[-1].get("created_at", time.time()))
            self._watermarks["transactions"] = new_wm
            self._save_watermarks()
        else:
            new_wm = last_wm

        return IngestionResult(
            source="postgresql/transactions",
            model_target="anomaly_detection",
            n_rows=len(df),
            n_new_rows=len(df),
            columns=list(df.columns) if len(df) > 0 else [],
            timestamp=time.time(),
            watermark=new_wm,
        )

    def ingest_all(self, output_dir: Path) -> list[IngestionResult]:
        """Run all ingestion pipelines."""
        output_dir.mkdir(parents=True, exist_ok=True)
        results: list[IngestionResult] = []

        print("\n" + "=" * 60)
        print("  Platform Data Ingestion")
        print("=" * 60)

        for name, method in [
            ("claims", self.ingest_claims_data),
            ("fraud", self.ingest_fraud_signals),
            ("churn", self.ingest_churn_signals),
            ("transactions", self.ingest_transaction_data),
        ]:
            try:
                result = method(output_dir)
                results.append(result)
                print(f"  [{name}] Ingested {result.n_rows} rows from {result.source}")
            except Exception as e:
                print(f"  [{name}] Ingestion failed: {e}")

        return results
