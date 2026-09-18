/**
 * individualOnboardingG2.integration.test.ts — real-DB (PGlite/Postgres)
 * integration tests for the G2 individual-onboarding fix wave (2026-02).
 *
 * Covers:
 *   #1  verifyKycWithNibss — no format-only "verified"; unconfigured service
 *       throws (fail-loud); a REAL adjudicated verified response (local HTTP
 *       service boundary, same discipline as the Go httptest provider tests)
 *       marks KYC verified and activates the customer.
 *   #5/#7 createOrFetchCustomer — NIN/BVN blind-index dedupe rejects a second
 *       customer for the same national ID.
 *   #6  assertCustomerKycVerified — policy-purchase KYC gate (fail-closed).
 *   #8  phone-match merge requires phone-ownership OTP proof.
 *   #9  customer.account.register binds keycloakSub; BVN dedupe CONFLICT.
 *   #10 advanceStage — server-derived stage; client-asserted fromStage cannot
 *       bypass the KYC gate; ownership enforced.
 *   #11 referrals awardBonus — FORBIDDEN for non-owner; no qualifying
 *       transaction → no payout; qualifying transaction → single award.
 *   #18 customer.account.update — under-18 DOB rejected (fail-closed).
 */
import { describe, it, beforeAll, afterAll } from "vitest";
import bcrypt from "bcryptjs";
import http from "node:http";
import { eq } from "drizzle-orm";

import { getDb } from "../../server/db";
import {
  customers,
  users,
  agents,
  referrals,
  transactions,
  phoneVerificationOtps,
  kycVerifications,
} from "../../drizzle/schema";
import { policyQuotes } from "../../drizzle/schema.additions";
import {
  createOrFetchCustomer,
  verifyKycWithNibss,
  assertCustomerKycVerified,
  validateInsuranceQuote,
} from "../../server/journey-activities";
import {
  verifyPhoneOwnershipOtp,
  hasPhoneOwnershipProof,
} from "../../server/lib/phoneOtp";
import { router } from "../../server/_core/trpc";
import { customerOnboardingPipelineRouter } from "../../server/routers/customerOnboardingPipeline";
import { referralsRouter } from "../../server/routers/referrals";
import { customerRouter } from "../../server/routers/customer";
import {
  callerFor,
  adminUser,
  regularUser,
  expectCounted as expect,
  resetAssertionCount,
  getAssertionCount,
} from "./helpers/trpc";
import type { TrpcContext } from "../../server/_core/context";
import type { User } from "../../drizzle/schema";

const FILE = "individualOnboardingG2";
type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

// Extra router mount for the G2 paths (same production mount names).
const g2Router = router({
  customerOnboardingPipeline: customerOnboardingPipelineRouter,
  referrals: referralsRouter,
  customer: customerRouter,
});
function g2Caller(user: Pick<User, "id" | "email" | "name" | "role">) {
  const ctx = {
    user: user as User,
    req: { headers: {} } as unknown as TrpcContext["req"],
    res: { cookie: () => undefined, clearCookie: () => undefined } as unknown as TrpcContext["res"],
    requestId: "g2-integration",
  };
  return g2Router.createCaller(ctx);
}

let db: Db;
const SUFFIX = Date.now().toString(36).slice(-6);
const phone = (n: string) => `+23480${n}`.slice(0, 15);

beforeAll(async () => {
  resetAssertionCount();
  const instance = await getDb();
  if (!instance) throw new Error("DB unavailable in integration setup");
  db = instance;
  // users rows for FK (customer_onboarding_progress.user_id → users.id)
  for (const u of [adminUser, regularUser]) {
    const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.id, u.id)).limit(1);
    if (!existing) {
      await db.insert(users).values({
        id: u.id,
        keycloakSub: `g2-test-${u.id}-${SUFFIX}`,
        name: u.name,
        email: u.email,
        role: u.role as "admin" | "user",
      } as typeof users.$inferInsert);
    }
  }
});

afterAll(() => {
  console.log(`[${FILE}] assertions: ${getAssertionCount()}`);
});

