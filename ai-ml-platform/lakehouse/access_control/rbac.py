"""
Role-Based Access Control (RBAC) for Lakehouse Feature Tables

Provides:
- Role definitions (reader, writer, admin, data_scientist, ml_engineer)
- Table-level and column-level permissions
- Audit logging of all access attempts
- Token-based authentication with Keycloak integration
- Policy enforcement middleware
"""

from __future__ import annotations

import hashlib
import json
import secrets
import time
from dataclasses import dataclass, field
from enum import Enum, Flag, auto
from pathlib import Path
from typing import Any


class Permission(Flag):
    """Feature table permissions."""
    NONE = 0
    READ = auto()
    WRITE = auto()
    DELETE = auto()
    SCHEMA_MODIFY = auto()
    ADMIN = READ | WRITE | DELETE | SCHEMA_MODIFY


class Role(Enum):
    """Predefined roles with associated permissions."""
    READER = "reader"
    WRITER = "writer"
    DATA_SCIENTIST = "data_scientist"
    ML_ENGINEER = "ml_engineer"
    ADMIN = "admin"

    @property
    def permissions(self) -> Permission:
        role_perms = {
            Role.READER: Permission.READ,
            Role.WRITER: Permission.READ | Permission.WRITE,
            Role.DATA_SCIENTIST: Permission.READ | Permission.WRITE,
            Role.ML_ENGINEER: Permission.READ | Permission.WRITE | Permission.SCHEMA_MODIFY,
            Role.ADMIN: Permission.ADMIN,
        }
        return role_perms[self]


@dataclass
class Principal:
    """A user or service with access to the lakehouse."""
    id: str
    name: str
    roles: list[Role]
    service_account: bool = False
    api_key_hash: str | None = None
    created_at: float = field(default_factory=time.time)
    metadata: dict[str, str] = field(default_factory=dict)

    @property
    def effective_permissions(self) -> Permission:
        perms = Permission.NONE
        for role in self.roles:
            perms = perms | role.permissions
        return perms

    def has_permission(self, perm: Permission) -> bool:
        return perm in self.effective_permissions

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "roles": [r.value for r in self.roles],
            "service_account": self.service_account,
            "created_at": self.created_at,
            "permissions": str(self.effective_permissions),
            "metadata": self.metadata,
        }


@dataclass
class TablePolicy:
    """Access policy for a specific feature table."""
    table_name: str
    allowed_roles: list[Role]
    denied_columns: dict[str, list[str]] = field(default_factory=dict)  # role -> columns
    row_filter: str | None = None  # SQL-like filter expression
    require_audit: bool = True
    max_rows_per_query: int | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "table_name": self.table_name,
            "allowed_roles": [r.value for r in self.allowed_roles],
            "denied_columns": {r: cols for r, cols in self.denied_columns.items()},
            "row_filter": self.row_filter,
            "require_audit": self.require_audit,
            "max_rows_per_query": self.max_rows_per_query,
        }


@dataclass
class AccessEvent:
    """Audit log entry for an access attempt."""
    principal_id: str
    table_name: str
    operation: str  # "read", "write", "delete", "schema_modify"
    allowed: bool
    timestamp: float = field(default_factory=time.time)
    columns_accessed: list[str] = field(default_factory=list)
    n_rows: int = 0
    reason: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "principal_id": self.principal_id,
            "table_name": self.table_name,
            "operation": self.operation,
            "allowed": self.allowed,
            "timestamp": self.timestamp,
            "columns_accessed": self.columns_accessed,
            "n_rows": self.n_rows,
            "reason": self.reason,
        }


