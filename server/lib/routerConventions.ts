// @ts-check
/**
 * Router Organization Conventions
 *
 * Guidelines for organizing router files to prevent fragmentation
 * and improve maintainability.
 *
 * Current State (as of analysis):
 *   - 454 router files in server/routers/
 *   - Total size: 3.2MB
 *   - Largest: transactions.ts (88KB), management.ts (66KB)
 *
 * Target State:
 *   - Organize into domain-organized directories
 *   - Max 500 lines per file
 *   - Max 10KB per file
 *   - Consolidate related routers into single domain files
 */

export interface RouterConvention {
  /** Maximum lines per router file */
  maxLines: number;
  /** Maximum file size in KB */
  maxSizeKB: number;
  /** Maximum routes per router */
  maxRoutes: number;
  /** Maximum files per domain */
  maxFilesPerDomain: number;
}

export const ROUTER_CONVENTIONS: RouterConvention = {
  maxLines: 500,
  maxSizeKB: 10,
  maxRoutes: 20,
  maxFilesPerDomain: 15,
};

/**
 * Domain organization structure for routers
 *
 * Recommended structure:
 * server/routers/
 * ├── auth/          - Authentication & authorization
 * ├── users/         - User management
 * ├── agents/        - Agent management & commission
 * ├── transactions/  - Payment processing & ledger
 * ├── kyc/           - KYC/KYB verification
 * ├── admin/         - Admin dashboard & management
 * ├── billing/       - Billing & subscription
 * ├── analytics/     - Analytics & reporting
 * ├── notifications/ - SMS, email, push notifications
 * ├── integrations/  - Third-party integrations
 * └── legacy/        - Deprecated or unmigrated routers
 */

export const DOMAIN_STRUCTURE = {
  auth: ["auth", "login", "logout", "oauth", "oidc", "session", "token"],
  users: ["user", "profile", "account", "customer"],
  agents: ["agent", "commission", "hierarchy", "territory", "onboarding"],
  transactions: ["transaction", "payment", "ledger", "transfer", "settlement"],
  kyc: ["kyc", "kyb", "verification", "identity", "document"],
  admin: ["admin", "dashboard", "management", "super-admin"],
  billing: ["billing", "subscription", "invoice", "plan", "tenant"],
  analytics: ["analytics", "report", "dashboard", "metric", "kpi"],
  notifications: ["notification", "sms", "email", "push", "webhook", "termii"],
  integrations: ["integration", "webhook", "callback", "sidecar", "bridge"],
} as const;

/**
 * Get recommended domain for a router file based on filename
 */
export function getDomainForRouter(filename: string): string {
  const lower = filename.toLowerCase();
  for (const [domain, keywords] of Object.entries(DOMAIN_STRUCTURE)) {
    if (keywords.some(keyword => lower.includes(keyword))) {
      return domain;
    }
  }
  return "legacy";
}

/**
 * Analyze router organization and provide recommendations
 */
export function analyzeRouterOrganization() {
  const recommendations: string[] = [];
  const totalRouters = 0;
  const oversizedRouters = 0;
  const fragmentedDomains = 0;

  // This would be populated by a script that analyzes actual router files
  recommendations.push(
    "📊 Router Organization Analysis:",
    "  • Current: 454 router files (target: ~50 domain-organized files)",
    "  • Largest: transactions.ts (88KB) - should be split",
    "  • Recommendation: Consolidate related routers by domain",
    "",
    "🎯 Target Structure:",
    "  • 10-12 domain directories",
    "  • Max 500 lines per file",
    "  • Max 10KB per file",
    "  • Max 20 routes per router",
    "",
    "📈 Expected Benefits:",
    "  • 90% reduction in file count",
    "  • Improved code organization",
    "  • Easier navigation and maintenance",
    "  • Better testability",
  );

  return recommendations;
}

/**
 * Generate migration plan for router consolidation
 */
export function generateMigrationPlan() {
  const plan = [
    "🚀 Router Consolidation Migration Plan",
    "",
    "Phase 1: Foundation (Week 1-2)",
    "  • Create domain directory structure",
    "  • Set up barrel exports (index.ts) for each domain",
    "  • Update router registration to use domain imports",
    "",
    "Phase 2: Core Domains (Week 3-4)",
    "  • Consolidate auth routers (5-8 files → 2 files)",
    "  • Consolidate user routers (10-15 files → 3 files)",
    "  • Consolidate agent routers (20-25 files → 5 files)",
    "",
    "Phase 3: Business Logic (Week 5-6)",
    "  • Consolidate transaction routers (15-20 files → 4 files)",
    "  • Consolidate billing routers (8-10 files → 2 files)",
    "  • Consolidate KYC routers (10-12 files → 3 files)",
    "",
    "Phase 4: Supporting Domains (Week 7-8)",
    "  • Consolidate analytics routers (15-20 files → 3 files)",
    "  • Consolidate notification routers (10-12 files → 2 files)",
    "  • Consolidate integration routers (15-20 files → 3 files)",
    "",
    "Phase 5: Cleanup (Week 9-10)",
    "  • Move legacy routers to legacy/ directory",
    "  • Deprecate unused routers",
    "  • Update documentation",
    "  • Run CI/CD checks",
    "",
    "📋 Migration Checklist:",
    "  □ Maintain backward compatibility during transition",
    "  □ Update all import paths",
    "  □ Update route registration",
    "  □ Update tests to match new structure",
    "  □ Update API documentation",
    "  □ Update CI/CD pipeline",
    "  □ Run full test suite",
    "  □ Performance testing",
  ];

  return plan;
}

export default {
  ROUTER_CONVENTIONS,
  DOMAIN_STRUCTURE,
  getDomainForRouter,
  analyzeRouterOrganization,
  generateMigrationPlan,
};