// ─── #1: verifyKycWithNibss — real verification only ────────────────────────
describe("#1 verifyKycWithNibss", () => {
  it("rejects a malformed (non-11-digit) NIN without any verified mark", async () => {
    const cust = await createOrFetchCustomer({ fullName: "G2 One", phone: phone(`100${SUFFIX}`) });
    const res = await verifyKycWithNibss({ customerId: cust.customerId, nin: "12345" });
    expect(res.verified).toBe(false);
    const [c] = await db.select().from(customers).where(eq(customers.id, cust.customerId));
    expect(c.status).toBe("pending_kyc"); // never activated by format alone
  });

  it("throws (fail-loud) when the verification service is unconfigured", async () => {
    const cust = await createOrFetchCustomer({ fullName: "G2 Two", phone: phone(`101${SUFFIX}`) });
    const savedUrl = process.env.ENHANCED_KYC_URL;
    const savedKey = process.env.ENHANCED_KYC_API_KEY;
    delete process.env.ENHANCED_KYC_URL;
    delete process.env.ENHANCED_KYC_API_KEY;
    try {
      await expect(
        verifyKycWithNibss({ customerId: cust.customerId, nin: "12345678901" })
      ).rejects.toThrow(/ENHANCED_KYC_URL/);
    } finally {
      if (savedUrl) process.env.ENHANCED_KYC_URL = savedUrl;
      if (savedKey) process.env.ENHANCED_KYC_API_KEY = savedKey;
    }
    const [c] = await db.select().from(customers).where(eq(customers.id, cust.customerId));
    expect(c.status).toBe("pending_kyc");
  });

  it("marks verified ONLY on an adjudicated verified provider response", async () => {
    // Real HTTP service boundary (no in-process mock): responds like
    // enhanced-kyc-kyb does after a positive NIBSS adjudication.
    const server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        if (req.headers.authorization !== "Bearer g2-test-key") {
          res.writeHead(401).end(JSON.stringify({ error: "unauthorized" }));
          return;
        }
        const parsed = JSON.parse(body);
        const ok = parsed.nin === "11111111111";
        res.writeHead(200, { "Content-Type": "application/json" }).end(
          JSON.stringify({ verified: ok, status: ok ? "verified" : "failed" })
        );
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as { port: number }).port;
    process.env.ENHANCED_KYC_URL = `http://127.0.0.1:${port}`;
    process.env.ENHANCED_KYC_API_KEY = "g2-test-key";
    try {
      // verified path
      const cust = await createOrFetchCustomer({ fullName: "G2 Three", phone: phone(`102${SUFFIX}`) });
      const [kyc] = await db.insert(kycVerifications).values({
        customerId: cust.customerId,
        verificationType: "nin",
        documentNumber: "11111111111",
        status: "pending",
      }).returning();
      const res = await verifyKycWithNibss({ kycId: kyc.id, customerId: cust.customerId, nin: "11111111111" });
      expect(res.verified).toBe(true);
      const [c] = await db.select().from(customers).where(eq(customers.id, cust.customerId));
      expect(c.status).toBe("active");
      const [k] = await db.select().from(kycVerifications).where(eq(kycVerifications.id, kyc.id));
      expect(k.status).toBe("verified");

      // failed adjudication path → no verified mark, no activation
      const cust2 = await createOrFetchCustomer({ fullName: "G2 Four", phone: phone(`103${SUFFIX}`) });
      const res2 = await verifyKycWithNibss({ customerId: cust2.customerId, nin: "22222222222" });
      expect(res2.verified).toBe(false);
      const [c2] = await db.select().from(customers).where(eq(customers.id, cust2.customerId));
      expect(c2.status).toBe("pending_kyc");
    } finally {
      delete process.env.ENHANCED_KYC_URL;
      delete process.env.ENHANCED_KYC_API_KEY;
      await new Promise((r) => server.close(r));
    }
  });
});

// ─── #5/#7: duplicate identity ───────────────────────────────────────────────
describe("#7 duplicate identity (NIN/BVN dedupe)", () => {
  it("rejects a second customer with the same NIN", async () => {
    await createOrFetchCustomer({ fullName: "G2 Five", phone: phone(`104${SUFFIX}`), nin: "33333333333" });
    await expect(
      createOrFetchCustomer({ fullName: "G2 Six", phone: phone(`105${SUFFIX}`), nin: "33333333333" })
    ).rejects.toThrow(/DUPLICATE_IDENTITY/);
  });

  it("rejects a second customer with the same BVN", async () => {
    await createOrFetchCustomer({ fullName: "G2 Seven", phone: phone(`106${SUFFIX}`), bvn: "44444444444" });
    await expect(
      createOrFetchCustomer({ fullName: "G2 Eight", phone: phone(`107${SUFFIX}`), bvn: "44444444444" })
    ).rejects.toThrow(/DUPLICATE_IDENTITY/);
  });
});

