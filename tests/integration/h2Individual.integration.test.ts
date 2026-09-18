/**
 * h2Individual.integration.test.ts — H2-wave verification fixes (2026-02),
 * real-DB (PGlite/Postgres) integration tests:
 *
 *   1. promotions.redeemCoupon — customerId is SESSION-DERIVED: a spoofed
 *      client customerId is FORBIDDEN for regular users; self-redemption
 *      works; admin on-behalf redemption works (audited).
 *   2. Quote-consume defense-in-depth — the guarded UPDATE binds customerId,
 *      so cross-customer consumption fails with QUOTE_CONSUMED even when
 *      called directly (no upstream validation).
 *   3. Deleted /settlement broadcaster — the module is gone and the live
 *      Socket.IO server REFUSES the /settlement namespace (Invalid namespace).
 */
import { describe, it, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { AddressInfo } from "node:net";
import { SignJWT } from "jose";
import { Server as SocketIOServer } from "socket.io";
import { io as ioc, type Socket as ClientSocket } from "socket.io-client";
import { eq } from "drizzle-orm";

import { getDb } from "../../server/db";
import { customers, users } from "../../drizzle/schema";
import { policyQuotes } from "../../drizzle/schema.additions";
import { promotions, couponRedemptions } from "../../drizzle/insurance-extended-schema";
import { router } from "../../server/_core/trpc";
import { promotionsRouter } from "../../server/routers/promotions";
import { createInsurancePolicy } from "../../server/journey-activities";
import { initRealtimeNotifications } from "../../server/lib/realtimeNotifications";
import { getJwtSecret } from "../../server/lib/envValidation";
import {
  adminUser,
  regularUser,
  expectCounted as expect,
  resetAssertionCount,
  getAssertionCount,
} from "./helpers/trpc";
import type { TrpcContext } from "../../server/_core/context";
import type { User } from "../../drizzle/schema";

const FILE = "h2Individual";
type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
let db: Db;
const SUFFIX = Date.now().toString(36).slice(-6);

// promotionsRouter is not in the shared integration mount — mount under the
// production path here (same discipline as the G2/H waves).
const h2Router = router({ promotions: promotionsRouter });
function h2Caller(user: Pick<User, "id" | "email" | "name" | "role">) {
  const ctx = {
    user: user as User,
    req: { headers: {} } as unknown as TrpcContext["req"],
    res: { cookie: () => undefined, clearCookie: () => undefined } as unknown as TrpcContext["res"],
    requestId: "h2-integration",
  };
  return h2Router.createCaller(ctx);
}

// Select-or-insert: the integration DB is shared across files, and another
// suite may already own this keycloakSub (unique).
async function mkCustomer(keycloakSub: string, phone: string) {
  const [existing] = await db
    .select()
    .from(customers)
    .where(eq(customers.keycloakSub, keycloakSub))
    .limit(1);
  if (existing) return existing;
  const [c] = await db.insert(customers).values({
    firstName: "H2", lastName: "Cust", phone, status: "active", keycloakSub,
  } as typeof customers.$inferInsert).returning();
  return c;
}

beforeAll(async () => {
  resetAssertionCount();
  const instance = await getDb();
  if (!instance) throw new Error("DB unavailable in integration setup");
  db = instance;

  // Fixture (2026-02): the integration harness materializes drizzle/schema
  // only; insurance-extended-schema tables are created here verbatim (columns
  // match drizzle/insurance-extended-schema.ts) so the coupon path runs
  // against a REAL table, not a mock.
  await db.execute(
    // language=SQL
    `CREATE TABLE IF NOT EXISTS "promotions" (
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
      "applicableProducts" integer[],
      "applicableCategories" integer[],
      "startDate" timestamp NOT NULL,
      "endDate" timestamp NOT NULL,
      "createdAt" timestamp DEFAULT now() NOT NULL,
      "updatedAt" timestamp DEFAULT now() NOT NULL
    )`
  );
  await db.execute(
    // language=SQL
    `CREATE TABLE IF NOT EXISTS "coupon_redemptions" (
      "id" serial PRIMARY KEY,
      "promoId" integer NOT NULL REFERENCES "promotions"("id"),
      "customerId" integer NOT NULL,
      "orderId" integer,
      "createdAt" timestamp DEFAULT now() NOT NULL
    )`
  );
});

afterAll(() => {
  console.log(`[${FILE}] assertions: ${getAssertionCount()}`);
});

// ─── 1. Session-derived coupon redemption ───────────────────────────────────
describe("H2-1 redeemCoupon session-derived customerId", () => {
  it("spoofed customerId is FORBIDDEN; self-redemption works; admin on-behalf works", async () => {
    const me = await mkCustomer(String(regularUser.id), `+234820${SUFFIX}`.slice(0, 15));
    const victim = await mkCustomer("h2-victim", `+234821${SUFFIX}`.slice(0, 15));
    const [promo] = await db.insert(promotions).values({
      name: "H2 Promo", code: `H2CODE-${SUFFIX}`, type: "fixed_amount", value: "1000",
      perCustomerLimit: 1, isActive: true,
      startDate: new Date(Date.now() - 86400000), endDate: new Date(Date.now() + 86400000),
    } as typeof promotions.$inferInsert).returning();

    // (a) Identity spoofing attempt: regular user passes the VICTIM's id.
    await expect(
      h2Caller(regularUser).promotions.redeemCoupon({ code: promo.code, customerId: victim.id })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    // Nothing was burned for the victim.
    const [victimUses] = await db
      .select({ n: couponRedemptions.id })
      .from(couponRedemptions)
      .where(eq(couponRedemptions.customerId, victim.id))
      .limit(1);
    expect(victimUses).toBeUndefined();

    // (b) Self-redemption (customerId omitted entirely) succeeds and binds
    // the SESSION customer.
    const ok = await h2Caller(regularUser).promotions.redeemCoupon({ code: promo.code });
    expect(ok.success).toBe(true);
    const [myUse] = await db
      .select()
      .from(couponRedemptions)
      .where(eq(couponRedemptions.customerId, me.id))
      .limit(1);
    expect(myUse?.promoId).toBe(promo.id);

    // (c) Per-customer limit still enforced against the session identity.
    await expect(
      h2Caller(regularUser).promotions.redeemCoupon({ code: promo.code })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    // (d) Admin on-behalf redemption is allowed (and audited).
    const okAdmin = await h2Caller(adminUser).promotions.redeemCoupon({ code: promo.code, customerId: victim.id });
    expect(okAdmin.success).toBe(true);
    const [victimUse] = await db
      .select()
      .from(couponRedemptions)
      .where(eq(couponRedemptions.customerId, victim.id))
      .limit(1);
    expect(victimUse?.promoId).toBe(promo.id);
  });
});

// ─── 2. Cross-customer quote consume is impossible ──────────────────────────
describe("H2-2 quote consume guard binds customerId", () => {
  it("cross-customer consume fails with QUOTE_CONSUMED even when called directly", async () => {
    const owner = await mkCustomer("h2-owner", `+234822${SUFFIX}`.slice(0, 15));
    const intruder = await mkCustomer("h2-intruder", `+234823${SUFFIX}`.slice(0, 15));
    const [quote] = await db.insert(policyQuotes).values({
      customerId: owner.id, productId: 1, sumInsured: "100000", premiumAmount: "5000", status: "pending",
    }).returning();

    // Direct activity call as the INTRUDER (bypassing every upstream check):
    // the guarded UPDATE's customerId binding must refuse the flip.
    await expect(
      createInsurancePolicy({
        quoteId: quote.id, customerId: intruder.id, productId: 1,
        sumInsured: 100000, premiumAmount: 5000, durationMonths: 12,
        paymentRef: `H2PAY-${SUFFIX}`, coverageStartDate: new Date().toISOString(),
      })
    ).rejects.toThrow(/QUOTE_CONSUMED/);
    // Quote is still pending — no flip, no policy.
    const [q1] = await db.select().from(policyQuotes).where(eq(policyQuotes.id, quote.id));
    expect(q1.status).toBe("pending");

    // Owner consumes successfully.
    const ok = await createInsurancePolicy({
      quoteId: quote.id, customerId: owner.id, productId: 1,
      sumInsured: 100000, premiumAmount: 5000, durationMonths: 12,
      paymentRef: `H2PAY2-${SUFFIX}`, coverageStartDate: new Date().toISOString(),
    });
    expect(ok.policyId).toBeGreaterThan(0);
    const [q2] = await db.select().from(policyQuotes).where(eq(policyQuotes.id, quote.id));
    expect(q2.status).toBe("converted");
  });
});

// ─── 3. Deleted /settlement broadcaster ─────────────────────────────────────
describe("H2-3 /settlement broadcaster removed and namespace refused", () => {
  it("module file is absent", () => {
    const filePath = path.join(__dirname, "../../server/websocket/realtimeStreaming.ts");
    expect(fs.existsSync(filePath)).toBe(false);
  });

  it("live Socket.IO server refuses the /settlement namespace", async () => {
    const httpServer = http.createServer();
    const ioServer = new SocketIOServer(httpServer, { path: "/socket.io" });
    initRealtimeNotifications(ioServer); // registers ONLY /notifications
    await new Promise<void>((r) => httpServer.listen(0, "127.0.0.1", r));
    const port = (httpServer.address() as AddressInfo).port;
    const clients: ClientSocket[] = [];
    try {
      const token = await new SignJWT({ name: "H2", role: "admin" })
        .setProtectedHeader({ alg: "HS256" })
        .setSubject("h2-settle")
        .setIssuedAt()
        .setExpirationTime("5m")
        .sign(new TextEncoder().encode(getJwtSecret()));
      const result = await new Promise<{ ok: boolean; error?: string }>((resolve) => {
        const s = ioc(`http://127.0.0.1:${port}/settlement`, {
          path: "/socket.io",
          transports: ["websocket"],
          auth: { token }, // even a VALID staff token must not get /settlement
          reconnection: false,
          timeout: 5000,
        });
        s.on("connect", () => resolve({ ok: true }));
        s.on("connect_error", (err) => resolve({ ok: false, error: err.message }));
        clients.push(s);
      });
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/Invalid namespace/);
    } finally {
      for (const c of clients) c.disconnect();
      await new Promise((r) => ioServer.close(r));
      await new Promise((r) => httpServer.close(r));
    }
  });
});
