"""
NGApp Production Lakehouse — Delta Lake Feature Store

A complete production-grade Lakehouse implementation:
- Delta Lake with ACID transactions and time-travel
- Object store abstraction (local/S3/MinIO/GCS)
- Streaming ingestion from Kafka/Fluvio
- Real-time feature computation
- Online + offline feature serving
- Schema registry with evolution
- Data lineage and observability
- Role-based access control
- DuckDB SQL query engine
- Microservice event connectors
"""

from lakehouse.delta_feature_store import DeltaFeatureStore, FeatureTableConfig, build_feature_store

__all__ = ["DeltaFeatureStore", "FeatureTableConfig", "build_feature_store"]
