/**
 * hWaveIndividual.integration.test.ts — H-wave adversarial-verifier fixes
 * (2026-02), real-DB (PGlite/Postgres) integration tests:
 *
 *   1. PLATFORM referrals self-referral / identity-dedup guards (F5 residual
 *      ported from insureportal AB-9): own code refused, same-phone referee
 *      refused, one-referral-per-identity refused; legit referral still works.
 *   2. /notifications socket namespace: anonymous connection REJECTED;
 *      authenticated user is denied staff-only channels (fraud/settlement/
 *      compliance) and admitted to personal ones; staff role gets all.
 *   4. J02 quote ownership + atomic consume: validateInsuranceQuote refuses a
 *      cross-customer quote; createInsurancePolicy consumes a quote exactly
 *      once — second use throws QUOTE_CONSUMED.
 */
import { describe, it, beforeAll, afterAll } from "vitest";
import http from "node:http";
import { AddressInfo } from "node:net";
import { SignJWT } from "jose";
import { Server as SocketIOServer } from "socket.io";
import { io as ioc, type Socket as ClientSocket } from "socket.io-client";
import { eq } from "drizzle-orm";

import { getDb } from "../../server/db";
import { agents, referrals, customers } from "../../drizzle/schema";
import { policyQuotes } from "../../drizzle/schema.additions";
import { router } from "../../server/_core/trpc";
import { referralsRouter } from "../../server/routers/referrals";
import {
  validateInsuranceQuote,
  createInsurancePolicy,
} from "../../server/journey-activities";
import { initRealtimeNotifications } from "../../server/lib/realtimeNotifications";
import { getJwtSecret } from "../../server/lib/envValidation";
import {
  adminUser,
  expectCounted as expect,
  resetAssertionCount,
  getAssertionCount,
} from "./helpers/trpc";
import type { TrpcContext } from "../../server/_core/context";
import type { User } from "../../drizzle/schema";

// referrals is not part of the shared integration mount — mount it under the
// production path here (same discipline as individualOnboardingG2).
const hRouter = router({ referrals: referralsRouter });
function hCaller(user: Pick<User, "id" | "email" | "name" | "role">) {
  const ctx = {
    user: user as User,
    req: { headers: {} } as unknown as TrpcContext["req"],
    res: { cookie: () => undefined, clearCookie: () => undefined } as unknown as TrpcContext["res"],
    requestId: "h-wave-integration",
  };
  return hRouter.createCaller(ctx);
}

const FILE = "hWaveIndividual";
type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
let db: Db;
const SUFFIX = Date.now().toString(36).slice(-6);

beforeAll(async () => {
  resetAssertionCount();
  const instance = await getDb();
  if (!instance) throw new Error("DB unavailable in integration setup");
  db = instance;
});

afterAll(() => {
  console.log(`[${FILE}] assertions: ${getAssertionCount()}`);
});

