/**
 * merchantOnboardingFixes.integration.test.ts — G1 fix-wave (2026-06)
 *
 * Real-DB (PGlite) integration tests for the merchant-onboarding audit fixes.
 * All calls pass through the REAL production middleware chain (see
 * tests/integration/helpers/trpc.ts).
 *
 * Proves:
 *   CRIT-1  merchant portal auth is the Keycloak principal bound via
 *           merchants.keycloakSub — no merchant binding → FORBIDDEN, the old
 *           X-Merchant-Code static bearer no longer authenticates, suspended
 *           merchants are blocked (HIGH-11)
 *   CRIT-2  checkRegistrationStatus returns status ONLY (no merchantCode
 *           credential oracle, no business name)
 *   CRIT-3  settlement changes never apply inline; OTP to the registered
 *           phone gates the swap; applied change sets a payout hold
 *   CRIT-4  approveMerchant is admin-only, KYB-gated, guarded (no
 *           last-writer-wins) and advances the persisted KYC stage (MED-16)
 *   CRIT-5  initiatePayout pays only the VERIFIED settlement account, is
 *           denied to the plain agent role, and refuses during the
 *           settlement-change hold
 *   HIGH-6  a payout with NULL initiatedBy can never be approved
 *   HIGH-7  KYB doc decisions are admin-only; uploads are owner-or-admin
 *   HIGH-9  duplicate identity (email/phone) is a DB-enforced CONFLICT
 *   HIGH-10 merchantPayments.pay refuses unknown / non-active merchants
 *   MED-13  per-merchant limits override platform defaults
 *   MED-14  register is idempotent per identity
 */
import { describe, it, beforeAll, afterAll } from "vitest";
import bcrypt from "bcryptjs";
import { eq, and, inArray, sql } from "drizzle-orm";
import { getDb } from "../../server/db";
import {
  agents,
  merchants,
  merchantKycDocs,
  merchantKycStages,
  merchantPayouts,
  merchantSettlementChangeRequests,
  merchantFeeLimits,
  auditLog,
} from "../../drizzle/schema";
import {
  callerFor,
  adminUser,
  regularUser,
  expectCounted as expect,
  expectTrpcError,
  resetAssertionCount,
  getAssertionCount,
  type TestUser,
} from "./helpers/trpc";

const FILE = "merchantOnboardingFixes";

const merchantUser: TestUser = {
  id: 92001,
  email: "merchant1@integration.local",
  name: "Merchant One",
  role: "user",
  keycloakSub: "g1-merchant-sub-1",
};
const otherMerchantUser: TestUser = {
  id: 92002,
  email: "merchant2@integration.local",
  name: "Merchant Two",
  role: "user",
  keycloakSub: "g1-merchant-sub-2",
};

const KYC_DOC_TYPES = [
  "cac_certificate",
  "tin_certificate",
  "utility_bill",
  "bank_statement",
  "id_card",
  "passport",
  "bvn_verification",
  "memart",
];

async function seedMerchant(over: Partial<typeof merchants.$inferInsert>) {
  const db = (await getDb())!;
  const [m] = await db
    .insert(merchants)
    .values({
      merchantCode: over.merchantCode ?? `MCG1${Date.now()}`,
      businessName: "G1 Test Merchant",
      ownerName: "G1 Owner",
      email: `g1-${Date.now()}-${Math.random()}@test.local`,
      phone: `080${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`,
      address: "1 Test Street, Lagos",
      category: "retail",
      status: "pending",
      settlementAccountNumber: "0123456789",
      settlementBankCode: "058",
      settlementBankName: "GTBank",
      walletBalance: "0.00",
      totalVolume: "0.00",
      totalTransactions: 0,
      ...over,
    })
    .returning();
  return m;
}

const G1_SUBS = ["g1-merchant-sub-1", "g1-merchant-sub-2", "g1-suspended-sub"];

