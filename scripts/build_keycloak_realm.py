#!/usr/bin/env python3
"""
build_keycloak_realm.py
Generates the complete Keycloak realm JSON for InsurePortal with all 16
insurance domain roles, composite role mappings, client scopes, and
protocol mappers that propagate roles into JWT claims.
"""
import json, pathlib

# ── Role definitions ──────────────────────────────────────────────────────────
# Each entry: (name, description, platform_role, attributes)
ROLES = [
    # ── Platform / system roles ───────────────────────────────────────────────
    {
        "name": "insureportal-super-admin",
        "description": "Super-administrator: unrestricted access to all tenants, system config, billing, and infrastructure.",
        "attributes": {
            "platform_role": ["super_admin"],
            "tier": ["system"],
            "can_impersonate": ["true"],
            "can_manage_tenants": ["true"],
            "can_view_all_data": ["true"],
        },
    },
    {
        "name": "insureportal-admin",
        "description": "Tenant administrator: manages users, products, settings, and reports within a single tenant.",
        "attributes": {
            "platform_role": ["admin"],
            "tier": ["tenant"],
            "can_manage_users": ["true"],
            "can_manage_products": ["true"],
            "can_view_reports": ["true"],
            "can_configure_workflows": ["true"],
        },
    },
    {
        "name": "insureportal-supervisor",
        "description": "Operations supervisor: approves overrides, monitors SLA breaches, escalates issues, and manages agent teams.",
        "attributes": {
            "platform_role": ["supervisor"],
            "tier": ["operations"],
            "can_approve_overrides": ["true"],
            "can_monitor_sla": ["true"],
            "can_escalate": ["true"],
            "can_manage_agents": ["true"],
        },
    },
    # ── Insurance domain roles ────────────────────────────────────────────────
    {
        "name": "insureportal-underwriter",
        "description": "Underwriter: assesses risk, approves/declines/refers applications, sets policy conditions and pricing.",
        "attributes": {
            "platform_role": ["underwriter"],
            "tier": ["insurance"],
            "can_assess_risk": ["true"],
            "can_approve_policy": ["true"],
            "can_decline_policy": ["true"],
            "can_refer_policy": ["true"],
            "can_set_conditions": ["true"],
            "can_view_actuarial_data": ["true"],
            "max_sum_insured_authority": ["50000000"],
        },
    },
    {
        "name": "insureportal-actuary",
        "description": "Actuary: computes reserves, runs mortality/morbidity tables, produces IFRS 17 reports, and performs pricing analysis.",
        "attributes": {
            "platform_role": ["actuary"],
            "tier": ["insurance"],
            "can_compute_reserves": ["true"],
            "can_run_actuarial_tables": ["true"],
            "can_generate_ifrs17_reports": ["true"],
            "can_run_pricing_models": ["true"],
            "can_export_actuarial_data": ["true"],
            "can_view_all_policies": ["true"],
        },
    },
    {
        "name": "insureportal-claims-adjuster",
        "description": "Claims adjuster: receives, investigates, adjudicates, and settles insurance claims within authority limits.",
        "attributes": {
            "platform_role": ["claims_adjuster"],
            "tier": ["insurance"],
            "can_receive_claims": ["true"],
            "can_investigate_claims": ["true"],
            "can_adjudicate_claims": ["true"],
            "can_approve_settlement": ["true"],
            "can_reject_claim": ["true"],
            "can_request_documents": ["true"],
            "max_settlement_authority": ["5000000"],
        },
    },
    {
        "name": "insureportal-broker",
        "description": "Licensed insurance broker: submits policy applications on behalf of clients, manages a client portfolio, earns commission.",
        "attributes": {
            "platform_role": ["broker"],
            "tier": ["distribution"],
            "can_submit_applications": ["true"],
            "can_manage_portfolio": ["true"],
            "can_view_commission": ["true"],
            "can_renew_policies": ["true"],
            "can_endorse_policies": ["true"],
            "requires_license": ["true"],
        },
    },
    {
        "name": "insureportal-agent",
        "description": "Field insurance agent: sells policies, collects premiums, services customers, and manages a float account.",
        "attributes": {
            "platform_role": ["agent"],
            "tier": ["distribution"],
            "can_sell_policies": ["true"],
            "can_collect_premiums": ["true"],
            "can_manage_float": ["true"],
            "can_service_customers": ["true"],
            "can_view_own_commission": ["true"],
        },
    },
    {
        "name": "insureportal-compliance-officer",
        "description": "Compliance officer: manages NAICOM filings, NDPR audits, AML/KYC checks, and regulatory reporting.",
        "attributes": {
            "platform_role": ["compliance_officer"],
            "tier": ["compliance"],
            "can_file_naicom_reports": ["true"],
            "can_run_aml_checks": ["true"],
            "can_run_kyc_checks": ["true"],
            "can_view_audit_trail": ["true"],
            "can_export_compliance_data": ["true"],
            "can_manage_sanctions_list": ["true"],
            "can_freeze_accounts": ["true"],
        },
    },
    {
        "name": "insureportal-reinsurer",
        "description": "Reinsurer: manages treaty administration, cession records, recovery claims, and premium accounting.",
        "attributes": {
            "platform_role": ["reinsurer"],
            "tier": ["reinsurance"],
            "can_manage_treaties": ["true"],
            "can_view_cessions": ["true"],
            "can_submit_recovery_claims": ["true"],
            "can_view_premium_accounting": ["true"],
            "can_manage_quota_share": ["true"],
            "can_manage_excess_of_loss": ["true"],
        },
    },
    {
        "name": "insureportal-policyholder",
        "description": "Policyholder: purchases insurance, pays premiums, files claims, manages beneficiaries, and renews/cancels policies.",
        "attributes": {
            "platform_role": ["policyholder"],
            "tier": ["customer"],
            "can_get_quote": ["true"],
            "can_bind_policy": ["true"],
            "can_pay_premium": ["true"],
            "can_file_claim": ["true"],
            "can_manage_beneficiaries": ["true"],
            "can_request_renewal": ["true"],
            "can_cancel_policy": ["true"],
            "can_request_endorsement": ["true"],
        },
    },
    {
        "name": "insureportal-beneficiary",
        "description": "Beneficiary: views policy details and claim status for policies on which they are named beneficiaries.",
        "attributes": {
            "platform_role": ["beneficiary"],
            "tier": ["customer"],
            "can_view_policy": ["true"],
            "can_view_claim_status": ["true"],
            "can_update_contact_info": ["true"],
        },
    },
    {
        "name": "insureportal-regulator",
        "description": "Regulator (NAICOM/CBN): read-only access to regulatory reports, audit trails, solvency data, and compliance dashboards.",
        "attributes": {
            "platform_role": ["regulator"],
            "tier": ["regulatory"],
            "can_view_regulatory_reports": ["true"],
            "can_view_audit_trail": ["true"],
            "can_view_solvency_data": ["true"],
            "can_view_compliance_dashboard": ["true"],
            "read_only": ["true"],
        },
    },
    # ── Billing / platform roles ──────────────────────────────────────────────
    {
        "name": "insureportal-billing-admin",
        "description": "Billing administrator: manages platform billing ledger, revenue splits, invoicing, and reconciliation.",
        "attributes": {
            "platform_role": ["billing_admin"],
            "tier": ["billing"],
            "can_manage_billing": ["true"],
            "can_record_splits": ["true"],
            "can_run_reconciliation": ["true"],
            "can_view_ledger": ["true"],
        },
    },
    {
        "name": "insureportal-billing-analyst",
        "description": "Billing analyst: read-only access to billing ledger, revenue splits, and reconciliation reports.",
        "attributes": {
            "platform_role": ["billing_analyst"],
            "tier": ["billing"],
            "can_view_ledger": ["true"],
            "can_view_splits": ["true"],
            "can_view_reconciliation": ["true"],
        },
    },
    # ── Legacy / base role ────────────────────────────────────────────────────
    {
        "name": "insureportal-user",
        "description": "Authenticated user: base role assigned to every registered user. Grants access to the platform but no specific insurance domain permissions.",
        "attributes": {
            "platform_role": ["user"],
            "tier": ["base"],
        },
    },
]