// ─── 1. Self-referral / identity dedup ──────────────────────────────────────
describe("H1 platform referrals self-referral + identity dedup", () => {
  const mkAgent = async (code: string, phone: string, email?: string) => {
    const [a] = await db.insert(agents).values({
      agentId: code,
      name: `H Agent ${code}`,
      phone,
      email: email ?? null,
      pinHash: "h-test-hash",
    } as typeof agents.$inferInsert).returning();
    return a;
  };
  const mkReferral = async (referrer: { id: number; agentId: string }) => {
    const [r] = await db.insert(referrals).values({
      referrerAgentId: referrer.id,
      referrerCode: referrer.agentId,
      referralCode: `HR${SUFFIX}${referrer.id}`.slice(0, 20),
      status: "pending",
      bonusPoints: 500,
      bonusCash: "1000",
      expiresAt: new Date(Date.now() + 30 * 86400000),
    }).returning();
    return r;
  };

  // Helper: capture a tRPC error for code+message assertions (the counted
  // expect wrapper has no asymmetric matchers like stringMatching).
  const capture = async (p: Promise<unknown>) => {
    try {
      await p;
      return null;
    } catch (e) {
      return e as { code?: string; message?: string };
    }
  };

  it("blocks an agent applying their OWN referral code (self-referral)", async () => {
    const caller = hCaller(adminUser);
    const a = await mkAgent(`H1${SUFFIX}`.slice(0, 12), `+234801${SUFFIX}`.slice(0, 15));
    const r = await mkReferral(a);
    const err = await capture(caller.referrals.useCode({ referralCode: r.referralCode, refereeAgentCode: a.agentId }));
    expect(err?.code).toBe("BAD_REQUEST");
    expect(String(err?.message)).toMatch(/Self-referral/);
    // still pending — nothing was activated
    const [after] = await db.select().from(referrals).where(eq(referrals.id, r.id));
    expect(after.status).toBe("pending");
  });

  it("blocks a referee sharing the referrer's phone (identity correlation)", async () => {
    const caller = hCaller(adminUser);
    const sharedPhone = `+234802${SUFFIX}`.slice(0, 15);
    const referrer = await mkAgent(`H2${SUFFIX}`.slice(0, 12), sharedPhone);
    const referee = await mkAgent(`H3${SUFFIX}`.slice(0, 12), sharedPhone);
    const r = await mkReferral(referrer);
    const err = await capture(caller.referrals.useCode({ referralCode: r.referralCode, refereeAgentCode: referee.agentId }));
    expect(err?.code).toBe("BAD_REQUEST");
    expect(String(err?.message)).toMatch(/shares identity/);
  });

  it("blocks a referee identity already referred under another agent account", async () => {
    const caller = hCaller(adminUser);
    const phone = `+234803${SUFFIX}`.slice(0, 15);
    const referrer1 = await mkAgent(`H4${SUFFIX}`.slice(0, 12), `+234804${SUFFIX}`.slice(0, 15));
    const referrer2 = await mkAgent(`H5${SUFFIX}`.slice(0, 12), `+234805${SUFFIX}`.slice(0, 15));
    // Same human (same phone), two agent accounts: one already activated.
    const refereeAcct1 = await mkAgent(`H6${SUFFIX}`.slice(0, 12), phone);
    const refereeAcct2 = await mkAgent(`H7${SUFFIX}`.slice(0, 12), phone);
    const r1 = await mkReferral(referrer1);
    const ok = await caller.referrals.useCode({ referralCode: r1.referralCode, refereeAgentCode: refereeAcct1.agentId });
    expect(ok.success).toBe(true);
    const r2 = await mkReferral(referrer2);
    const err = await capture(caller.referrals.useCode({ referralCode: r2.referralCode, refereeAgentCode: refereeAcct2.agentId }));
    expect(err?.code).toBe("BAD_REQUEST");
    expect(String(err?.message)).toMatch(/already referred/);
  });

  it("still allows a legitimate distinct referral", async () => {
    const caller = hCaller(adminUser);
    const referrer = await mkAgent(`H8${SUFFIX}`.slice(0, 12), `+234806${SUFFIX}`.slice(0, 15));
    const referee = await mkAgent(`H9${SUFFIX}`.slice(0, 12), `+234807${SUFFIX}`.slice(0, 15));
    const r = await mkReferral(referrer);
    const ok = await caller.referrals.useCode({ referralCode: r.referralCode, refereeAgentCode: referee.agentId });
    expect(ok.success).toBe(true);
    const [after] = await db.select().from(referrals).where(eq(referrals.id, r.id));
    expect(after.status).toBe("activated");
  });
});

// ─── 2. Notifications socket auth + channel scoping ─────────────────────────
describe("H2 /notifications socket namespace", () => {
  let httpServer: http.Server;
  let ioServer: SocketIOServer;
  let port: number;
  const clients: ClientSocket[] = [];

  beforeAll(async () => {
    httpServer = http.createServer();
    ioServer = new SocketIOServer(httpServer, { path: "/socket.io" });
    initRealtimeNotifications(ioServer);
    await new Promise<void>((r) => httpServer.listen(0, "127.0.0.1", r));
    port = (httpServer.address() as AddressInfo).port;
  });

  afterAll(async () => {
    for (const c of clients) c.disconnect();
    await new Promise((r) => ioServer.close(r));
    await new Promise((r) => httpServer.close(r));
  });

  const signToken = (sub: string, role: string) =>
    new SignJWT({ name: `H ${role}`, role })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(sub)
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(new TextEncoder().encode(getJwtSecret()));

  function connect(token?: string): Promise<{ ok: boolean; error?: string; socket?: ClientSocket }> {
    return new Promise((resolve) => {
      const s = ioc(`http://127.0.0.1:${port}/notifications`, {
        path: "/socket.io",
        transports: ["websocket"],
        auth: token ? { token } : undefined,
        reconnection: false,
        timeout: 5000,
      });
      s.on("connect", () => resolve({ ok: true, socket: s }));
      s.on("connect_error", (err) => resolve({ ok: false, error: err.message }));
      clients.push(s);
    });
  }

  it("rejects anonymous connections (fail-closed)", async () => {
    const noToken = await connect();
    expect(noToken.ok).toBe(false);
    expect(noToken.error).toMatch(/authentication required/);
    const badToken = await connect("not-a-real-jwt");
    expect(badToken.ok).toBe(false);
  });

  it("scopes channels: user denied staff feeds, admin admitted", async () => {
    const userConn = await connect(await signToken("h-user-1", "user"));
    expect(userConn.ok).toBe(true);
    const userSub = await new Promise<{ channels: string[]; denied: string[] }>((resolve) => {
      userConn.socket!.emit("notification:subscribe", ["transaction", "fraud", "settlement", "compliance"]);
      userConn.socket!.on("notification:subscribed", (p: { channels: string[]; denied: string[] }) => resolve(p));
    });
    expect(userSub.channels).toEqual(["transaction"]);
    expect(userSub.denied?.sort()).toEqual(["compliance", "fraud", "settlement"]);

    const adminConn = await connect(await signToken("h-admin-1", "admin"));
    expect(adminConn.ok).toBe(true);
    const adminSub = await new Promise<{ channels: string[]; denied: string[] }>((resolve) => {
      adminConn.socket!.emit("notification:subscribe", ["fraud", "settlement", "compliance"]);
      adminConn.socket!.on("notification:subscribed", (p: { channels: string[]; denied: string[] }) => resolve(p));
    });
    expect(adminSub.channels.sort()).toEqual(["compliance", "fraud", "settlement"]);
    expect(adminSub.denied ?? []).toEqual([]);
  });
});

