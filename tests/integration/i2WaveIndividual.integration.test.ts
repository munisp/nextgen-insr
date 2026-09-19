/**
 * i2WaveIndividual.integration.test.ts — I2-wave funds-grade residuals
 * (2026-02), real-DB (PGlite/Postgres) integration tests:
 *
 *   1. promotions.redeemPoints — session-derived identity (cross-customer
 *      FORBIDDEN for non-staff, staff path audited) and the debit is an
 *      ATOMIC balance-guarded UPDATE: parallel redeems can never go negative.
 *   2. customerLoyaltyProgram.redeemPoints — agent-self or staff only;
 *      atomic guarded debit on agents.loyalty_points + ledger entry.
 *   3. applyReferral — the advertised referee bonus is now REALLY credited,
 *      exactly once, in the same one-time-guarded transaction.
 */
import { describe, it, beforeAll, afterAll } from "vitest";
import { and, eq } from "drizzle-orm";

import { getDb } from "../../server/db";
import { agents, auditLog, customers } from "../../drizzle/schema";
import {
  loyaltyAccounts,
  loyaltyTransactions,
} from "../../drizzle/insurance-extended-schema";
import { router } from "../../server/_core/trpc";
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

const FILE = "i2WaveIndividual";
type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
let db: Db;
const SUFFIX = Date.now().toString(36).slice(-6);

const i2Router = router({
  promotions: promotionsRouter,
  customerLoyaltyProgram: customerLoyaltyProgramRouter,
});
function i2Caller(user: Pick<User, "id" | "email" | "name" | "role">) {
  const ctx = {
    user: user as User,
    req: { headers: {} } as unknown as TrpcContext["req"], // no agent cookie → not an agent session
    res: { cookie: () => undefined, clearCookie: () => undefined } as unknown as TrpcContext["res"],
    requestId: "i2-wave-integration",
  };
  return i2Router.createCaller(ctx);
}

async function mkCustomer(keycloakSub: string, phone: string) {
  const [existing] = await db.select().from(customers).where(eq(customers.keycloakSub, keycloakSub)).limit(1);
  if (existing) return existing;
  const [c] = await db.insert(customers).values({
    firstName: "I2", lastName: "Cust", phone, status: "active", keycloakSub,
  } as typeof customers.$inferInsert).returning();
  return c;
}

async function mkLoyalty(customerId: number, code: string, points = 0) {
  const [existing] = await db.select().from(loyaltyAccounts).where(eq(loyaltyAccounts.customerId, customerId)).limit(1);
  if (existing) {
    await db.update(loyaltyAccounts).set({ points }).where(eq(loyaltyAccounts.id, existing.id));
    return { ...existing, points };
  }
  const [a] = await db.insert(loyaltyAccounts).values({ customerId, referralCode: code, points }).returning();
  return a;
}

beforeAll(async () => {
  resetAssertionCount();
  const instance = await getDb();
  if (!instance) throw new Error("DB unavailable in integration setup");
  db = instance;

  // Fixture (2026-02): same discipline as H2/I waves — the harness only
  // materializes drizzle/schema; these are insurance-extended-schema tables
  // created verbatim.
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

// ─── 1. promotions.redeemPoints ─────────────────────────────────────────────
describe("I2-1 promotions.redeemPoints session identity + atomic guarded debit", () => {
  it("cross-customer redeem FORBIDDEN; self-redeem works; staff path audited", async () => {
    const me = await mkCustomer(String(regularUser.id), `+234840${SUFFIX}`.slice(0, 15));
    const victim = await mkCustomer("i2-victim", `+234841${SUFFIX}`.slice(0, 15));
    await mkLoyalty(me.id, `I2ME${SUFFIX}`.slice(0, 16), 400);
    await mkLoyalty(victim.id, `I2VI${SUFFIX}`.slice(0, 16), 400);

    // (a) the exploit: spending the VICTIM's points
    await expect(
      i2Caller(regularUser).promotions.redeemPoints({ customerId: victim.id, points: 100 })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const [v] = await db.select().from(loyaltyAccounts).where(eq(loyaltyAccounts.customerId, victim.id));
    expect(v.points).toBe(400);

    // (b) self-redeem works and debits exactly
    const ok = await i2Caller(regularUser).promotions.redeemPoints({ points: 150 });
    expect(ok.remainingPoints).toBe(250);
    const [m] = await db.select().from(loyaltyAccounts).where(eq(loyaltyAccounts.customerId, me.id));
    expect(m.points).toBe(250);

    // (c) staff path works AND leaves an audit entry
    const staff = await i2Caller(adminUser).promotions.redeemPoints({ customerId: victim.id, points: 50 });
    expect(staff.remainingPoints).toBe(350);
    const audits = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.action, "LOYALTY_POINTS_STAFF_REDEEM"), eq(auditLog.resourceId, String(victim.id))))
      .limit(1);
    expect(audits.length).toBe(1);
  });

  it("parallel redeems can never drive the balance negative", async () => {
    const me = await mkCustomer(String(regularUser.id), `+234842${SUFFIX}`.slice(0, 15));
    await mkLoyalty(me.id, `I2RC${SUFFIX}`.slice(0, 16), 500);

    const caller = i2Caller(regularUser);
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        caller.promotions
          .redeemPoints({ points: 200 })
          .then(() => ({ ok: true as const }))
          .catch(() => ({ ok: false as const }))
      )
    );
    const succeeded = results.filter(r => r.ok).length;
    expect(succeeded).toBe(2); // floor(500/200) — the 3rd concurrent debit is refused
    const [m] = await db.select().from(loyaltyAccounts).where(eq(loyaltyAccounts.customerId, me.id));
    expect(m.points).toBe(100); // NEVER negative
    expect(m.points).toBeGreaterThanOrEqual(0);
  });
});

