"""
Keycloak → Lakehouse Connector
Exports Keycloak admin events, user events, and user/role data from
the Keycloak Admin REST API into the S3 lakehouse as Parquet files.
"""
from __future__ import annotations

import io
import json
import logging
import os
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional

import boto3
import httpx
import pyarrow as pa
import pyarrow.parquet as pq

log = logging.getLogger(__name__)

KEYCLOAK_URL = os.getenv("KEYCLOAK_URL", "http://keycloak:8080")
KEYCLOAK_REALM = os.getenv("KEYCLOAK_REALM", "insureportal")
KEYCLOAK_ADMIN_USER = os.getenv("KEYCLOAK_ADMIN_USER", "admin")
KEYCLOAK_ADMIN_PASSWORD = os.getenv("KEYCLOAK_ADMIN_PASSWORD", "admin")
S3_ENDPOINT = os.getenv("S3_ENDPOINT", "http://minio:9000")
S3_ACCESS_KEY = os.getenv("S3_ACCESS_KEY", "minioadmin")
S3_SECRET_KEY = os.getenv("S3_SECRET_KEY", "minioadmin")
S3_BUCKET = os.getenv("S3_BUCKET", "insureportal-lakehouse")

AUTH_EVENT_SCHEMA = pa.schema([
    pa.field("event_id", pa.string()),
    pa.field("event_type", pa.string()),
    pa.field("realm_id", pa.string()),
    pa.field("client_id", pa.string()),
    pa.field("user_id", pa.string()),
    pa.field("session_id", pa.string()),
    pa.field("ip_address", pa.string()),
    pa.field("error", pa.string()),
    pa.field("details_json", pa.string()),
    pa.field("event_time", pa.timestamp("us", tz="UTC")),
    pa.field("exported_at", pa.timestamp("us", tz="UTC")),
])

ADMIN_EVENT_SCHEMA = pa.schema([
    pa.field("event_id", pa.string()),
    pa.field("operation_type", pa.string()),
    pa.field("resource_type", pa.string()),
    pa.field("resource_path", pa.string()),
    pa.field("realm_id", pa.string()),
    pa.field("auth_realm_id", pa.string()),
    pa.field("auth_client_id", pa.string()),
    pa.field("auth_user_id", pa.string()),
    pa.field("auth_ip_address", pa.string()),
    pa.field("representation_json", pa.string()),
    pa.field("error", pa.string()),
    pa.field("event_time", pa.timestamp("us", tz="UTC")),
    pa.field("exported_at", pa.timestamp("us", tz="UTC")),
])

USER_SCHEMA = pa.schema([
    pa.field("user_id", pa.string()),
    pa.field("username", pa.string()),
    pa.field("email", pa.string()),
    pa.field("first_name", pa.string()),
    pa.field("last_name", pa.string()),
    pa.field("realm", pa.string()),
    pa.field("enabled", pa.bool_()),
    pa.field("email_verified", pa.bool_()),
    pa.field("roles", pa.string()),        # JSON array
    pa.field("groups", pa.string()),       # JSON array
    pa.field("attributes_json", pa.string()),
    pa.field("created_timestamp", pa.timestamp("us", tz="UTC")),
    pa.field("exported_at", pa.timestamp("us", tz="UTC")),
])

SESSION_SCHEMA = pa.schema([
    pa.field("session_id", pa.string()),
    pa.field("user_id", pa.string()),
    pa.field("username", pa.string()),
    pa.field("realm", pa.string()),
    pa.field("client_id", pa.string()),
    pa.field("ip_address", pa.string()),
    pa.field("start_time", pa.timestamp("us", tz="UTC")),
    pa.field("last_access", pa.timestamp("us", tz="UTC")),
    pa.field("exported_at", pa.timestamp("us", tz="UTC")),
])


def _get_s3():
    try:
        return boto3.client(
            "s3",
            endpoint_url=S3_ENDPOINT,
            aws_access_key_id=S3_ACCESS_KEY,
            aws_secret_access_key=S3_SECRET_KEY,
        )
    except Exception as e:
        log.warning(f"S3 unavailable: {e}")
        return None


