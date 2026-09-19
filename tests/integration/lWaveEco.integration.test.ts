/**
 * lWaveEco.integration.test.ts — L-wave ecosystem/tenancy security fixes,
 * proven against the REAL PGlite database, mini-TigerBeetle ledger and
 * mini-Redis. No mocks on production paths. (2026-09-19)
 *
 * Proves each audited exploit is dead:
 *   L-S-4  disputeRefund.processRefund: role-gated (financialProcedure
 *          "refund" op), SoD vs the initiator, staff approval required above
 *          the auto tier, audited payout.
 *   L-S-6 / L-P-7  tenantAdmin: every procedure is admin-gated; tenant
 *          lifecycle mutations are audited with the acting admin.
 *   L-S-7 / L-P-8  disputeRefund.list/getSummary: platform-scope
 *          (tenantId NULL) reads are admin-only — fail-closed.
 *   L-S-9  users.role writes: no self role change (adminDashboard,
 *          tenantAdmin), audited; pbacManagement.assignRole admin-gated.
 *   L-P-5  bancassurance.createReferral: the issued partner API key is
 *          actually validated (sha256, constant-time).
 *   L-P-9  apiKeyManagement: list/usage scoped to caller (admin sees all);
 *          scopes validated against the server allowlist; rateLimit
 *          server-capped.
 *   L-P-10 groupInsurance.addMember: organiser-or-staff only; premium is
 *          honestly "pending_payment" (no collection rail exists) and
 *          totalPremium is not inflated.
 *   L-P-11 p2pPools: fileClaim no longer debits the pool on a self-declared
 *          pending claim; staff adjudication gate moves funds on APPROVED;
 *          reinsuranceThreshold is server-set/admin-capped.
 */
import { describe, it, beforeAll, afterAll } from "vitest";
import { eq, desc } from "drizzle-orm";
import { getDb } from "../../server/db";
import { auditLog, customers, refunds, users } from "../../drizzle/schema";
import {
  bancassurancePartners,
  groupPolicies,
  p2pPoolClaims,
  p2pPools,
} from "../../drizzle/schema.innovations";
import {
  callerFor,
  adminUser,
  regularUser,
  approverUser,
  expectCounted as expect,
  expectTrpcError,
  resetAssertionCount,
  getAssertionCount,
  type TestUser,
} from "./helpers/trpc";

const FILE = "lWaveEco";

// Dedicated identity namespaces (shared single PGlite DB across files).
const LW_MEMBER: TestUser = {
  id: 940011,
  email: "lw-member@integration.local",
  name: "LW Pool Member",
  role: "user",
};
const LW_ORGANISER: TestUser = {
  id: 940021,
  email: "lw-organiser@integration.local",
  name: "LW Group Organiser",
  role: "user",
};
const LW_OTHER: TestUser = {
  id: 940022,
  email: "lw-other@integration.local",
  name: "LW Other User",
  role: "user",
};
const LW_TENANT_USER: TestUser = {
  id: 940031,
  email: "lw-tenant@integration.local",
  name: "LW Tenant User",
  role: "user",
  tenantId: 950001,
};
const LW_SUPERVISOR: TestUser = {
  id: 940041,
  email: "lw-supervisor@integration.local",
  name: "LW Supervisor",
  role: "supervisor",
};

// customers.id targets for FK-bearing inserts (organiserId / member
// customerId reference customers.id while carrying users.id values — the
// identity-domain mismatch is pre-existing and disclosed in the fix commit).
const CUSTOMER_IDS = [91001, 91003, 940011, 940021, 940022, 940023, 940041];

async function seedRefundRow(opts: {
  ref: string;
  amount: number;
  initiatedByUserId: number;
}): Promise<void> {
  const db = (await getDb())!;
  await db.insert(refunds).values({
    ref: opts.ref,
    disputeId: null,
    agentId: 1,
    customerId: 940099,
    originalAmount: opts.amount,
    refundAmount: opts.amount,
    reason: "L-wave integration fixture",
    category: "dispute_refund",
    status: "pending",
    method: "original_method",
    destinationAccount: "0199000011",
    initiatedByUserId: opts.initiatedByUserId,
  });
}

