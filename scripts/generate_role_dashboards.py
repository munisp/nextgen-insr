#!/usr/bin/env python3
"""Generate all 12 remaining role-specific insurance dashboard pages."""

import os

PAGES_DIR = "/home/ubuntu/nextgen-insr/client/src/pages"

DASHBOARDS = [
    {
        "name": "ActuaryDashboard",
        "file": "ActuaryDashboard.tsx",
        "title": "Actuarial Dashboard",
        "subtitle": "Reserves, IFRS17 & Pricing Models",
        "role_var": "--role-actuary",
        "icon": "TrendingUp",
        "trpc_proc": "getActuaryKpi",
        "kpis": [
            ("IFRS17 BEL (₦M)",       "ifrs17Bel",         "TrendingUp",    "up",   "↑ 3.2%",    "neutral",  "--role-actuary"),
            ("Risk Adjustment (₦M)",   "riskAdjustment",    "Shield",        "flat", "stable",    "neutral",  "--role-actuary"),
            ("CSM Balance (₦M)",       "csmBalance",        "DollarSign",    "up",   "↑ 1.8%",    "good",     "--risk-low"),
            ("Mortality Rate",         "mortalityRate",     "HeartPulse",    "down", "↓ 0.3%",    "good",     "--risk-low"),
            ("Loss Ratio",             "lossRatio",         "BarChart2",     "down", "↓ 2.1%",    "good",     "--risk-low"),
            ("Expense Ratio",          "expenseRatio",      "Receipt",       "flat", "stable",    "neutral",  "--insurance-primary"),
            ("Combined Ratio",         "combinedRatio",     "Activity",      "down", "↓ 1.5%",    "good",     "--risk-low"),
            ("Reserve Adequacy %",     "reserveAdequacy",   "CheckCircle",   "up",   "↑ 0.9%",    "good",     "--risk-low"),
        ],
        "actions": [
            ("Reserve Calcs",   "TrendingUp",   "/reserve-calculations",  "--role-actuary"),
            ("IFRS17 Dashboard","BookOpen",     "/ifrs17-dashboard",       "--insurance-primary"),
            ("Pricing Models",  "Activity",     "/actuarial-models",       "--risk-low"),
            ("Reports",         "BarChart2",    "/actuarial-reports",      "--text-secondary"),
        ],
    },
    {
        "name": "ClaimsDashboard",
        "file": "ClaimsDashboard.tsx",
        "title": "Claims Dashboard",
        "subtitle": "FNOL, Adjudication & Settlement",
        "role_var": "--role-claims-adjuster",
        "icon": "ClipboardList",
        "trpc_proc": "getClaimsKpi",
        "kpis": [
            ("Open Claims",          "openClaims",          "ClipboardList", "up",   "+5 today",  "warning",  "--risk-medium"),
            ("FNOL Today",           "fnolToday",           "PlusCircle",    "up",   "+8",        "neutral",  "--role-claims-adjuster"),
            ("Avg. Settlement Days", "avgSettlementDays",   "Clock",         "down", "↓ 1.2d",   "good",     "--risk-low"),
            ("Settled Today",        "settledToday",        "CheckCircle",   "up",   "↑ 12%",    "good",     "--risk-low"),
            ("Fraud Flags",          "fraudFlags",          "AlertTriangle", "up",   "+2",        "critical", "--risk-critical"),
            ("Disputed Claims",      "disputedClaims",      "Scale",         "flat", "stable",   "warning",  "--risk-medium"),
            ("Total Paid (MTD ₦M)",  "totalPaidMtd",        "DollarSign",    "up",   "↑ 9%",     "neutral",  "--insurance-primary"),
            ("SLA Breach Rate",      "slaBreachRate",       "Activity",      "down", "↓ 0.8%",   "good",     "--risk-low"),
        ],
        "actions": [
            ("New FNOL",        "PlusCircle",   "/fnol-submission",        "--role-claims-adjuster"),
            ("Claims Queue",    "ClipboardList","/claims-management",      "--insurance-primary"),
            ("Fraud Cases",     "AlertTriangle","/fraud-case-management",  "--risk-critical"),
            ("Settlements",     "CheckCircle",  "/claims-settlement",      "--risk-low"),
        ],
    },
    {
        "name": "BrokerDashboard",
        "file": "BrokerDashboard.tsx",
        "title": "Broker Dashboard",
        "subtitle": "Client Portfolio & Commissions",
        "role_var": "--role-broker",
        "icon": "Users",
        "trpc_proc": "getBrokerKpi",
        "kpis": [
            ("Active Clients",       "activeClients",       "Users",         "up",   "+3 this wk","neutral",  "--role-broker"),
            ("Policies Written",     "policiesWritten",     "FileText",      "up",   "↑ 18%",    "good",     "--risk-low"),
            ("Renewal Rate",         "renewalRate",         "RefreshCw",     "up",   "↑ 2.3%",   "good",     "--risk-low"),
            ("Commission (MTD ₦)",   "commissionMtd",       "DollarSign",    "up",   "↑ 11%",    "good",     "--risk-low"),
            ("Pending Quotes",       "pendingQuotes",       "Clock",         "flat", "stable",   "neutral",  "--insurance-primary"),
            ("Lapsed Policies",      "lapsedPolicies",      "XCircle",       "up",   "+2",        "warning",  "--risk-medium"),
            ("GWP (MTD ₦M)",         "gwpMtd",              "TrendingUp",    "up",   "↑ 14%",    "good",     "--risk-low"),
            ("Avg. Premium (₦)",     "avgPremium",          "BarChart2",     "flat", "stable",   "neutral",  "--role-broker"),
        ],
        "actions": [
            ("New Quote",       "PlusCircle",   "/quote-engine",           "--role-broker"),
            ("Client List",     "Users",        "/client-portfolio",       "--insurance-primary"),
            ("Commissions",     "DollarSign",   "/commission-management",  "--risk-low"),
            ("Renewals",        "RefreshCw",    "/policy-renewals",        "--text-secondary"),
        ],
    },
    {
        "name": "PolicyholderDashboard",
        "file": "PolicyholderDashboard.tsx",
        "title": "My Insurance",
        "subtitle": "Policies, Claims & Payments",
        "role_var": "--role-policyholder",
        "icon": "Home",
        "trpc_proc": "getPolicyholderKpi",
        "kpis": [
            ("Active Policies",      "activePolicies",      "FileText",      "flat", "stable",   "good",     "--risk-low"),
            ("Open Claims",          "openClaims",          "ClipboardList", "flat", "stable",   "neutral",  "--role-policyholder"),
            ("Next Premium Due",     "nextPremiumDue",      "Calendar",      None,   None,        "warning",  "--risk-medium"),
            ("Total Coverage (₦M)",  "totalCoverage",       "Shield",        "flat", "stable",   "neutral",  "--insurance-primary"),
            ("Upcoming Renewals",    "upcomingRenewals",    "RefreshCw",     "up",   "+1",        "warning",  "--risk-medium"),
            ("Paid Premiums (YTD ₦)","paidPremiumsYtd",    "DollarSign",    "up",   "↑ 8%",     "neutral",  "--role-policyholder"),
            ("Claim Paid (YTD ₦)",   "claimPaidYtd",        "CheckCircle",   "flat", "stable",   "neutral",  "--risk-low"),
            ("Loyalty Points",       "loyaltyPoints",       "Star",          "up",   "+120",      "good",     "--risk-low"),
        ],
        "actions": [
            ("File a Claim",    "PlusCircle",   "/my-claims",              "--role-policyholder"),
            ("Pay Premium",     "DollarSign",   "/premium-payment",        "--insurance-primary"),
            ("My Policies",     "FileText",     "/my-policies",            "--risk-low"),
            ("Documents",       "BookOpen",     "/my-documents",           "--text-secondary"),
        ],
    },
    {
        "name": "ComplianceDashboard",
        "file": "ComplianceDashboard.tsx",
        "title": "Compliance Dashboard",
        "subtitle": "AML/KYC, Audit & Regulatory",
        "role_var": "--role-compliance-officer",
        "icon": "Shield",
        "trpc_proc": "getComplianceKpi",
        "kpis": [
            ("Open AML Alerts",      "openAmlAlerts",       "AlertTriangle", "up",   "+4",        "critical", "--risk-critical"),
            ("KYC Pending",          "kycPending",          "UserCheck",     "down", "↓ 6",       "warning",  "--risk-medium"),
            ("SAR Filed (MTD)",      "sarFiledMtd",         "FileText",      "flat", "stable",   "neutral",  "--role-compliance-officer"),
            ("Sanctions Hits",       "sanctionsHits",       "XCircle",       "flat", "0 new",    "good",     "--risk-low"),
            ("Policy Violations",    "policyViolations",    "Shield",        "down", "↓ 2",       "good",     "--risk-low"),
            ("Audit Items Open",     "auditItemsOpen",      "ClipboardList", "up",   "+7",        "warning",  "--risk-medium"),
            ("Training Compliance%", "trainingCompliance",  "GraduationCap", "up",   "↑ 3%",     "good",     "--risk-low"),
            ("Regulatory Filings",   "regulatoryFilings",   "BookOpen",      "flat", "on track",  "neutral",  "--insurance-primary"),
        ],
        "actions": [
            ("AML/KYC",         "Shield",       "/aml-kyc-management",     "--role-compliance-officer"),
            ("Audit Trail",     "BookOpen",     "/audit-trail",            "--insurance-primary"),
            ("Compliance Rpts", "BarChart2",    "/compliance-reporting",   "--risk-low"),
            ("Alerts",          "AlertTriangle","/compliance-alerts",      "--risk-critical"),
        ],
    },
    {
        "name": "RegulatorDashboard",
        "file": "RegulatorDashboard.tsx",
        "title": "Regulatory Dashboard",
        "subtitle": "NAICOM/CBN Oversight — Read Only",
        "role_var": "--role-regulator",
        "icon": "Landmark",
        "trpc_proc": "getRegulatorKpi",
        "kpis": [
            ("Licensed Insurers",    "licensedInsurers",    "Building2",     "flat", "stable",   "neutral",  "--role-regulator"),
            ("Solvency Ratio Avg%",  "solvencyRatioAvg",    "TrendingUp",    "up",   "↑ 1.2%",   "good",     "--risk-low"),
            ("Complaints (MTD)",     "complaintsMtd",       "AlertTriangle", "down", "↓ 8%",     "good",     "--risk-low"),
            ("Pending Filings",      "pendingFilings",      "FileText",      "up",   "+3",        "warning",  "--risk-medium"),
            ("Market GWP (₦B)",      "marketGwp",           "DollarSign",    "up",   "↑ 6.4%",   "neutral",  "--insurance-primary"),
            ("Claims Ratio Avg%",    "claimsRatioAvg",      "BarChart2",     "down", "↓ 1.1%",   "good",     "--risk-low"),
            ("Enforcement Actions",  "enforcementActions",  "Scale",         "flat", "stable",   "neutral",  "--role-regulator"),
            ("Market Concentration", "marketConcentration", "Activity",      "flat", "stable",   "neutral",  "--role-regulator"),
        ],
        "actions": [
            ("Market Reports",  "BarChart2",    "/regulatory-reports",     "--role-regulator"),
            ("Solvency Data",   "TrendingUp",   "/solvency-reporting",     "--insurance-primary"),
            ("Audit Access",    "BookOpen",     "/regulatory-audit",       "--risk-low"),
            ("Search",          "Search",       "/regulatory-search",      "--text-secondary"),
        ],
    },
    {
        "name": "ReinsurerDashboard",
        "file": "ReinsurerDashboard.tsx",
        "title": "Reinsurance Dashboard",
        "subtitle": "Treaties, Premiums & Claims",
        "role_var": "--role-reinsurer",
        "icon": "Scale",
        "trpc_proc": "getReinsurerKpi",
        "kpis": [
            ("Active Treaties",      "activeTreaties",      "Scale",         "flat", "stable",   "neutral",  "--role-reinsurer"),
            ("Ceded Premium (MTD ₦M)","cedingPremiumMtd",   "DollarSign",    "up",   "↑ 7%",     "neutral",  "--insurance-primary"),
            ("Recoveries (MTD ₦M)",  "recoveriesMtd",       "TrendingUp",    "up",   "↑ 4%",     "good",     "--risk-low"),
            ("Open RI Claims",       "openRiClaims",        "ClipboardList", "flat", "stable",   "neutral",  "--role-reinsurer"),
            ("Treaty Utilization%",  "treatyUtilization",   "Activity",      "up",   "↑ 2.1%",   "neutral",  "--role-reinsurer"),
            ("Net Retention (₦M)",   "netRetention",        "Shield",        "flat", "stable",   "neutral",  "--insurance-primary"),
            ("Loss Ratio (RI)",      "lossRatioRi",         "BarChart2",     "down", "↓ 1.8%",   "good",     "--risk-low"),
            ("Pending Settlements",  "pendingSettlements",  "Clock",         "flat", "stable",   "warning",  "--risk-medium"),
        ],
        "actions": [
            ("Treaties",        "Scale",        "/reinsurance-treaties",   "--role-reinsurer"),
            ("RI Claims",       "ClipboardList","/reinsurance-claims",     "--insurance-primary"),
            ("Premiums",        "DollarSign",   "/reinsurance-premiums",   "--risk-low"),
            ("RI Reports",      "BarChart2",    "/reinsurance-reports",    "--text-secondary"),
        ],
    },
    {
        "name": "BillingAdminDashboard",
        "file": "BillingAdminDashboard.tsx",
        "title": "Billing Admin Dashboard",
        "subtitle": "Ledger, Revenue & Reconciliation",
        "role_var": "--role-billing-admin",
        "icon": "Receipt",
        "trpc_proc": "getBillingAdminKpi",
        "kpis": [
            ("Revenue (MTD ₦M)",     "revenueMtd",          "TrendingUp",    "up",   "↑ 11%",    "good",     "--risk-low"),
            ("Unreconciled Items",   "unreconciledItems",   "AlertTriangle", "down", "↓ 4",       "good",     "--risk-low"),
            ("Platform Fees (MTD ₦)","platformFeesMtd",     "DollarSign",    "up",   "↑ 9%",     "neutral",  "--role-billing-admin"),
            ("Tenant Payouts (₦M)",  "tenantPayoutsMtd",    "Receipt",       "up",   "↑ 13%",    "neutral",  "--insurance-primary"),
            ("Failed Transactions",  "failedTransactions",  "XCircle",       "down", "↓ 2",       "good",     "--risk-low"),
            ("Disputes Open",        "disputesOpen",        "Scale",         "flat", "stable",   "warning",  "--risk-medium"),
            ("Chargeback Rate%",     "chargebackRate",      "Activity",      "down", "↓ 0.2%",   "good",     "--risk-low"),
            ("Reconciliation Rate%", "reconciliationRate",  "CheckCircle",   "up",   "↑ 0.5%",   "good",     "--risk-low"),
        ],
        "actions": [
            ("Ledger",          "Receipt",      "/billing-ledger",         "--role-billing-admin"),
            ("Reconcile",       "RefreshCw",    "/reconciliation",         "--insurance-primary"),
            ("Revenue",         "TrendingUp",   "/revenue-analytics",      "--risk-low"),
            ("Settings",        "Settings",     "/billing-settings",       "--text-secondary"),
        ],
    },
    {
        "name": "SupervisorDashboard",
        "file": "SupervisorDashboard.tsx",
        "title": "Supervisor Dashboard",
        "subtitle": "Agent Oversight & Operations",
        "role_var": "--role-supervisor",
        "icon": "Activity",
        "trpc_proc": "getSupervisorKpi",
        "kpis": [
            ("Active Agents",        "activeAgents",        "Users",         "flat", "stable",   "neutral",  "--role-supervisor"),
            ("Transactions Today",   "transactionsToday",   "ArrowRightLeft","up",   "↑ 8%",     "good",     "--risk-low"),
            ("Float Utilization%",   "floatUtilization",    "Wallet",        "up",   "↑ 3%",     "neutral",  "--insurance-primary"),
            ("SLA Breaches",         "slaBreaches",         "AlertTriangle", "down", "↓ 1",       "good",     "--risk-low"),
            ("Pending Approvals",    "pendingApprovals",    "Clock",         "up",   "+6",        "warning",  "--risk-medium"),
            ("Revenue (Today ₦)",    "revenueToday",        "DollarSign",    "up",   "↑ 12%",    "good",     "--risk-low"),
            ("Escalations Open",     "escalationsOpen",     "AlertTriangle", "flat", "stable",   "warning",  "--risk-medium"),
            ("Agent Performance%",   "agentPerformance",    "TrendingUp",    "up",   "↑ 2.1%",   "good",     "--risk-low"),
        ],
        "actions": [
            ("Agent Mgmt",      "Users",        "/agent-management",       "--role-supervisor"),
            ("Float Mgmt",      "Wallet",       "/float-management",       "--insurance-primary"),
            ("SLA Monitor",     "Activity",     "/sla-monitoring",         "--risk-medium"),
            ("Reports",         "BarChart2",    "/analytics-dashboard",    "--text-secondary"),
        ],
    },
    {
        "name": "BeneficiaryDashboard",
        "file": "BeneficiaryDashboard.tsx",
        "title": "Beneficiary Portal",
        "subtitle": "Policy & Claim Status — Read Only",
        "role_var": "--role-beneficiary",
        "icon": "Heart",
        "trpc_proc": "getPolicyholderKpi",
        "kpis": [
            ("Policies I'm Named On", "activePolicies",     "FileText",      "flat", "stable",   "neutral",  "--role-beneficiary"),
            ("Open Claims",           "openClaims",         "ClipboardList", "flat", "stable",   "neutral",  "--role-beneficiary"),
            ("Total Coverage (₦M)",   "totalCoverage",      "Shield",        "flat", "stable",   "neutral",  "--insurance-primary"),
            ("Claim Paid (YTD ₦)",    "claimPaidYtd",       "CheckCircle",   "flat", "stable",   "neutral",  "--risk-low"),
        ],
        "actions": [
            ("My Policies",     "FileText",     "/my-policies",            "--role-beneficiary"),
            ("My Claims",       "ClipboardList","/my-claims",              "--insurance-primary"),
            ("Documents",       "BookOpen",     "/my-documents",           "--risk-low"),
            ("Profile",         "UserCheck",    "/my-profile",             "--text-secondary"),
        ],
    },
    {
        "name": "Ifrs17Dashboard",
        "file": "Ifrs17Dashboard.tsx",
        "title": "IFRS 17 Dashboard",
        "subtitle": "Insurance Contract Accounting",
        "role_var": "--role-actuary",
        "icon": "BookOpen",
        "trpc_proc": "getIfrs17Dashboard",
        "kpis": [
            ("BEL (₦M)",             "bel",                 "TrendingUp",    "up",   "↑ 2.1%",   "neutral",  "--role-actuary"),
            ("Risk Adjustment (₦M)", "riskAdjustment",      "Shield",        "flat", "stable",   "neutral",  "--role-actuary"),
            ("CSM (₦M)",             "csm",                 "DollarSign",    "up",   "↑ 1.4%",   "good",     "--risk-low"),
            ("Loss Component (₦M)",  "lossComponent",       "AlertTriangle", "down", "↓ 0.8%",   "good",     "--risk-low"),
            ("Insurance Revenue (₦M)","insuranceRevenue",   "BarChart2",     "up",   "↑ 5.2%",   "good",     "--risk-low"),
            ("Insurance Service Exp","insuranceServiceExp", "Receipt",       "flat", "stable",   "neutral",  "--insurance-primary"),
            ("Net Financial Result", "netFinancialResult",  "Activity",      "up",   "↑ 3.1%",   "good",     "--risk-low"),
            ("Discount Rate%",       "discountRate",        "TrendingUp",    "flat", "stable",   "neutral",  "--role-actuary"),
        ],
        "actions": [
            ("Run Calc",        "TrendingUp",   "/reserve-calculations",   "--role-actuary"),
            ("GMM Model",       "BookOpen",     "/actuarial-models",       "--insurance-primary"),
            ("PAA Model",       "Activity",     "/actuarial-models",       "--risk-low"),
            ("Reports",         "BarChart2",    "/actuarial-reports",      "--text-secondary"),
        ],
    },
]