def _write_parquet(records: List[Dict], schema: pa.Schema, s3_key: str) -> Dict[str, Any]:
    if not records:
        return {"status": "skip", "rows": 0}
    s3 = _get_s3()
    if not s3:
        return {"status": "no_s3", "rows": 0}

    arrays = []
    for field in schema:
        vals = []
        for r in records:
            v = r.get(field.name)
            if v is None:
                if pa.types.is_string(field.type):
                    v = ""
                elif pa.types.is_integer(field.type):
                    v = 0
                elif pa.types.is_boolean(field.type):
                    v = False
                elif pa.types.is_timestamp(field.type):
                    v = datetime.now(timezone.utc)
            if pa.types.is_timestamp(field.type) and isinstance(v, (int, float)):
                # Keycloak returns timestamps in milliseconds
                v = datetime.fromtimestamp(v / 1000, tz=timezone.utc)
            if pa.types.is_timestamp(field.type) and isinstance(v, str):
                try:
                    v = datetime.fromisoformat(v.replace("Z", "+00:00"))
                except Exception:
                    v = datetime.now(timezone.utc)
            if pa.types.is_timestamp(field.type) and hasattr(v, "tzinfo") and v.tzinfo is None:
                v = v.replace(tzinfo=timezone.utc)
            vals.append(v)
        arrays.append(pa.array(vals, type=field.type))

    table = pa.table(arrays, schema=schema)
    buf = io.BytesIO()
    pq.write_table(table, buf, compression="snappy")
    buf.seek(0)

    try:
        s3.put_object(Bucket=S3_BUCKET, Key=s3_key, Body=buf.read())
        log.info(f"[Keycloak→Lakehouse] Wrote {len(records)} rows → s3://{S3_BUCKET}/{s3_key}")
        return {"status": "ok", "rows": len(records), "key": s3_key}
    except Exception as e:
        log.error(f"[Keycloak→Lakehouse] S3 write failed: {e}")
        return {"status": "error", "error": str(e)}


async def _get_admin_token() -> Optional[str]:
    """Obtain an admin access token from Keycloak."""
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(
                f"{KEYCLOAK_URL}/realms/master/protocol/openid-connect/token",
                data={
                    "grant_type": "password",
                    "client_id": "admin-cli",
                    "username": KEYCLOAK_ADMIN_USER,
                    "password": KEYCLOAK_ADMIN_PASSWORD,
                },
            )
            resp.raise_for_status()
            return resp.json().get("access_token")
    except Exception as e:
        log.warning(f"[Keycloak] Could not obtain admin token: {e}")
        return None


async def export_auth_events(since_hours: int = 24, max_events: int = 10000) -> Dict[str, Any]:
    """Export Keycloak user auth events (login, logout, failures) to the lakehouse."""
    now = datetime.now(timezone.utc)
    token = await _get_admin_token()
    if not token:
        return {"status": "no_token", "rows": 0}

    since_ms = int((now - timedelta(hours=since_hours)).timestamp() * 1000)
    events: List[Dict] = []

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            headers = {"Authorization": f"Bearer {token}"}
            first = 0
            while len(events) < max_events:
                resp = await client.get(
                    f"{KEYCLOAK_URL}/admin/realms/{KEYCLOAK_REALM}/events",
                    headers=headers,
                    params={
                        "dateFrom": (now - timedelta(hours=since_hours)).strftime("%Y-%m-%d"),
                        "first": first,
                        "max": min(500, max_events - len(events)),
                    },
                )
                if resp.status_code != 200:
                    break
                batch = resp.json()
                if not batch:
                    break
                for ev in batch:
                    events.append({
                        "event_id": str(ev.get("id", "")),
                        "event_type": str(ev.get("type", "")),
                        "realm_id": str(ev.get("realmId", KEYCLOAK_REALM)),
                        "client_id": str(ev.get("clientId", "")),
                        "user_id": str(ev.get("userId", "")),
                        "session_id": str(ev.get("sessionId", "")),
                        "ip_address": str(ev.get("ipAddress", "")),
                        "error": str(ev.get("error", "")),
                        "details_json": json.dumps(ev.get("details", {}), default=str),
                        "event_time": ev.get("time", int(now.timestamp() * 1000)),
                        "exported_at": now,
                    })
                first += len(batch)
                if len(batch) < 500:
                    break
    except Exception as e:
        log.warning(f"[Keycloak] Could not fetch auth events: {e}")

    key = (
        f"bronze/keycloak/auth_events/"
        f"year={now.year:04d}/month={now.month:02d}/day={now.day:02d}/"
        f"events_{now.strftime('%Y%m%d_%H%M%S')}.parquet"
    )
    return _write_parquet(events, AUTH_EVENT_SCHEMA, key)


