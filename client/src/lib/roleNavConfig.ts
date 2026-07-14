/**
 * Role-Based Navigation Configuration — Sprint 93
 *
 * Controls which navigation groups are visible to each user role.
 * Aligned with the 7-role PBAC hierarchy from pbacManagement.ts:
 *   super_admin > admin > supervisor > agent_manager > agent > auditor > viewer
 *
 * Each role inherits all groups from roles below it in the hierarchy,
 * plus its own additional groups.
 */

export type PBACRole =
  | "super_admin"
  | "admin"
  | "supervisor"
  | "agent_manager"
  | "agent"
  | "auditor"
  | "viewer";

/** Numeric level for hierarchy comparison (higher = more access) */
export const ROLE_LEVEL: Record<PBACRole, number> = {
  super_admin: 7,
  admin: 6,
  supervisor: 5,
  agent_manager: 4,
  agent: 3,
  auditor: 2,
  viewer: 1,
};

/**
 * Navigation group IDs each role can see.
 * Groups are the `id` field on the navGroups array in DashboardLayout.
 */
const roleGroupAccess: Record<PBACRole, string[]> = {
  // ── Viewer: read-only dashboards ──
  viewer: ["core", "help"],

  // ── Auditor: viewer + compliance, audit, reporting ──
  auditor: [
    "core",
    "help",
    "analytics",
    "production-finalization", // regulatory reports, compliance training
    "final-production", // compliance certs, data retention
  ],

  // ── Agent: operational access ──
  agent: ["core", "help", "finance", "notifications", "engagement"],

  // ── Agent Manager: agent + agent management, territory, performance ──
  agent_manager: [
    "core",
    "help",
    "finance",
    "notifications",
    "engagement",
    "agents",
    "analytics",
    "portals",
  ],

  // ── Supervisor: agent_manager + admin tools, monitoring ──
  supervisor: [
    "core",
    "help",
    "finance",
    "notifications",
    "engagement",
    "agents",
    "analytics",
    "portals",
    "admin",
    "production-readiness",
    "sprint51-features",
  ],

  // ── Admin: supervisor + infrastructure, integrations, tenant ──
  admin: [
    "core",
    "help",
    "finance",
    "notifications",
    "engagement",
    "agents",
    "analytics",
    "portals",
    "admin",
    "production-readiness",
    "sprint51-features",
    "integrations",
    "tenant",
    "infra",
    "production-suite",
    "sprint52-features",
    "production-finalization",
    "final-production",
  ],

  // ── Super Admin: everything ──
  super_admin: [
    "core",
    "help",
    "finance",
    "notifications",
    "engagement",
    "agents",
    "analytics",
    "portals",
    "admin",
    "production-readiness",
    "sprint51-features",
    "integrations",
    "tenant",
    "infra",
    "production-suite",
    "sprint52-features",
    "production-finalization",
    "final-production",
    "sprint37",
    "sprint38",
    "sprint39",
    "enterprise-scaling",
  ],
};

/** Public alias for test/consumer access (Sprint 19+) */
export const roleNavAccess: Record<string, string[]> = roleGroupAccess;

/**
 * Get the navigation group IDs visible to a given role.
 * Falls back to viewer-level access for unknown roles.
 */
export function getVisibleNavGroups(role?: string): string[] {
  if (!role) return roleGroupAccess.viewer;
  // Map legacy role names to PBAC roles
  const mapped = mapLegacyRole(role);
  return roleGroupAccess[mapped] || roleGroupAccess.viewer;
}

/**
 * Filter an array of nav groups to only those visible to the role.
 */
export function filterNavGroupsByRole<T extends { id: string }>(
  groups: T[],
  role?: string
): T[] {
  const visibleIds = new Set(getVisibleNavGroups(role));
  return groups.filter(g => visibleIds.has(g.id));
}

/**
 * Route-level access control.
 * Maps specific routes to the minimum role level required.
 */