async function g1MerchantIds(): Promise<number[]> {
  const db = (await getDb())!;
  const rows = await db
    .select({ id: merchants.id })
    .from(merchants)
    .where(
      sql`${merchants.keycloakSub} IN (${sql.join(G1_SUBS.map(v => sql`${v}`), sql`, `)}) OR ${merchants.merchantCode} LIKE 'MCG1%' OR ${merchants.email} LIKE '%@test.local'`
    );
  return rows.map(r => r.id);
}

// Scoped cleanup: only G1-wave rows (the suite shares one DB with other
// files — never wipe tables wholesale).
async function cleanup() {
  const db = (await getDb())!;
  const ids = await g1MerchantIds();
  if (ids.length === 0) return;
  await db.delete(merchantSettlementChangeRequests).where(inArray(merchantSettlementChangeRequests.merchantId, ids));
  await db.delete(merchantFeeLimits).where(inArray(merchantFeeLimits.merchantId, ids));
  await db.delete(merchantPayouts).where(inArray(merchantPayouts.merchantId, ids));
  await db.delete(merchantKycDocs).where(inArray(merchantKycDocs.merchantId, ids));
  await db.delete(merchantKycStages).where(inArray(merchantKycStages.merchantId, ids));
  await db.delete(auditLog).where(and(eq(auditLog.resource, "merchants"), inArray(auditLog.resourceId, ids.map(String))));
  await db.delete(merchants).where(inArray(merchants.id, ids));
}