async def export_admin_events(since_hours: int = 24, max_events: int = 5000) -> Dict[str, Any]:
    """Export Keycloak admin events (user/role/client management) to the lakehouse."""
    now = datetime.now(timezone.utc)
    token = await _get_admin_token()
    if not token:
        return {"status": "no_token", "rows": 0}

    events: List[Dict] = []
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            headers = {"Authorization": f"Bearer {token}"}
            first = 0
            while len(events) < max_events:
                resp = await client.get(
                    f"{KEYCLOAK_URL}/admin/realms/{KEYCLOAK_REALM}/admin-events",
                    headers=headers,
                    params={
                        "dateFrom": (now - timedelta(hours=since_hours)).strftime("%Y-%m-%d"),
                        "first": first,
                        "max": min(500, max_events - len(events)),
                    },
                )
                if resp.status_code != 200:
                    break
                batch = resp.json()
                if not batch:
                    break
                for ev in batch:
                    auth_details = ev.get("authDetails", {})
                    events.append({
                        "event_id": str(ev.get("id", "")),
                        "operation_type": str(ev.get("operationType", "")),
                        "resource_type": str(ev.get("resourceType", "")),
                        "resource_path": str(ev.get("resourcePath", "")),
                        "realm_id": str(ev.get("realmId", KEYCLOAK_REALM)),
                        "auth_realm_id": str(auth_details.get("realmId", "")),
                        "auth_client_id": str(auth_details.get("clientId", "")),
                        "auth_user_id": str(auth_details.get("userId", "")),
                        "auth_ip_address": str(auth_details.get("ipAddress", "")),
                        "representation_json": str(ev.get("representation", "")),
                        "error": str(ev.get("error", "")),
                        "event_time": ev.get("time", int(now.timestamp() * 1000)),
                        "exported_at": now,
                    })
                first += len(batch)
                if len(batch) < 500:
                    break
    except Exception as e:
        log.warning(f"[Keycloak] Could not fetch admin events: {e}")

    key = (
        f"bronze/keycloak/admin_events/"
        f"year={now.year:04d}/month={now.month:02d}/day={now.day:02d}/"
        f"admin_events_{now.strftime('%Y%m%d_%H%M%S')}.parquet"
    )
    return _write_parquet(events, ADMIN_EVENT_SCHEMA, key)


async def export_users() -> Dict[str, Any]:
    """Export all Keycloak users with their roles to the lakehouse."""
    now = datetime.now(timezone.utc)
    token = await _get_admin_token()
    if not token:
        return {"status": "no_token", "rows": 0}

    users: List[Dict] = []
    try:
        async with httpx.AsyncClient(timeout=60) as client:
            headers = {"Authorization": f"Bearer {token}"}
            first = 0
            while True:
                resp = await client.get(
                    f"{KEYCLOAK_URL}/admin/realms/{KEYCLOAK_REALM}/users",
                    headers=headers,
                    params={"first": first, "max": 500, "briefRepresentation": "false"},
                )
                if resp.status_code != 200:
                    break
                batch = resp.json()
                if not batch:
                    break

                for user in batch:
                    user_id = user.get("id", "")
                    # Fetch realm roles for this user
                    roles: List[str] = []
                    try:
                        roles_resp = await client.get(
                            f"{KEYCLOAK_URL}/admin/realms/{KEYCLOAK_REALM}/users/{user_id}/role-mappings/realm",
                            headers=headers,
                        )
                        if roles_resp.status_code == 200:
                            roles = [r.get("name", "") for r in roles_resp.json()]
                    except Exception:
                        pass

                    # Fetch groups
                    groups: List[str] = []
                    try:
                        groups_resp = await client.get(
                            f"{KEYCLOAK_URL}/admin/realms/{KEYCLOAK_REALM}/users/{user_id}/groups",
                            headers=headers,
                        )
                        if groups_resp.status_code == 200:
                            groups = [g.get("name", "") for g in groups_resp.json()]
                    except Exception:
                        pass

                    created_ts = user.get("createdTimestamp", int(now.timestamp() * 1000))
                    users.append({
                        "user_id": user_id,
                        "username": str(user.get("username", "")),
                        "email": str(user.get("email", "")),
                        "first_name": str(user.get("firstName", "")),
                        "last_name": str(user.get("lastName", "")),
                        "realm": KEYCLOAK_REALM,
                        "enabled": bool(user.get("enabled", False)),
                        "email_verified": bool(user.get("emailVerified", False)),
                        "roles": json.dumps(roles),
                        "groups": json.dumps(groups),
                        "attributes_json": json.dumps(user.get("attributes", {}), default=str),
                        "created_timestamp": created_ts,
                        "exported_at": now,
                    })

                first += len(batch)
                if len(batch) < 500:
                    break
    except Exception as e:
        log.warning(f"[Keycloak] Could not fetch users: {e}")

    key = (
        f"silver/keycloak/users/"
        f"year={now.year:04d}/month={now.month:02d}/day={now.day:02d}/"
        f"users_{now.strftime('%Y%m%d_%H%M%S')}.parquet"
    )
    return _write_parquet(users, USER_SCHEMA, key)


