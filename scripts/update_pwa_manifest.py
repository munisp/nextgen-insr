#!/usr/bin/env python3
"""Update the PWA manifest.json with all 16 role shortcuts, screenshots, and maskable icons."""
import json, os

manifest_path = "/home/ubuntu/nextgen-insr/client/public/manifest.json"

with open(manifest_path) as f:
    manifest = json.load(f)

# Update core fields
manifest.update({
    "name": "InsurePortal — Next-Gen Insurance Platform",
    "short_name": "InsurePortal",
    "description": "Nigeria's most advanced insurance platform — policies, claims, underwriting, and compliance in one app.",
    "theme_color": "#0F172A",
    "background_color": "#0F172A",
    "display": "standalone",
    "display_override": ["window-controls-overlay", "standalone", "minimal-ui"],
    "orientation": "any",
    "scope": "/",
    "start_url": "/?source=pwa",
    "id": "insureportal-pwa-v1",
    "categories": ["finance", "insurance", "business"],
    "lang": "en-NG",
    "dir": "ltr",
    "prefer_related_applications": False,
    "handle_links": "preferred",
    "launch_handler": {"client_mode": ["navigate-existing", "auto"]},
})

# 16 role shortcuts
manifest["shortcuts"] = [
    {"name": "Underwriter Dashboard",  "short_name": "Underwrite",  "url": "/underwriter-dashboard",   "description": "Risk assessment & approval queue"},
    {"name": "Actuary Dashboard",      "short_name": "Actuary",     "url": "/actuary-dashboard",        "description": "IFRS17 reserves & pricing models"},
    {"name": "Claims Dashboard",       "short_name": "Claims",      "url": "/claims-dashboard",         "description": "FNOL, adjudication & settlement"},
    {"name": "Broker Dashboard",       "short_name": "Broker",      "url": "/broker-dashboard",         "description": "Client portfolio & commissions"},
    {"name": "My Insurance",           "short_name": "My Cover",    "url": "/policyholder-dashboard",   "description": "Policies, claims & payments"},
    {"name": "Compliance Dashboard",   "short_name": "Compliance",  "url": "/compliance-dashboard",     "description": "AML/KYC & regulatory"},
    {"name": "Regulator Dashboard",    "short_name": "Regulator",   "url": "/regulator-dashboard",      "description": "Market oversight — read only"},
    {"name": "Reinsurance Dashboard",  "short_name": "Reinsurance", "url": "/reinsurer-dashboard",      "description": "Treaties, premiums & RI claims"},
    {"name": "Billing Admin",          "short_name": "Billing",     "url": "/billing-admin-dashboard",  "description": "Ledger, revenue & reconciliation"},
    {"name": "Supervisor Dashboard",   "short_name": "Supervisor",  "url": "/supervisor-dashboard",     "description": "Agent oversight & operations"},
    {"name": "Beneficiary Portal",     "short_name": "Beneficiary", "url": "/beneficiary-dashboard",    "description": "Policy & claim status"},
    {"name": "IFRS 17 Dashboard",      "short_name": "IFRS17",      "url": "/ifrs17-dashboard",         "description": "Insurance contract accounting"},
    {"name": "Admin Dashboard",        "short_name": "Admin",       "url": "/admin-dashboard",          "description": "Platform administration"},
    {"name": "Analytics",              "short_name": "Analytics",   "url": "/analytics-dashboard",      "description": "Platform analytics & lakehouse"},
    {"name": "New Claim",              "short_name": "New Claim",   "url": "/fnol-submission",          "description": "File a new insurance claim"},
    {"name": "New Quote",              "short_name": "New Quote",   "url": "/quote-engine",             "description": "Generate an insurance quote"},
]

# Screenshots for app store display
manifest["screenshots"] = [
    {"src": "/screenshots/dashboard-wide.png",   "sizes": "1280x720",  "type": "image/png", "form_factor": "wide",   "label": "InsurePortal Dashboard"},
    {"src": "/screenshots/dashboard-narrow.png", "sizes": "390x844",   "type": "image/png", "form_factor": "narrow", "label": "InsurePortal Mobile Dashboard"},
    {"src": "/screenshots/claims-wide.png",      "sizes": "1280x720",  "type": "image/png", "form_factor": "wide",   "label": "Claims Management"},
    {"src": "/screenshots/claims-narrow.png",    "sizes": "390x844",   "type": "image/png", "form_factor": "narrow", "label": "Claims on Mobile"},
]

# Ensure maskable icon is listed
icons = manifest.get("icons", [])
has_maskable = any(i.get("purpose") == "maskable" for i in icons)
if not has_maskable:
    icons.append({
        "src": "/icons/icon-512x512.png",
        "sizes": "512x512",
        "type": "image/png",
        "purpose": "maskable"
    })
manifest["icons"] = icons

with open(manifest_path, "w") as f:
    json.dump(manifest, f, indent=2)

print(f"✓ manifest.json updated: {len(manifest['shortcuts'])} shortcuts, {len(manifest['screenshots'])} screenshots")