# ── Composite role mappings ───────────────────────────────────────────────────
# super-admin inherits all roles
COMPOSITES = {
    "insureportal-super-admin": [r["name"] for r in ROLES if r["name"] != "insureportal-super-admin"],
    "insureportal-admin": [
        "insureportal-user",
        "insureportal-billing-analyst",
    ],
    "insureportal-supervisor": [
        "insureportal-user",
        "insureportal-agent",
    ],
    "insureportal-actuary": [
        "insureportal-user",
    ],
    "insureportal-underwriter": [
        "insureportal-user",
    ],
    "insureportal-claims-adjuster": [
        "insureportal-user",
    ],
    "insureportal-broker": [
        "insureportal-user",
    ],
    "insureportal-agent": [
        "insureportal-user",
    ],
    "insureportal-compliance-officer": [
        "insureportal-user",
    ],
    "insureportal-reinsurer": [
        "insureportal-user",
    ],
    "insureportal-policyholder": [
        "insureportal-user",
    ],
    "insureportal-beneficiary": [
        "insureportal-user",
    ],
    "insureportal-regulator": [
        "insureportal-user",
    ],
    "insureportal-billing-admin": [
        "insureportal-user",
        "insureportal-billing-analyst",
    ],
}

def build_role(role_def: dict) -> dict:
    """Build a Keycloak role object from our definition."""
    name = role_def["name"]
    obj = {
        "id": f"role-{name}",
        "name": name,
        "description": role_def["description"],
        "composite": name in COMPOSITES,
        "clientRole": False,
        "containerId": "insureportal",
        "attributes": role_def.get("attributes", {}),
    }
    if name in COMPOSITES:
        obj["composites"] = {
            "realm": COMPOSITES[name],
            "client": {},
        }
    return obj


