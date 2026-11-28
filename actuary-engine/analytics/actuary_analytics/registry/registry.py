"""MLflow-compatible model registry API with MinIO/S3 artefact round-trip.

API shape mirrors MLflow's model registry concepts (registered model,
versions, stages candidate/approved/retired, artefact URI) so a later real
MLflow server can be swapped in without changing callers (design §10.5).

Artefacts live in an object store (MinIO in the wave default). The object
store is an HTTP boundary: tests may use a wire double (InMemoryObjectStore)
or a real MinIO testcontainer when docker is available — never a fake
compute path.
"""

from __future__ import annotations

import hashlib
import io
import json
import logging
import threading
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Protocol

logger = logging.getLogger(__name__)

# F1 additions: agg_dist (aggregate-loss distribution / distortion-pricing
# artefacts from the adopted aggregate library, actuary_analytics.aggdist)
# and tweedie_dist (standalone Tweedie density model artefacts,
# actuary_analytics.freqsev.tweedie_tools). Both follow the same register/
# stage/round-trip flow as the existing types so Go/TS layers can discover
# them through the same registry surface.
# F2 addition: reserve_model — reserving result artefacts from the extended
# reserving methods (chainladder CL/BF/Mack plus Bootstrap ODP, Cape Cod,
# Clark; actuary_analytics.reserving). Same register/stage/round-trip flow.
MODEL_TYPES = (
    "freq_glm",
    "sev_glm",
    "freq_sev_glm",
    "mortality",
    "capital",
    "fraud_link",
    "agg_dist",
    "tweedie_dist",
    "reserve_model",
)
STAGES = ("candidate", "approved", "retired")


class ArtefactStoreError(Exception):
    """Object-store boundary failure (503-equivalent for registry calls)."""


class ObjectStore(Protocol):
    """Object-store boundary protocol (put/get bytes)."""

    def put(self, key: str, payload: bytes, content_type: str = "application/json") -> None: ...
    def get(self, key: str) -> bytes: ...
    def exists(self, key: str) -> bool: ...


class MinioObjectStore:
    """Real MinIO/S3-backed object store (real minio client, no fakes)."""

    def __init__(
        self,
        endpoint: str,
        access_key: str,
        secret_key: str,
        bucket: str,
        secure: bool = False,
        client: Any | None = None,
    ) -> None:
        self._bucket = bucket
        if client is not None:
            self._client = client
        else:
            from minio import Minio  # real object-store client

            self._client = Minio(
                endpoint,
                access_key=access_key,
                secret_key=secret_key,
                secure=secure,
            )
        self._ensure_bucket()

    def _ensure_bucket(self) -> None:
        try:
            if not self._client.bucket_exists(self._bucket):
                self._client.make_bucket(self._bucket)
        except Exception as exc:
            raise ArtefactStoreError(f"minio bucket setup failed: {exc}") from exc

    def put(self, key: str, payload: bytes, content_type: str = "application/json") -> None:
        try:
            self._client.put_object(
                self._bucket, key, io.BytesIO(payload), len(payload),
                content_type=content_type,
            )
        except Exception as exc:
            raise ArtefactStoreError(f"minio put {key} failed: {exc}") from exc

    def get(self, key: str) -> bytes:
        try:
            response = self._client.get_object(self._bucket, key)
            try:
                return response.read()
            finally:
                response.close()
                response.release_conn()
        except Exception as exc:
            raise ArtefactStoreError(f"minio get {key} failed: {exc}") from exc

    def exists(self, key: str) -> bool:
        try:
            self._client.stat_object(self._bucket, key)
            return True
        except Exception:  # noqa: BLE001 - fail-closed at external boundary (never guess data)
            return False


class InMemoryObjectStore:
    """Documented wire double at the object-store boundary.

    Used ONLY in tests/local dev where docker (and thus a MinIO
    testcontainer) is unavailable; production code paths use
    MinioObjectStore. Implements the identical ObjectStore protocol.
    """

    def __init__(self) -> None:
        self._objects: dict[str, bytes] = {}
        self._lock = threading.Lock()

    def put(self, key: str, payload: bytes, content_type: str = "application/json") -> None:
        with self._lock:
            self._objects[key] = payload

    def get(self, key: str) -> bytes:
        with self._lock:
            if key not in self._objects:
                raise ArtefactStoreError(f"object {key} not found")
            return self._objects[key]

    def exists(self, key: str) -> bool:
        with self._lock:
            return key in self._objects


@dataclass(frozen=True)
class RegisteredModel:
    id: int
    model_type: str
    version: str
    artefact_uri: str
    metrics: dict[str, Any]
    trained_at: str
    stage: str = "candidate"
    approved_by: str | None = None
    sha256: str = ""
    created_at: str = ""


