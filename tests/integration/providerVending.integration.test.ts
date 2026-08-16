/**
 * providerVending.integration.test.ts — airtime / bill-payment / mobile-money
 * unknown-outcome tests against the REAL routers (full tRPC middleware chain,
 * real DB) (F-02, THREAT_MODEL.md §F-02).
 *
 * The provider is tests/providers/vendingSimulator.ts — a PROTOCOL-FAITHFUL
 * LOCAL SIMULATOR implementing the vend/pay/cashin/cashout + status-lookup
 * wire protocol consumed by server/lib/providerDispatch.ts. It is NOT
 * evidence of provider behavior; official-sandbox verification remains an
 * open external item.
 *
 * Scenarios (per flow):
 *   (a) provider timeout BEFORE send -> operation stays pending, retry is
 *        idempotent (no duplicate row, no duplicate provider effect)
 *   (b) timeout AFTER provider accepted (drop_response) -> retry uses status
 *        lookup, resolves to success, provider saw exactly ONE dispatch
 *   (c) malformed provider reply -> loud unknown outcome, no phantom success
 *   definitive rejection -> row marked failed loudly, no success fabrication
 *   happy path -> pending FIRST, then submitted; completion only via lookup
 */
import { describe, it, beforeAll, afterAll, beforeEach } from "vitest";
import { eq, count } from "drizzle-orm";
import { getDb } from "../../server/db";
import { agents, transactions } from "../../drizzle/schema";
import { VendingSimulator } from "../providers/vendingSimulator";
import {
  callerFor,
  adminUser,
  expectCounted as expect,
  expectTrpcError,
  resetAssertionCount,
  getAssertionCount,
} from "./helpers/trpc";

const FILE = "providerVending";
const AGENT_PK = 977001;
const AGENT_CODE = "AGT-PS-77001";

let sim: VendingSimulator;
const ENV_KEYS = [
  "AIRTIME_PROVIDER_URL",
  "AIRTIME_PROVIDER_API_KEY",
  "AIRTIME_PROVIDER_TIMEOUT_MS",
  "BILL_PROVIDER_URL",
  "BILL_PROVIDER_API_KEY",
  "BILL_PROVIDER_TIMEOUT_MS",
  "MOBILE_MONEY_PROVIDER_URL",
  "MOBILE_MONEY_PROVIDER_API_KEY",
  "MOBILE_MONEY_PROVIDER_TIMEOUT_MS",
  "VTPASS_API_KEY",
  "RELOADLY_API_KEY",
  "BAXI_API_KEY",
] as const;
let savedEnv: Record<string, string | undefined> = {};
let refSeq = 0;
function nextRef(prefix: string): string {
  return `${prefix}-${Date.now()}-${refSeq++}`;
}

async function txByRef(ref: string) {
  const db = (await getDb())!;
  const rows = await db.select().from(transactions).where(eq(transactions.ref, ref));
  return rows[0] ?? null;
}

async function txCountByRef(ref: string): Promise<number> {
  const db = (await getDb())!;
  const [row] = await db
    .select({ c: count() })
    .from(transactions)
    .where(eq(transactions.ref, ref));
  return Number(row?.c ?? 0);
}

function meta(tx: any): Record<string, any> {
  return (tx?.metadata as Record<string, any>) ?? {};
}

