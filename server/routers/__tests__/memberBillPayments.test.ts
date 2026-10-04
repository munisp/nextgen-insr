/**
 * memberBillPayments.test.ts — R3 batch 3 (2026-10-01, R3-b3)
 *
 * Real-behavior PGlite tests for server/routers/memberBillPayments.ts:
 *   - anonymous caller → UNAUTHORIZED (protectedProcedure)
 *   - billers catalog: real registry contents (names, commission rates,
 *     limits) + the honest `configured` flag (env probe; unset in tests →
 *     false)
 *   - validateCustomer: identical regex rules to billPayments.validateCustomer
 *     (electricity 10-13 digits, TV 10-12 digits, other >= 5 chars)
 *   - 2026-10-03 (W10-B2): the member-safe funds mutations `pay`/`confirmPay`
 *     now ship (Paystack capture → verified fulfillment dispatch via
 *     server/lib/memberFunds.ts); the catalog procs still never touch the
 *     DB. The mutation behavior itself is covered for real (PGlite + wire
 *     servers) in memberBillPayW10B2.test.ts.
 *
 * PGlite harness copied from memberReferrals.test.ts (2026-10-01 R3-fix-ci2):
 * real embedded PostgreSQL over the wire protocol, EPHEMERAL probed port so
 * suites can run concurrently without EADDRINUSE. memberBillPayments itself
 * performs no DB access; the harness still runs the same real stack
 * (getDb() wired to a live server) so any future accidental DB call is
 * exercised against a real database, not a mock.
 */
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  makeAuthenticatedCtx,
  makeUnauthenticatedCtx,
} from "../../lib/__tests__/testHelpers";

// Ephemeral port probe (memberReferrals.test.ts copy, 2026-10-01 R3-b3).
let PG_PORT = 0;
let PG_URL = "";

async function probeFreePort(): Promise<number> {
  const net = await import("node:net");
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      srv.close(() => (port > 0 ? resolve(port) : reject(new Error("no port"))));
    });
  });
}
let pgliteChild: ChildProcess | null = null;

// Unit-test env: no Permify sidecar. Explicit insecure opt-in (same pattern
// as memberReferrals) so protectedProcedure passes the base gate.
process.env.PERMIFY_FAIL_OPEN = "true";

// Provider env vars must be ABSENT for the honest `configured:false` test.
delete process.env.BILL_PROVIDER_URL;
delete process.env.BILL_PROVIDER_API_KEY;
delete process.env.VTPASS_API_KEY;
delete process.env.BAXI_API_KEY;

type Caller = ReturnType<
  (typeof import("../memberBillPayments"))["memberBillPaymentsRouter"]["createCaller"]
>;
let memberCaller: Caller;
let anonCaller: Caller;

async function startPglite(): Promise<void> {
  PG_PORT = await probeFreePort();
  PG_URL = `postgresql://postgres:postgres@127.0.0.1:${PG_PORT}/postgres`;
  const script = path.resolve(
    __dirname,
    "../../../tests/integration/setup/pgliteServer.mjs"
  );
  pgliteChild = spawn(process.execPath, [script], {
    env: { ...process.env, PGLITE_PORT: String(PG_PORT) },
    stdio: ["ignore", "pipe", "inherit"],
  });
  await new Promise<void>((resolve, reject) => {
    const to = setTimeout(() => reject(new Error("PGlite start timeout")), 30_000);
    pgliteChild!.stdout!.on("data", d => {
      if (String(d).includes("PGLITE_READY")) {
        clearTimeout(to);
        resolve();
      }
    });
    pgliteChild!.on("exit", c => reject(new Error(`pglite exited ${c}`)));
  });
  process.env.POSTGRES_URL = PG_URL;
}

beforeAll(async () => {
  await startPglite();
  const { memberBillPaymentsRouter } = await import("../memberBillPayments");
  memberCaller = memberBillPaymentsRouter.createCaller(makeAuthenticatedCtx());
  anonCaller = memberBillPaymentsRouter.createCaller(makeUnauthenticatedCtx());
}, 60_000);