class ModelRegistry:
    """MLflow-compatible registry. Metadata is persisted in the object
    store alongside artefacts so the registry survives restarts; PG
    projection into act_model_registry is a Leg D/Drizzle concern."""

    def __init__(self, store: ObjectStore, prefix: str = "actuary-models") -> None:
        self._store = store
        self._prefix = prefix.rstrip("/")
        self._lock = threading.Lock()

    # -- internal helpers -------------------------------------------------
    def _index_key(self) -> str:
        return f"{self._prefix}/index.json"

    def _load_index(self) -> dict[str, Any]:
        if not self._store.exists(self._index_key()):
            return {"next_id": 1, "models": []}
        return json.loads(self._store.get(self._index_key()).decode("utf-8"))

    def _save_index(self, index: dict[str, Any]) -> None:
        self._store.put(self._index_key(), json.dumps(index).encode("utf-8"))

    # -- MLflow-style API -------------------------------------------------
    def register_model(
        self,
        model_type: str,
        version: str,
        artefact: bytes,
        metrics: dict[str, Any],
        trained_at: str,
        approved_by: str | None = None,
    ) -> RegisteredModel:
        """Upload artefact bytes + metadata; returns the registered model."""
        if model_type not in MODEL_TYPES:
            raise ValueError(f"model_type must be one of {MODEL_TYPES}")
        sha = hashlib.sha256(artefact).hexdigest()
        with self._lock:
            index = self._load_index()
            model_id = int(index["next_id"])
            key = f"{self._prefix}/{model_type}/{model_id}/artefact.json"
            self._store.put(key, artefact)
            uri = f"minio://{key}"
            record = RegisteredModel(
                id=model_id,
                model_type=model_type,
                version=version,
                artefact_uri=uri,
                metrics=dict(metrics),
                trained_at=trained_at,
                stage="candidate",
                approved_by=approved_by,
                sha256=sha,
                created_at=datetime.now(UTC).isoformat(),
            )
            index["next_id"] = model_id + 1
            index["models"].append(_model_to_dict(record))
            self._save_index(index)
            return record

    def get_model(self, model_id: int) -> RegisteredModel:
        for rec in self._load_index()["models"]:
            if rec["id"] == model_id:
                return _dict_to_model(rec)
        raise KeyError(f"model id {model_id} not registered")

    def list_models(
        self, model_type: str | None = None, stage: str | None = None
    ) -> list[RegisteredModel]:
        out = []
        for rec in self._load_index()["models"]:
            if model_type is not None and rec["model_type"] != model_type:
                continue
            if stage is not None and rec["stage"] != stage:
                continue
            out.append(_dict_to_model(rec))
        return out

    def transition_stage(self, model_id: int, stage: str, approved_by: str | None = None) -> RegisteredModel:
        if stage not in STAGES:
            raise ValueError(f"stage must be one of {STAGES}")
        with self._lock:
            index = self._load_index()
            for rec in index["models"]:
                if rec["id"] == model_id:
                    rec["stage"] = stage
                    if approved_by is not None:
                        rec["approved_by"] = approved_by
                    self._save_index(index)
                    return _dict_to_model(rec)
        raise KeyError(f"model id {model_id} not registered")

    def download_artefact(self, model_id: int) -> bytes:
        """Round-trip: fetch artefact bytes and verify the stored sha256."""
        model = self.get_model(model_id)
        key = model.artefact_uri.replace("minio://", "")
        payload = self._store.get(key)
        if hashlib.sha256(payload).hexdigest() != model.sha256:
            raise ArtefactStoreError(
                f"artefact {model_id} sha256 mismatch — store corrupted"
            )
        return payload


def _model_to_dict(model: RegisteredModel) -> dict[str, Any]:
    return {
        "id": model.id,
        "model_type": model.model_type,
        "version": model.version,
        "artefact_uri": model.artefact_uri,
        "metrics": model.metrics,
        "trained_at": model.trained_at,
        "stage": model.stage,
        "approved_by": model.approved_by,
        "sha256": model.sha256,
        "created_at": model.created_at,
    }


def _dict_to_model(rec: dict[str, Any]) -> RegisteredModel:
    return RegisteredModel(
        id=int(rec["id"]),
        model_type=rec["model_type"],
        version=rec["version"],
        artefact_uri=rec["artefact_uri"],
        metrics=dict(rec["metrics"]),
        trained_at=rec["trained_at"],
        stage=rec["stage"],
        approved_by=rec.get("approved_by"),
        sha256=rec["sha256"],
        created_at=rec["created_at"],
    )
