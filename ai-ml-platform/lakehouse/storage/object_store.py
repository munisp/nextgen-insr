"""
Object Store Abstraction Layer

Provides a unified interface for storing Delta Lake tables across multiple backends:
- LocalStore: Local filesystem (development/testing)
- S3Store: AWS S3 (production)
- MinIOStore: MinIO S3-compatible (on-premise/hybrid)

All stores implement the same ObjectStore interface for seamless backend switching.
"""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, BinaryIO, Iterator


@dataclass
class ObjectMetadata:
    """Metadata for a stored object."""
    key: str
    size: int
    etag: str
    last_modified: float
    content_type: str = "application/octet-stream"
    metadata: dict[str, str] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "key": self.key,
            "size": self.size,
            "etag": self.etag,
            "last_modified": self.last_modified,
            "content_type": self.content_type,
            "metadata": self.metadata,
        }


@dataclass
class StorageConfig:
    """Configuration for object storage."""
    backend: str = "local"  # local, s3, minio
    base_path: str = "lakehouse_store"

    # S3/MinIO
    endpoint_url: str | None = None
    bucket: str = "ngapp-lakehouse"
    region: str = "af-south-1"
    access_key: str | None = None
    secret_key: str | None = None

    # Performance
    multipart_threshold: int = 8 * 1024 * 1024  # 8MB
    multipart_chunksize: int = 8 * 1024 * 1024
    max_concurrency: int = 10

    @classmethod
    def from_env(cls) -> StorageConfig:
        """Create config from environment variables."""
        backend = os.environ.get("LAKEHOUSE_BACKEND", "local")
        return cls(
            backend=backend,
            base_path=os.environ.get("LAKEHOUSE_BASE_PATH", "lakehouse_store"),
            endpoint_url=os.environ.get("LAKEHOUSE_ENDPOINT_URL"),
            bucket=os.environ.get("LAKEHOUSE_BUCKET", "ngapp-lakehouse"),
            region=os.environ.get("LAKEHOUSE_REGION", "af-south-1"),
            access_key=os.environ.get("LAKEHOUSE_ACCESS_KEY") or os.environ.get("AWS_ACCESS_KEY_ID"),
            secret_key=os.environ.get("LAKEHOUSE_SECRET_KEY") or os.environ.get("AWS_SECRET_ACCESS_KEY"),
        )


class ObjectStore(ABC):
    """Abstract base class for object storage backends."""

    @abstractmethod
    def put(self, key: str, data: bytes, metadata: dict[str, str] | None = None) -> ObjectMetadata:
        """Store an object."""

    @abstractmethod
    def get(self, key: str) -> bytes:
        """Retrieve an object."""

    @abstractmethod
    def delete(self, key: str) -> bool:
        """Delete an object."""

    @abstractmethod
    def exists(self, key: str) -> bool:
        """Check if an object exists."""

    @abstractmethod
    def list_objects(self, prefix: str = "") -> Iterator[ObjectMetadata]:
        """List objects with a given prefix."""

    @abstractmethod
    def head(self, key: str) -> ObjectMetadata | None:
        """Get object metadata without retrieving the body."""

    @abstractmethod
    def copy(self, src_key: str, dst_key: str) -> ObjectMetadata:
        """Copy an object within the store."""

    def put_file(self, key: str, file_path: str | Path, metadata: dict[str, str] | None = None) -> ObjectMetadata:
        """Store a file from disk."""
        with open(file_path, "rb") as f:
            return self.put(key, f.read(), metadata)

    def get_file(self, key: str, file_path: str | Path) -> Path:
        """Download an object to a file."""
        path = Path(file_path)
        path.parent.mkdir(parents=True, exist_ok=True)
        data = self.get(key)
        path.write_bytes(data)
        return path

    def list_prefixes(self, prefix: str = "", delimiter: str = "/") -> list[str]:
        """List common prefixes (directory-like listing)."""
        prefixes = set()
        for obj in self.list_objects(prefix):
            remainder = obj.key[len(prefix):]
            if delimiter in remainder:
                pfx = prefix + remainder.split(delimiter)[0] + delimiter
                prefixes.add(pfx)
        return sorted(prefixes)


class LocalStore(ObjectStore):
    """Local filesystem storage backend for development and testing."""

    def __init__(self, base_path: str | Path = "lakehouse_store") -> None:
        self.base_path = Path(base_path)
        self.base_path.mkdir(parents=True, exist_ok=True)
        self._meta_dir = self.base_path / "_metadata"
        self._meta_dir.mkdir(parents=True, exist_ok=True)

    def _resolve(self, key: str) -> Path:
        return self.base_path / key

    def _meta_path(self, key: str) -> Path:
        safe_key = key.replace("/", "__")
        return self._meta_dir / f"{safe_key}.json"

    def _compute_etag(self, data: bytes) -> str:
        return hashlib.md5(data).hexdigest()

    def put(self, key: str, data: bytes, metadata: dict[str, str] | None = None) -> ObjectMetadata:
        path = self._resolve(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)

        etag = self._compute_etag(data)
        obj_meta = ObjectMetadata(
            key=key,
            size=len(data),
            etag=etag,
            last_modified=time.time(),
            metadata=metadata or {},
        )

        self._meta_path(key).write_text(json.dumps(obj_meta.to_dict()))
        return obj_meta

    def get(self, key: str) -> bytes:
        path = self._resolve(key)
        if not path.exists():
            raise FileNotFoundError(f"Object not found: {key}")
        return path.read_bytes()

    def delete(self, key: str) -> bool:
        path = self._resolve(key)
        meta = self._meta_path(key)
        if path.exists():
            path.unlink()
            if meta.exists():
                meta.unlink()
            return True
        return False

    def exists(self, key: str) -> bool:
        return self._resolve(key).exists()

    def list_objects(self, prefix: str = "") -> Iterator[ObjectMetadata]:
        search_path = self._resolve(prefix) if prefix else self.base_path
        if search_path.is_file():
            yield self._get_meta(prefix)
            return

        base = self.base_path
        for path in sorted(base.rglob("*")):
            if path.is_file() and not str(path).startswith(str(self._meta_dir)):
                key = str(path.relative_to(base))
                if key.startswith(prefix):
                    yield self._get_meta(key)

    def _get_meta(self, key: str) -> ObjectMetadata:
        meta_path = self._meta_path(key)
        if meta_path.exists():
            data = json.loads(meta_path.read_text())
            return ObjectMetadata(**data)
        path = self._resolve(key)
        stat = path.stat()
        return ObjectMetadata(
            key=key,
            size=stat.st_size,
            etag=self._compute_etag(path.read_bytes()),
            last_modified=stat.st_mtime,
        )

    def head(self, key: str) -> ObjectMetadata | None:
        if not self.exists(key):
            return None
        return self._get_meta(key)

    def copy(self, src_key: str, dst_key: str) -> ObjectMetadata:
        data = self.get(src_key)
        src_meta = self.head(src_key)
        metadata = src_meta.metadata if src_meta else {}
        return self.put(dst_key, data, metadata)