// ─── #8: phone-merge requires ownership proof ───────────────────────────────
describe("#8 phone-merge ownership proof", () => {
  it("blocks merge without proof, allows after OTP verification", async () => {
    const p = phone(`108${SUFFIX}`);
    const first = await createOrFetchCustomer({ fullName: "G2 Nine", phone: p });
    expect(first.isNew).toBe(true);

    // No proof → honest refusal (no silent merge).
    await expect(
      createOrFetchCustomer({ fullName: "G2 Ten", phone: p })
    ).rejects.toThrow(/PHONE_OWNERSHIP_PROOF_REQUIRED/);

    // Plant an OTP directly (bcrypt at rest, same as requestPhoneOwnershipOtp)
    // and verify it — proof marker must then authorize the merge.
    const hashed = await bcrypt.hash("424242", 10);
    await db.insert(phoneVerificationOtps).values({
      phone: p,
      hashedOtp: hashed,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    });
    const v = await verifyPhoneOwnershipOtp(p, "424242");
    expect(v.verified).toBe(true);
    expect(await hasPhoneOwnershipProof(p)).toBe(true);

    const merged = await createOrFetchCustomer({ fullName: "G2 Ten", phone: p });
    expect(merged.isNew).toBe(false);
    expect(merged.customerId).toBe(first.customerId);
  });
});

// ─── #6: KYC gate for policy purchase ───────────────────────────────────────
describe("#6 KYC/tier gate + server-computed quote", () => {
  it("blocks purchase for unverified customers, passes for active", async () => {
    const cust = await createOrFetchCustomer({ fullName: "G2 Eleven", phone: phone(`109${SUFFIX}`) });
    await expect(assertCustomerKycVerified({ customerId: cust.customerId })).rejects.toThrow(/KYC_REQUIRED/);
    await db.update(customers).set({ status: "active" }).where(eq(customers.id, cust.customerId));
    const ok = await assertCustomerKycVerified({ customerId: cust.customerId });
    expect(ok.verified).toBe(true);
  });

  it("validateInsuranceQuote is fail-closed and carries server pricing", async () => {
    const cust = await createOrFetchCustomer({ fullName: "G2 Twelve", phone: phone(`110${SUFFIX}`) });
    const [quote] = await db.insert(policyQuotes).values({
      customerId: cust.customerId,
      productId: 1,
      sumInsured: "500000",
      premiumAmount: "12500",
      status: "pending",
    }).returning();
    // server-computed path (premiumAmount 0) → valid, quote row returned
    const ok = await validateInsuranceQuote({ quoteId: quote.id, customerId: cust.customerId, premiumAmount: 0 });
    expect(ok.valid).toBe(true);
    expect(Number((ok.quote as typeof quote).premiumAmount)).toBe(12500);
    // client-asserted wrong premium → throws
    await expect(
      validateInsuranceQuote({ quoteId: quote.id, customerId: cust.customerId, premiumAmount: 100 })
    ).rejects.toThrow(/Premium mismatch/);
    // expired quote → throws
    await db.update(policyQuotes).set({ validUntil: new Date(Date.now() - 1000) }).where(eq(policyQuotes.id, quote.id));
    await expect(
      validateInsuranceQuote({ quoteId: quote.id, customerId: cust.customerId, premiumAmount: 0 })
    ).rejects.toThrow(/expired/);
    // missing quote → throws (the old .catch(() => valid) would have swallowed this)
    await expect(
      validateInsuranceQuote({ quoteId: 99999999, customerId: cust.customerId, premiumAmount: 0 })
    ).rejects.toThrow(/not found/);
  });
});

