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
  };
  return mapping[role] ?? "viewer";
}