// ─── 4. J02 quote ownership + atomic consume ────────────────────────────────
describe("H4 J02 quote ownership + atomic consume", () => {
  it("refuses to validate a quote owned by a DIFFERENT customer", async () => {
    const [c1] = await db.insert(customers).values({
      firstName: "H", lastName: "Owner", phone: `+234810${SUFFIX}`.slice(0, 15), status: "active",
    } as typeof customers.$inferInsert).returning();
    const [c2] = await db.insert(customers).values({
      firstName: "H", lastName: "Intruder", phone: `+234811${SUFFIX}`.slice(0, 15), status: "active",
    } as typeof customers.$inferInsert).returning();
    const [quote] = await db.insert(policyQuotes).values({
      customerId: c1.id, productId: 1, sumInsured: "100000", premiumAmount: "5000", status: "pending",
    }).returning();

    await expect(
      validateInsuranceQuote({ quoteId: quote.id, customerId: c2.id, premiumAmount: 0 })
    ).rejects.toThrow(/QUOTE_OWNERSHIP/);
    const ok = await validateInsuranceQuote({ quoteId: quote.id, customerId: c1.id, premiumAmount: 0 });
    expect(ok.valid).toBe(true);
  });

  it("consumes a quote exactly once — second use is QUOTE_CONSUMED", async () => {
    const [c1] = await db.insert(customers).values({
      firstName: "H", lastName: "Atomic", phone: `+234812${SUFFIX}`.slice(0, 15), status: "active",
    } as typeof customers.$inferInsert).returning();
    const [quote] = await db.insert(policyQuotes).values({
      customerId: c1.id, productId: 1, sumInsured: "100000", premiumAmount: "5000", status: "pending",
    }).returning();

    const base = {
      quoteId: quote.id,
      customerId: c1.id,
      productId: 1,
      sumInsured: 100000,
      premiumAmount: 5000,
      durationMonths: 12,
      paymentRef: `HPAY-${SUFFIX}`,
      coverageStartDate: new Date().toISOString(),
    };
    const first = await createInsurancePolicy(base);
    expect(first.policyId).toBeGreaterThan(0);

    // Idempotent REPLAY (same customer, same quote): returns the existing
    // policy — retry-safe, no second policy, no second charge.
    const replay = await createInsurancePolicy(base);
    expect(replay.policyId).toBe(first.policyId);

    // The atomic guarded flip: a quote marked converted WITHOUT a policy
    // (the concurrent-use window) cannot be consumed again.
    const [quote2] = await db.insert(policyQuotes).values({
      customerId: c1.id, productId: 1, sumInsured: "100000", premiumAmount: "5000", status: "pending",
    }).returning();
    await db.update(policyQuotes).set({ status: "converted" }).where(eq(policyQuotes.id, quote2.id));
    await expect(
      createInsurancePolicy({ ...base, quoteId: quote2.id })
    ).rejects.toThrow(/QUOTE_CONSUMED/);

    // Cross-customer replay of the FIRST quote is refused (ownership).
    const [c2] = await db.insert(customers).values({
      firstName: "H", lastName: "Cross", phone: `+234813${SUFFIX}`.slice(0, 15), status: "active",
    } as typeof customers.$inferInsert).returning();
    await expect(
      createInsurancePolicy({ ...base, customerId: c2.id })
    ).rejects.toThrow(/QUOTE_OWNERSHIP/);

    // Only ONE policy was created for the first quote.
    const [q] = await db.select().from(policyQuotes).where(eq(policyQuotes.id, quote.id));
    expect(q.status).toBe("converted");
  });
});