// ─── #9/#18: customer.account.register / update ─────────────────────────────
describe("#9 register binds identity; #18 minor guard", () => {
  it("register sets keycloakSub from the session, dedupes phone and BVN", async () => {
    const caller = g2Caller(regularUser);
    const created = await caller.customer.account.register({
      firstName: "G2",
      lastName: "Thirteen",
      phone: phone(`111${SUFFIX}`),
      bvn: "55555555555",
    });
    expect((created as { keycloakSub?: string }).keycloakSub).toBe(String(regularUser.id));

    // same identity twice → CONFLICT
    await expect(
      caller.customer.account.register({ firstName: "G2", lastName: "X", phone: phone(`112${SUFFIX}`) })
    ).rejects.toMatchObject({ code: "CONFLICT" });

    // another identity, same phone → CONFLICT
    const other = g2Caller({ ...regularUser, id: 91005, email: "g2b@integration.local" });
    await expect(
      other.customer.account.register({ firstName: "G2", lastName: "Y", phone: phone(`111${SUFFIX}`) })
    ).rejects.toMatchObject({ code: "CONFLICT" });

    // another identity, same BVN → CONFLICT (duplicate identity)
    await expect(
      other.customer.account.register({ firstName: "G2", lastName: "Z", phone: phone(`113${SUFFIX}`), bvn: "55555555555" })
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("update rejects an under-18 dateOfBirth (fail-closed)", async () => {
    const caller = g2Caller(regularUser);
    const minorDob = new Date();
    minorDob.setFullYear(minorDob.getFullYear() - 15);
    await expect(
      caller.customer.account.update({ dateOfBirth: minorDob.toISOString().slice(0, 10) })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

// ─── #10: advanceStage is server-derived ────────────────────────────────────
describe("#10 onboarding pipeline server-derived stage", () => {
  it("cannot bypass the KYC gate with a client-asserted fromStage", async () => {
    const caller = g2Caller(regularUser);
    const uid = String(regularUser.id);

    // The audit's exploit: claim fromStage=kyc_review to skip the KYC gate.
    // The server derives the REAL stage (registration) → the client-asserted
    // hint conflicts with the stored stage → CONFLICT, and nothing advances.
    // (Honest-contract fix 2026-02: was asserted as BAD_REQUEST before the
    // stale-stage CONFLICT check was placed first; the security property —
    // no bypass, no advancement — is what is pinned here.)
    await expect(
      caller.customerOnboardingPipeline.advanceStage({ userId: uid, fromStage: "kyc_review", toStage: "account_setup" })
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const progressAfterExploit = await caller.customerOnboardingPipeline.getProgress({ userId: uid });
    expect(progressAfterExploit.currentStage).toBe("registration");

    // Legit first step persists the durable stage.
    const step1 = await caller.customerOnboardingPipeline.advanceStage({ userId: uid, toStage: "kyc_submission" });
    expect(step1.fromStage).toBe("registration");

    // Stale client hint → CONFLICT (server stage wins).
    await expect(
      caller.customerOnboardingPipeline.advanceStage({ userId: uid, fromStage: "registration", toStage: "kyc_review" })
    ).rejects.toMatchObject({ code: "CONFLICT" });

    // KYC gate: no completed KYC session → PRECONDITION_FAILED even though
    // the transition is one legal step.
    await expect(
      caller.customerOnboardingPipeline.advanceStage({ userId: uid, toStage: "kyc_review" })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });

    // Ownership: another user's pipeline is off-limits.
    await expect(
      caller.customerOnboardingPipeline.advanceStage({ userId: String(adminUser.id), toStage: "kyc_submission" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

// ─── #11: referral awardBonus is not caller-triggerable ─────────────────────
describe("#11 referral bonus requires a real qualifying transaction", () => {
  it("FORBIDDEN for non-owner, no payout without a successful transaction, single award with one", async () => {
    const mk = async (code: string) => {
      const [a] = await db.insert(agents).values({
        agentId: code,
        name: `G2 Agent ${code}`,
        phone: phone(`2${code}${SUFFIX}`),
        pinHash: "g2-test-hash",
      }).returning();
      return a;
    };
    const referrer = await mk(`R1${SUFFIX}`.slice(0, 12));
    const referee = await mk(`R2${SUFFIX}`.slice(0, 12));
    await db.insert(referrals).values({
      referrerAgentId: referrer.id,
      referrerCode: referrer.agentId,
      referralCode: `REF${SUFFIX}`.slice(0, 16),
      refereeAgentId: referee.id,
      refereeCode: referee.agentId,
      status: "activated",
      bonusPoints: 500,
      bonusCash: "1000",
      expiresAt: new Date(Date.now() + 30 * 86400000),
    });

    // Non-owner, non-admin (no agent session) → FORBIDDEN.
    await expect(
      g2Caller(regularUser).referrals.awardBonus({ refereeAgentCode: referee.agentId })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    // Admin, but NO qualifying transaction → no payout.
    const admin = g2Caller(adminUser);
    const noQual = await admin.referrals.awardBonus({ refereeAgentCode: referee.agentId });
    expect(noQual.awarded).toBe(false);

    // Plant the referee's first successful transaction → award succeeds once.
    await db.insert(transactions).values({
      ref: `TX${SUFFIX}`.slice(0, 32),
      agentId: referee.id,
      type: "Cash In",
      amount: "5000",
      status: "success",
    });
    const awarded = await admin.referrals.awardBonus({ refereeAgentCode: referee.agentId });
    expect(awarded.awarded).toBe(true);

    // Second award attempt → already rewarded, no double-pay.
    const again = await admin.referrals.awardBonus({ refereeAgentCode: referee.agentId });
    expect(again.awarded).toBe(false);

    const [ref] = await db.select().from(agents).where(eq(agents.id, referrer.id));
    expect(ref.loyaltyPoints).toBe(500);
    expect(Number(ref.commissionBalance)).toBe(1000);
  });
});