ICON_IMPORTS = [
    "Shield", "ClipboardList", "AlertTriangle", "TrendingUp", "CheckCircle",
    "XCircle", "Clock", "DollarSign", "BarChart2", "FileText", "Users",
    "Activity", "Receipt", "Scale", "Landmark", "Building2", "Star",
    "RefreshCw", "PlusCircle", "UserCheck", "BookOpen", "Home", "Heart",
    "GraduationCap", "ArrowRightLeft", "Wallet", "HeartPulse", "Calendar",
    "Search", "Settings",
]

TEMPLATE = '''/**
 * {name} — Role-scoped KPI home screen for the {title} role.
 * Auto-generated by scripts/generate_role_dashboards.py
 */
import {{ trpc }} from "@/_core/trpc";
import {{ KpiCard }} from "@/components/insurance/KpiCard";
import {{ useIsMobile }} from "@/hooks/useMobile";
import {{ useLocation }} from "wouter";
import {{
  {icon_imports}
}} from "lucide-react";

export default function {name}() {{
  const isMobile = useIsMobile();
  const [, navigate] = useLocation();
  const {{ data, isLoading }} = (trpc as any).insuranceKpiDashboard?.{trpc_proc}?.useQuery?.() ?? {{ data: null, isLoading: false }};
  const kpi = data?.kpis ?? {{}};

  const cards = [
{kpi_cards}  ];

  return (
    <div
      className="min-h-screen"
      style={{{{
        background: "var(--page-bg)",
        paddingBottom: isMobile ? "calc(4rem + var(--safe-area-bottom))" : "2rem",
      }}}}
    >
      {{/* Header */}}
      <div
        className="sticky top-0 z-10 px-4 py-3 flex items-center justify-between"
        style={{{{
          background: "var(--header-bg)",
          borderBottom: "1px solid var(--card-border)",
          backdropFilter: "blur(12px)",
        }}}}
      >
        <div className="flex items-center gap-3">
          <span
            className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{{{ background: "var({role_var})20", color: "var({role_var})" }}}}
          >
            <{icon} size={{18}} />
          </span>
          <div>
            <h1 className="text-base font-semibold" style={{{{ color: "var(--text-primary)" }}}}>
              {title}
            </h1>
            <p className="text-xs" style={{{{ color: "var(--text-secondary)" }}}}>
              {subtitle}
            </p>
          </div>
        </div>
      </div>

      <div className="px-4 pt-4 space-y-6">
        {{/* KPI Grid */}}
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wide mb-3"
              style={{{{ color: "var(--text-secondary)" }}}}>
            Key Metrics
          </h2>
          <div className={{`grid gap-3 ${{isMobile ? "grid-cols-2" : "grid-cols-4"}}`}}>
            {{cards.map((c) => (
              <KpiCard
                key={{c.title}}
                title={{c.title}}
                value={{c.value}}
                icon={{c.icon}}
                trend={{c.trend}}
                trendValue={{c.trendValue}}
                subtitle={{c.subtitle}}
                status={{c.status}}
                accentColor={{c.accent}}
                loading={{isLoading}}
                onClick={{() => navigate(c.href)}}
              />
            ))}}
          </div>
        </section>

        {{/* Quick Actions */}}
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wide mb-3"
              style={{{{ color: "var(--text-secondary)" }}}}>
            Quick Actions
          </h2>
          <div className={{`grid gap-3 ${{isMobile ? "grid-cols-2" : "grid-cols-4"}}`}}>
            {{{action_buttons}}}
          </div>
        </section>
      </div>
    </div>
  );
}}
'''

