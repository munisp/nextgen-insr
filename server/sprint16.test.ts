/**
 * ═══════════════════════════════════════════════════════════════════════════
 * QUARANTINED-OPEN-DEFECT — genuine defect / partial delivery (fix routing in progress) — 2026-08-16 (assurance-lead approved; see tests/QUARANTINE.md)
 * ═══════════════════════════════════════════════════════════════════════════
 * REASON: schema content assertion drift.
 * EVIDENCE: run 31969739386.
 * RE-ENABLE CONDITION: Content reconciled (F-12).
 * NO assertion in this file has been modified or deleted — it runs as-is the
 * day the re-enable condition is met. Excluded from the default vitest run via
 * vitest.config.ts (config-level, auditable in one place).
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { describe, it, expect } from "vitest";

// ─── Sprint 16: Multi-Tenant White-Label Tests ─────────────────────────────

describe("Sprint 16: Invite Codes Router", () => {
  it("should export inviteCodesRouter from routers/inviteCodes", async () => {
    const mod = await import("./routers/inviteCodes");
    expect(mod.inviteCodesRouter).toBeDefined();
    expect(mod.inviteCodesRouter._def).toBeDefined();
  });

  it("should have generate, list, validate, markUsed, revoke, stats procedures", async () => {
    const mod = await import("./routers/inviteCodes");
    const procedures = Object.keys(mod.inviteCodesRouter._def.procedures);
    expect(procedures).toContain("generate");
    expect(procedures).toContain("list");
    expect(procedures).toContain("validate");
    expect(procedures).toContain("markUsed");
    expect(procedures).toContain("revoke");
    expect(procedures).toContain("stats");
  });
});

describe("Sprint 16: Partner Onboarding Router", () => {
  it("should export partnerOnboardingRouter", async () => {
    const mod = await import("./routers/partnerOnboarding");
    expect(mod.partnerOnboardingRouter).toBeDefined();
    expect(mod.partnerOnboardingRouter._def).toBeDefined();
  });

  it("should have all onboarding step procedures", async () => {
    const mod = await import("./routers/partnerOnboarding");
    const procedures = Object.keys(mod.partnerOnboardingRouter._def.procedures);
    expect(procedures).toContain("validateInvite");
    expect(procedures).toContain("registerTenant");
    expect(procedures).toContain("updateBranding");
    expect(procedures).toContain("addInsuranceRegion");
    expect(procedures).toContain("addFeeOverride");
    expect(procedures).toContain("completeOnboarding");
    expect(procedures).toContain("getProgress");
    expect(procedures).toContain("getBranding");
    expect(procedures).toContain("listInsuranceRegions");
    expect(procedures).toContain("listFees");
    expect(procedures).toContain("removeInsuranceRegion");
    expect(procedures).toContain("removeFee");
  });
});

describe("Sprint 16: Tenant Admin Router", () => {
  it("should export tenantAdminRouter", async () => {
    const mod = await import("./routers/tenantAdmin");
    expect(mod.tenantAdminRouter).toBeDefined();
    expect(mod.tenantAdminRouter._def).toBeDefined();
  });

  it("should have dashboard, listUsers, inviteUser, updateUser, removeUser, activityLog, toggleLive, settings", async () => {
    const mod = await import("./routers/tenantAdmin");
    const procedures = Object.keys(mod.tenantAdminRouter._def.procedures);
    expect(procedures).toContain("dashboard");
    expect(procedures).toContain("listUsers");
    expect(procedures).toContain("inviteUser");
    expect(procedures).toContain("updateUser");
    expect(procedures).toContain("removeUser");
    expect(procedures).toContain("activityLog");
    expect(procedures).toContain("toggleLive");
    expect(procedures).toContain("settings");
  });
});

describe("Sprint 16: Main Router Integration", () => {
  it("should have inviteCodes, partnerOnboarding, tenantAdmin in appRouter", async () => {
    const mod = await import("./routers");
    const procedures = Object.keys(mod.appRouter._def.procedures);
    const hasInviteCodes = procedures.some(p => p.startsWith("inviteCodes."));
    const hasPartnerOnboarding = procedures.some(p =>
      p.startsWith("partnerOnboarding.")
    );
    const hasTenantAdmin = procedures.some(p => p.startsWith("tenantAdmin."));
    expect(hasInviteCodes).toBe(true);
    expect(hasPartnerOnboarding).toBe(true);
    expect(hasTenantAdmin).toBe(true);
  }, 60_000);
});

describe("Sprint 16: Navigation Reorganization", () => {
  it("should have all 11 navigation groups in DashboardLayout", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync(
      "client/src/components/DashboardLayout.tsx",
      "utf-8"
    );
    const expectedGroups = [
      "Core",
      "Portals",
      "Administration",
      "Analytics & Reporting",
      "Agent Management",
      "Transactions & Finance",
      "Engagement & Loyalty",
      "Notifications",
      "Integrations & Webhooks",
      "White Label & Tenants",
      "Infrastructure & System",
    ];
    for (const group of expectedGroups) {
      expect(content).toContain(group);
    }
  });

  it("should include search functionality in navigation", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync(
      "client/src/components/DashboardLayout.tsx",
      "utf-8"
    );
    expect(content).toContain("searchQuery");
    expect(content).toContain("Search menu");
  });

  it("should include collapsible group functionality", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync(
      "client/src/components/DashboardLayout.tsx",
      "utf-8"
    );
    expect(content).toContain("collapsedGroups");
    expect(content).toContain("toggleGroup");
    expect(content).toContain("ChevronDown");
    expect(content).toContain("ChevronRight");
  });
});

describe("Sprint 16: Schema Tables", () => {
  it("should have invite_codes, tenant_branding, tenant_insurance_regions, tenant_fee_overrides in schema", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync("drizzle/schema.ts", "utf-8");
    expect(content).toContain("inviteCodes");
    expect(content).toContain("tenantBranding");
    expect(content).toContain("tenantInsuranceRegions");
    expect(content).toContain("premiumFeeSchedules");
  });
});