const routeMinLevel: Record<string, number> = {
  // Super admin only
  "/super-admin": 7,
  "/pbac-management": 7,
  "/security-alerts": 7,
  "/infrastructure": 7,
  "/system-config-manager": 7,

  // Supervisor+
  "/admin": 5,
  "/admin/fraud": 6,
  "/admin/audit": 6,
  "/admin/tenant": 6,
  "/admin/invite-codes": 6,
  "/admin-dashboard": 6,
  "/admin-user-management": 6,
  "/admin-system-health": 6,
  "/alert-notification-preferences": 6,
  "/management": 6,
  "/system-health": 6,
  "/cache-management": 6,
  "/rate-limit-dashboard": 6,
  "/service-health": 6,
  "/retry-queue": 6,
  "/session-manager": 6,
  "/gdpr": 6,
  "/tigerbeetle": 6,
  "/temporal": 6,
  "/vault": 6,
  "/resilience": 6,
  "/sim-orchestrator": 6,
  "/mqtt-bridge": 6,
  "/push-notifications": 6,
  "/business-rules": 6,
  "/system-health-monitor": 6,
  "/platform-config": 6,
  "/api-key-management": 6,
  "/webhook-delivery": 6,
  "/database-visualization": 6,
  "/middleware-manager": 6,

  // Supervisor+
  "/supervisor": 5,
  "/agent-management": 5,
  "/cbn-reporting": 5,
  "/admin/analytics": 5,
  "/realtime-tx-monitor": 5,
  "/fraud-ml-scoring": 5,

  // Agent Manager+
  "/agent-scorecard": 4,
  "/agent-hierarchy-territory": 4,
  "/agent-performance-analytics": 4,

  // Agent+
  "/offline-queue": 3,
  "/payments": 3,

  // Auditor+
  "/activity-audit-log": 2,
  "/compliance-reporting": 2,
  "/regulatory-reports": 2,
  "/compliance-cert-manager": 2,
  "/compliance-training": 2,
  "/transaction-analytics": 2,
};

/**
 * Check if a specific route is accessible to a role.
 */
export function canAccessRoute(
  role: string | undefined,
  path: string
): boolean {
  if (!role) return false;
  const mapped = mapLegacyRole(role);
  const userLevel = ROLE_LEVEL[mapped] || 1;

  // Super admin can access everything
  if (userLevel >= 7) return true;

  const minLevel = routeMinLevel[path];
  // No restriction = public route
  if (minLevel === undefined) return true;
  return userLevel >= minLevel;
}

/**
 * Get the display name for a PBAC role.
 */
export function getRoleDisplayName(role: string): string {
  const names: Record<string, string> = {
    super_admin: "Super Admin",
    admin: "Administrator",
    supervisor: "Supervisor",
    agent_manager: "Agent Manager",
    agent: "Agent",
    auditor: "Auditor",
    viewer: "Viewer",
  };
  return names[role] || role;
}

/**
 * Get the badge color class for a role.
 */
export function getRoleBadgeColor(role: string): string {
  const colors: Record<string, string> = {
    super_admin: "bg-red-500/10 text-red-500 border-red-500/20",
    admin: "bg-orange-500/10 text-orange-500 border-orange-500/20",
    supervisor: "bg-blue-500/10 text-blue-500 border-blue-500/20",
    agent_manager: "bg-purple-500/10 text-purple-500 border-purple-500/20",
    agent: "bg-green-500/10 text-green-500 border-green-500/20",
    auditor: "bg-yellow-500/10 text-yellow-500 border-yellow-500/20",
    viewer: "bg-gray-500/10 text-gray-500 border-gray-500/20",
  };
  return colors[role] || colors.viewer;
}

/**
 * Map legacy role names (from older sprints) to the current PBAC hierarchy.
 */
