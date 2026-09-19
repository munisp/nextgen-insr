/**
 * iWaveIndividual.integration.test.ts — I-wave referral/loyalty/promo gaming
 * cluster (2026-02), real-DB (PGlite/Postgres) integration tests:
 *
 *   AB-11 referrals.markRewarded — non-staff FORBIDDEN; staff flip is coupled
 *        to the REAL bonus award atomically (points + commission balance).
 *   AB-12 loyalty earnPoints — non-staff arbitrary grant to another
 *        customerId FORBIDDEN; session-bound earn works and is bounded;
 *        staff grant works (audited). customerLoyaltyProgram.earnPoints is
 *        staff-only.
 *   AB-13 applyReferral — one-time per referee identity: second application
 *        (any caller) is CONFLICT and the referrer is NOT credited twice.
 *   AB-14 validateCoupon — perCustomerLimit enforced at validation time,
 *        consistent with the redemption ledger; identity session-derived.
 */
import { describe, it, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";

import { getDb } from "../../server/db";
import { agents, customers, referrals } from "../../drizzle/schema";
import {
  promotions,
  couponRedemptions,
  loyaltyAccounts,
  loyaltyTransactions,
} from "../../drizzle/insurance-extended-schema";
import { router } from "../../server/_core/trpc";
import { referralsRouter } from "../../server/routers/referrals";
import { promotionsRouter } from "../../server/routers/promotions";
import { customerLoyaltyProgramRouter } from "../../server/routers/customerLoyaltyProgram";
import {
  adminUser,
  regularUser,
  expectCounted as expect,
  resetAssertionCount,
  getAssertionCount,
} from "./helpers/trpc";
import type { TrpcContext } from "../../server/_core/context";
import type { User } from "../../drizzle/schema";

const FILE = "iWaveIndividual";
type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
let db: Db;
const SUFFIX = Date.now().toString(36).slice(-6);

// Production-path mount (none of these are in the shared integration mount).
const iRouter = router({
  referrals: referralsRouter,
  promotions: promotionsRouter,
  customerLoyaltyProgram: customerLoyaltyProgramRouter,
});
function iCaller(user: Pick<User, "id" | "email" | "name" | "role">) {
  const ctx = {
    user: user as User,
    req: { headers: {} } as unknown as TrpcContext["req"],
    res: { cookie: () => undefined, clearCookie: () => undefined } as unknown as TrpcContext["res"],
    requestId: "i-wave-integration",
  };
  return iRouter.createCaller(ctx);
}

async function mkCustomer(keycloakSub: string, phone: string) {
  const [existing] = await db.select().from(customers).where(eq(customers.keycloakSub, keycloakSub)).limit(1);
  if (existing) return existing;
  const [c] = await db.insert(customers).values({
    firstName: "I", lastName: "Cust", phone, status: "active", keycloakSub,
  } as typeof customers.$inferInsert).returning();
  return c;
}

async function mkLoyalty(customerId: number, code: string) {
  const [existing] = await db.select().from(loyaltyAccounts).where(eq(loyaltyAccounts.customerId, customerId)).limit(1);
  if (existing) return existing;
  const [a] = await db.insert(loyaltyAccounts).values({ customerId, referralCode: code }).returning();
  return a;
}

beforeAll(async () => {
  resetAssertionCount();
  const instance = await getDb();
  if (!instance) throw new Error("DB unavailable in integration setup");
  db = instance;

  // Fixture (2026-02): the integration harness materializes drizzle/schema
  // only; insurance-extended-schema tables are created here verbatim (same
  // discipline as the H2 wave fixture).
  await db.execute(
    `CREATE TABLE IF NOT EXISTS "promotions" (
      "id" serial PRIMARY KEY, "storeId" integer, "name" text NOT NULL,
      "code" varchar(64) NOT NULL, "type" varchar(32) NOT NULL,
      "value" numeric(12,2) NOT NULL, "minOrderAmount" numeric(12,2),
      "maxDiscount" numeric(12,2), "usageLimit" integer,
      "perCustomerLimit" integer DEFAULT 1 NOT NULL,
      "usedCount" integer DEFAULT 0 NOT NULL,
      "isActive" boolean DEFAULT true NOT NULL,
      "applicableProducts" integer[], "applicableCategories" integer[],
      "startDate" timestamp NOT NULL, "endDate" timestamp NOT NULL,
      "createdAt" timestamp DEFAULT now() NOT NULL, "updatedAt" timestamp DEFAULT now() NOT NULL
    )`
  );
  await db.execute(
    `CREATE TABLE IF NOT EXISTS "coupon_redemptions" (
      "id" serial PRIMARY KEY,
      "promoId" integer NOT NULL REFERENCES "promotions"("id"),
      "customerId" integer NOT NULL, "orderId" integer,
      "createdAt" timestamp DEFAULT now() NOT NULL
    )`
  );
  await db.execute(
    `CREATE TABLE IF NOT EXISTS "loyalty_accounts" (
      "id" serial PRIMARY KEY, "customerId" integer NOT NULL,
      "points" integer DEFAULT 0 NOT NULL,
      "lifetimePoints" integer DEFAULT 0 NOT NULL,
      "tier" varchar(16) DEFAULT 'bronze' NOT NULL,
      "referralCode" varchar(16) NOT NULL, "referredBy" integer,
      "createdAt" timestamp DEFAULT now() NOT NULL,
      "updatedAt" timestamp DEFAULT now() NOT NULL
    )`
  );
  await db.execute(
    `CREATE TABLE IF NOT EXISTS "loyalty_transactions" (
      "id" serial PRIMARY KEY, "accountId" integer NOT NULL,
      "points" integer NOT NULL, "type" varchar(32) NOT NULL,
      "description" text, "orderId" integer,
      "createdAt" timestamp DEFAULT now() NOT NULL
    )`
  );
});

afterAll(() => {
  console.log(`[${FILE}] assertions: ${getAssertionCount()}`);
});

// ─── AB-11: markRewarded ────────────────────────────────────────────────────
describe("AB-11 markRewarded staff-gated + atomically coupled to the award", () => {
  it("non-staff is FORBIDDEN; staff flip pays the referrer exactly once", async () => {
    const [referrer] = await db.insert(agents).values({
      agentId: `IA${SUFFIX}`.slice(0, 12), name: "I Referrer",
      phone: `+234830${SUFFIX}`.slice(0, 15), pinHash: "i-test-hash",
    } as typeof agents.$inferInsert).returning();
    const [referee] = await db.insert(agents).values({
      agentId: `IB${SUFFIX}`.slice(0, 12), name: "I Referee",
      phone: `+234831${SUFFIX}`.slice(0, 15), pinHash: "i-test-hash",
    } as typeof agents.$inferInsert).returning();
    const [ref] = await db.insert(referrals).values({
      referrerAgentId: referrer.id, referrerCode: referrer.agentId,
      referralCode: `IR${SUFFIX}`.slice(0, 16), refereeAgentId: referee.id,
      refereeCode: referee.agentId, status: "activated",
      bonusPoints: 500, bonusCash: "1000",
      expiresAt: new Date(Date.now() + 30 * 86400000),
    }).returning();

    // (a) non-staff → FORBIDDEN, nothing changes
    await expect(iCaller(regularUser).referrals.markRewarded({ id: ref.id }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    const [stillActivated] = await db.select().from(referrals).where(eq(referrals.id, ref.id));
    expect(stillActivated.status).toBe("activated");

    // (b) staff → flip AND the bonus is actually paid (coupled, atomic)
    const ok = await iCaller(adminUser).referrals.markRewarded({ id: ref.id });
    expect(ok.status).toBe("rewarded");
    const [paid] = await db.select().from(agents).where(eq(agents.id, referrer.id));
    expect(paid.loyaltyPoints).toBe(500);
    expect(Number(paid.commissionBalance)).toBe(1000);

    // (c) double reward → BAD_REQUEST (not rewardable), no double-pay
    await expect(iCaller(adminUser).referrals.markRewarded({ id: ref.id }))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });
    const [paidOnce] = await db.select().from(agents).where(eq(agents.id, referrer.id));
    expect(paidOnce.loyaltyPoints).toBe(500);
  });
});

// ─── AB-12: loyalty earnPoints ──────────────────────────────────────────────
describe("AB-12 loyalty earnPoints funds-grade gating", () => {
  it("promotions.earnPoints: cross-customer grant FORBIDDEN for non-staff; session earn works; staff grant works", async () => {
    const me = await mkCustomer(String(regularUser.id), `+234832${SUFFIX}`.slice(0, 15));
    const victim = await mkCustomer("i-victim", `+234833${SUFFIX}`.slice(0, 15));
    await mkLoyalty(me.id, `IME${SUFFIX}`.slice(0, 16));
    await mkLoyalty(victim.id, `IVI${SUFFIX}`.slice(0, 16));

    // (a) the exploit: regular user granting points to ANOTHER customer
    await expect(
      iCaller(regularUser).promotions.earnPoints({ customerId: victim.id, points: 9999, type: "bonus" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const [v] = await db.select().from(loyaltyAccounts).where(eq(loyaltyAccounts.customerId, victim.id));
    expect(v.points).toBe(0);

    // (b) session-bound earn (no customerId) works, bounded.
    // 2026-02 (I2 robustness fix): the session customer's loyalty account is
    // shared across suites — assert the DELTA, not an absolute balance.
    const [before] = await db.select().from(loyaltyAccounts).where(eq(loyaltyAccounts.customerId, me.id));
    const ok = await iCaller(regularUser).promotions.earnPoints({ points: 250, type: "purchase" });
    expect(ok.points).toBe(before.points + 250);
    const [m] = await db.select().from(loyaltyAccounts).where(eq(loyaltyAccounts.customerId, me.id));
    expect(m.points).toBe(before.points + 250);

    // (c) out-of-bounds grants are rejected by input validation
    await expect(
      iCaller(regularUser).promotions.earnPoints({ points: 100_001, type: "bonus" })
    ).rejects.toThrow();
    await expect(
      iCaller(regularUser).promotions.earnPoints({ points: -50, type: "bonus" })
    ).rejects.toThrow();

    // (d) staff grant to another customer works (audited path)
    const staff = await iCaller(adminUser).promotions.earnPoints({ customerId: victim.id, points: 300, type: "bonus" });
    expect(staff.points).toBe(300);
    const [v2] = await db.select().from(loyaltyAccounts).where(eq(loyaltyAccounts.customerId, victim.id));
    expect(v2.points).toBe(300);
  });

  it("customerLoyaltyProgram.earnPoints is staff-only", async () => {
    const [agent] = await db.insert(agents).values({
      agentId: `IC${SUFFIX}`.slice(0, 12), name: "I Agent",
      phone: `+234839${SUFFIX}`.slice(0, 15), pinHash: "i-test-hash",
    } as typeof agents.$inferInsert).returning();
    await expect(
      iCaller(regularUser).customerLoyaltyProgram.earnPoints({ customerId: agent.id, points: 100, reason: "exploit" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const ok = await iCaller(adminUser).customerLoyaltyProgram.earnPoints({ customerId: agent.id, points: 100, reason: "staff adjustment" });
    expect(ok.points).toBe(100);
  });
});

// ─── AB-13: applyReferral one-time ──────────────────────────────────────────
describe("AB-13 applyReferral is one-time per referee identity", () => {
  it("second application is CONFLICT and the referrer is credited exactly once", async () => {
    const referrerCust = await mkCustomer("i-referrer", `+234834${SUFFIX}`.slice(0, 15));
    const referrerAcct = await mkLoyalty(referrerCust.id, `IREF${SUFFIX}`.slice(0, 16));
    const me = await mkCustomer(String(regularUser.id), `+234835${SUFFIX}`.slice(0, 15));
    await mkLoyalty(me.id, `IME2${SUFFIX}`.slice(0, 16));

    // First application succeeds (session identity, referrer's code)
    const ok = await iCaller(regularUser).promotions.applyReferral({ referralCode: referrerAcct.referralCode });
    expect(ok.success).toBe(true);
    const [afterFirst] = await db.select().from(loyaltyAccounts).where(eq(loyaltyAccounts.id, referrerAcct.id));
    expect(afterFirst.points).toBe(500);

    // Second application (re-callable exploit) → CONFLICT, no second grant
    await expect(
      iCaller(regularUser).promotions.applyReferral({ referralCode: referrerAcct.referralCode })
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const [afterSecond] = await db.select().from(loyaltyAccounts).where(eq(loyaltyAccounts.id, referrerAcct.id));
    expect(afterSecond.points).toBe(500);

    // Self-referral guard still holds
    const me2 = await mkCustomer("i-selfref", `+234836${SUFFIX}`.slice(0, 15));
    const selfAcct = await mkLoyalty(me2.id, `ISLF${SUFFIX}`.slice(0, 16));
    await expect(
      iCaller(adminUser).promotions.applyReferral({ customerId: me2.id, referralCode: selfAcct.referralCode })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

// ─── AB-14: validateCoupon perCustomerLimit ─────────────────────────────────
describe("AB-14 validateCoupon enforces perCustomerLimit", () => {
  it("validation-time count matches the redemption ledger; identity session-derived", async () => {
    const me = await mkCustomer(String(regularUser.id), `+234837${SUFFIX}`.slice(0, 15));
    const [promo] = await db.insert(promotions).values({
      name: "I Promo", code: `ICODE-${SUFFIX}`, type: "fixed_amount", value: "500",
      perCustomerLimit: 1, isActive: true,
      startDate: new Date(Date.now() - 86400000), endDate: new Date(Date.now() + 86400000),
    } as typeof promotions.$inferInsert).returning();

    // Before any redemption: valid.
    const v1 = await iCaller(regularUser).promotions.validateCoupon({ code: promo.code, orderTotal: 5000 });
    expect(v1.valid).toBe(true);

    // Ledger shows the session customer already used it → invalid at
    // VALIDATION time too (not just at redeem).
    await db.insert(couponRedemptions).values({ promoId: promo.id, customerId: me.id });
    const v2 = await iCaller(regularUser).promotions.validateCoupon({ code: promo.code, orderTotal: 5000 });
    expect(v2.valid).toBe(false);
    expect(v2.reason).toMatch(/Per-customer/);

    // Identity spoofing at validation is FORBIDDEN for non-staff.
    const other = await mkCustomer("i-other", `+234838${SUFFIX}`.slice(0, 15));
    await expect(
      iCaller(regularUser).promotions.validateCoupon({ code: promo.code, orderTotal: 5000, customerId: other.id })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
