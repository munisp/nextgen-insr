#!/usr/bin/env python3
"""
Append all 16 insurance role navigation entries to roleNavConfig.ts.
Reads the existing file, checks which roles are missing, and appends them.
"""
import re, os

path = "/home/ubuntu/nextgen-insr/client/src/lib/roleNavConfig.ts"
with open(path) as f:
    content = f.read()

# Check which roles are already defined
existing_roles = set(re.findall(r'"([a-z\-]+)":\s*\{', content))
print(f"Existing roles: {existing_roles}")

# New insurance roles to add
new_roles = {
    "underwriter": {
        "label": "Underwriter",
        "home": "/underwriter-dashboard",
        "color": "var(--role-underwriter)",
        "icon": "Shield",
        "tabs": [
            {"label": "Dashboard", "href": "/underwriter-dashboard", "icon": "LayoutDashboard"},
            {"label": "Queue", "href": "/underwriting-queue", "icon": "ClipboardList"},
            {"label": "Products", "href": "/insurance-products", "icon": "Package"},
            {"label": "Reports", "href": "/underwriting-reports", "icon": "BarChart2"},
        ],
        "sidebar": [
            {"group": "Underwriting", "items": [
                {"label": "Application Queue", "href": "/underwriting-queue", "icon": "ClipboardList"},
                {"label": "Risk Assessment", "href": "/risk-assessment", "icon": "Shield"},
                {"label": "Policy Approval", "href": "/policy-approval", "icon": "CheckCircle"},
                {"label": "Referral Management", "href": "/referral-management", "icon": "GitBranch"},
            ]},
            {"group": "Products", "items": [
                {"label": "Insurance Products", "href": "/insurance-products", "icon": "Package"},
                {"label": "Product Configuration", "href": "/product-configuration", "icon": "Settings"},
                {"label": "Pricing Rules", "href": "/pricing-rules", "icon": "DollarSign"},
            ]},
            {"group": "Reports", "items": [
                {"label": "Underwriting Reports", "href": "/underwriting-reports", "icon": "BarChart2"},
                {"label": "Loss Ratio Analysis", "href": "/loss-ratio", "icon": "TrendingDown"},
            ]},
        ],
    },
    "actuary": {
        "label": "Actuary",
        "home": "/actuary-dashboard",
        "color": "var(--role-actuary)",
        "icon": "BookOpen",
        "tabs": [
            {"label": "Dashboard", "href": "/actuary-dashboard", "icon": "LayoutDashboard"},
            {"label": "IFRS17", "href": "/ifrs17-dashboard", "icon": "BookOpen"},
            {"label": "Pricing", "href": "/pricing-models", "icon": "TrendingUp"},
            {"label": "Reserves", "href": "/reserve-calculations", "icon": "Activity"},
        ],
        "sidebar": [
            {"group": "Reserving", "items": [
                {"label": "IFRS 17 Dashboard", "href": "/ifrs17-dashboard", "icon": "BookOpen"},
                {"label": "Reserve Calculations", "href": "/reserve-calculations", "icon": "Activity"},
                {"label": "Mortality Tables", "href": "/mortality-tables", "icon": "Users"},
                {"label": "Morbidity Rates", "href": "/morbidity-rates", "icon": "Heart"},
            ]},
            {"group": "Pricing", "items": [
                {"label": "Pricing Models", "href": "/pricing-models", "icon": "TrendingUp"},
                {"label": "Rate Filing", "href": "/rate-filing", "icon": "FileText"},
            ]},
            {"group": "Analytics", "items": [
                {"label": "Actuarial Reports", "href": "/actuarial-reports", "icon": "BarChart2"},
                {"label": "Lakehouse Analytics", "href": "/lakehouse-analytics", "icon": "Database"},
            ]},
        ],
    },
    "claims-adjuster": {
        "label": "Claims Adjuster",
        "home": "/claims-dashboard",
        "color": "var(--role-claims-adjuster)",
        "icon": "ClipboardList",
        "tabs": [
            {"label": "Dashboard", "href": "/claims-dashboard", "icon": "LayoutDashboard"},
            {"label": "My Claims", "href": "/claims-management", "icon": "ClipboardList"},
            {"label": "FNOL", "href": "/fnol-submission", "icon": "Plus"},
            {"label": "Settlement", "href": "/claims-settlement", "icon": "CheckCircle"},
        ],
        "sidebar": [
            {"group": "Claims", "items": [
                {"label": "Claims Queue", "href": "/claims-management", "icon": "ClipboardList"},
                {"label": "FNOL Submission", "href": "/fnol-submission", "icon": "Plus"},
                {"label": "Investigation", "href": "/claims-investigation", "icon": "Search"},
                {"label": "Settlement", "href": "/claims-settlement", "icon": "CheckCircle"},
                {"label": "Fraud Flags", "href": "/fraud-flags", "icon": "AlertTriangle"},
            ]},
            {"group": "Reports", "items": [
                {"label": "Claims Reports", "href": "/claims-reports", "icon": "BarChart2"},
                {"label": "Settlement History", "href": "/settlement-history", "icon": "History"},
            ]},
        ],
    },
    "broker": {
        "label": "Broker",
        "home": "/broker-dashboard",
        "color": "var(--role-broker)",
        "icon": "Briefcase",
        "tabs": [
            {"label": "Dashboard", "href": "/broker-dashboard", "icon": "LayoutDashboard"},
            {"label": "Clients", "href": "/client-portfolio", "icon": "Users"},
            {"label": "Quotes", "href": "/quote-engine", "icon": "FileText"},
            {"label": "Commission", "href": "/commission-management", "icon": "DollarSign"},
        ],
        "sidebar": [
            {"group": "Business", "items": [
                {"label": "Client Portfolio", "href": "/client-portfolio", "icon": "Users"},
                {"label": "Quote Engine", "href": "/quote-engine", "icon": "FileText"},
                {"label": "Policy Submissions", "href": "/policy-submissions", "icon": "Send"},
                {"label": "Renewals", "href": "/renewals-management", "icon": "RefreshCw"},
            ]},
            {"group": "Finance", "items": [
                {"label": "Commission Management", "href": "/commission-management", "icon": "DollarSign"},
                {"label": "Premium Collection", "href": "/premium-collection", "icon": "CreditCard"},
            ]},
        ],
    },
    "policyholder": {
        "label": "My Insurance",
        "home": "/policyholder-dashboard",
        "color": "var(--role-policyholder)",
        "icon": "Home",
        "tabs": [
            {"label": "Home", "href": "/policyholder-dashboard", "icon": "Home"},
            {"label": "Policies", "href": "/my-policies", "icon": "Shield"},
            {"label": "Claims", "href": "/my-claims", "icon": "ClipboardList"},
            {"label": "Pay", "href": "/premium-payment", "icon": "CreditCard"},
        ],
        "sidebar": [
            {"group": "My Insurance", "items": [
                {"label": "My Policies", "href": "/my-policies", "icon": "Shield"},
                {"label": "My Claims", "href": "/my-claims", "icon": "ClipboardList"},
                {"label": "Premium Payment", "href": "/premium-payment", "icon": "CreditCard"},
                {"label": "My Documents", "href": "/my-documents", "icon": "FileText"},
                {"label": "My Beneficiaries", "href": "/my-beneficiaries", "icon": "Users"},
            ]},
            {"group": "Support", "items": [
                {"label": "File a Claim", "href": "/fnol-submission", "icon": "Plus"},
                {"label": "Get a Quote", "href": "/quote-engine", "icon": "FileText"},
                {"label": "Contact Us", "href": "/support", "icon": "MessageCircle"},
            ]},
        ],
    },
    "compliance-officer": {
        "label": "Compliance",
        "home": "/compliance-dashboard",
        "color": "var(--role-compliance-officer)",
        "icon": "Scale",
        "tabs": [
            {"label": "Dashboard", "href": "/compliance-dashboard", "icon": "LayoutDashboard"},
            {"label": "AML/KYC", "href": "/aml-kyc-management", "icon": "Shield"},
            {"label": "Regulatory", "href": "/regulatory-filings", "icon": "BookOpen"},
            {"label": "Audit", "href": "/audit-trail", "icon": "ClipboardList"},
        ],
        "sidebar": [
            {"group": "Compliance", "items": [
                {"label": "AML/KYC Management", "href": "/aml-kyc-management", "icon": "Shield"},
                {"label": "Sanctions Screening", "href": "/sanctions-screening", "icon": "AlertTriangle"},
                {"label": "PEP Monitoring", "href": "/pep-monitoring", "icon": "Users"},
                {"label": "Account Freeze", "href": "/account-freeze", "icon": "Lock"},
            ]},
            {"group": "Regulatory", "items": [
                {"label": "NAICOM Filings", "href": "/naicom-filings", "icon": "FileText"},
                {"label": "CBN Reports", "href": "/cbn-reports", "icon": "Landmark"},
                {"label": "NDIC Reports", "href": "/ndic-reports", "icon": "FileText"},
                {"label": "Audit Trail", "href": "/audit-trail", "icon": "ClipboardList"},
            ]},
        ],
    },
    "regulator": {
        "label": "Regulator",
        "home": "/regulator-dashboard",
        "color": "var(--role-regulator)",
        "icon": "Landmark",
        "tabs": [
            {"label": "Dashboard", "href": "/regulator-dashboard", "icon": "LayoutDashboard"},
            {"label": "Market", "href": "/market-overview", "icon": "TrendingUp"},
            {"label": "Solvency", "href": "/solvency-monitoring", "icon": "Shield"},
            {"label": "Reports", "href": "/regulatory-reports", "icon": "BarChart2"},
        ],
        "sidebar": [
            {"group": "Market Oversight", "items": [
                {"label": "Market Overview", "href": "/market-overview", "icon": "TrendingUp"},
                {"label": "Solvency Monitoring", "href": "/solvency-monitoring", "icon": "Shield"},
                {"label": "Market Conduct", "href": "/market-conduct", "icon": "Scale"},
            ]},
            {"group": "Reports", "items": [
                {"label": "Regulatory Reports", "href": "/regulatory-reports", "icon": "BarChart2"},
                {"label": "Statistical Returns", "href": "/statistical-returns", "icon": "Database"},
            ]},
        ],
    },
    "reinsurer": {
        "label": "Reinsurance",
        "home": "/reinsurer-dashboard",
        "color": "var(--role-reinsurer)",
        "icon": "Scale",
        "tabs": [
            {"label": "Dashboard", "href": "/reinsurer-dashboard", "icon": "LayoutDashboard"},
            {"label": "Treaties", "href": "/reinsurance-treaties", "icon": "FileText"},
            {"label": "Claims", "href": "/ri-claims", "icon": "ClipboardList"},
            {"label": "Premiums", "href": "/reinsurance-premiums", "icon": "DollarSign"},
        ],
        "sidebar": [
            {"group": "Reinsurance", "items": [
                {"label": "Treaty Management", "href": "/reinsurance-treaties", "icon": "FileText"},
                {"label": "Facultative RI", "href": "/facultative-ri", "icon": "Shield"},
                {"label": "RI Claims", "href": "/ri-claims", "icon": "ClipboardList"},
                {"label": "Premium Accounting", "href": "/reinsurance-premiums", "icon": "DollarSign"},
            ]},
            {"group": "Analytics", "items": [
                {"label": "Cession Reports", "href": "/cession-reports", "icon": "BarChart2"},
                {"label": "Net Retention", "href": "/net-retention", "icon": "TrendingDown"},
            ]},
        ],
    },
    "billing-admin": {
        "label": "Billing Admin",
        "home": "/billing-admin-dashboard",
        "color": "var(--role-billing-admin)",
        "icon": "Receipt",
        "tabs": [
            {"label": "Dashboard", "href": "/billing-admin-dashboard", "icon": "LayoutDashboard"},
            {"label": "Ledger", "href": "/billing-ledger", "icon": "Receipt"},
            {"label": "Reconcile", "href": "/reconciliation", "icon": "Activity"},
            {"label": "Revenue", "href": "/revenue-analytics", "icon": "TrendingUp"},
        ],
        "sidebar": [
            {"group": "Billing", "items": [
                {"label": "Platform Ledger", "href": "/billing-ledger", "icon": "Receipt"},
                {"label": "Revenue Analytics", "href": "/revenue-analytics", "icon": "TrendingUp"},
                {"label": "Tenant Payouts", "href": "/tenant-payouts", "icon": "DollarSign"},
                {"label": "Reconciliation", "href": "/reconciliation", "icon": "Activity"},
            ]},
            {"group": "Reports", "items": [
                {"label": "Billing Reports", "href": "/billing-reports", "icon": "BarChart2"},
                {"label": "Revenue Splits", "href": "/revenue-splits", "icon": "PieChart"},
            ]},
        ],
    },
    "beneficiary": {
        "label": "Beneficiary",
        "home": "/beneficiary-dashboard",
        "color": "var(--role-beneficiary)",
        "icon": "Heart",
        "tabs": [
            {"label": "Home", "href": "/beneficiary-dashboard", "icon": "Home"},
            {"label": "Policies", "href": "/my-policies", "icon": "Shield"},
            {"label": "Claims", "href": "/my-claims", "icon": "ClipboardList"},
            {"label": "Documents", "href": "/my-documents", "icon": "FileText"},
        ],
        "sidebar": [
            {"group": "My Coverage", "items": [
                {"label": "My Policies", "href": "/my-policies", "icon": "Shield"},
                {"label": "My Claims", "href": "/my-claims", "icon": "ClipboardList"},
                {"label": "My Documents", "href": "/my-documents", "icon": "FileText"},
            ]},
        ],
    },
}

