"""
Schema Registry — Feature Table Schema Management

Provides:
- Schema versioning with semantic compatibility checks
- Forward/backward/full compatibility modes
- Schema evolution (add columns, widen types, rename with alias)
- Schema validation for incoming data
- Schema discovery and search
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import ClassVar
from typing import Any

import numpy as np
import pyarrow as pa


class CompatibilityMode(Enum):
    """Schema compatibility modes."""
    NONE = "none"  # No compatibility check
    BACKWARD = "backward"  # New schema can read old data
    FORWARD = "forward"  # Old schema can read new data
    FULL = "full"  # Both backward and forward compatible


class FieldType(Enum):
    """Supported field types with promotion hierarchy."""
    INT8 = "int8"
    INT16 = "int16"
    INT32 = "int32"
    INT64 = "int64"
    FLOAT16 = "float16"
    FLOAT32 = "float32"
    FLOAT64 = "float64"
    STRING = "string"
    BOOLEAN = "boolean"
    TIMESTAMP = "timestamp"
    DATE = "date"
    BINARY = "binary"
    LIST = "list"
    MAP = "map"
    STRUCT = "struct"

    @staticmethod
    def can_promote(from_type: FieldType, to_type: FieldType) -> bool:
        """Check if a type can be safely promoted (widened) to another."""
        promotions = {
            FieldType.INT8: {FieldType.INT16, FieldType.INT32, FieldType.INT64, FieldType.FLOAT32, FieldType.FLOAT64},
            FieldType.INT16: {FieldType.INT32, FieldType.INT64, FieldType.FLOAT32, FieldType.FLOAT64},
            FieldType.INT32: {FieldType.INT64, FieldType.FLOAT64},
            FieldType.INT64: {FieldType.FLOAT64},
            FieldType.FLOAT16: {FieldType.FLOAT32, FieldType.FLOAT64},
            FieldType.FLOAT32: {FieldType.FLOAT64},
        }
        if from_type == to_type:
            return True
        return to_type in promotions.get(from_type, set())


@dataclass
class SchemaField:
    """A single field in a schema."""
    name: str
    field_type: FieldType
    nullable: bool = True
    description: str = ""
    default_value: Any = None
    aliases: list[str] = field(default_factory=list)
    tags: dict[str, str] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "field_type": self.field_type.value,
            "nullable": self.nullable,
            "description": self.description,
            "default_value": self.default_value,
            "aliases": self.aliases,
            "tags": self.tags,
        }

    _TYPE_ALIASES: ClassVar[dict[str, str]] = {
        "float": "float64", "double": "float64", "int": "int64",
        "integer": "int64", "long": "int64", "short": "int16",
        "str": "string", "text": "string", "bool": "boolean",
        "bytes": "binary", "datetime": "timestamp",
    }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> SchemaField:
        raw_type = data.get("field_type") or data.get("type", "string")
        resolved_type = cls._TYPE_ALIASES.get(raw_type, raw_type)
        return cls(
            name=data["name"],
            field_type=FieldType(resolved_type),
            nullable=data.get("nullable", True),
            description=data.get("description", ""),
            default_value=data.get("default_value"),
            aliases=data.get("aliases", []),
            tags=data.get("tags", {}),
        )

    def to_arrow(self) -> pa.Field:
        """Convert to PyArrow field."""
        type_map = {
            FieldType.INT8: pa.int8(),
            FieldType.INT16: pa.int16(),
            FieldType.INT32: pa.int32(),
            FieldType.INT64: pa.int64(),
            FieldType.FLOAT16: pa.float16(),
            FieldType.FLOAT32: pa.float32(),
            FieldType.FLOAT64: pa.float64(),
            FieldType.STRING: pa.string(),
            FieldType.BOOLEAN: pa.bool_(),
            FieldType.TIMESTAMP: pa.timestamp("us"),
            FieldType.DATE: pa.date32(),
            FieldType.BINARY: pa.binary(),
        }
        arrow_type = type_map.get(self.field_type, pa.string())
        return pa.field(self.name, arrow_type, nullable=self.nullable)


@dataclass
class FeatureSchema:
    """Complete schema for a feature table."""
    name: str
    version: int
    fields: list[SchemaField]
    primary_key: str
    timestamp_field: str | None = None
    description: str = ""
    compatibility: CompatibilityMode = CompatibilityMode.BACKWARD
    created_at: float = field(default_factory=time.time)
    tags: dict[str, str] = field(default_factory=dict)

    @property
    def field_names(self) -> list[str]:
        return [f.name for f in self.fields]

    @property
    def field_map(self) -> dict[str, SchemaField]:
        return {f.name: f for f in self.fields}

    def to_arrow_schema(self) -> pa.Schema:
        """Convert to PyArrow schema."""
        return pa.schema([f.to_arrow() for f in self.fields])

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "version": self.version,
            "fields": [f.to_dict() for f in self.fields],
            "primary_key": self.primary_key,
            "timestamp_field": self.timestamp_field,
            "description": self.description,
            "compatibility": self.compatibility.value,
            "created_at": self.created_at,
            "tags": self.tags,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> FeatureSchema:
        return cls(
            name=data["name"],
            version=data["version"],
            fields=[SchemaField.from_dict(f) for f in data["fields"]],
            primary_key=data["primary_key"],
            timestamp_field=data.get("timestamp_field"),
            description=data.get("description", ""),
            compatibility=CompatibilityMode(data.get("compatibility", "backward")),
            created_at=data.get("created_at", time.time()),
            tags=data.get("tags", {}),
        )


@dataclass
class SchemaEvolution:
    """Records a schema evolution operation."""
    from_version: int
    to_version: int
    operation: str  # add_field, remove_field, widen_type, rename_field
    field_name: str
    details: dict[str, Any] = field(default_factory=dict)
    timestamp: float = field(default_factory=time.time)

    def to_dict(self) -> dict[str, Any]:
        return {
            "from_version": self.from_version,
            "to_version": self.to_version,
            "operation": self.operation,
            "field_name": self.field_name,
            "details": self.details,
            "timestamp": self.timestamp,
        }


class SchemaCompatibilityError(Exception):
    """Raised when a schema change violates compatibility constraints."""
    pass


class SchemaRegistry:
    """Central registry for feature table schemas.

    Manages schema versions, enforces compatibility, and tracks evolution history.
    """

    def __init__(self, storage_path: str | Path = "lakehouse_store/_schemas") -> None:
        self.storage_path = Path(storage_path)
        self.storage_path.mkdir(parents=True, exist_ok=True)
        self._schemas: dict[str, list[FeatureSchema]] = {}
        self._evolutions: dict[str, list[SchemaEvolution]] = {}
        self._load_all()

    def _load_all(self) -> None:
        """Load all schemas from disk."""
        for schema_dir in self.storage_path.iterdir():
            if schema_dir.is_dir() and not schema_dir.name.startswith("_"):
                self._load_schema(schema_dir.name)

    def _load_schema(self, name: str) -> None:
        schema_dir = self.storage_path / name
        versions_file = schema_dir / "versions.json"
        if versions_file.exists():
            data = json.loads(versions_file.read_text())
            self._schemas[name] = [FeatureSchema.from_dict(v) for v in data.get("versions", [])]
            self._evolutions[name] = [
                SchemaEvolution(**e) for e in data.get("evolutions", [])
            ]

    def _save_schema(self, name: str) -> None:
        schema_dir = self.storage_path / name
        schema_dir.mkdir(parents=True, exist_ok=True)
        data = {
            "versions": [s.to_dict() for s in self._schemas.get(name, [])],
            "evolutions": [e.to_dict() for e in self._evolutions.get(name, [])],
        }
        (schema_dir / "versions.json").write_text(json.dumps(data, indent=2, default=str))

    def register(self, schema: FeatureSchema) -> FeatureSchema:
        """Register a new schema or a new version of an existing schema.

        Enforces compatibility constraints when evolving existing schemas.
        """
        name = schema.name
        existing = self._schemas.get(name, [])

        if existing:
            latest = existing[-1]
            self._check_compatibility(latest, schema)
            schema.version = latest.version + 1
            evolutions = self._detect_evolutions(latest, schema)
            self._evolutions.setdefault(name, []).extend(evolutions)
        else:
            schema.version = 1

        self._schemas.setdefault(name, []).append(schema)
        self._save_schema(name)
        return schema

    def get_schema(self, name: str, version: int | None = None) -> FeatureSchema | None:
        """Get a schema by name and optional version (latest if not specified)."""
        schemas = self._schemas.get(name, [])
        if not schemas:
            return None
        if version is None:
            return schemas[-1]
        for s in schemas:
            if s.version == version:
                return s
        return None

    def get_latest_version(self, name: str) -> int:
        """Get the latest version number for a schema."""
        schemas = self._schemas.get(name, [])
        return schemas[-1].version if schemas else 0

    def list_schemas(self) -> list[dict[str, Any]]:
        """List all registered schemas with their latest versions."""
        result = []
        for name, versions in self._schemas.items():
            if versions:
                latest = versions[-1]
                result.append({
                    "name": name,
                    "latest_version": latest.version,
                    "n_fields": len(latest.fields),
                    "compatibility": latest.compatibility.value,
                    "created_at": versions[0].created_at,
                    "updated_at": latest.created_at,
                })
        return result

    def get_evolution_history(self, name: str) -> list[dict[str, Any]]:
        """Get the evolution history for a schema."""
        return [e.to_dict() for e in self._evolutions.get(name, [])]

    def validate_data(self, name: str, data: dict[str, Any]) -> list[str]:
        """Validate a data record against the latest schema. Returns list of errors."""
        schema = self.get_schema(name)
        if not schema:
            return [f"Schema '{name}' not found"]

        errors = []
        field_map = schema.field_map

        for field_name, field_def in field_map.items():
            if field_name not in data:
                if not field_def.nullable and field_def.default_value is None:
                    errors.append(f"Required field '{field_name}' is missing")
            else:
                value = data[field_name]
                if value is None and not field_def.nullable:
                    errors.append(f"Field '{field_name}' cannot be null")

        unknown_fields = set(data.keys()) - set(field_map.keys())
        if unknown_fields:
            # Check aliases
            for uf in unknown_fields:
                matched = False
                for f in schema.fields:
                    if uf in f.aliases:
                        matched = True
                        break
                if not matched:
                    errors.append(f"Unknown field: '{uf}'")

        return errors

    def _check_compatibility(self, old: FeatureSchema, new: FeatureSchema) -> None:
        """Check if new schema is compatible with the old schema."""
        mode = old.compatibility

        if mode == CompatibilityMode.NONE:
            return

        old_fields = old.field_map
        new_fields = new.field_map

        if mode in (CompatibilityMode.BACKWARD, CompatibilityMode.FULL):
            # New schema must be able to read old data
            for name, old_field in old_fields.items():
                if name not in new_fields:
                    # Field removed — only OK if it was nullable
                    if not old_field.nullable:
                        raise SchemaCompatibilityError(
                            f"Cannot remove non-nullable field '{name}' in backward-compatible mode"
                        )
                else:
                    new_field = new_fields[name]
                    if old_field.field_type != new_field.field_type:
                        if not FieldType.can_promote(old_field.field_type, new_field.field_type):
                            raise SchemaCompatibilityError(
                                f"Cannot change type of '{name}' from {old_field.field_type.value} "
                                f"to {new_field.field_type.value} — not a safe promotion"
                            )

        if mode in (CompatibilityMode.FORWARD, CompatibilityMode.FULL):
            # Old schema must be able to read new data
            for name, new_field in new_fields.items():
                if name not in old_fields:
                    # New field added — must have a default or be nullable
                    if not new_field.nullable and new_field.default_value is None:
                        raise SchemaCompatibilityError(
                            f"New non-nullable field '{name}' without default violates forward compatibility"
                        )

    def _detect_evolutions(self, old: FeatureSchema, new: FeatureSchema) -> list[SchemaEvolution]:
        """Detect schema changes between versions."""
        evolutions = []
        old_fields = old.field_map
        new_fields = new.field_map

        # Added fields
        for name in set(new_fields) - set(old_fields):
            evolutions.append(SchemaEvolution(
                from_version=old.version,
                to_version=new.version,
                operation="add_field",
                field_name=name,
                details={"field_type": new_fields[name].field_type.value, "nullable": new_fields[name].nullable},
            ))

        # Removed fields
        for name in set(old_fields) - set(new_fields):
            evolutions.append(SchemaEvolution(
                from_version=old.version,
                to_version=new.version,
                operation="remove_field",
                field_name=name,
                details={"was_type": old_fields[name].field_type.value},
            ))

        # Type changes
        for name in set(old_fields) & set(new_fields):
            if old_fields[name].field_type != new_fields[name].field_type:
                evolutions.append(SchemaEvolution(
                    from_version=old.version,
                    to_version=new.version,
                    operation="widen_type",
                    field_name=name,
                    details={
                        "from_type": old_fields[name].field_type.value,
                        "to_type": new_fields[name].field_type.value,
                    },
                ))

        return evolutions

    @staticmethod
    def infer_schema(
        name: str,
        df: "pd.DataFrame",
        primary_key: str,
        timestamp_field: str | None = None,
        description: str = "",
    ) -> FeatureSchema:
        """Infer a schema from a pandas DataFrame."""
        import pandas as pd

        type_map = {
            "int8": FieldType.INT8,
            "int16": FieldType.INT16,
            "int32": FieldType.INT32,
            "int64": FieldType.INT64,
            "float16": FieldType.FLOAT16,
            "float32": FieldType.FLOAT32,
            "float64": FieldType.FLOAT64,
            "bool": FieldType.BOOLEAN,
            "object": FieldType.STRING,
            "string": FieldType.STRING,
            "datetime64[ns]": FieldType.TIMESTAMP,
            "category": FieldType.STRING,
        }

        fields = []
        for col in df.columns:
            dtype_str = str(df[col].dtype)
            field_type = FieldType.FLOAT64  # default
            for key, ft in type_map.items():
                if key in dtype_str:
                    field_type = ft
                    break

            fields.append(SchemaField(
                name=col,
                field_type=field_type,
                nullable=bool(df[col].isnull().any()),
                description=f"Column '{col}' ({dtype_str})",
            ))

        return FeatureSchema(
            name=name,
            version=1,
            fields=fields,
            primary_key=primary_key,
            timestamp_field=timestamp_field,
            description=description,
        )
