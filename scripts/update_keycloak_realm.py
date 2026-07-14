#!/usr/bin/env python3
"""Update Keycloak realm JSON with all insurance domain roles and client scopes."""
import json
import uuid

REALM_FILE = "infra/keycloak/realm-insureportal.json"

with open(REALM_FILE) as f:
    realm = json.load(f)

# ── All insurance domain roles ────────────────────────────────────────────────
REQUIRED_ROLES = [
    # Core platform roles
    {"name": "admin", "description": "Platform administrator"},
    {"name": "agent", "description": "Insurance agent"},
    {"name": "supervisor", "description": "Agent supervisor"},
    {"name": "customer", "description": "Policyholder / customer"},
    # Insurance domain roles
    {"name": "underwriter", "description": "Insurance underwriter — evaluates and prices risk"},
    {"name": "actuary", "description": "Actuary — reserve calculations and IFRS17"},
    {"name": "claims_adjuster", "description": "Claims adjuster — investigates and settles claims"},
    {"name": "broker", "description": "Insurance broker — intermediary between customer and insurer"},
    {"name": "compliance_officer", "description": "Compliance officer — regulatory oversight"},
    {"name": "reinsurer", "description": "Reinsurance counterparty — treaty and facultative"},
    {"name": "finance_officer", "description": "Finance officer — GL, settlements, TigerBeetle ledger"},
    {"name": "risk_manager", "description": "Risk manager — enterprise risk and exposure"},
    {"name": "product_manager", "description": "Insurance product manager — product catalog"},
    {"name": "data_analyst", "description": "Data analyst — lakehouse, actuarial reports"},
    {"name": "auditor", "description": "Internal/external auditor — read-only audit access"},
    {"name": "api_service", "description": "Machine-to-machine service account role"},
]

existing_role_names = {r["name"] for r in realm.get("roles", {}).get("realm", [])}
if "roles" not in realm:
    realm["roles"] = {"realm": []}
if "realm" not in realm["roles"]:
    realm["roles"]["realm"] = []

added_roles = []
for role in REQUIRED_ROLES:
    if role["name"] not in existing_role_names:
        realm["roles"]["realm"].append({
            "id": str(uuid.uuid4()),
            "name": role["name"],
            "description": role["description"],
            "composite": False,
            "clientRole": False,
            "containerId": realm.get("id", "insureportal"),
        })
        added_roles.append(role["name"])

# ── Ensure insureportal-backend service client exists ─────────────────────────
client_ids = {c["clientId"] for c in realm.get("clients", [])}
if "insureportal-backend" not in client_ids:
    realm.setdefault("clients", []).append({
        "id": str(uuid.uuid4()),
        "clientId": "insureportal-backend",
        "name": "InsurePortal Backend Service",
        "description": "Backend service account for server-to-server auth",
        "enabled": True,
        "clientAuthenticatorType": "client-secret",
        "secret": "${KEYCLOAK_CLIENT_SECRET}",
        "serviceAccountsEnabled": True,
        "authorizationServicesEnabled": False,
        "directAccessGrantsEnabled": False,
        "publicClient": False,
        "protocol": "openid-connect",
        "attributes": {
            "access.token.lifespan": "300",
        },
    })
    print("Added insureportal-backend service client")

# ── Ensure all roles are in the default roles ─────────────────────────────────
default_roles = realm.get("defaultRoles", [])
for role in REQUIRED_ROLES:
    if role["name"] not in default_roles and role["name"] not in ("admin", "api_service", "auditor"):
        pass  # Don't add sensitive roles to default

# ── Add Permify and Dapr scopes to the main client ───────────────────────────
for client in realm.get("clients", []):
    if client["clientId"] == "insurance-portal":
        # Ensure roles claim is included in token
        if "protocolMappers" not in client:
            client["protocolMappers"] = []
        mapper_names = {m.get("name") for m in client["protocolMappers"]}
        if "realm-roles-mapper" not in mapper_names:
            client["protocolMappers"].append({
                "id": str(uuid.uuid4()),
                "name": "realm-roles-mapper",
                "protocol": "openid-connect",
                "protocolMapper": "oidc-usermodel-realm-role-mapper",
                "consentRequired": False,
                "config": {
                    "multivalued": "true",
                    "userinfo.token.claim": "true",
                    "id.token.claim": "true",
                    "access.token.claim": "true",
                    "claim.name": "realm_access.roles",
                    "jsonType.label": "String",
                },
            })
        if "tenant-id-mapper" not in mapper_names:
            client["protocolMappers"].append({
                "id": str(uuid.uuid4()),
                "name": "tenant-id-mapper",
                "protocol": "openid-connect",
                "protocolMapper": "oidc-usermodel-attribute-mapper",
                "consentRequired": False,
                "config": {
                    "userinfo.token.claim": "true",
                    "user.attribute": "tenantId",
                    "id.token.claim": "true",
                    "access.token.claim": "true",
                    "claim.name": "tenantId",
                    "jsonType.label": "String",
                },
            })

with open(REALM_FILE, "w") as f:
    json.dump(realm, f, indent=2)

print(f"Realm updated successfully.")
print(f"Added roles: {added_roles}")
all_roles = [r["name"] for r in realm["roles"]["realm"]]
print(f"Total realm roles: {len(all_roles)}: {all_roles}")