def make_kpi_card(title, field, icon, trend, trend_val, status, accent):
    trend_str = f'"{trend}"' if trend else "undefined"
    tv_str    = f'"{trend_val}"' if trend_val else "undefined"
    return (
        f'    {{ title: "{title}", value: kpi.{field} ?? "—", icon: {icon}, '
        f'trend: {trend_str}, trendValue: {tv_str}, '
        f'status: "{status}" as const, href: "#", accent: "var({accent})" }},\n'
    )

def make_action_button(label, icon, href, color):
    return f'''            <button
              key="{label}"
              onClick={{() => navigate("{href}")}}
              className="flex flex-col items-center justify-center gap-2 p-4 rounded-xl
                         transition-all duration-150 hover:shadow-md hover:-translate-y-0.5"
              style={{{{
                background: "var(--card-bg)",
                border: "1px solid var(--card-border)",
                color: "var({color})",
              }}}}
            >
              <{icon} size={{22}} />
              <span className="text-xs font-medium text-center leading-tight"
                    style={{{{ color: "var(--text-primary)" }}}}>
                {label}
              </span>
            </button>'''

generated = []
for d in DASHBOARDS:
    kpi_cards = "".join(make_kpi_card(*k) for k in d["kpis"])
    action_buttons = "\n".join(make_action_button(*a) for a in d["actions"])
    icon_imports = ", ".join(sorted(set(
        [d["icon"]] + [k[2] for k in d["kpis"]] + [a[1] for a in d["actions"]]
    )))
    content = TEMPLATE.format(
        name=d["name"],
        title=d["title"],
        subtitle=d["subtitle"],
        role_var=d["role_var"],
        icon=d["icon"],
        trpc_proc=d["trpc_proc"],
        kpi_cards=kpi_cards,
        action_buttons=action_buttons,
        icon_imports=icon_imports,
    )
    path = os.path.join(PAGES_DIR, d["file"])
    with open(path, "w") as f:
        f.write(content)
    generated.append(d["file"])
    print(f"  ✓ Generated {d['file']}")

print(f"\nTotal: {len(generated)} dashboard pages generated.")