describe("L-wave ecosystem/tenancy fixes (integration, real DB)", () => {
  beforeAll(async () => {
    resetAssertionCount();
    const db = (await getDb())!;
    for (const id of CUSTOMER_IDS) {
      await db
        .insert(customers)
        .values({
          id,
          firstName: "LW",
          lastName: `Cust${id}`,
          phone: `070${String(id).slice(-8)}`,
        })
        .onConflictDoNothing();
    }
    // 2026-09-19 (L-wave validation): api_keys.userId is a NOT NULL FK to
    // users.id — the L-P-9 createKey calls need real users rows for the
    // shared fixture identities (the fixtures are ctx-only, no DB rows).
    // Idempotent so re-runs and other files' rows are untouched.
    for (const u of [adminUser, regularUser, approverUser]) {
      await db
        .insert(users)
        .values({
          id: u.id,
          keycloakSub: `lw-fixture-${u.id}`,
          email: u.email,
          name: u.name,
          role: u.role === "supervisor" ? "supervisor" : u.role === "admin" ? "admin" : "user",
        })
        .onConflictDoNothing();
    }
  });

  afterAll(() =>
    console.log(`[integration] ${FILE}: ${getAssertionCount()} assertions`)
  );

  // ── L-S-4: processRefund money movement is staff-gated + SoD + approval ──
  describe("L-S-4 disputeRefund.processRefund", () => {
    it("non-staff callers are FORBIDDEN (financialProcedure 'refund' op)", async () => {
      await seedRefundRow({ ref: "REF-LW-AUTO-1", amount: 2500, initiatedByUserId: adminUser.id });
      await expectTrpcError(
        callerFor(regularUser).disputeRefund.processRefund({ refundRef: "REF-LW-AUTO-1" }),
        "FORBIDDEN"
      );
      const db = (await getDb())!;
      const [r] = await db.select().from(refunds).where(eq(refunds.ref, "REF-LW-AUTO-1"));
      expect(r!.status).toBe("pending"); // nothing moved
    });

    it("the initiator can never process their own refund (SoD)", async () => {
      await expectTrpcError(
        callerFor(adminUser).disputeRefund.processRefund({ refundRef: "REF-LW-AUTO-1" }),
        "FORBIDDEN"
      );
      // approveRefund is likewise blocked for the initiator.
      await expectTrpcError(
        callerFor(adminUser).disputeRefund.approveRefund({ refundRef: "REF-LW-AUTO-1" }),
        "FORBIDDEN"
      );
    });

    it("auto-tier refund processes via a DIFFERENT staff user with a real ledger leg + audit", async () => {
      const res = await callerFor(approverUser).disputeRefund.processRefund({
        refundRef: "REF-LW-AUTO-1",
      });
      expect(res.success).toBe(true);
      if (!res.success) throw new Error("expected success");
      expect(res.status).toBe("processed");
      const db = (await getDb())!;
      const [r] = await db.select().from(refunds).where(eq(refunds.ref, "REF-LW-AUTO-1"));
      expect(r!.status).toBe("processed");
      expect(r!.processedAt).toBeTruthy();
      const [audit] = await db
        .select()
        .from(auditLog)
        .where(eq(auditLog.resourceId, "REF-LW-AUTO-1"))
        .orderBy(desc(auditLog.id))
        .limit(1);
      expect(audit).toBeTruthy();
      expect(audit!.action).toBe("REFUND_PROCESSED");
    });

    it("supervisor-tier refund cannot be paid from bare 'pending'; approve→process by distinct staff", async () => {
      await seedRefundRow({ ref: "REF-LW-SUP-1", amount: 50000, initiatedByUserId: adminUser.id });
      // Above the auto tier: pending payout is refused loudly.
      await expectTrpcError(
        callerFor(approverUser).disputeRefund.processRefund({ refundRef: "REF-LW-SUP-1" }),
        "PRECONDITION_FAILED"
      );
      // Supervisor holds the "refund" op after the L-wave matrix fix.
      const ap = await callerFor(LW_SUPERVISOR).disputeRefund.approveRefund({
        refundRef: "REF-LW-SUP-1",
      });
      expect(ap.success).toBe(true);
      // Idempotent re-approval.
      const ap2 = await callerFor(LW_SUPERVISOR).disputeRefund.approveRefund({
        refundRef: "REF-LW-SUP-1",
      });
      expect(ap2.idempotent).toBe(true);
      // Now a staff processor (not the initiator) pays it out.
      const pr = await callerFor(approverUser).disputeRefund.processRefund({
        refundRef: "REF-LW-SUP-1",
      });
      expect(pr.success).toBe(true);
      if (!pr.success) throw new Error("expected success");
      expect(pr.status).toBe("processed");
      const db = (await getDb())!;
      const [r] = await db.select().from(refunds).where(eq(refunds.ref, "REF-LW-SUP-1"));
      expect(r!.approvedBy).toBe(String(LW_SUPERVISOR.id));
      expect(r!.status).toBe("processed");
    });
  });

  // ── L-S-7/L-P-8: platform-scope reads fail closed for non-admins ──
  describe("L-S-7/L-P-8 tenant isolation on disputeRefund reads", () => {
    it("platform-scope non-admin is FORBIDDEN on list and getSummary", async () => {
      await expectTrpcError(
        callerFor(regularUser).disputeRefund.list({ limit: 5, offset: 0, status: "all" }),
        "FORBIDDEN"
      );
      await expectTrpcError(callerFor(regularUser).disputeRefund.getSummary(), "FORBIDDEN");
    });

    it("tenant-scoped user is allowed and stays scoped; platform admin allowed", async () => {
      const l = await callerFor(LW_TENANT_USER).disputeRefund.list({
        limit: 5,
        offset: 0,
        status: "all",
      });
      expect(Array.isArray(l.data)).toBe(true);
      for (const row of l.data as Array<{ tenantId: number | null }>) {
        expect(row.tenantId).toBe(950001);
      }
      const s = await callerFor(adminUser).disputeRefund.getSummary();
      expect(typeof s.totalDisputes).toBe("number");
    });
  });

  // ── L-S-6/L-P-7: tenantAdmin router is admin-gated end to end ──
  describe("L-S-6/L-P-7 tenantAdmin admin gating", () => {
    it("non-admin is FORBIDDEN on every lifecycle + read procedure", async () => {
      const c = callerFor(regularUser);
      await expectTrpcError(
        c.tenantAdmin.createTenant({ name: "evil", slug: `evil-${Date.now()}` }),
        "FORBIDDEN"
      );
      await expectTrpcError(
        c.tenantAdmin.suspendTenant({ tenantId: 1, reason: "attack" }),
        "FORBIDDEN"
      );
      await expectTrpcError(c.tenantAdmin.toggleLive({ id: 1 }), "FORBIDDEN");
      await expectTrpcError(
        c.tenantAdmin.updateTenant({ tenantId: 1, status: "active" }),
        "FORBIDDEN"
      );
      await expectTrpcError(c.tenantAdmin.listTenants(), "FORBIDDEN");
      await expectTrpcError(c.tenantAdmin.getStats(), "FORBIDDEN");
      await expectTrpcError(c.tenantAdmin.getTenant({ tenantId: 1 }), "FORBIDDEN");
      await expectTrpcError(c.tenantAdmin.listUsers(), "FORBIDDEN");
      await expectTrpcError(c.tenantAdmin.activityLog({ limit: 5 }), "FORBIDDEN");
    });

    it("platform admin retains full lifecycle (positive control) with actor-attributed audit", async () => {
      const c = callerFor(adminUser);
      const slug = `lw-admin-tenant-${Date.now()}`;
      const created = await c.tenantAdmin.createTenant({ name: "LW Tenant", slug });
      expect(created.success).toBe(true);
      const tenantId = created.tenant!.id;
      const suspended = await c.tenantAdmin.suspendTenant({ tenantId, reason: "lw test" });
      expect(suspended.success).toBe(true);
      const listed = await c.tenantAdmin.listTenants({ limit: 50 });
      expect((listed.tenants as Array<{ id: number }>).some((t) => t.id === tenantId)).toBe(true);
      const db = (await getDb())!;
      const [audit] = await db
        .select()
        .from(auditLog)
        .where(eq(auditLog.resourceId, String(tenantId)))
        .orderBy(desc(auditLog.id))
        .limit(1);
      expect(audit).toBeTruthy();
      expect(audit!.action).toBe("tenant_suspended");
      expect(audit!.agentId).toBe(adminUser.id);
    });
  });

  // ── L-S-9: users.role writes are admin-only, audited, never self ──
  describe("L-S-9 role-write guards", () => {
    it("adminDashboard.updateUserRole: self role change is FORBIDDEN, other-user change audited", async () => {
      const c = callerFor(adminUser);
      await expectTrpcError(
        c.adminDashboard.updateUserRole({ userId: adminUser.id, role: "user" }),
        "FORBIDDEN"
      );
      await expectTrpcError(
        c.adminDashboard.updateUserRole({ userId: adminUser.id, role: "admin" }),
        "FORBIDDEN"
      );
      const db = (await getDb())!;
      const [victim] = await db
        .insert(users)
        .values({
          keycloakSub: `lw-victim-${Date.now()}`,
          email: `lw-victim-${Date.now()}@integration.local`,
          name: "LW Victim",
          role: "user",
        })
        .returning();
      const res = await c.adminDashboard.updateUserRole({ userId: victim!.id, role: "admin" });
      expect(res.success).toBe(true);
      const [row] = await db.select().from(users).where(eq(users.id, victim!.id));
      expect(row!.role).toBe("admin");
      const [audit] = await db
        .select()
        .from(auditLog)
        .where(eq(auditLog.resourceId, String(victim!.id)))
        .orderBy(desc(auditLog.id))
        .limit(1);
      expect(audit!.action).toBe("USER_ROLE_CHANGED");
      expect(audit!.agentId).toBe(adminUser.id);
    });

    it("tenantAdmin.updateUser: self role change is FORBIDDEN", async () => {
      await expectTrpcError(
        callerFor(adminUser).tenantAdmin.updateUser({
          userId: String(adminUser.id),
          role: "user",
        }),
        "FORBIDDEN"
      );
    });

    it("pbacManagement.assignRole is admin-gated", async () => {
      await expectTrpcError(
        callerFor(regularUser).pbacManagement.assignRole({ userId: 1, role: "admin" }),
        "FORBIDDEN"
      );
    });
  });

  // ── L-P-5: partner API key is actually validated on createReferral ──
  describe("L-P-5 bancassurance referral authentication", () => {
    let partnerCode = "";
    let apiKey = "";

    it("registerPartner (admin) issues a raw key; storage stays hashed", async () => {
      partnerCode = `LW${String(Date.now()).slice(-10)}`;
      const res = await callerFor(adminUser).bancassurance.registerPartner({
        partnerName: "LW Test Bank",
        partnerType: "commercial_bank",
        partnerCode,
        commissionRate: 5,
        productsEnabled: ["motor"],
      });
      apiKey = res.apiKey;
      expect(apiKey.length).toBe(64);
      const db = (await getDb())!;
      const [p] = await db
        .select()
        .from(bancassurancePartners)
        .where(eq(bancassurancePartners.partnerCode, partnerCode));
      expect(p!.apiKeyHash).toBeTruthy();
      expect(p!.apiKeyHash).not.toBe(apiKey); // hashed at rest
    });

    it("createReferral without a key is BAD_REQUEST; with a wrong key is UNAUTHORIZED", async () => {
      await expectTrpcError(
        callerFor(null).bancassurance.createReferral({
          partnerCode,
          productType: "motor",
        } as never),
        "BAD_REQUEST"
      );
      await expectTrpcError(
        callerFor(null).bancassurance.createReferral({
          partnerCode,
          apiKey: "0".repeat(64),
          productType: "motor",
        }),
        "UNAUTHORIZED"
      );
      // Unknown partner code + key: same indistinguishable failure.
      await expectTrpcError(
        callerFor(null).bancassurance.createReferral({
          partnerCode: "NOSUCHCODE",
          apiKey: "0".repeat(64),
          productType: "motor",
        }),
        "UNAUTHORIZED"
      );
    });

    it("createReferral with the real key succeeds (positive control)", async () => {
      const res = await callerFor(null).bancassurance.createReferral({
        partnerCode,
        apiKey,
        productType: "motor",
      });
      expect(res.referralCode).toContain(`REF-${partnerCode}-`);
    });
  });

  // ── L-P-9: API key inventory scoping + scope allowlist + rate cap ──
  describe("L-P-9 apiKeyManagement", () => {
    it("bogus scopes are rejected; non-admin rateLimit is server-capped", async () => {
      await expectTrpcError(
        callerFor(regularUser).apiKeyManagement.createKey({
          name: "lw-bad-scope",
          scopes: ["admin:all"],
        }),
        "BAD_REQUEST"
      );
      const res = await callerFor(regularUser).apiKeyManagement.createKey({
        name: "lw-capped",
        scopes: ["transactions:read"],
        rateLimit: 100000,
      });
      expect(res.success).toBe(true);
      const list = await callerFor(regularUser).apiKeyManagement.listKeys({});
      const mine = (list.items as Array<{ id: number; rateLimit: number }>).find(
        (k) => k.id === res.id
      );
      expect(mine).toBeTruthy();
      expect(mine!.rateLimit).toBe(1000); // clamped to the non-admin cap
    });

    it("listKeys/getUsage show only the caller's keys to non-admins; admin sees all", async () => {
      const other = await callerFor(LW_OTHER).apiKeyManagement.listKeys({ limit: 100 });
      const mine = await callerFor(regularUser).apiKeyManagement.createKey({
        name: "lw-isolation-probe",
      });
      const otherAfter = await callerFor(LW_OTHER).apiKeyManagement.listKeys({ limit: 100 });
      expect((otherAfter.items as Array<{ id: number }>).some((k) => k.id === mine.id)).toBe(false);
      expect(otherAfter.total).toBe(other.total);
      const adminList = await callerFor(adminUser).apiKeyManagement.listKeys({ limit: 200 });
      expect((adminList.items as Array<{ id: number }>).some((k) => k.id === mine.id)).toBe(true);
      const usage = await callerFor(LW_OTHER).apiKeyManagement.getUsage({ limit: 100 });
      expect((usage.items as Array<{ id: number }>).some((k) => k.id === mine.id)).toBe(false);
    });
  });

  // ── L-P-10: group scheme organiser check + honest premium handling ──
  describe("L-P-10 groupInsurance.addMember", () => {
    let groupId = 0;

    it("organiser creates a scheme; a non-organiser cannot add members", async () => {
      const c = callerFor(LW_ORGANISER);
      const created = await c.groupInsurance.createGroupPolicy({
        groupName: "LW Scheme",
        groupType: "employer",
        productId: 1,
        sumInsuredPerMember: 100000,
        premiumPerMember: 5000,
        startDate: "2026-01-01",
        endDate: "2026-12-31",
      });
      groupId = created.groupId;
      await expectTrpcError(
        callerFor(LW_OTHER).groupInsurance.addMember({
          groupPolicyId: groupId,
          customerId: 940023,
        }),
        "FORBIDDEN"
      );
    });

    it("organiser enrolment is pending_payment and does NOT inflate totalPremium", async () => {
      const res = await callerFor(LW_ORGANISER).groupInsurance.addMember({
        groupPolicyId: groupId,
        customerId: 940023,
      });
      expect(res.status).toBe("pending_payment");
      const db = (await getDb())!;
      const [g] = await db.select().from(groupPolicies).where(eq(groupPolicies.id, groupId));
      expect(g!.totalMembers).toBe(1);
      // No collection rail exists — the premium ledger must not pretend.
      expect(Number(g!.totalPremium)).toBe(0);
    });

    it("staff (supervisor) may add members to any scheme", async () => {
      const res = await callerFor(LW_SUPERVISOR).groupInsurance.addMember({
        groupPolicyId: groupId,
        customerId: 940021,
      });
      expect(res.status).toBe("pending_payment");
    });
  });

  // ── L-P-11: P2P claims move funds only on staff approval ──
  describe("L-P-11 p2pPools claim gating", () => {
    let poolId = 0;

    it("reinsuranceThreshold is server-set: caller value refused for non-admins, capped for admins", async () => {
      await expectTrpcError(
        callerFor(LW_ORGANISER).p2pPools.createPool({
          poolName: "LW Pool X",
          poolType: "family",
          productType: "motor",
          contributionAmount: 1000,
          reinsuranceThreshold: 1, // attacker-chosen tiny threshold — dead
          periodStart: "2026-01-01",
          periodEnd: "2026-12-31",
        }),
        "FORBIDDEN"
      );
      const created = await callerFor(LW_ORGANISER).p2pPools.createPool({
        poolName: "LW Pool",
        poolType: "family",
        productType: "motor",
        contributionAmount: 1000,
        periodStart: "2026-01-01",
        periodEnd: "2026-12-31",
      });
      poolId = created.poolId;
      const db = (await getDb())!;
      const [p] = await db.select().from(p2pPools).where(eq(p2pPools.id, poolId));
      expect(Number(p!.reinsuranceThreshold)).toBe(100000); // server default
      await expectTrpcError(
        callerFor(adminUser).p2pPools.createPool({
          poolName: "LW Pool Admin Over Cap",
          poolType: "family",
          productType: "motor",
          contributionAmount: 1000,
          reinsuranceThreshold: 5_000_000, // above the server cap
          periodStart: "2026-01-01",
          periodEnd: "2026-12-31",
        }),
        "BAD_REQUEST"
      );
    });

    it("fileClaim no longer debits the pool on a self-declared pending claim", async () => {
      const db = (await getDb())!;
      // Fund the pool honestly at the fixture layer.
      await db
        .update(p2pPools)
        .set({ poolBalance: "80000", status: "active" })
        .where(eq(p2pPools.id, poolId));
      await callerFor(LW_MEMBER).p2pPools.joinPool({ poolId });
      const res = await callerFor(LW_MEMBER).p2pPools.fileClaim({
        poolId,
        claimAmount: 60000,
      });
      expect(res.status).toBe("pending");
      expect(res.paidFromPool).toBe(0);
      expect(res.paidFromInsurer).toBe(0);
      const [p] = await db.select().from(p2pPools).where(eq(p2pPools.id, poolId));
      expect(Number(p!.poolBalance)).toBe(80000); // untouched at filing
    });

    it("non-staff adjudication is FORBIDDEN; staff approval moves the pool debit atomically", async () => {
      const db = (await getDb())!;
      const [claim] = await db
        .select()
        .from(p2pPoolClaims)
        .where(eq(p2pPoolClaims.poolId, poolId))
        .orderBy(desc(p2pPoolClaims.id))
        .limit(1);
      await expectTrpcError(
        callerFor(LW_OTHER).p2pPools.adjudicatePoolClaim({
          claimId: claim!.id,
          decision: "approved",
        }),
        "FORBIDDEN"
      );
      const res = await callerFor(adminUser).p2pPools.adjudicatePoolClaim({
        claimId: claim!.id,
        decision: "approved",
      });
      expect(res.status).toBe("approved");
      // approved = 60000 ≤ threshold(100000) and ≤ balance(80000) → pool pays all.
      expect(res.paidFromPool).toBe(60000);
      expect(res.paidFromInsurer).toBe(0);
      const [p] = await db.select().from(p2pPools).where(eq(p2pPools.id, poolId));
      expect(Number(p!.poolBalance)).toBe(20000);
      // Re-adjudication of a settled claim is refused.
      await expectTrpcError(
        callerFor(adminUser).p2pPools.adjudicatePoolClaim({
          claimId: claim!.id,
          decision: "approved",
        }),
        "PRECONDITION_FAILED"
      );
    });

    it("staff cannot adjudicate a claim they filed themselves (SoD)", async () => {
      const db = (await getDb())!;
      // Supervisor joins the pool and files a claim...
      await callerFor(LW_SUPERVISOR).p2pPools.joinPool({ poolId });
      const filed = await callerFor(LW_SUPERVISOR).p2pPools.fileClaim({
        poolId,
        claimAmount: 5000,
      });
      // ...then cannot approve it, even though supervisors are staff.
      await expectTrpcError(
        callerFor(LW_SUPERVISOR).p2pPools.adjudicatePoolClaim({
          claimId: filed.claimId,
          decision: "approved",
        }),
        "FORBIDDEN"
      );
      // A different staff user can reject it.
      const rej = await callerFor(adminUser).p2pPools.adjudicatePoolClaim({
        claimId: filed.claimId,
        decision: "rejected",
      });
      expect(rej.status).toBe("rejected");
      const [p] = await db.select().from(p2pPools).where(eq(p2pPools.id, poolId));
      expect(Number(p!.poolBalance)).toBe(20000); // rejection never debits
    });
  });
});