class S3Store(ObjectStore):
    """AWS S3 storage backend for production deployments."""

    def __init__(self, config: StorageConfig) -> None:
        self.config = config
        self._client = None

    @property
    def client(self):
        if self._client is None:
            try:
                import boto3
                session_kwargs: dict[str, Any] = {}
                if self.config.access_key:
                    session_kwargs["aws_access_key_id"] = self.config.access_key
                    session_kwargs["aws_secret_access_key"] = self.config.secret_key
                session = boto3.Session(region_name=self.config.region, **session_kwargs)
                client_kwargs: dict[str, Any] = {}
                if self.config.endpoint_url:
                    client_kwargs["endpoint_url"] = self.config.endpoint_url
                self._client = session.client("s3", **client_kwargs)
            except ImportError:
                raise RuntimeError("boto3 required for S3 backend: pip install boto3")
        return self._client

    def put(self, key: str, data: bytes, metadata: dict[str, str] | None = None) -> ObjectMetadata:
        put_kwargs: dict[str, Any] = {
            "Bucket": self.config.bucket,
            "Key": key,
            "Body": data,
        }
        if metadata:
            put_kwargs["Metadata"] = metadata

        response = self.client.put_object(**put_kwargs)
        return ObjectMetadata(
            key=key,
            size=len(data),
            etag=response.get("ETag", "").strip('"'),
            last_modified=time.time(),
            metadata=metadata or {},
        )

    def get(self, key: str) -> bytes:
        response = self.client.get_object(Bucket=self.config.bucket, Key=key)
        return response["Body"].read()

    def delete(self, key: str) -> bool:
        try:
            self.client.delete_object(Bucket=self.config.bucket, Key=key)
            return True
        except Exception:
            return False

    def exists(self, key: str) -> bool:
        try:
            self.client.head_object(Bucket=self.config.bucket, Key=key)
            return True
        except Exception:
            return False

    def list_objects(self, prefix: str = "") -> Iterator[ObjectMetadata]:
        paginator = self.client.get_paginator("list_objects_v2")
        for page in paginator.paginate(Bucket=self.config.bucket, Prefix=prefix):
            for obj in page.get("Contents", []):
                yield ObjectMetadata(
                    key=obj["Key"],
                    size=obj["Size"],
                    etag=obj["ETag"].strip('"'),
                    last_modified=obj["LastModified"].timestamp(),
                )

    def head(self, key: str) -> ObjectMetadata | None:
        try:
            response = self.client.head_object(Bucket=self.config.bucket, Key=key)
            return ObjectMetadata(
                key=key,
                size=response["ContentLength"],
                etag=response["ETag"].strip('"'),
                last_modified=response["LastModified"].timestamp(),
                metadata=response.get("Metadata", {}),
            )
        except Exception:
            return None

    def copy(self, src_key: str, dst_key: str) -> ObjectMetadata:
        self.client.copy_object(
            Bucket=self.config.bucket,
            Key=dst_key,
            CopySource={"Bucket": self.config.bucket, "Key": src_key},
        )
        return self.head(dst_key)


class MinIOStore(S3Store):
    """MinIO S3-compatible storage backend for on-premise/hybrid deployments.

    Inherits from S3Store with MinIO-specific defaults.
    """

    def __init__(self, config: StorageConfig | None = None) -> None:
        if config is None:
            config = StorageConfig(
                backend="minio",
                endpoint_url=os.environ.get("MINIO_ENDPOINT", "http://localhost:9000"),
                bucket=os.environ.get("MINIO_BUCKET", "ngapp-lakehouse"),
                access_key=os.environ.get("MINIO_ACCESS_KEY", "minioadmin"),
                secret_key=os.environ.get("MINIO_SECRET_KEY", "minioadmin"),
                region="us-east-1",
            )
        super().__init__(config)

    def ensure_bucket(self) -> None:
        """Create bucket if it doesn't exist (MinIO-specific)."""
        try:
            self.client.head_bucket(Bucket=self.config.bucket)
        except Exception:
            self.client.create_bucket(Bucket=self.config.bucket)


def create_store(config: StorageConfig | None = None) -> ObjectStore:
    """Factory function to create the appropriate storage backend."""
    if config is None:
        config = StorageConfig.from_env()

    if config.backend == "s3":
        return S3Store(config)
    elif config.backend == "minio":
        return MinIOStore(config)
    else:
        return LocalStore(config.base_path)
