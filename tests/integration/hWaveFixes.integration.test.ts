/**
 * hWaveFixes.integration.test.ts — H-wave (adversarial-verifier follow-up,
 * 2026-09). Real-DB (PGlite) tests:
 *
 *   F5  platform promotions.redeemCoupon is race-safe:
 *       - per-customer limit enforced at burn time (advisory-lock serialized,
 *         no TOCTOU window) under parallel calls
 *       - global usageLimit trips via the atomic guarded UPDATE even under
 *         cross-customer concurrency
 *   F2  the policy-lifecycle sweep is actually runnable: the cron wrapper
 *       (server/cron/policyLifecycleSweep) is invoked FOR REAL against a
 *       seeded PGlite DB and lapses/expires policies, and server/_core/index.ts
 *       registers it on node-cron (source assertion — importing index.ts has
 *       server side effects, so registration is verified textually while
 *       INVOCATION is verified against the real DB).
 *
 * Note: `promotions`/`coupon_redemptions` live in
 * drizzle/insurance-extended-schema.ts, which drizzle-kit push (schema.ts
 * only) does not materialize — the tables are created here verbatim from the
 * drizzle definitions (migration 0083 SQL).
 */
import { describe, it, beforeAll, afterAll } from "vitest";
import { eq, sql } from "drizzle-orm";
import { readFileSync } from "fs";
import path from "path";
import { getDb } from "../../server/db";
import { customers, policies, policyLifecycleStates } from "../../drizzle/schema";
import { promotions, couponRedemptions } from "../../drizzle/insurance-extended-schema";
import { runPolicyLifecycleSweep } from "../../server/cron/policyLifecycleSweep";
import {
  callerFor,
  adminUser,
  regularUser,
  expectCounted as expect,
  expectTrpcError,
  resetAssertionCount,
  getAssertionCount,
} from "./helpers/trpc";

const FILE = "hWaveFixes";