describe("merchant onboarding G1 fixes (integration, real DB)", () => {
  beforeAll(async () => {
    resetAssertionCount();
    await cleanup();
  });

  afterAll(async () => {
    console.log(`[integration] ${FILE}: ${getAssertionCount()} assertions`);
    await cleanup();
  });

  // ── CRIT-2 + MED-14: register / status / idempotency ──────────────────────
  it("register binds the caller identity; re-register is idempotent; status leaks no credential", async () => {
    const caller = callerFor(merchantUser);
    const reg = await caller.merchant.register({
      businessName: "G1 Grocery",
      ownerName: "Owner One",
      email: "g1-grocery@test.local",
      phone: "08030000001",
      address: "12 Broad Street, Lagos",
      category: "retail",
      settlementAccountNumber: "0123456789",
      settlementBankCode: "058",
      settlementBankName: "GTBank",
    });
    expect(reg.success).toBe(true);
    expect(reg.merchantCode).toMatch(/^MC/);

    const again = await caller.merchant.register({
      businessName: "G1 Grocery",
      ownerName: "Owner One",
      email: "g1-grocery@test.local",
      phone: "08030000001",
      address: "12 Broad Street, Lagos",
      category: "retail",
      settlementAccountNumber: "0123456789",
      settlementBankCode: "058",
      settlementBankName: "GTBank",
    });
    expect((again as { idempotent?: boolean }).idempotent).toBe(true);
    expect(again.merchantCode).toBe(reg.merchantCode);

    const status = await callerFor(regularUser).merchant.checkRegistrationStatus({
      email: "g1-grocery@test.local",
    });
    expect(status.found).toBe(true);
    // CRIT-2: no merchantCode / businessName in the payload.
    expect("merchantCode" in status).toBe(false);
    expect("businessName" in status).toBe(false);
    expect((status as { status?: string }).status).toBe("pending");
  });

  // ── HIGH-9: DB-enforced duplicate identity ────────────────────────────────
  it("duplicate email/phone identity is a DB-enforced CONFLICT (no race)", async () => {
    await expectTrpcError(
      callerFor(otherMerchantUser).merchant.register({
        businessName: "Shell Merchant",
        ownerName: "Shell Owner",
        email: "g1-grocery@test.local", // same email, different identity
        phone: "08030000009",
        address: "99 Fraud Avenue, Abuja",
        category: "other",
        settlementAccountNumber: "9999999999",
        settlementBankCode: "011",
        settlementBankName: "First Bank",
      }),
      "CONFLICT"
    );
    await expectTrpcError(
      callerFor(otherMerchantUser).merchant.register({
        businessName: "Shell Merchant",
        ownerName: "Shell Owner",
        email: "g1-shell@test.local",
        phone: "08030000001", // same phone, different identity
        address: "99 Fraud Avenue, Abuja",
        category: "other",
        settlementAccountNumber: "9999999999",
        settlementBankCode: "011",
        settlementBankName: "First Bank",
      }),
      "CONFLICT"
    );
  });

  // ── CRIT-1 / HIGH-11: authenticated merchant identity ─────────────────────
  it("portal access requires a bound merchant identity; suspended merchants are blocked", async () => {
    // Bound merchant works.
    const profile = await callerFor(merchantUser).merchant.getProfile();
    expect(profile.email).toBe("g1-grocery@test.local");

    // Authenticated user with NO keycloak merchant binding → UNAUTHORIZED
    // (the removed X-Merchant-Code static bearer cannot substitute).
    // 2026-09-19 (L-wave validation): regularUser now carries a keycloakSub
    // (helpers/trpc.ts fixtures gained one for the L-wave SoD checks), so the
    // "no keycloak identity" leg must strip it explicitly — otherwise the
    // fail-closed sub check passes and the assertion sees FORBIDDEN instead.
    await expectTrpcError(
      callerFor({ ...regularUser, keycloakSub: undefined }).merchant.getProfile(),
      "UNAUTHORIZED"
    );
    // A Keycloak principal with NO bound merchant row → FORBIDDEN.
    await expectTrpcError(
      callerFor({
        id: 92004,
        email: "unbound@integration.local",
        name: "Unbound",
        role: "user",
        keycloakSub: "g1-unbound-sub",
      }).merchant.getProfile(),
      "FORBIDDEN"
    );

    // Anonymous → UNAUTHORIZED.
    await expectTrpcError(callerFor(null).merchant.getProfile(), "UNAUTHORIZED");

    // HIGH-11: suspended merchant loses portal access.
    await seedMerchant({
      merchantCode: "MCG1SUSP01",
      keycloakSub: "g1-suspended-sub",
      status: "suspended",
    });
    await expectTrpcError(
      callerFor({
        id: 92003,
        email: "susp@integration.local",
        name: "Suspended",
        role: "user",
        keycloakSub: "g1-suspended-sub",
      }).merchant.getProfile(),
      "FORBIDDEN"
    );
  });

  // ── CRIT-3: settlement account changes require OTP + hold ─────────────────
  it("updateProfile cannot swap the settlement account; OTP-gated change applies with a hold + audit", async () => {
    const caller = callerFor(merchantUser);
    // Silent-swap attempt: settlement fields are no longer accepted/applied.
    await caller.merchant.updateProfile({
      address: "3 New Road, Lagos",
      // @ts-expect-error legacy field — must be ignored, never applied
      settlementAccountNumber: "5555555555",
    });
    const after = await caller.merchant.getProfile();
    expect(after.settlementAccountNumber).toBe("0123456789");

    // Request a change: pending request row + OTP to the registered phone.
    const req = await caller.merchant.requestSettlementChange({
      newAccountNumber: "5555555555",
      newBankCode: "011",
      newBankName: "First Bank",
    });
    expect(req.success).toBe(true);

    // Wrong OTP → FORBIDDEN (and attempt counter increments).
    await expectTrpcError(
      caller.merchant.confirmSettlementChange({
        requestId: req.requestId,
        otp: "000000",
      }),
      "FORBIDDEN"
    );

    // Success path: seed a fresh request with a KNOWN otp hash (the real OTP
    // is only ever delivered via SMS — same seeding pattern as pinResetOtp).
    const db = (await getDb())!;
    const [m] = await db
      .select({ id: merchants.id })
      .from(merchants)
      .where(eq(merchants.keycloakSub, "g1-merchant-sub-1"))
      .limit(1);
    await db
      .update(merchantSettlementChangeRequests)
      .set({ status: "expired" })
      .where(eq(merchantSettlementChangeRequests.merchantId, m.id));
    const [seeded] = await db
      .insert(merchantSettlementChangeRequests)
      .values({
        merchantId: m.id,
        newAccountNumber: "5555555555",
        newBankCode: "011",
        newBankName: "First Bank",
        hashedOtp: await bcrypt.hash("246810", 10),
        otpExpiresAt: new Date(Date.now() + 10 * 60 * 1000),
        requestedBy: merchantUser.id,
        status: "pending",
      })
      .returning({ id: merchantSettlementChangeRequests.id });

    const conf = await caller.merchant.confirmSettlementChange({
      requestId: seeded.id,
      otp: "246810",
    });
    expect(conf.success).toBe(true);
    expect(new Date(conf.holdUntil).getTime()).toBeGreaterThan(
      Date.now() + 23 * 3600 * 1000
    );
    const finalProfile = await caller.merchant.getProfile();
    expect(finalProfile.settlementAccountNumber).toBe("5555555555");
    expect(finalProfile.settlementBankCode).toBe("011");
    const audit = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, "MERCHANT_SETTLEMENT_ACCOUNT_CHANGED"));
    expect(audit.length).toBe(1);
  });

  // ── CRIT-4 / MED-16: admin-only, KYB-gated approval with real stage ───────
  it("approveMerchant: non-admin denied, KYB gate enforced, guarded transition, stage persisted", async () => {
    const m = await seedMerchant({ merchantCode: "MCG1APPROV1" });

    // Any-authenticated-user self-approval is gone.
    await expectTrpcError(
      callerFor(regularUser).merchantOnboardingPortal.approveMerchant({ id: m.id }),
      "FORBIDDEN"
    );

    // KYB incomplete → PRECONDITION_FAILED.
    await expectTrpcError(
      callerFor(adminUser).merchantOnboardingPortal.approveMerchant({ id: m.id }),
      "PRECONDITION_FAILED"
    );

    // Complete KYB (all docs approved by an admin).
    const db = (await getDb())!;
    for (const t of KYC_DOC_TYPES) {
      const [d] = await db
        .insert(merchantKycDocs)
        .values({ merchantId: m.id, docType: t, docUrl: "https://docs.test/x", status: "pending" })
        .returning({ id: merchantKycDocs.id });
      const v = await callerFor(adminUser).merchantKycOnboarding.verifyDoc({
        docId: d.id,
        approved: true,
      });
      expect(v.success).toBe(true);
    }

    // Stage before approval: derived compliance_review, never "approval".
    const prog = await callerFor(adminUser).merchantKycOnboarding.kycProgress({
      merchantId: m.id,
    });
    expect(prog.stage).toBe("compliance_review");

    const ok = await callerFor(adminUser).merchantOnboardingPortal.approveMerchant({ id: m.id });
    expect(ok.success).toBe(true);

    const [after] = await db
      .select({ status: merchants.status })
      .from(merchants)
      .where(eq(merchants.id, m.id));
    expect(after.status).toBe("active");

    const [stage] = await db
      .select()
      .from(merchantKycStages)
      .where(eq(merchantKycStages.merchantId, m.id));
    expect(stage.stage).toBe("activation");
    expect(stage.updatedBy).toBe(adminUser.id);

    const approvals = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, "merchant_approved"));
    expect(approvals.length).toBe(1);
    expect((approvals[0].metadata as { approvedBy?: number }).approvedBy).toBe(adminUser.id);

    // Guarded transition: re-approval is an honest CONFLICT, not silent overwrite.
    await expectTrpcError(
      callerFor(adminUser).merchantOnboardingPortal.approveMerchant({ id: m.id }),
      "CONFLICT"
    );
  });

  // ── HIGH-7: KYB docs admin/ownership ──────────────────────────────────────
  it("verifyDoc is admin-only; uploadDoc requires ownership", async () => {
    const m = await seedMerchant({
      merchantCode: "MCG1DOCS01",
      keycloakSub: "g1-merchant-sub-2",
    });
    const [d] = await (await getDb())!
      .insert(merchantKycDocs)
      .values({ merchantId: m.id, docType: "id_card", docUrl: "https://docs.test/id", status: "pending" })
      .returning({ id: merchantKycDocs.id });
    await expectTrpcError(
      callerFor(regularUser).merchantKycOnboarding.verifyDoc({ docId: d.id, approved: true }),
      "FORBIDDEN"
    );
    // Upload for someone else's merchant → FORBIDDEN.
    await expectTrpcError(
      callerFor(merchantUser).merchantKycOnboarding.uploadDoc({
        merchantId: m.id,
        docType: "passport",
        docUrl: "https://docs.test/pp",
      }),
      "FORBIDDEN"
    );
    // Owner upload works.
    const up = await callerFor(otherMerchantUser).merchantKycOnboarding.uploadDoc({
      merchantId: m.id,
      docType: "passport",
      docUrl: "https://docs.test/pp",
    });
    expect(up.doc.status).toBe("pending");
  });

  // ── HIGH-12: PII list endpoints are admin-only ────────────────────────────
  it("portal application lists are admin-only and mask settlement accounts", async () => {
    await expectTrpcError(
      callerFor(regularUser).merchantOnboardingPortal.listApplications({}),
      "FORBIDDEN"
    );
    const list = await callerFor(adminUser).merchantOnboardingPortal.listApplications({});
    expect(list.applications.length).toBeGreaterThan(0);
    const row = list.applications[0] as Record<string, unknown>;
    expect("settlementAccountNumber" in row).toBe(false);
    expect("ownerName" in row).toBe(false);
    expect("phone" in row).toBe(false);
  });

  // ── CRIT-5 / HIGH-6: payout destination + maker-checker ───────────────────
  it("initiatePayout: agent role denied, verified destination only, hold + balance enforced; NULL initiator unapprovable", async () => {
    const active = await seedMerchant({
      merchantCode: "MCG1PAYOUT1",
      status: "active",
      walletBalance: "100000.00",
      settlementAccountNumber: "1112223334",
      settlementBankCode: "044",
      settlementBankName: "Access Bank",
    });

    // Plain agent role must NOT hold the payout permission (was "transfer").
    await expectTrpcError(
      callerFor(regularUser).merchantPayoutSettlement.initiatePayout({
        merchantId: active.id,
        amount: 5000,
        bankCode: "999",
        accountNumber: "0000000000",
        accountName: "Attacker",
      } as never),
      "FORBIDDEN"
    );

    // Admin initiation: destination comes from the VERIFIED settlement
    // record even if the caller supplies a different one (input is ignored).
    const res = await callerFor(adminUser).merchantPayoutSettlement.initiatePayout({
      merchantId: active.id,
      amount: 5000,
      bankCode: "999",
      accountNumber: "0000000000",
      accountName: "Attacker",
    } as never);
    expect(res.payout.accountNumber).toBe("1112223334");
    expect(res.payout.bankCode).toBe("044");
    expect(res.payout.status).toBe("pending");

    // Balance gate.
    await expectTrpcError(
      callerFor(adminUser).merchantPayoutSettlement.initiatePayout({
        merchantId: active.id,
        amount: 500_000,
      }),
      "PRECONDITION_FAILED"
    );

    // Pending (non-active) merchant → refused.
    const pending = await seedMerchant({ merchantCode: "MCG1PAYOUT2" });
    await expectTrpcError(
      callerFor(adminUser).merchantPayoutSettlement.initiatePayout({
        merchantId: pending.id,
        amount: 5000,
      }),
      "PRECONDITION_FAILED"
    );

    // Settlement-change hold blocks payouts.
    const db = (await getDb())!;
    await db.insert(merchantSettlementChangeRequests).values({
      merchantId: active.id,
      newAccountNumber: "1112223334",
      newBankCode: "044",
      newBankName: "Access Bank",
      hashedOtp: await bcrypt.hash("111111", 10),
      otpExpiresAt: new Date(Date.now() + 600_000),
      requestedBy: adminUser.id,
      status: "applied",
      appliedAt: new Date(),
      holdUntil: new Date(Date.now() + 12 * 3600 * 1000),
    });
    await expectTrpcError(
      callerFor(adminUser).merchantPayoutSettlement.initiatePayout({
        merchantId: active.id,
        amount: 5000,
      }),
      "PRECONDITION_FAILED"
    );

    // HIGH-6: a payout row with NULL initiatedBy can never be approved.
    const [legacy] = await db
      .insert(merchantPayouts)
      .values({
        merchantId: active.id,
        amount: "1000",
        bankCode: "044",
        accountNumber: "1112223334",
        accountName: "G1 Test Merchant",
        reference: `PO-LEGACY-${Date.now()}`,
        status: "pending",
        initiatedBy: null,
        periodStart: new Date(),
        periodEnd: new Date(),
      })
      .returning({ id: merchantPayouts.id });
    await expectTrpcError(
      callerFor(adminUser).merchantPayoutSettlement.approvePayout({ payoutId: legacy.id }),
      "CONFLICT"
    );

    // Maker-checker still enforced for attributed payouts: the initiator
    // (adminUser) cannot approve their own payout.
    await expectTrpcError(
      callerFor(adminUser).merchantPayoutSettlement.approvePayout({
        payoutId: res.payout.id,
      }),
      "FORBIDDEN"
    );
  });

  // ── HIGH-10 / MED-13: payments only to real ACTIVE merchants, per-merchant limits ──
  it("merchantPayments.pay requires a real ACTIVE merchant and honors per-merchant limits", async () => {
    const caller = callerFor(adminUser);
    const db0 = (await getDb())!;
    const [payAgent] = await db0
      .insert(agents)
      .values({
        agentId: "AGT-G1-PAY-1",
        name: "G1 Pay Agent",
        phone: "08039990001",
        pinHash: "x",
        isActive: true,
        floatLocked: false,
      })
      .onConflictDoNothing()
      .returning({ id: agents.id });
    const payAgentId =
      payAgent?.id ??
      (await db0.select({ id: agents.id }).from(agents).where(eq(agents.agentId, "AGT-G1-PAY-1")).limit(1))[0].id;
    await expectTrpcError(
      caller.merchantPayments.pay({
        agentId: payAgentId,
        merchantId: "MC_DOES_NOT_EXIST",
        amountNGN: 1000,
        reference: `G1-NOPE-${Date.now()}`,
        paymentMethod: "transfer",
      }),
      "NOT_FOUND"
    );

    const pending = await seedMerchant({ merchantCode: "MCG1PAYPEND" });
    await expectTrpcError(
      caller.merchantPayments.pay({
        agentId: payAgentId,
        merchantId: pending.merchantCode,
        amountNGN: 1000,
        reference: `G1-PEND-${Date.now()}`,
        paymentMethod: "transfer",
      }),
      "PRECONDITION_FAILED"
    );

    // Per-merchant max limit (₦500) overrides the global ₦1M cap.
    const limited = await seedMerchant({
      merchantCode: "MCG1PAYLIMIT",
      status: "active",
    });
    const db = (await getDb())!;
    await db.insert(merchantFeeLimits).values({
      merchantId: limited.id,
      maxAmount: "500.00",
      updatedBy: adminUser.id,
    });
    await expectTrpcError(
      caller.merchantPayments.pay({
        agentId: payAgentId,
        merchantId: limited.merchantCode,
        amountNGN: 1000,
        reference: `G1-LIMIT-${Date.now()}`,
        paymentMethod: "transfer",
      }),
      "PRECONDITION_FAILED"
    );
  });
});