// ─── 2. customerLoyaltyProgram.redeemPoints ─────────────────────────────────
describe("I2-2 customerLoyaltyProgram.redeemPoints agent/staff-only + atomic debit", () => {
  it("non-self non-staff FORBIDDEN; staff debit is balance-guarded and ledgered", async () => {
    const [agent] = await db.insert(agents).values({
      agentId: `I2A${SUFFIX}`.slice(0, 12), name: "I2 Agent",
      phone: `+234843${SUFFIX}`.slice(0, 15), pinHash: "i2-test-hash",
      loyaltyPoints: 300,
    } as typeof agents.$inferInsert).returning();

    // (a) platform user with NO agent session, not staff → FORBIDDEN
    await expect(
      i2Caller(regularUser).customerLoyaltyProgram.redeemPoints({ customerId: agent.id, points: 100, reward: "exploit" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const [a1] = await db.select().from(agents).where(eq(agents.id, agent.id));
    expect(a1.loyaltyPoints).toBe(300);

    // (b) staff redeem: guarded debit + ledger entry with balanceAfter
    const ok = await i2Caller(adminUser).customerLoyaltyProgram.redeemPoints({ customerId: agent.id, points: 200, reward: "staff cash-out" });
    expect(ok.points).toBe(-200);
    const [a2] = await db.select().from(agents).where(eq(agents.id, agent.id));
    expect(a2.loyaltyPoints).toBe(100);

    // (c) overdraw attempt → BAD_REQUEST, balance untouched
    await expect(
      i2Caller(adminUser).customerLoyaltyProgram.redeemPoints({ customerId: agent.id, points: 500, reward: "overdraw" })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const [a3] = await db.select().from(agents).where(eq(agents.id, agent.id));
    expect(a3.loyaltyPoints).toBe(100);
  });
});

// ─── 3. applyReferral referee bonus is real ─────────────────────────────────
describe("I2-3 applyReferral credits the referee bonus exactly once", () => {
  it("both parties credited 500 in one transaction; re-call is CONFLICT with no double-credit", async () => {
    const referrerCust = await mkCustomer("i2-referrer", `+234844${SUFFIX}`.slice(0, 15));
    const referrerAcct = await mkLoyalty(referrerCust.id, `I2RF${SUFFIX}`.slice(0, 16), 0);
    // Fresh caller identity: the I-wave suite already consumed regularUser's
    // one-time referral claim (shared DB) — a one-time guard must be tested
    // against an un-referred identity.
    const freshUser = { id: 977002, email: "i2fresh@test.local", name: "I2 Fresh", role: "user" as const };
    const me = await mkCustomer(String(freshUser.id), `+234845${SUFFIX}`.slice(0, 15));
    const myAcct = await mkLoyalty(me.id, `I2M3${SUFFIX}`.slice(0, 16), 0);

    const ok = await i2Caller(freshUser).promotions.applyReferral({ referralCode: referrerAcct.referralCode });
    expect(ok.success).toBe(true);
    expect(ok.referreeBonus).toBe(500);

    // BOTH sides actually credited (the old code only paid the referrer).
    const [ref1] = await db.select().from(loyaltyAccounts).where(eq(loyaltyAccounts.id, referrerAcct.id));
    const [me1] = await db.select().from(loyaltyAccounts).where(eq(loyaltyAccounts.id, myAcct.id));
    expect(ref1.points).toBe(500);
    expect(me1.points).toBe(500);

    // One-time guard still holds: no double-credit on either side.
    await expect(
      i2Caller(freshUser).promotions.applyReferral({ referralCode: referrerAcct.referralCode })
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const [ref2] = await db.select().from(loyaltyAccounts).where(eq(loyaltyAccounts.id, referrerAcct.id));
    const [me2] = await db.select().from(loyaltyAccounts).where(eq(loyaltyAccounts.id, myAcct.id));
    expect(ref2.points).toBe(500);
    expect(me2.points).toBe(500);
  });
});
