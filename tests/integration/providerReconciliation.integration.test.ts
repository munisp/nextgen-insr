/**
 * providerReconciliation.integration.test.ts — provider/local divergence
 * detection by the reconciliation pass (F-02, THREAT_MODEL.md §F-02).
 *
 * No reconciliation job previously existed for these provider flows;
 * server/lib/providerReconciliation.ts implements the minimal real check
 * (scope: airtime / bill-payment / mobile-money transactions still locally
 * pending with a provider-dispatch status). It FLAGS divergences loudly
 * (audit log + report) and never silently moves funds.
 *
 * The provider is tests/providers/vendingSimulator.ts — a PROTOCOL-FAITHFUL
 * LOCAL SIMULATOR. NOT evidence of provider behavior.
 */
import { describe, it, beforeAll, afterAll } from "vitest";
import { eq, and } from "drizzle-orm";
import { getDb } from "../../server/db";
import { agents, auditLog, transactions } from "../../drizzle/schema";
import { VendingSimulator } from "../providers/vendingSimulator";
import { reconcileProviderOperations } from "../../server/lib/providerReconciliation";
import {
  callerFor,
  adminUser,
  expectCounted as expect,
  resetAssertionCount,
  getAssertionCount,
} from "./helpers/trpc";

const FILE = "providerReconciliation";
const AGENT_PK = 977002;
const AGENT_CODE = "AGT-PS-77002";

let sim: VendingSimulator;
const ENV_KEYS = [
  "AIRTIME_PROVIDER_URL",
  "AIRTIME_PROVIDER_TIMEOUT_MS",
  "VTPASS_API_KEY",
  "RELOADLY_API_KEY",
] as const;
let savedEnv: Record<string, string | undefined> = {};

describe("provider reconciliation: divergence flagging (protocol-faithful local simulator)", () => {
  beforeAll(async () => {
    resetAssertionCount();
    sim = await VendingSimulator.start();
    for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
    for (const k of ENV_KEYS) delete process.env[k];
    process.env.AIRTIME_PROVIDER_URL = sim.baseUrl;
    process.env.AIRTIME_PROVIDER_TIMEOUT_MS = "500";
    const db = (await getDb())!;
    await db
      .insert(agents)
      .values({
        id: AGENT_PK,
        agentId: AGENT_CODE,
        name: "Recon Sim Agent",
        phone: "08030000002",
        pinHash: "x".repeat(64),
        premiumReserve: "1000000.00",
        isActive: true,
        floatLocked: false,
      })
      .onConflictDoNothing();
  });

  afterAll(async () => {
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
    await sim.stop();
    console.log(`[integration] ${FILE}: ${getAssertionCount()} assertions`);
  });

  it("flags provider-completed vs local-pending divergence in the audit log", async () => {
    const caller = callerFor(adminUser);
    const ref = `RECON-DIV-${Date.now()}`;

    // Inject the divergence: the provider ACCEPTED and COMPLETED the vend,
    // but the response was dropped so locally it is still pending.
    sim.mode = "drop_response";
    const first = await caller.airtimeVending.vend({
      agentId: AGENT_PK,
      network: "MTN",
      phoneNumber: "08031234567",
      amountNGN: 500,
      reference: ref,
    });
    expect(first.status).toBe("unknown_outcome");
    sim.mode = "normal";

    const report = await reconcileProviderOperations({ olderThanMs: -60_000 });
    const divergence = report.divergences.find(d => d.ref === ref);
    expect(divergence).toBeDefined();
    expect(divergence!.providerReportedStatus).toBe("completed");
    expect(divergence!.localStatus).toBe("pending");

    // Flagged loudly in the audit log.
    const db = (await getDb())!;
    const flags = await db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.action, "PROVIDER_RECONCILIATION_DIVERGENCE"),
          eq(auditLog.resourceId, ref)
        )
      );
    expect(flags.length).toBeGreaterThanOrEqual(1);

    // The reconciler FLAGGED but did not silently rewrite the local state.
    const [tx] = await db.select().from(transactions).where(eq(transactions.ref, ref));
    expect(tx.status).toBe("pending");
  });

  it("reports consistent rows as consistent (no false divergence)", async () => {
    const caller = callerFor(adminUser);
    const ref = `RECON-CON-${Date.now()}`;
    sim.mode = "normal";
    await caller.airtimeVending.vend({
      agentId: AGENT_PK,
      network: "Glo",
      phoneNumber: "08051234567",
      amountNGN: 300,
      reference: ref,
    });
    // Provider still processing -> status lookup returns pending.
    sim.statuses.set(ref, "pending");

    const report = await reconcileProviderOperations({ olderThanMs: -60_000 });
    expect(report.divergences.find(d => d.ref === ref)).toBeUndefined();
  });

  it("reports rows without a provider URL as unreconcilable (honest gap)", async () => {
    // Key-only configuration: vend passes the gate but nothing can be
    // dispatched or reconciled — the report must say so honestly.
    delete process.env.AIRTIME_PROVIDER_URL;
    process.env.VTPASS_API_KEY = "legacy-key-only";
    const caller = callerFor(adminUser);
    const ref = `RECON-NOURL-${Date.now()}`;
    await caller.airtimeVending.vend({
      agentId: AGENT_PK,
      network: "Airtel",
      phoneNumber: "08021234567",
      amountNGN: 100,
      reference: ref,
    });
    delete process.env.VTPASS_API_KEY;

    const report = await reconcileProviderOperations({ olderThanMs: -60_000 });
    expect(report.unreconcilable).toBeGreaterThanOrEqual(1);
    expect(report.divergences.find(d => d.ref === ref)).toBeUndefined();
    // Restore for any later files.
    process.env.AIRTIME_PROVIDER_URL = sim.baseUrl;
  });
});