afterAll(() => {
  pgliteChild?.kill();
});

describe("memberBillPayments router (2026-10-01, R3-b3)", () => {
  it("rejects anonymous callers with UNAUTHORIZED", async () => {
    await expect(anonCaller.billers()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await expect(
      anonCaller.validateCustomer({ biller: "EKEDC", customerNumber: "0123456789" })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("exposes exactly the catalog reads + the W10-B2 member-safe funds mutations", async () => {
    // 2026-10-03 (W10-B2): pay/confirmPay now exist — the member-safe
    // recomposition (session-derived identity, server-side limits, Paystack
    // capture, never the quarantined agent router). Assert on the router
    // DEFINITION (createCaller is a proxy with no enumerable keys).
    const { memberBillPaymentsRouter } = await import("../memberBillPayments");
    const procs = Object.keys(
      memberBillPaymentsRouter._def.procedures as Record<string, unknown>
    );
    expect(procs.sort()).toEqual([
      "billers",
      "confirmPay",
      "pay",
      "validateCustomer",
    ]);
  });

  it("billers returns the real registry with limits and honest configured:false", async () => {
    const result = await memberCaller.billers();
    expect(result.configured).toBe(false); // no provider env in tests
    expect(result.limits).toEqual({
      minAmountNGN: 100,
      maxAmountNGN: 500_000,
      dailyLimitNGN: 2_000_000,
    });
    expect(result.billers.length).toBe(20);
    const ekedc = result.billers.find(b => b.name === "EKEDC");
    expect(ekedc).toMatchObject({ commissionRate: 0.005, commissionPct: "0.5%" });
    const waec = result.billers.find(b => b.name === "WAEC");
    expect(waec).toMatchObject({ commissionRate: 0.02, commissionPct: "2.0%" });
    const names = result.billers.map(b => b.name);
    expect(names).toContain("DSTV");
    expect(names).toContain("JAMB");
  });

  it("billers discloses configured:true only when a provider env var is set", async () => {
    process.env.VTPASS_API_KEY = "test-key";
    try {
      const { memberBillPaymentsRouter } = await import("../memberBillPayments");
      const caller = memberBillPaymentsRouter.createCaller(makeAuthenticatedCtx());
      const result = await caller.billers();
      expect(result.configured).toBe(true);
    } finally {
      delete process.env.VTPASS_API_KEY;
    }
  });

  it("validateCustomer applies the electricity 10-13 digit rule", async () => {
    await expect(
      memberCaller.validateCustomer({ biller: "EKEDC", customerNumber: "0123456789" })
    ).resolves.toMatchObject({ valid: true, message: "Valid" });
    await expect(
      memberCaller.validateCustomer({ biller: "IKEDC", customerNumber: "0123456789012" })
    ).resolves.toMatchObject({ valid: true });
    await expect(
      memberCaller.validateCustomer({ biller: "EKEDC", customerNumber: "12345" })
    ).resolves.toMatchObject({ valid: false, message: "Invalid customer number" });
    await expect(
      memberCaller.validateCustomer({ biller: "EKEDC", customerNumber: "01234567890123" })
    ).resolves.toMatchObject({ valid: false }); // 14 digits
  });

  it("validateCustomer applies the TV 10-12 digit rule", async () => {
    await expect(
      memberCaller.validateCustomer({ biller: "DSTV", customerNumber: "0123456789" })
    ).resolves.toMatchObject({ valid: true });
    await expect(
      memberCaller.validateCustomer({ biller: "GOtv", customerNumber: "0123456789012" })
    ).resolves.toMatchObject({ valid: false }); // 13 digits
  });

  it("validateCustomer applies the >=5-char fallback for other billers", async () => {
    await expect(
      memberCaller.validateCustomer({ biller: "WAEC", customerNumber: "ABCDE" })
    ).resolves.toMatchObject({ valid: true });
    await expect(
      memberCaller.validateCustomer({ biller: "WAEC", customerNumber: "ABC" })
    ).resolves.toMatchObject({ valid: false });
  });
});
