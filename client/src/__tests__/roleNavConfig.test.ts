import { describe, it, expect } from "vitest";
import {
  ROLE_LEVEL,
  getVisibleNavGroups,
  filterNavGroupsByRole,
  canAccessRoute,
  getRoleDisplayName,
  getRoleBadgeColor,
  PBACRole,
} from "../lib/roleNavConfig";

describe("Role-Based Navigation Configuration", () => {
  describe("ROLE_LEVEL hierarchy", () => {
    it("should define all 7 PBAC roles with numeric levels", () => {
      expect(ROLE_LEVEL).toHaveProperty("super_admin", 7);
      expect(ROLE_LEVEL).toHaveProperty("admin", 6);
      expect(ROLE_LEVEL).toHaveProperty("supervisor", 5);
      expect(ROLE_LEVEL).toHaveProperty("agent_manager", 4);
      expect(ROLE_LEVEL).toHaveProperty("agent", 3);
      expect(ROLE_LEVEL).toHaveProperty("auditor", 2);
      expect(ROLE_LEVEL).toHaveProperty("viewer", 1);
    });

    it("should maintain strict hierarchy ordering (higher level = more access)", () => {
      expect(ROLE_LEVEL.super_admin).toBeGreaterThan(ROLE_LEVEL.admin);
      expect(ROLE_LEVEL.admin).toBeGreaterThan(ROLE_LEVEL.supervisor);
      expect(ROLE_LEVEL.supervisor).toBeGreaterThan(ROLE_LEVEL.agent_manager);
      expect(ROLE_LEVEL.agent_manager).toBeGreaterThan(ROLE_LEVEL.agent);
      expect(ROLE_LEVEL.agent).toBeGreaterThan(ROLE_LEVEL.auditor);
      expect(ROLE_LEVEL.auditor).toBeGreaterThan(ROLE_LEVEL.viewer);
    });
  });

  describe("getVisibleNavGroups", () => {
    it("should return viewer-level groups for undefined role", () => {
      const groups = getVisibleNavGroups(undefined);
      expect(groups).toEqual(["core", "help"]);
    });

    it("should return viewer-level groups for unknown role", () => {
      const groups = getVisibleNavGroups("unknown_role");
      expect(groups).toEqual(["core", "help"]);
    });

    it("should return correct groups for viewer role", () => {
      const groups = getVisibleNavGroups("viewer");
      expect(groups).toEqual(["core", "help"]);
    });

    it("should return auditor groups with compliance access", () => {
      const groups = getVisibleNavGroups("auditor");
      expect(groups).toContain("core");
      expect(groups).toContain("help");
      expect(groups).toContain("analytics");
      expect(groups).toContain("production-finalization");
      expect(groups).toContain("final-production");
      // Auditors should NOT have operational access
      expect(groups).not.toContain("finance");
      expect(groups).not.toContain("agents");
    });

    it("should return agent groups with operational access", () => {
      const groups = getVisibleNavGroups("agent");
      expect(groups).toContain("core");
      expect(groups).toContain("finance");
      expect(groups).toContain("notifications");
      expect(groups).toContain("engagement");
      // Agents should NOT have admin access
      expect(groups).not.toContain("admin");
      expect(groups).not.toContain("infra");
    });

    it("should return super_admin groups with all access", () => {
      const groups = getVisibleNavGroups("super_admin");
      // Super admin should have every group
      expect(groups).toContain("core");
      expect(groups).toContain("finance");
      expect(groups).toContain("admin");
      expect(groups).toContain("infra");
      expect(groups).toContain("production-finalization");
      expect(groups).toContain("sprint37");
      expect(groups).toContain("enterprise-scaling");
    });
  });

  describe("filterNavGroupsByRole", () => {
    const mockGroups = [
      { id: "core", label: "Core" },
      { id: "finance", label: "Finance" },
      { id: "admin", label: "Admin" },
      { id: "infra", label: "Infrastructure" },
      { id: "help", label: "Help" },
    ];

    it("should filter groups for viewer role (core + help only)", () => {
      const filtered = filterNavGroupsByRole(mockGroups, "viewer");
      expect(filtered).toHaveLength(2);
      expect(filtered.map(g => g.id)).toEqual(["core", "help"]);
    });

    it("should filter groups for agent role (core + finance + help)", () => {
      const filtered = filterNavGroupsByRole(mockGroups, "agent");
      expect(filtered).toHaveLength(3);
      expect(filtered.map(g => g.id)).toContain("finance");
      expect(filtered.map(g => g.id)).not.toContain("admin");
    });

    it("should return all groups for super_admin", () => {
      const filtered = filterNavGroupsByRole(mockGroups, "super_admin");
      expect(filtered).toHaveLength(5);
    });

    it("should return all groups when role is undefined", () => {
      // Undefined role defaults to viewer access
      const filtered = filterNavGroupsByRole(mockGroups, undefined);
      expect(filtered).toHaveLength(2);
      expect(filtered.map(g => g.id)).toEqual(["core", "help"]);
    });
  });

  describe("canAccessRoute", () => {
    it("should deny access for undefined role", () => {
      expect(canAccessRoute(undefined, "/admin")).toBe(false);
      expect(canAccessRoute(undefined, "/payments")).toBe(false);
    });

    it("should allow super_admin to access any route", () => {
      expect(canAccessRoute("super_admin", "/admin")).toBe(true);
      expect(canAccessRoute("super_admin", "/super-admin")).toBe(true);
      expect(canAccessRoute("super_admin", "/nonexistent")).toBe(true);
    });

    it("should allow public routes for all roles", () => {
      expect(canAccessRoute("viewer", "/dashboard")).toBe(true);
      expect(canAccessRoute("agent", "/payments")).toBe(true);
      expect(canAccessRoute("auditor", "/transaction-analytics")).toBe(true);
    });

    it("should restrict admin routes to admin level and above", () => {
      expect(canAccessRoute("admin", "/admin")).toBe(true);
      expect(canAccessRoute("supervisor", "/admin")).toBe(true);
      expect(canAccessRoute("agent", "/admin")).toBe(false);
    });

    it("should restrict super-admin routes to super_admin only", () => {
      expect(canAccessRoute("super_admin", "/super-admin")).toBe(true);
      expect(canAccessRoute("admin", "/super-admin")).toBe(false);
      expect(canAccessRoute("supervisor", "/super-admin")).toBe(false);
    });

    it("should restrict compliance routes to auditor level and above", () => {
      // /activity-audit-log requires level 2 (auditor)
      expect(canAccessRoute("auditor", "/activity-audit-log")).toBe(true);
      expect(canAccessRoute("supervisor", "/activity-audit-log")).toBe(true);
      expect(canAccessRoute("agent_manager", "/activity-audit-log")).toBe(true);
      expect(canAccessRoute("agent", "/activity-audit-log")).toBe(true); // agent (3) > auditor (2)
      // Viewer (level 1) cannot access
      expect(canAccessRoute("viewer", "/activity-audit-log")).toBe(false);
    });

    it("should handle legacy role names", () => {
      // tenant_admin should map to admin
      expect(canAccessRoute("tenant_admin", "/admin")).toBe(true);
      // merchant should map to agent
      expect(canAccessRoute("merchant", "/payments")).toBe(true);
      // customer should map to viewer
      expect(canAccessRoute("customer", "/admin")).toBe(false);
    });
  });

  describe("getRoleDisplayName", () => {
    it("should return correct display names for all PBAC roles", () => {
      expect(getRoleDisplayName("super_admin")).toBe("Super Admin");
      expect(getRoleDisplayName("admin")).toBe("Administrator");
      expect(getRoleDisplayName("supervisor")).toBe("Supervisor");
      expect(getRoleDisplayName("agent_manager")).toBe("Agent Manager");
      expect(getRoleDisplayName("agent")).toBe("Agent");
      expect(getRoleDisplayName("auditor")).toBe("Auditor");
      expect(getRoleDisplayName("viewer")).toBe("Viewer");
    });

    it("should return the role name itself for unknown roles", () => {
      expect(getRoleDisplayName("unknown_role")).toBe("unknown_role");
    });
  });

  describe("getRoleBadgeColor", () => {
    it("should return correct badge colors for all PBAC roles", () => {
      expect(getRoleBadgeColor("super_admin")).toContain("red");
      expect(getRoleBadgeColor("admin")).toContain("orange");
      expect(getRoleBadgeColor("supervisor")).toContain("blue");
      expect(getRoleBadgeColor("agent_manager")).toContain("purple");
      expect(getRoleBadgeColor("agent")).toContain("green");
      expect(getRoleBadgeColor("auditor")).toContain("yellow");
      expect(getRoleBadgeColor("viewer")).toContain("gray");
    });

    it("should return viewer color for unknown roles", () => {
      const unknownColor = getRoleBadgeColor("unknown");
      expect(unknownColor).toBe(getRoleBadgeColor("viewer"));
    });
  });
});