async function ensureExtendedTables() {
  const db = (await getDb())!;
  // Mirrors drizzle/0083_coupon_redemption_race_safety.sql + the promotions
  // table definition in drizzle/insurance-extended-schema.ts (verbatim
  // column set used by the redeem path).
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "promotions" (
      "id" serial PRIMARY KEY,
      "storeId" integer,
      "name" text NOT NULL,
      "code" varchar(64) NOT NULL,
      "type" varchar(32) NOT NULL,
      "value" numeric(12,2) NOT NULL,
      "minOrderAmount" numeric(12,2),
      "maxDiscount" numeric(12,2),
      "usageLimit" integer,
      "perCustomerLimit" integer DEFAULT 1 NOT NULL,
      "usedCount" integer DEFAULT 0 NOT NULL,
      "isActive" boolean DEFAULT true NOT NULL,
      "applicableProducts" integer[] DEFAULT '{}',
      "applicableCategories" integer[] DEFAULT '{}',
      "startDate" timestamp NOT NULL,
      "endDate" timestamp NOT NULL,
      "createdAt" timestamp DEFAULT now() NOT NULL,
      "updatedAt" timestamp DEFAULT now() NOT NULL
    )
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "coupon_redemptions" (
      "id" serial PRIMARY KEY,
      "promoId" integer NOT NULL REFERENCES "promotions"("id"),
      "customerId" integer NOT NULL,
      "orderId" integer,
      "createdAt" timestamp DEFAULT now() NOT NULL
    )
  `);
}

async function cleanupExtended() {
  const db = (await getDb())!;
  await db.execute(sql`DELETE FROM coupon_redemptions`);
  await db.execute(sql`DELETE FROM promotions`);
}

async function seedPromo(over: {
  code: string;
  usageLimit: number | null;
  perCustomerLimit: number;
}) {
  const db = (await getDb())!;
  const [p] = await db
    .insert(promotions)
    .values({
      name: "H-wave test promo",
      code: over.code,
      type: "percentage",
      value: "10",
      usageLimit: over.usageLimit,
      perCustomerLimit: over.perCustomerLimit,
      usedCount: 0,
      isActive: true,
      startDate: new Date(Date.now() - 86400_000),
      endDate: new Date(Date.now() + 86400_000),
    })
    .returning();
  return p;
}

describe("H-wave fixes (integration, real DB)", () => {
  beforeAll(async () => {
    resetAssertionCount();
    await ensureExtendedTables();
    await cleanupExtended();
  });

  afterAll(async () => {
    console.log(`[integration] ${FILE}: ${getAssertionCount()} assertions`);
    await cleanupExtended();
  });

  // ── F5: per-customer limit is race-safe (TOCTOU closed) ──────────────────
  it("parallel redemptions by ONE customer: exactly perCustomerLimit succeed", async () => {
    const promo = await seedPromo({
      code: "HWAVE-PC-1",
      usageLimit: null,
      perCustomerLimit: 1,
    });
    // 2026-02 (H2 honest-contract update): redeemCoupon now derives the
    // customer from the AUTHENTICATED SESSION (identity-spoofing fix) — the
    // client-supplied customerId fixture (777001) would be FORBIDDEN. Seed a
    // real customer bound to regularUser's keycloakSub and omit customerId;
    // the race invariant (exactly perCustomerLimit succeeds) is unchanged.
    const db0 = (await getDb())!;
    let [sessionCustomer] = await db0
      .select()
      .from(customers)
      .where(eq(customers.keycloakSub, String(regularUser.id)))
      .limit(1);
    if (!sessionCustomer) {
      [sessionCustomer] = await db0
        .insert(customers)
        .values({
          firstName: "HW", lastName: "Race",
          phone: `+234890${Date.now().toString(36).slice(-6)}`.slice(0, 15),
          status: "active",
          keycloakSub: String(regularUser.id),
        } as typeof customers.$inferInsert)
        .returning();
    }
    expect(sessionCustomer).toBeTruthy();
    const caller = callerFor(regularUser);
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        caller.promotions
          .redeemCoupon({ code: promo.code })
          .then(r => ({ ok: true as const, r }))
          .catch(e => ({ ok: false as const, e }))
      )
    );
    const ok = results.filter(r => r.ok);
    expect(ok.length).toBe(1);
    const db = (await getDb())!;
    const [after] = await db
      .select({ usedCount: promotions.usedCount })
      .from(promotions)
      .where(eq(promotions.id, promo.id));
    expect(after.usedCount).toBe(1);
    const rows = await db
      .select()
      .from(couponRedemptions)
      .where(eq(couponRedemptions.promoId, promo.id));
    expect(rows.length).toBe(1);
  });

  // ── F5: global usageLimit trips under cross-customer concurrency ──────────
  it("global usageLimit: atomic guarded increment caps concurrent burns", async () => {
    const promo = await seedPromo({
      code: "HWAVE-GL-1",
      usageLimit: 2,
      perCustomerLimit: 1,
    });
    const caller = callerFor(adminUser);
    const results = await Promise.all(
      [880001, 880002, 880003, 880004].map(customerId =>
        caller.promotions
          .redeemCoupon({ code: promo.code, customerId })
          .then(r => ({ ok: true as const, r }))
          .catch(e => ({ ok: false as const, e }))
      )
    );
    const ok = results.filter(r => r.ok);
    expect(ok.length).toBe(2);
    const db = (await getDb())!;
    const [after] = await db
      .select({ usedCount: promotions.usedCount })
      .from(promotions)
      .where(eq(promotions.id, promo.id));
    expect(after.usedCount).toBe(2);
    // Further redemption: honest limit error, not a silent increment.
    await expectTrpcError(
      caller.promotions.redeemCoupon({
        code: promo.code,
        customerId: 880099,
      }),
      "BAD_REQUEST"
    );
    const [finalRow] = await db
      .select({ usedCount: promotions.usedCount })
      .from(promotions)
      .where(eq(promotions.id, promo.id));
    expect(finalRow.usedCount).toBe(2);
  });

  // ── F5: unknown / inactive codes fail honestly ────────────────────────────
  it("unknown coupon code → NOT_FOUND (no silent increment)", async () => {
    // 2026-02 (H2 honest-contract update): a regular user passing an
    // arbitrary customerId is now FORBIDDEN before the code lookup (session-
    // derived identity). Admin on-behalf redemption reaches the code lookup,
    // so the NOT_FOUND contract is exercised through the admin path.
    await expectTrpcError(
      callerFor(adminUser).promotions.redeemCoupon({
        code: "HWAVE-NOPE",
        customerId: 1,
      }),
      "NOT_FOUND"
    );
  });

  // ── F2: the sweep runs for real via the cron wrapper ─────────────────────
  it("runPolicyLifecycleSweep lapses/expires seeded policies (real invocation)", async () => {
    const db = (await getDb())!;
    const now = Date.now();
    const mk = (policyNumber: string, endDaysAgo: number) =>
      db
        .insert(policies)
        .values({
          policyNumber,
          productId: 1,
          customerId: 990001,
          status: "active",
          coverageType: "motor",
          sumInsured: "1000000",
          annualPremium: "50000",
          startDate: new Date(now - 400 * 86400_000),
          endDate: new Date(now - endDaysAgo * 86400_000),
        })
        .returning({ id: policies.id });

    // 40 days past end: past the 30-day grace → lapsed (within 90d reinstate).
    const [p1] = await mk("HWAVE-POL-LAPSE", 40);
    // 200 days past end: grace + 90d reinstatement fully elapsed → expired.
    const [p2] = await mk("HWAVE-POL-EXPIRE", 200);

    const result = await runPolicyLifecycleSweep();
    expect(result.lapsed + result.expired).toBeGreaterThanOrEqual(2);

    const [a1] = await db
      .select({ status: policies.status })
      .from(policies)
      .where(eq(policies.id, p1.id));
    const [a2] = await db
      .select({ status: policies.status })
      .from(policies)
      .where(eq(policies.id, p2.id));
    expect(a1.status).toBe("lapsed");
    expect(a2.status).toBe("expired");

    const [lc] = await db
      .select()
      .from(policyLifecycleStates)
      .where(eq(policyLifecycleStates.policyId, p1.id));
    expect(lc.lapsedAt).not.toBeNull();
    expect(Number(lc.arrearsAmount)).toBe(50000);

    // Idempotent: a second sweep leaves the freshly-lapsed policy lapsed
    // (no double transition, no duplicate arrears reset).
    await runPolicyLifecycleSweep();
    const [a1b] = await db
      .select({ status: policies.status })
      .from(policies)
      .where(eq(policies.id, p1.id));
    expect(a1b.status).toBe("lapsed");

    await db.delete(policies).where(eq(policies.id, p1.id));
    await db.delete(policies).where(eq(policies.id, p2.id));
  });

  // ── F2: the sweep is actually scheduled (registration assertion) ──────────
  it("server/_core/index.ts registers the sweep on node-cron (daily 03:00)", async () => {
    const src = readFileSync(
      path.resolve(__dirname, "../../server/_core/index.ts"),
      "utf8"
    );
    expect(src).toContain('from "../cron/policyLifecycleSweep"');
    expect(src).toContain('"0 3 * * *"');
    expect(src).toContain("runPolicyLifecycleSweep");
  });
});