function mapLegacyRole(role: string): PBACRole {
  const mapping: Record<string, PBACRole> = {
    // Direct matches
    super_admin: "super_admin",
    admin: "admin",
    supervisor: "supervisor",
    agent_manager: "agent_manager",
    agent: "agent",
    auditor: "auditor",
    viewer: "viewer",
    // Legacy mappings
    tenant_admin: "admin",
    customer: "viewer",
    merchant: "agent",
    developer: "admin",
    user: "viewer",
    manager: "agent_manager",
    operator: "agent",
    "underwriter": {
    label: "Underwriter",
    home: "/underwriter-dashboard",
    color: "var(--role-underwriter)",
    icon: "Shield",
    tabs: [
    { label: "Dashboard", href: "/underwriter-dashboard", icon: "LayoutDashboard" },
    { label: "Queue", href: "/underwriting-queue", icon: "ClipboardList" },
    { label: "Products", href: "/insurance-products", icon: "Package" },
    { label: "Reports", href: "/underwriting-reports", icon: "BarChart2" }
    ],
    sidebar: [
      {
      group: "Underwriting",
      items: [
        { label: "Application Queue", href: "/underwriting-queue", icon: "ClipboardList" },
        { label: "Risk Assessment", href: "/risk-assessment", icon: "Shield" },
        { label: "Policy Approval", href: "/policy-approval", icon: "CheckCircle" },
        { label: "Referral Management", href: "/referral-management", icon: "GitBranch" }
      ]
    },
      {
      group: "Products",
      items: [
        { label: "Insurance Products", href: "/insurance-products", icon: "Package" },
        { label: "Product Configuration", href: "/product-configuration", icon: "Settings" },
        { label: "Pricing Rules", href: "/pricing-rules", icon: "DollarSign" }
      ]
    },
      {
      group: "Reports",
      items: [
        { label: "Underwriting Reports", href: "/underwriting-reports", icon: "BarChart2" },
        { label: "Loss Ratio Analysis", href: "/loss-ratio", icon: "TrendingDown" }
      ]
    }
    ],
  },
  "actuary": {
    label: "Actuary",
    home: "/actuary-dashboard",
    color: "var(--role-actuary)",
    icon: "BookOpen",
    tabs: [
    { label: "Dashboard", href: "/actuary-dashboard", icon: "LayoutDashboard" },
    { label: "IFRS17", href: "/ifrs17-dashboard", icon: "BookOpen" },
    { label: "Pricing", href: "/pricing-models", icon: "TrendingUp" },
    { label: "Reserves", href: "/reserve-calculations", icon: "Activity" }
    ],
    sidebar: [
      {
      group: "Reserving",
      items: [
        { label: "IFRS 17 Dashboard", href: "/ifrs17-dashboard", icon: "BookOpen" },
        { label: "Reserve Calculations", href: "/reserve-calculations", icon: "Activity" },
        { label: "Mortality Tables", href: "/mortality-tables", icon: "Users" },
        { label: "Morbidity Rates", href: "/morbidity-rates", icon: "Heart" }
      ]
    },
      {
      group: "Pricing",
      items: [
        { label: "Pricing Models", href: "/pricing-models", icon: "TrendingUp" },
        { label: "Rate Filing", href: "/rate-filing", icon: "FileText" }
      ]
    },
      {
      group: "Analytics",
      items: [
        { label: "Actuarial Reports", href: "/actuarial-reports", icon: "BarChart2" },
        { label: "Lakehouse Analytics", href: "/lakehouse-analytics", icon: "Database" }
      ]
    }
    ],
  },
  "claims-adjuster": {
    label: "Claims Adjuster",
    home: "/claims-dashboard",
    color: "var(--role-claims-adjuster)",
    icon: "ClipboardList",
    tabs: [
    { label: "Dashboard", href: "/claims-dashboard", icon: "LayoutDashboard" },
    { label: "My Claims", href: "/claims-management", icon: "ClipboardList" },
    { label: "FNOL", href: "/fnol-submission", icon: "Plus" },
    { label: "Settlement", href: "/claims-settlement", icon: "CheckCircle" }
    ],
    sidebar: [
      {
      group: "Claims",
      items: [
        { label: "Claims Queue", href: "/claims-management", icon: "ClipboardList" },
        { label: "FNOL Submission", href: "/fnol-submission", icon: "Plus" },
        { label: "Investigation", href: "/claims-investigation", icon: "Search" },
        { label: "Settlement", href: "/claims-settlement", icon: "CheckCircle" },
        { label: "Fraud Flags", href: "/fraud-flags", icon: "AlertTriangle" }
      ]
    },
      {
      group: "Reports",
      items: [
        { label: "Claims Reports", href: "/claims-reports", icon: "BarChart2" },
        { label: "Settlement History", href: "/settlement-history", icon: "History" }
      ]
    }
    ],
  },
  "broker": {
    label: "Broker",
    home: "/broker-dashboard",
    color: "var(--role-broker)",
    icon: "Briefcase",
    tabs: [
    { label: "Dashboard", href: "/broker-dashboard", icon: "LayoutDashboard" },
    { label: "Clients", href: "/client-portfolio", icon: "Users" },
    { label: "Quotes", href: "/quote-engine", icon: "FileText" },
    { label: "Commission", href: "/commission-management", icon: "DollarSign" }
    ],
    sidebar: [
      {
      group: "Business",
      items: [
        { label: "Client Portfolio", href: "/client-portfolio", icon: "Users" },
        { label: "Quote Engine", href: "/quote-engine", icon: "FileText" },
        { label: "Policy Submissions", href: "/policy-submissions", icon: "Send" },
        { label: "Renewals", href: "/renewals-management", icon: "RefreshCw" }
      ]
    },
      {
      group: "Finance",
      items: [
        { label: "Commission Management", href: "/commission-management", icon: "DollarSign" },
        { label: "Premium Collection", href: "/premium-collection", icon: "CreditCard" }
      ]
    }
    ],
  },
  "policyholder": {
    label: "My Insurance",
    home: "/policyholder-dashboard",
    color: "var(--role-policyholder)",
    icon: "Home",
    tabs: [
    { label: "Home", href: "/policyholder-dashboard", icon: "Home" },
    { label: "Policies", href: "/my-policies", icon: "Shield" },
    { label: "Claims", href: "/my-claims", icon: "ClipboardList" },
    { label: "Pay", href: "/premium-payment", icon: "CreditCard" }
    ],
    sidebar: [
      {
      group: "My Insurance",
      items: [
        { label: "My Policies", href: "/my-policies", icon: "Shield" },
        { label: "My Claims", href: "/my-claims", icon: "ClipboardList" },
        { label: "Premium Payment", href: "/premium-payment", icon: "CreditCard" },
        { label: "My Documents", href: "/my-documents", icon: "FileText" },
        { label: "My Beneficiaries", href: "/my-beneficiaries", icon: "Users" }
      ]
    },
      {
      group: "Support",
      items: [
        { label: "File a Claim", href: "/fnol-submission", icon: "Plus" },
        { label: "Get a Quote", href: "/quote-engine", icon: "FileText" },
        { label: "Contact Us", href: "/support", icon: "MessageCircle" }
      ]
    }
    ],
  },
  "compliance-officer": {
    label: "Compliance",
    home: "/compliance-dashboard",
    color: "var(--role-compliance-officer)",
    icon: "Scale",
    tabs: [
    { label: "Dashboard", href: "/compliance-dashboard", icon: "LayoutDashboard" },
    { label: "AML/KYC", href: "/aml-kyc-management", icon: "Shield" },
    { label: "Regulatory", href: "/regulatory-filings", icon: "BookOpen" },
    { label: "Audit", href: "/audit-trail", icon: "ClipboardList" }
    ],
    sidebar: [
      {
      group: "Compliance",
      items: [
        { label: "AML/KYC Management", href: "/aml-kyc-management", icon: "Shield" },
        { label: "Sanctions Screening", href: "/sanctions-screening", icon: "AlertTriangle" },
        { label: "PEP Monitoring", href: "/pep-monitoring", icon: "Users" },
        { label: "Account Freeze", href: "/account-freeze", icon: "Lock" }
      ]
    },
      {
      group: "Regulatory",
      items: [
        { label: "NAICOM Filings", href: "/naicom-filings", icon: "FileText" },
        { label: "CBN Reports", href: "/cbn-reports", icon: "Landmark" },
        { label: "NDIC Reports", href: "/ndic-reports", icon: "FileText" },
        { label: "Audit Trail", href: "/audit-trail", icon: "ClipboardList" }
      ]
    }
    ],
  },
  "regulator": {
    label: "Regulator",
    home: "/regulator-dashboard",
    color: "var(--role-regulator)",
    icon: "Landmark",
    tabs: [
    { label: "Dashboard", href: "/regulator-dashboard", icon: "LayoutDashboard" },
    { label: "Market", href: "/market-overview", icon: "TrendingUp" },
    { label: "Solvency", href: "/solvency-monitoring", icon: "Shield" },
    { label: "Reports", href: "/regulatory-reports", icon: "BarChart2" }
    ],
    sidebar: [
      {
      group: "Market Oversight",
      items: [
        { label: "Market Overview", href: "/market-overview", icon: "TrendingUp" },
        { label: "Solvency Monitoring", href: "/solvency-monitoring", icon: "Shield" },
        { label: "Market Conduct", href: "/market-conduct", icon: "Scale" }
      ]
    },
      {
      group: "Reports",
      items: [
        { label: "Regulatory Reports", href: "/regulatory-reports", icon: "BarChart2" },
        { label: "Statistical Returns", href: "/statistical-returns", icon: "Database" }
      ]
    }
    ],
  },
  "reinsurer": {
    label: "Reinsurance",
    home: "/reinsurer-dashboard",
    color: "var(--role-reinsurer)",
    icon: "Scale",
    tabs: [
    { label: "Dashboard", href: "/reinsurer-dashboard", icon: "LayoutDashboard" },
    { label: "Treaties", href: "/reinsurance-treaties", icon: "FileText" },
    { label: "Claims", href: "/ri-claims", icon: "ClipboardList" },
    { label: "Premiums", href: "/reinsurance-premiums", icon: "DollarSign" }
    ],
    sidebar: [
      {
      group: "Reinsurance",
      items: [
        { label: "Treaty Management", href: "/reinsurance-treaties", icon: "FileText" },
        { label: "Facultative RI", href: "/facultative-ri", icon: "Shield" },
        { label: "RI Claims", href: "/ri-claims", icon: "ClipboardList" },
        { label: "Premium Accounting", href: "/reinsurance-premiums", icon: "DollarSign" }
      ]
    },
      {
      group: "Analytics",
      items: [
        { label: "Cession Reports", href: "/cession-reports", icon: "BarChart2" },
        { label: "Net Retention", href: "/net-retention", icon: "TrendingDown" }
      ]
    }
    ],
  },
  "billing-admin": {
    label: "Billing Admin",
    home: "/billing-admin-dashboard",
    color: "var(--role-billing-admin)",
    icon: "Receipt",
    tabs: [
    { label: "Dashboard", href: "/billing-admin-dashboard", icon: "LayoutDashboard" },
    { label: "Ledger", href: "/billing-ledger", icon: "Receipt" },
    { label: "Reconcile", href: "/reconciliation", icon: "Activity" },
    { label: "Revenue", href: "/revenue-analytics", icon: "TrendingUp" }
    ],
    sidebar: [
      {
      group: "Billing",
      items: [
        { label: "Platform Ledger", href: "/billing-ledger", icon: "Receipt" },
        { label: "Revenue Analytics", href: "/revenue-analytics", icon: "TrendingUp" },
        { label: "Tenant Payouts", href: "/tenant-payouts", icon: "DollarSign" },
        { label: "Reconciliation", href: "/reconciliation", icon: "Activity" }
      ]
    },
      {
      group: "Reports",
      items: [
        { label: "Billing Reports", href: "/billing-reports", icon: "BarChart2" },
        { label: "Revenue Splits", href: "/revenue-splits", icon: "PieChart" }
      ]
    }
    ],
  },

  "beneficiary": {
    label: "Beneficiary",
    home: "/beneficiary-dashboard",
    color: "var(--role-beneficiary)",
    icon: "Heart",
    tabs: [
    { label: "Home", href: "/beneficiary-dashboard", icon: "Home" },
    { label: "Policies", href: "/my-policies", icon: "Shield" },
    { label: "Claims", href: "/my-claims", icon: "ClipboardList" },
    { label: "Documents", href: "/my-documents", icon: "FileText" }
    ],
    sidebar: [
      {
      group: "My Coverage",
      items: [
        { label: "My Policies", href: "/my-policies", icon: "Shield" },
        { label: "My Claims", href: "/my-claims", icon: "ClipboardList" },
        { label: "My Documents", href: "/my-documents", icon: "FileText" }
      ]
    }
    ],
  },
};};