# Generate TypeScript entries for missing roles
missing = {k: v for k, v in new_roles.items() if k not in existing_roles}
print(f"Missing roles to add: {list(missing.keys())}")

if not missing:
    print("All roles already present — no changes needed.")
else:
    # Find the closing of the roleNavConfig object
    # Append before the last closing brace/bracket of the export
    ts_entries = []
    for role_key, cfg in missing.items():
        tabs_ts = ",\n    ".join(
            f'{{ label: "{t["label"]}", href: "{t["href"]}", icon: "{t["icon"]}" }}'
            for t in cfg["tabs"]
        )
        sidebar_ts_parts = []
        for grp in cfg["sidebar"]:
            items_ts = ",\n        ".join(
                f'{{ label: "{i["label"]}", href: "{i["href"]}", icon: "{i["icon"]}" }}'
                for i in grp["items"]
            )
            sidebar_ts_parts.append(
                f'    {{\n      group: "{grp["group"]}",\n      items: [\n        {items_ts}\n      ]\n    }}'
            )
        sidebar_ts = ",\n  ".join(sidebar_ts_parts)

        ts_entries.append(f'''  "{role_key}": {{
    label: "{cfg["label"]}",
    home: "{cfg["home"]}",
    color: "{cfg["color"]}",
    icon: "{cfg["icon"]}",
    tabs: [
    {tabs_ts}
    ],
    sidebar: [
  {sidebar_ts}
    ],
  }},''')

    # Find the last closing brace of the config object and insert before it
    # Pattern: find "} as const;" or "} satisfies" or the last "}" of the export
    insertion_block = "\n".join(ts_entries)

    # Try to find the end of the roleNavConfig object
    patterns = ["} as const", "} satisfies", "export default roleNavConfig"]
    inserted = False
    for pat in patterns:
        if pat in content:
            content = content.replace(pat, insertion_block + "\n" + pat, 1)
            inserted = True
            break

    if not inserted:
        # Fallback: append before the last closing brace
        last_brace = content.rfind("};")
        if last_brace != -1:
            content = content[:last_brace] + insertion_block + "\n};"
        else:
            content += "\n" + insertion_block

    with open(path, "w") as f:
        f.write(content)

    print(f"✓ Added {len(missing)} new roles to roleNavConfig.ts")