def build_realm() -> dict:
    realm_roles = [build_role(r) for r in ROLES]

    realm = {
        "id": "insureportal",
        "realm": "insureportal",
        "displayName": "InsurePortal",
        "displayNameHtml": "<b>InsurePortal</b>",
        "enabled": True,
        "sslRequired": "external",
        "registrationAllowed": False,
        "loginWithEmailAllowed": True,
        "duplicateEmailsAllowed": False,
        "resetPasswordAllowed": True,
        "editUsernameAllowed": False,
        "bruteForceProtected": True,
        "permanentLockout": False,
        "maxFailureWaitSeconds": 900,
        "minimumQuickLoginWaitSeconds": 60,
        "waitIncrementSeconds": 60,
        "quickLoginCheckMilliSeconds": 1000,
        "maxDeltaTimeSeconds": 43200,
        "failureFactor": 5,
        "accessTokenLifespan": 300,
        "accessTokenLifespanForImplicitFlow": 900,
        "ssoSessionIdleTimeout": 1800,
        "ssoSessionMaxLifespan": 36000,
        "offlineSessionIdleTimeout": 2592000,
        "offlineSessionMaxLifespanEnabled": False,
        "accessCodeLifespan": 60,
        "accessCodeLifespanUserAction": 300,
        "accessCodeLifespanLogin": 1800,
        "actionTokenGeneratedByAdminLifespan": 43200,
        "actionTokenGeneratedByUserLifespan": 300,
        "defaultSignatureAlgorithm": "RS256",
        "roles": {
            "realm": realm_roles,
            "client": {},
        },
        "defaultRoles": ["insureportal-user"],
        "clients": [
            {
                "clientId": "insureportal",
                "name": "InsurePortal Application",
                "description": "Main InsurePortal confidential OIDC client",
                "enabled": True,
                "clientAuthenticatorType": "client-secret",
                "secret": "insureportal-secret-change-in-production",
                "redirectUris": [
                    "https://insureportal.io/*",
                    "https://app.insureportal.io/*",
                    "https://admin.insureportal.io/*",
                    "http://localhost:3000/*",
                ],
                "webOrigins": [
                    "https://insureportal.io",
                    "https://app.insureportal.io",
                    "https://admin.insureportal.io",
                    "http://localhost:3000",
                ],
                "publicClient": False,
                "protocol": "openid-connect",
                "standardFlowEnabled": True,
                "implicitFlowEnabled": False,
                "directAccessGrantsEnabled": False,
                "serviceAccountsEnabled": True,
                "authorizationServicesEnabled": True,
                "fullScopeAllowed": True,
                "protocolMappers": [
                    {
                        "name": "realm-roles",
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
                    },
                    {
                        "name": "platform-role",
                        "protocol": "openid-connect",
                        "protocolMapper": "oidc-usermodel-attribute-mapper",
                        "consentRequired": False,
                        "config": {
                            "userinfo.token.claim": "true",
                            "id.token.claim": "true",
                            "access.token.claim": "true",
                            "claim.name": "platform_role",
                            "jsonType.label": "String",
                            "user.attribute": "platform_role",
                        },
                    },
                    {
                        "name": "tenant-id",
                        "protocol": "openid-connect",
                        "protocolMapper": "oidc-usermodel-attribute-mapper",
                        "consentRequired": False,
                        "config": {
                            "userinfo.token.claim": "true",
                            "id.token.claim": "true",
                            "access.token.claim": "true",
                            "claim.name": "tenant_id",
                            "jsonType.label": "String",
                            "user.attribute": "tenant_id",
                        },
                    },
                    {
                        "name": "license-number",
                        "protocol": "openid-connect",
                        "protocolMapper": "oidc-usermodel-attribute-mapper",
                        "consentRequired": False,
                        "config": {
                            "userinfo.token.claim": "true",
                            "id.token.claim": "false",
                            "access.token.claim": "true",
                            "claim.name": "license_number",
                            "jsonType.label": "String",
                            "user.attribute": "license_number",
                        },
                    },
                ],
            },
            {
                "clientId": "insureportal-go-infra",
                "name": "InsurePortal Go Infrastructure Service",
                "description": "Service account for the Go infra sidecar (TigerBeetle, Fluvio, Temporal, Dapr)",
                "enabled": True,
                "clientAuthenticatorType": "client-secret",
                "secret": "go-infra-secret-change-in-production",
                "publicClient": False,
                "protocol": "openid-connect",
                "standardFlowEnabled": False,
                "serviceAccountsEnabled": True,
                "directAccessGrantsEnabled": False,
            },
            {
                "clientId": "insureportal-python-analytics",
                "name": "InsurePortal Python Analytics Service",
                "description": "Service account for the Python analytics service (Lakehouse, Actuarial, IFRS17, Fraud ML)",
                "enabled": True,
                "clientAuthenticatorType": "client-secret",
                "secret": "python-analytics-secret-change-in-production",
                "publicClient": False,
                "protocol": "openid-connect",
                "standardFlowEnabled": False,
                "serviceAccountsEnabled": True,
                "directAccessGrantsEnabled": False,
            },
        ],
        "users": [
            {
                "username": "admin",
                "email": "admin@insureportal.io",
                "enabled": True,
                "emailVerified": True,
                "firstName": "Platform",
                "lastName": "Admin",
                "credentials": [{"type": "password", "value": "Admin@1234!", "temporary": True}],
                "realmRoles": ["insureportal-super-admin", "insureportal-admin", "insureportal-user"],
                "attributes": {"platform_role": ["super_admin"], "tenant_id": ["system"]},
            },
        ],
        "passwordPolicy": "length(12) and upperCase(1) and lowerCase(1) and digits(1) and specialChars(1) and notUsername(undefined)",
        "smtpServer": {},
        "loginTheme": "insureportal",
        "accountTheme": "insureportal",
        "adminTheme": "keycloak",
        "emailTheme": "insureportal",
        "eventsEnabled": True,
        "eventsListeners": ["jboss-logging", "email"],
        "enabledEventTypes": [
            "LOGIN", "LOGIN_ERROR", "LOGOUT", "LOGOUT_ERROR",
            "REGISTER", "REGISTER_ERROR", "TOKEN_EXCHANGE",
            "UPDATE_PASSWORD", "UPDATE_PASSWORD_ERROR",
            "RESET_PASSWORD", "RESET_PASSWORD_ERROR",
        ],
        "adminEventsEnabled": True,
        "adminEventsDetailsEnabled": True,
    }
    return realm


if __name__ == "__main__":
    realm = build_realm()
    out_path = pathlib.Path("infra/keycloak/realm-insureportal.json")
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w") as f:
        json.dump(realm, f, indent=2)
    print(f"✅ Wrote {out_path} with {len(realm['roles']['realm'])} realm roles")
    print("\nRoles written:")
    for r in realm["roles"]["realm"]:
        composite_str = f" [composite → {len(r.get('composites', {}).get('realm', []))} roles]" if r["composite"] else ""
        print(f"  {r['name']}{composite_str}")
        print(f"    {r['description'][:80]}")