describe("vending providers: unknown-outcome resolution (protocol-faithful local simulator)", () => {
  beforeAll(async () => {
    resetAssertionCount();
    sim = await VendingSimulator.start();
    for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
    const db = (await getDb())!;
    await db
      .insert(agents)
      .values({
        id: AGENT_PK,
        agentId: AGENT_CODE,
        name: "Provider Sim Agent",
        phone: "08030000001",
        pinHash: "x".repeat(64),
        premiumReserve: "1000000.00",
        isActive: true,
        floatLocked: false,
      })
      .onConflictDoNothing();
  });

  beforeEach(() => {
    for (const k of ENV_KEYS) delete process.env[k];
    process.env.AIRTIME_PROVIDER_TIMEOUT_MS = "500";
    process.env.BILL_PROVIDER_TIMEOUT_MS = "500";
    process.env.MOBILE_MONEY_PROVIDER_TIMEOUT_MS = "500";
    sim.mode = "normal";
  });

  afterAll(async () => {
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
    await sim.stop();
    console.log(`[integration] ${FILE}: ${getAssertionCount()} assertions`);
  });

  // ── Airtime ─────────────────────────────────────────────────────────────
  it("airtime: happy path is pending-FIRST then submitted (never sync success)", async () => {
    process.env.AIRTIME_PROVIDER_URL = sim.baseUrl;
    const caller = callerFor(adminUser);
    const ref = nextRef("AIRT-OK");
    const result = await caller.airtimeVending.vend({
      agentId: AGENT_PK,
      network: "MTN",
      phoneNumber: "08031234567",
      amountNGN: 200,
      reference: ref,
    });
    expect(result.status).toBe("submitted");
    const tx = await txByRef(ref);
    expect(tx!.status).toBe("pending"); // not success until fulfilment lookup
    expect(meta(tx).providerStatus).toBe("submitted");
    expect(meta(tx).providerRef).toMatch(/^vsim_/);
  });

  it("airtime: (b) timeout AFTER provider accepted -> retry resolves via status lookup, ONE dispatch", async () => {
    process.env.AIRTIME_PROVIDER_URL = sim.baseUrl;
    sim.mode = "drop_response";
    const caller = callerFor(adminUser);
    const ref = nextRef("AIRT-DROP");

    const first = await caller.airtimeVending.vend({
      agentId: AGENT_PK,
      network: "MTN",
      phoneNumber: "08031234567",
      amountNGN: 150,
      reference: ref,
    });
    expect(first.status).toBe("unknown_outcome");
    let tx = await txByRef(ref);
    expect(tx!.status).toBe("pending");
    expect(meta(tx).providerStatus).toBe("unknown_outcome");
    expect(await txCountByRef(ref)).toBe(1);

    // Retry with the SAME reference: must NOT re-dispatch; resolves through
    // the provider status endpoint (the provider HAD accepted the first one).
    sim.mode = "normal";
    const retry = await caller.airtimeVending.vend({
      agentId: AGENT_PK,
      network: "MTN",
      phoneNumber: "08031234567",
      amountNGN: 150,
      reference: ref,
    });
    expect(retry.idempotent).toBe(true);
    expect((retry as any).resolution).toBe("completed");
    tx = await txByRef(ref);
    expect(tx!.status).toBe("success");
    expect(meta(tx).providerStatus).toBe("completed");
    // Commission earned only at confirmed fulfilment.
    expect(Number(tx!.commission)).toBeCloseTo(150 * 0.03, 2);
    // THE funds-safety property: exactly ONE provider dispatch, ONE local row.
    expect(sim.acceptedCount(ref)).toBe(1);
    expect(await txCountByRef(ref)).toBe(1);
  });

  it("airtime: (a) provider down before send -> stays pending, retry idempotent, no duplicate", async () => {
    process.env.AIRTIME_PROVIDER_URL = "http://127.0.0.1:9"; // dead
    const caller = callerFor(adminUser);
    const ref = nextRef("AIRT-DOWN");

    const first = await caller.airtimeVending.vend({
      agentId: AGENT_PK,
      network: "Glo",
      phoneNumber: "08051234567",
      amountNGN: 100,
      reference: ref,
    });
    expect(first.status).toBe("unknown_outcome");
    expect(await txCountByRef(ref)).toBe(1);

    // Retry while still down: no new row, lookup inconclusive, still pending.
    const retry = await caller.airtimeVending.vend({
      agentId: AGENT_PK,
      network: "Glo",
      phoneNumber: "08051234567",
      amountNGN: 100,
      reference: ref,
    });
    expect(retry.idempotent).toBe(true);
    expect(await txCountByRef(ref)).toBe(1);
    const tx = await txByRef(ref);
    expect(tx!.status).toBe("pending");
  });

  it("airtime: (c) malformed provider reply -> unknown outcome, NO phantom success", async () => {
    process.env.AIRTIME_PROVIDER_URL = sim.baseUrl;
    sim.mode = "malformed";
    const caller = callerFor(adminUser);
    const ref = nextRef("AIRT-MAL");
    const result = await caller.airtimeVending.vend({
      agentId: AGENT_PK,
      network: "Airtel",
      phoneNumber: "08021234567",
      amountNGN: 100,
      reference: ref,
    });
    expect(result.status).toBe("unknown_outcome");
    const tx = await txByRef(ref);
    expect(tx!.status).toBe("pending");
    expect(tx!.status).not.toBe("success");
  });

  it("airtime: definitive provider rejection -> loud failure, row failed, no success", async () => {
    process.env.AIRTIME_PROVIDER_URL = sim.baseUrl;
    sim.mode = "reject";
    const caller = callerFor(adminUser);
    const ref = nextRef("AIRT-REJ");
    await expectTrpcError(
      caller.airtimeVending.vend({
        agentId: AGENT_PK,
        network: "MTN",
        phoneNumber: "08031234567",
        amountNGN: 100,
        reference: ref,
      }),
      "PRECONDITION_FAILED"
    );
    const tx = await txByRef(ref);
    expect(tx!.status).toBe("failed");
    expect(meta(tx).providerStatus).toBe("rejected");
  });

  it("airtime: no provider URL keeps honest pending_provider (no dispatch)", async () => {
    process.env.VTPASS_API_KEY = "legacy-key-only"; // passes gate, no URL
    const caller = callerFor(adminUser);
    const ref = nextRef("AIRT-NOURL");
    const result = await caller.airtimeVending.vend({
      agentId: AGENT_PK,
      network: "MTN",
      phoneNumber: "08031234567",
      amountNGN: 100,
      reference: ref,
    });
    expect(result.status).toBe("pending_provider");
    expect(sim.operations.has(ref)).toBe(false);
  });

  // ── Bill payments ─────────────────────────────────────────────────────────
  it("bill payment: (b) drop-response then retry -> resolved completed, ONE dispatch", async () => {
    process.env.BILL_PROVIDER_URL = sim.baseUrl;
    sim.mode = "drop_response";
    const caller = callerFor(adminUser);
    const ref = nextRef("BILL-DROP");
    const first = await caller.billPayments.pay({
      agentId: AGENT_PK,
      biller: "EKEDC",
      customerNumber: "12345678901",
      amountNGN: 2500,
      reference: ref,
    });
    expect(first.status).toBe("unknown_outcome");

    sim.mode = "normal";
    const retry = await caller.billPayments.pay({
      agentId: AGENT_PK,
      biller: "EKEDC",
      customerNumber: "12345678901",
      amountNGN: 2500,
      reference: ref,
    });
    expect(retry.idempotent).toBe(true);
    const tx = await txByRef(ref);
    expect(tx!.status).toBe("success");
    expect(Number(tx!.commission)).toBeCloseTo(2500 * 0.005, 2);
    expect(sim.acceptedCount(ref)).toBe(1);
    expect(await txCountByRef(ref)).toBe(1);
  });

  it("bill payment: (c) malformed reply -> no phantom success", async () => {
    process.env.BILL_PROVIDER_URL = sim.baseUrl;
    sim.mode = "malformed";
    const caller = callerFor(adminUser);
    const ref = nextRef("BILL-MAL");
    const result = await caller.billPayments.pay({
      agentId: AGENT_PK,
      biller: "DSTV",
      customerNumber: "1234567890",
      amountNGN: 5000,
      reference: ref,
    });
    expect(result.status).toBe("unknown_outcome");
    const tx = await txByRef(ref);
    expect(tx!.status).toBe("pending");
  });

  // ── Mobile money ──────────────────────────────────────────────────────────
  it("mobile money cash-in: (b) drop-response then retry -> completed via lookup, ONE dispatch", async () => {
    process.env.MOBILE_MONEY_PROVIDER_URL = sim.baseUrl;
    sim.mode = "drop_response";
    const caller = callerFor(adminUser);
    const ref = nextRef("MMCI-DROP");
    const first = await caller.mobileMoney.cashIn({
      agentId: AGENT_PK,
      provider: "MTN MoMo",
      customerPhone: "08061234567",
      amountNGN: 3000,
      reference: ref,
    });
    expect(first.status).toBe("unknown_outcome");

    sim.mode = "normal";
    const retry = await caller.mobileMoney.cashIn({
      agentId: AGENT_PK,
      provider: "MTN MoMo",
      customerPhone: "08061234567",
      amountNGN: 3000,
      reference: ref,
    });
    expect(retry.idempotent).toBe(true);
    const tx = await txByRef(ref);
    expect(tx!.status).toBe("success");
    expect(Number(tx!.commission)).toBeCloseTo(3000 * 0.015, 2);
    expect(sim.acceptedCount(ref)).toBe(1);
    expect(await txCountByRef(ref)).toBe(1);
  });

  it("mobile money cash-out: (a) provider down -> pending, retry idempotent", async () => {
    process.env.MOBILE_MONEY_PROVIDER_URL = "http://127.0.0.1:9";
    const caller = callerFor(adminUser);
    const ref = nextRef("MMCO-DOWN");
    const first = await caller.mobileMoney.cashOut({
      agentId: AGENT_PK,
      provider: "Airtel Money",
      customerPhone: "08081234567",
      amountNGN: 4000,
      reference: ref,
    });
    expect(first.status).toBe("unknown_outcome");
    const retry = await caller.mobileMoney.cashOut({
      agentId: AGENT_PK,
      provider: "Airtel Money",
      customerPhone: "08081234567",
      amountNGN: 4000,
      reference: ref,
    });
    expect(retry.idempotent).toBe(true);
    expect(await txCountByRef(ref)).toBe(1);
    const tx = await txByRef(ref);
    expect(tx!.status).toBe("pending");
  });

  it("mobile money: definitive rejection -> loud PRECONDITION_FAILED, row failed", async () => {
    process.env.MOBILE_MONEY_PROVIDER_URL = sim.baseUrl;
    sim.mode = "reject";
    const caller = callerFor(adminUser);
    const ref = nextRef("MM-REJ");
    await expectTrpcError(
      caller.mobileMoney.cashOut({
        agentId: AGENT_PK,
        provider: "9PSB",
        customerPhone: "08091234567",
        amountNGN: 1000,
        reference: ref,
      }),
      "PRECONDITION_FAILED"
    );
    const tx = await txByRef(ref);
    expect(tx!.status).toBe("failed");
  });
});