async def export_active_sessions() -> Dict[str, Any]:
    """Export active Keycloak sessions to the lakehouse."""
    now = datetime.now(timezone.utc)
    token = await _get_admin_token()
    if not token:
        return {"status": "no_token", "rows": 0}

    sessions: List[Dict] = []
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            headers = {"Authorization": f"Bearer {token}"}
            # Get all clients first
            clients_resp = await client.get(
                f"{KEYCLOAK_URL}/admin/realms/{KEYCLOAK_REALM}/clients",
                headers=headers,
                params={"max": 100},
            )
            if clients_resp.status_code == 200:
                for kc_client in clients_resp.json():
                    client_id = kc_client.get("id", "")
                    client_name = kc_client.get("clientId", "")
                    try:
                        sess_resp = await client.get(
                            f"{KEYCLOAK_URL}/admin/realms/{KEYCLOAK_REALM}/clients/{client_id}/user-sessions",
                            headers=headers,
                            params={"max": 1000},
                        )
                        if sess_resp.status_code == 200:
                            for sess in sess_resp.json():
                                sessions.append({
                                    "session_id": str(sess.get("id", "")),
                                    "user_id": str(sess.get("userId", "")),
                                    "username": str(sess.get("username", "")),
                                    "realm": KEYCLOAK_REALM,
                                    "client_id": client_name,
                                    "ip_address": str(sess.get("ipAddress", "")),
                                    "start_time": sess.get("start", int(now.timestamp() * 1000)),
                                    "last_access": sess.get("lastAccess", int(now.timestamp() * 1000)),
                                    "exported_at": now,
                                })
                    except Exception:
                        pass
    except Exception as e:
        log.warning(f"[Keycloak] Could not fetch sessions: {e}")

    key = (
        f"bronze/keycloak/sessions/"
        f"year={now.year:04d}/month={now.month:02d}/day={now.day:02d}/"
        f"sessions_{now.strftime('%Y%m%d_%H%M%S')}.parquet"
    )
    return _write_parquet(sessions, SESSION_SCHEMA, key)


async def run_full_export(since_hours: int = 24) -> Dict[str, Any]:
    """Run all Keycloak exports in parallel."""
    import asyncio
    auth_r, admin_r, users_r, sessions_r = await asyncio.gather(
        export_auth_events(since_hours=since_hours),
        export_admin_events(since_hours=since_hours),
        export_users(),
        export_active_sessions(),
    )
    total = (
        auth_r.get("rows", 0)
        + admin_r.get("rows", 0)
        + users_r.get("rows", 0)
        + sessions_r.get("rows", 0)
    )
    return {
        "status": "ok",
        "auth_events": auth_r,
        "admin_events": admin_r,
        "users": users_r,
        "sessions": sessions_r,
        "total_rows": total,
        "completed_at": datetime.now(timezone.utc).isoformat(),
    }