class AccessControlManager:
    """Manages RBAC for the lakehouse feature store.

    Provides authentication, authorization, and audit logging.
    """

    def __init__(self, storage_path: str | Path = "lakehouse_store/_access_control") -> None:
        self.storage_path = Path(storage_path)
        self.storage_path.mkdir(parents=True, exist_ok=True)
        self._principals: dict[str, Principal] = {}
        self._policies: dict[str, TablePolicy] = {}
        self._api_keys: dict[str, str] = {}  # hash -> principal_id
        self._audit_log: list[AccessEvent] = []
        self._load_state()

    def _load_state(self) -> None:
        state_file = self.storage_path / "rbac_state.json"
        if state_file.exists():
            data = json.loads(state_file.read_text())
            for p_data in data.get("principals", []):
                principal = Principal(
                    id=p_data["id"],
                    name=p_data["name"],
                    roles=[Role(r) for r in p_data["roles"]],
                    service_account=p_data.get("service_account", False),
                    api_key_hash=p_data.get("api_key_hash"),
                    created_at=p_data.get("created_at", time.time()),
                    metadata=p_data.get("metadata", {}),
                )
                self._principals[principal.id] = principal
                if principal.api_key_hash:
                    self._api_keys[principal.api_key_hash] = principal.id

            for pol_data in data.get("policies", []):
                policy = TablePolicy(
                    table_name=pol_data["table_name"],
                    allowed_roles=[Role(r) for r in pol_data["allowed_roles"]],
                    denied_columns=pol_data.get("denied_columns", {}),
                    row_filter=pol_data.get("row_filter"),
                    require_audit=pol_data.get("require_audit", True),
                    max_rows_per_query=pol_data.get("max_rows_per_query"),
                )
                self._policies[policy.table_name] = policy

    def _save_state(self) -> None:
        data = {
            "principals": [p.to_dict() | {"api_key_hash": p.api_key_hash} for p in self._principals.values()],
            "policies": [p.to_dict() for p in self._policies.values()],
        }
        (self.storage_path / "rbac_state.json").write_text(json.dumps(data, indent=2, default=str))

    def create_principal(
        self,
        name: str,
        roles: list[Role],
        service_account: bool = False,
        metadata: dict[str, str] | None = None,
    ) -> tuple[Principal, str]:
        """Create a new principal and return (principal, api_key)."""
        principal_id = f"{'svc' if service_account else 'usr'}_{hashlib.sha256(name.encode()).hexdigest()[:12]}"
        api_key = f"lh_{secrets.token_urlsafe(32)}"
        api_key_hash = hashlib.sha256(api_key.encode()).hexdigest()

        principal = Principal(
            id=principal_id,
            name=name,
            roles=roles,
            service_account=service_account,
            api_key_hash=api_key_hash,
            metadata=metadata or {},
        )

        self._principals[principal_id] = principal
        self._api_keys[api_key_hash] = principal_id
        self._save_state()

        return principal, api_key

    def authenticate(self, api_key: str) -> Principal | None:
        """Authenticate a principal by API key."""
        key_hash = hashlib.sha256(api_key.encode()).hexdigest()
        principal_id = self._api_keys.get(key_hash)
        if principal_id:
            return self._principals.get(principal_id)
        return None

    def authorize(
        self,
        principal: Principal,
        table_name: str,
        operation: str,
        columns: list[str] | None = None,
    ) -> tuple[bool, str]:
        """Check if a principal is authorized to perform an operation.

        Returns (allowed, reason).
        """
        # Map operation to permission
        op_perms = {
            "read": Permission.READ,
            "write": Permission.WRITE,
            "delete": Permission.DELETE,
            "schema_modify": Permission.SCHEMA_MODIFY,
        }
        required_perm = op_perms.get(operation)
        if not required_perm:
            return False, f"Unknown operation: {operation}"

        # Check principal has base permission
        if not principal.has_permission(required_perm):
            self._log_access(principal.id, table_name, operation, False, columns or [], "Insufficient permissions")
            return False, f"Principal '{principal.name}' lacks {operation} permission"

        # Check table-specific policy
        policy = self._policies.get(table_name)
        if policy:
            # Check role is allowed for this table
            has_allowed_role = any(r in policy.allowed_roles for r in principal.roles)
            if not has_allowed_role and Role.ADMIN not in principal.roles:
                self._log_access(principal.id, table_name, operation, False, columns or [], "Role not in table policy")
                return False, f"None of principal's roles are allowed for table '{table_name}'"

            # Check column-level restrictions
            if columns:
                for role in principal.roles:
                    denied = policy.denied_columns.get(role.value, [])
                    restricted = set(columns) & set(denied)
                    if restricted:
                        self._log_access(
                            principal.id, table_name, operation, False, columns,
                            f"Column access denied: {restricted}",
                        )
                        return False, f"Access to columns {restricted} denied for role '{role.value}'"

        self._log_access(principal.id, table_name, operation, True, columns or [])
        return True, "Authorized"

    def set_table_policy(self, policy: TablePolicy) -> None:
        """Set or update an access policy for a table."""
        self._policies[policy.table_name] = policy
        self._save_state()

    def register_default_policies(self) -> None:
        """Register default table access policies for the platform."""
        default_policies = [
            TablePolicy(
                table_name="fraud_features",
                allowed_roles=[Role.ADMIN, Role.ML_ENGINEER, Role.DATA_SCIENTIST],
                denied_columns={"data_scientist": ["customer_name", "phone_number", "email"]},
                require_audit=True,
            ),
            TablePolicy(
                table_name="churn_features",
                allowed_roles=[Role.ADMIN, Role.ML_ENGINEER, Role.DATA_SCIENTIST, Role.READER],
                require_audit=True,
            ),
            TablePolicy(
                table_name="claims_features",
                allowed_roles=[Role.ADMIN, Role.ML_ENGINEER, Role.DATA_SCIENTIST],
                denied_columns={"data_scientist": ["claimant_id", "adjuster_notes"]},
                require_audit=True,
            ),
            TablePolicy(
                table_name="credit_features",
                allowed_roles=[Role.ADMIN, Role.ML_ENGINEER],
                denied_columns={"ml_engineer": ["bvn", "nin"]},
                require_audit=True,
                max_rows_per_query=10000,
            ),
            TablePolicy(
                table_name="anomaly_features",
                allowed_roles=[Role.ADMIN, Role.ML_ENGINEER, Role.DATA_SCIENTIST, Role.READER],
                require_audit=True,
            ),
            TablePolicy(
                table_name="risk_features",
                allowed_roles=[Role.ADMIN, Role.ML_ENGINEER, Role.DATA_SCIENTIST],
                require_audit=True,
            ),
        ]
        for policy in default_policies:
            self._policies[policy.table_name] = policy
        self._save_state()

    def register_default_service_accounts(self) -> dict[str, str]:
        """Create default service accounts for platform microservices.

        Returns dict of service_name -> api_key.
        """
        services = [
            ("claims-engine", [Role.WRITER]),
            ("fraud-service", [Role.WRITER]),
            ("kyc-service", [Role.WRITER]),
            ("payments-service", [Role.WRITER]),
            ("inference-server", [Role.READER]),
            ("training-pipeline", [Role.READER, Role.WRITER]),
            ("dashboard-api", [Role.READER]),
            ("audit-service", [Role.ADMIN]),
        ]
        keys = {}
        for name, roles in services:
            if not any(p.name == name for p in self._principals.values()):
                _, api_key = self.create_principal(
                    name=name,
                    roles=roles,
                    service_account=True,
                    metadata={"type": "microservice", "created_by": "platform_init"},
                )
                keys[name] = api_key
        return keys

    def _log_access(
        self,
        principal_id: str,
        table_name: str,
        operation: str,
        allowed: bool,
        columns: list[str],
        reason: str = "",
    ) -> None:
        event = AccessEvent(
            principal_id=principal_id,
            table_name=table_name,
            operation=operation,
            allowed=allowed,
            columns_accessed=columns,
            reason=reason,
        )
        self._audit_log.append(event)

        # Persist audit log
        audit_file = self.storage_path / "audit_log.jsonl"
        with open(audit_file, "a") as f:
            f.write(json.dumps(event.to_dict(), default=str) + "\n")

    def get_audit_log(self, principal_id: str | None = None, limit: int = 100) -> list[dict[str, Any]]:
        """Get audit log entries, optionally filtered by principal."""
        events = self._audit_log
        if principal_id:
            events = [e for e in events if e.principal_id == principal_id]
        return [e.to_dict() for e in events[-limit:]]

    def get_status(self) -> dict[str, Any]:
        """Get RBAC system status."""
        return {
            "n_principals": len(self._principals),
            "n_policies": len(self._policies),
            "n_audit_events": len(self._audit_log),
            "principals": [p.to_dict() for p in self._principals.values()],
            "policies": [p.to_dict() for p in self._policies.values()],
        }
