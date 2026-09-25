/**
 * parametricEngine.integration.test.ts — Q-wave Q2 (2026-09-25)
 *
 * Parametric Trigger Engine + STP expansion against the REAL PG (PGlite)
 * schema + mini-Redis + mini-TigerBeetle. No mocks on production paths.
 *
 * Coverage:
 *  1. Trigger CRUD + authz (admin-only; regular user FORBIDDEN).
 *  2. Datasource fail-closed: unreachable HTTP feed ⇒ event data_unavailable,
 *     claims routed to pending_adjudication, NO payout.
 *  3. Idempotent fire: duplicate evaluation (same window key) ⇒ single payout.
 *  4. End-to-end parametric claim → payout with recorded activity
 *     (claims_payments.amount == claims.approvedAmount, audit entries).
 *  5. STP tier config: default ₦200k cap queues a ₦250k payout; a configured
 *     ₦300k product tier auto-pays it; fraud-gate tier + fraud-detection-go
 *     DOWN ⇒ fail-closed to pending_adjudication (never auto-approve).
 *  6. Claims-paid-speed metrics: exact p50/p95 on a claimType slice, admin
 *     gated.
 *
 * Ids 973xxx / codes QW2-* are unique to this file.
 */
import { describe, it, beforeAll, afterAll } from "vitest";
import { and, eq } from "drizzle-orm";

import {
  auditLog,
  beneficiaries,
  claims,
  claimWorkflowEvents,
  customers,
  insuranceProducts,
  parametricEvents,
  parametricPayoutSettlements,
  policies,
} from "../../drizzle/schema";
import { claimsPayments } from "../../drizzle/schema.additions";
import { getDb } from "../../server/db";
import {
  callerFor,
  adminUser,
  approverUser,
  regularUser,
  expectCounted as expect,
  expectTrpcError,
  resetAssertionCount,
  getAssertionCount,
} from "./helpers/trpc";

const FILE = "parametricEngine.integration.test.ts";
const NOW = Date.now();
const DAY = 86_400_000;

const CUST = 973021;
const admin = () => callerFor(adminUser);
const admin2 = () => callerFor(approverUser); // second staff identity (dual control)

let productLowId: number;   // payout within default ₦200k cap
let productHighId: number;  // payout ₦250k (above default cap)
let productFraudId: number; // payout ₦100k with fraud-gated tier
let policyLowId: number;
let policyHighId: number;
let policyFraudId: number;

async function seedPolicy(productId: number, policyNumber: string): Promise<number> {
  const db = (await getDb())!;
  const [p] = await db.insert(policies).values({
    policyNumber,
    productId,
    customerId: CUST,
    coverageType: "agriculture",
    status: "active",
    sumInsured: "1000000.00",
    annualPremium: "5000.00",
    startDate: new Date(NOW - 30 * DAY),
    endDate: new Date(NOW + 335 * DAY),
  }).returning({ id: policies.id });
  await db.insert(beneficiaries).values({
    policyId: p.id,
    name: "QW2 Beneficiary",
    relationship: "spouse",
    percentage: "100",
    nationalId: `QW2-NIN-${policyNumber}`,
  });
  return p.id;
}

beforeAll(async () => {
  resetAssertionCount();
  const db = (await getDb())!;
  await db.insert(customers).values({
    id: CUST,
    firstName: "QW2",
    lastName: "Farmer",
    phone: `+234973${String(CUST).slice(-6)}`,
    status: "active",
  }).onConflictDoNothing();
  // 2026-09-25: explicit high ids — several sibling suites insert products
  // with literal small ids without bumping the serial sequence, so a
  // serial-allocated product id can collide with THEIR seeded policies on
  // the shared suite database.
  const mkProduct = async (code: string, id: number) => {
    await db.insert(insuranceProducts).values({
      id,
      productCode: code,
      name: `QW2 ${code}`,
      coverageType: "agriculture",
      isActive: true,
    }).onConflictDoNothing();
    return id;
  };
  productLowId = await mkProduct("QW2-RAIN-LOW", 973101);
  productHighId = await mkProduct("QW2-RAIN-HIGH", 973102);
  productFraudId = await mkProduct("QW2-RAIN-FRAUD", 973103);
  policyLowId = await seedPolicy(productLowId, "QW2-POL-LOW");
  policyHighId = await seedPolicy(productHighId, "QW2-POL-HIGH");
  policyFraudId = await seedPolicy(productFraudId, "QW2-POL-FRAUD");
});

afterAll(() => {
  console.log(`[${FILE}] assertions: ${getAssertionCount()}`);
});

// ── 1. Trigger CRUD + authz ──────────────────────────────────────────────────
describe("trigger CRUD + authz", () => {
  it("regular user cannot create/list/configure triggers (FORBIDDEN)", async () => {
    const user = callerFor(regularUser);
    await expectTrpcError(
      user.parametricEngine.createTrigger({
        name: "QW2-AUTHZ",
        metric: "rainfall_mm",
        operator: "lt",
        threshold: 10,
        windowSeconds: 3600,
        datasourceConfig: { type: "manual" },
      }),
      "FORBIDDEN",
    );
    await expectTrpcError(user.parametricEngine.listTriggers(), "FORBIDDEN");
    await expectTrpcError(user.parametricEngine.listStpTiers(), "FORBIDDEN");
    await expectTrpcError(
      user.parametricEngine.claimsPaidSpeedMetrics({}),
      "FORBIDDEN",
    );
  });

  it("admin creates a trigger (draft) and activates it", async () => {
    const { triggerId, status } = await admin().parametricEngine.createTrigger({
      name: "QW2-CRUD",
      metric: "rainfall_mm",
      operator: "lt",
      threshold: 10,
      windowSeconds: 3600,
      datasourceConfig: { type: "manual" },
    });
    expect(status).toBe("draft");
    await admin().parametricEngine.setTriggerStatus({ triggerId, status: "active" });
    const all = await admin().parametricEngine.listTriggers();
    const t = all.find(r => r.id === triggerId);
    expect(t?.status).toBe("active");
    expect(t?.metric).toBe("rainfall_mm");
  });

  it("dual control: the attester cannot confirm their own manual reading", async () => {
    const { triggerId } = await admin().parametricEngine.createTrigger({
      name: "QW2-DUAL",
      metric: "rainfall_mm",
      operator: "lt",
      threshold: 10,
      windowSeconds: 3600,
      datasourceConfig: { type: "manual" },
    });
    const { readingId } = await admin().parametricEngine.attestReading({
      triggerId,
      metric: "rainfall_mm",
      value: 5,
      observedAt: new Date().toISOString(),
    });
    await expectTrpcError(
      admin().parametricEngine.confirmReading({ readingId }),
      "FORBIDDEN",
    );
    const ok = await admin2().parametricEngine.confirmReading({ readingId });
    expect(ok.success).toBe(true);
  });
});

// ── 2. Datasource fail-closed ────────────────────────────────────────────────
describe("datasource fail-closed", () => {
  it("unreachable HTTP feed ⇒ data_unavailable + manual review, NO payout", async () => {
    const db = (await getDb())!;
    const { triggerId } = await admin().parametricEngine.createTrigger({
      name: "QW2-HTTP-DOWN",
      metric: "rainfall_mm",
      operator: "lt",
      threshold: 10,
      windowSeconds: 3600,
      // Dead local port: connection refused, fast.
      datasourceConfig: { type: "http", url: "http://127.0.0.1:9/reading", timeoutMs: 2000 },
    });
    await admin().parametricEngine.setTriggerStatus({ triggerId, status: "active" });
    await admin().parametricEngine.upsertProduct({
      productId: productLowId,
      triggerId,
      payoutAmount: 150_000,
      coveredPeril: "drought",
    });

    const res = await admin().parametricEngine.evaluateNow({ triggerId });
    expect(res.status).toBe("data_unavailable");
    expect(res.measuredValue).toBeNull();

    const [event] = await db.select().from(parametricEvents)
      .where(eq(parametricEvents.id, res.eventId));
    expect(event.status).toBe("data_unavailable");

    // The in-force policy's claim was routed to the manual review queue.
    const [claim] = await db.select().from(claims)
      .where(eq(claims.claimNumber, `PARAM-${res.eventId}-${policyLowId}`));
    expect(claim.status).toBe("pending_adjudication");

    const settlements = await db.select().from(parametricPayoutSettlements)
      .where(eq(parametricPayoutSettlements.eventId, res.eventId));
    expect(settlements.length).toBe(1);
    expect(settlements[0].status).toBe("pending_adjudication");

    // NO payout happened.
    const payments = await db.select().from(claimsPayments)
      .where(eq(claimsPayments.claimId, claim.id));
    expect(payments.length).toBe(0);
  });
});

// ── 3 + 4. End-to-end fire + idempotency ────────────────────────────────────
describe("end-to-end parametric claim → payout", () => {
  it("fires on a confirmed manual reading, auto-creates + settles the claim, and is idempotent", async () => {
    const db = (await getDb())!;
    const { triggerId } = await admin().parametricEngine.createTrigger({
      name: "QW2-E2E",
      metric: "rainfall_mm",
      operator: "lt",
      threshold: 10,
      windowSeconds: 3600,
      datasourceConfig: { type: "manual" },
    });
    await admin().parametricEngine.setTriggerStatus({ triggerId, status: "active" });
    await admin().parametricEngine.upsertProduct({
      productId: productLowId,
      triggerId,
      payoutAmount: 150_000,
      coveredPeril: "drought",
    });
    const { readingId } = await admin().parametricEngine.attestReading({
      triggerId,
      metric: "rainfall_mm",
      value: 2, // below threshold ⇒ breach for operator lt
      observedAt: new Date().toISOString(),
      note: "staff gauge reading",
    });
    await admin2().parametricEngine.confirmReading({ readingId });

    const res = await admin().parametricEngine.evaluateNow({ triggerId });
    expect(res.status).toBe("fired");
    expect(res.measuredValue).toBe(2);
    expect(res.idempotent).toBe(false);
    expect(res.payouts.length).toBe(1);
    expect(res.payouts[0].outcome).toBe("paid");

    const claimId = res.payouts[0].claimId;
    const [claim] = await db.select().from(claims).where(eq(claims.id, claimId));
    expect(claim.status).toBe("paid");
    expect(Number(claim.approvedAmount)).toBe(150_000);
    expect(Number(claim.paidAmount)).toBe(150_000);

    // Recorded activity: payment amount == adjudicated approvedAmount.
    const [payment] = await db.select().from(claimsPayments)
      .where(eq(claimsPayments.claimId, claimId));
    expect(Number(payment.amount)).toBe(Number(claim.approvedAmount));
    expect(payment.paymentRef).toBe(`PARAM-SETTLE-${res.eventId}-${claimId}`);

    // Beneficiary-of-record was honoured (recorded beneficiary account).
    expect(payment.beneficiaryAccount).toBe("QW2-NIN-QW2-POL-LOW");

    const settlements = await db.select().from(parametricPayoutSettlements)
      .where(eq(parametricPayoutSettlements.eventId, res.eventId));
    expect(settlements.length).toBe(1);
    expect(settlements[0].status).toBe("paid");
    expect(settlements[0].paymentId).toBe(payment.id);

    // Approval provenance event + audit entries.
    const events = await db.select().from(claimWorkflowEvents)
      .where(eq(claimWorkflowEvents.claimId, claimId));
    expect(events.some(e => e.eventType === "claim.approved")).toBe(true);
    const audits = await db.select().from(auditLog)
      .where(eq(auditLog.resourceId, String(claimId)));
    expect(audits.some(a => a.action === "PARAMETRIC_CLAIM_AUTOPAID")).toBe(true);

    // Idempotent re-fire: same window key ⇒ recorded event, NO second payout.
    const replay = await admin().parametricEngine.evaluateNow({ triggerId });
    expect(replay.idempotent).toBe(true);
    expect(replay.eventId).toBe(res.eventId);
    const paymentsAfter = await db.select().from(claimsPayments)
      .where(eq(claimsPayments.claimId, claimId));
    expect(paymentsAfter.length).toBe(1);
    const settlementsAfter = await db.select().from(parametricPayoutSettlements)
      .where(eq(parametricPayoutSettlements.eventId, res.eventId));
    expect(settlementsAfter.length).toBe(1);
  });
});

// ── 5. STP tier config + fraud-down fail-closed ─────────────────────────────
describe("STP tiers", () => {
  it("default ₦200k cap queues a ₦250k payout; configured ₦300k tier auto-pays it", async () => {
    const db = (await getDb())!;
    // Trigger A: no tier for productHighId ⇒ ₦250k > ₦200k default cap.
    const a = await admin().parametricEngine.createTrigger({
      name: "QW2-STP-DEFAULT",
      metric: "rainfall_mm",
      operator: "lt",
      threshold: 10,
      windowSeconds: 3600,
      datasourceConfig: { type: "manual" },
    });
    await admin().parametricEngine.setTriggerStatus({ triggerId: a.triggerId, status: "active" });
    await admin().parametricEngine.upsertProduct({
      productId: productHighId,
      triggerId: a.triggerId,
      payoutAmount: 250_000,
      coveredPeril: "drought",
    });
    const ra = await admin().parametricEngine.attestReading({
      triggerId: a.triggerId, metric: "rainfall_mm", value: 1,
      observedAt: new Date().toISOString(),
    });
    await admin2().parametricEngine.confirmReading({ readingId: ra.readingId });
    const resA = await admin().parametricEngine.evaluateNow({ triggerId: a.triggerId });
    expect(resA.status).toBe("fired");
    expect(resA.payouts[0].outcome).toBe("pending_adjudication");
    const [claimA] = await db.select().from(claims).where(eq(claims.id, resA.payouts[0].claimId));
    expect(claimA.status).toBe("pending_adjudication");
    const payA = await db.select().from(claimsPayments).where(eq(claimsPayments.claimId, claimA.id));
    expect(payA.length).toBe(0);

    // Configure a ₦300k product tier (no fraud bound) ⇒ same payout auto-pays.
    await admin().parametricEngine.upsertStpTier({
      productId: productHighId,
      tierName: "gold",
      autoApproveCap: 300_000,
      maxFraudScore: null,
    });
    const b = await admin().parametricEngine.createTrigger({
      name: "QW2-STP-TIER",
      metric: "rainfall_mm",
      operator: "lt",
      threshold: 10,
      windowSeconds: 3600,
      datasourceConfig: { type: "manual" },
    });
    await admin().parametricEngine.setTriggerStatus({ triggerId: b.triggerId, status: "active" });
    await admin().parametricEngine.upsertProduct({
      productId: productHighId,
      triggerId: b.triggerId,
      payoutAmount: 250_000,
      coveredPeril: "drought",
    });
    const rb = await admin().parametricEngine.attestReading({
      triggerId: b.triggerId, metric: "rainfall_mm", value: 1,
      observedAt: new Date().toISOString(),
    });
    await admin2().parametricEngine.confirmReading({ readingId: rb.readingId });
    const resB = await admin().parametricEngine.evaluateNow({ triggerId: b.triggerId });
    expect(resB.status).toBe("fired");
    expect(resB.payouts[0].outcome).toBe("paid");
    const [claimB] = await db.select().from(claims).where(eq(claims.id, resB.payouts[0].claimId));
    expect(claimB.status).toBe("paid");
    expect(Number(claimB.paidAmount)).toBe(250_000);
  });

  it("fraud-gated tier + fraud service DOWN ⇒ fail-closed to pending_adjudication", async () => {
    const db = (await getDb())!;
    // Tier with a fraud bound: scoring becomes mandatory. No Dapr sidecar in
    // this environment ⇒ fraud-detection-go unreachable ⇒ score null.
    await admin().parametricEngine.upsertStpTier({
      productId: productFraudId,
      tierName: "fraud-gated",
      autoApproveCap: 200_000,
      maxFraudScore: 50,
    });
    const { triggerId } = await admin().parametricEngine.createTrigger({
      name: "QW2-FRAUD-DOWN",
      metric: "rainfall_mm",
      operator: "lt",
      threshold: 10,
      windowSeconds: 3600,
      datasourceConfig: { type: "manual" },
    });
    await admin().parametricEngine.setTriggerStatus({ triggerId, status: "active" });
    await admin().parametricEngine.upsertProduct({
      productId: productFraudId,
      triggerId,
      payoutAmount: 100_000,
      coveredPeril: "drought",
    });
    const r = await admin().parametricEngine.attestReading({
      triggerId, metric: "rainfall_mm", value: 1,
      observedAt: new Date().toISOString(),
    });
    await admin2().parametricEngine.confirmReading({ readingId: r.readingId });
    const res = await admin().parametricEngine.evaluateNow({ triggerId });
    expect(res.status).toBe("fired");
    expect(res.payouts[0].outcome).toBe("pending_adjudication");
    const [claim] = await db.select().from(claims).where(eq(claims.id, res.payouts[0].claimId));
    expect(claim.status).toBe("pending_adjudication");
    // Never auto-approved, never paid.
    const payments = await db.select().from(claimsPayments).where(eq(claimsPayments.claimId, claim.id));
    expect(payments.length).toBe(0);
  });
});

// ── 6. Claims-paid-speed metrics ─────────────────────────────────────────────
describe("claims-paid-speed metrics", () => {
  it("aggregates created→approved→paid p50/p95 from real timestamps", async () => {
    const db = (await getDb())!;
    const t0 = NOW - 10 * DAY;
    const seedPaid = async (
      num: string,
      approveAfterMs: number,
      payAfterMs: number,
    ) => {
      const [c] = await db.insert(claims).values({
        claimNumber: num,
        policyId: policyLowId,
        claimantId: CUST,
        status: "paid",
        claimType: "qw2_metrics_probe",
        incidentDate: new Date(t0),
        claimedAmount: "1000.00",
        approvedAmount: "1000.00",
        paidAmount: "1000.00",
        incidentDescription: "metrics probe",
        settlementDate: new Date(t0 + payAfterMs),
        createdAt: new Date(t0),
        updatedAt: new Date(t0 + payAfterMs),
      }).returning({ id: claims.id });
      await db.insert(claimWorkflowEvents).values({
        claimId: c.id,
        eventType: "claim.approved",
        fromStatus: "submitted",
        toStatus: "approved",
        createdAt: new Date(t0 + approveAfterMs),
      });
      return c.id;
    };
    await seedPaid("QW2-MET-1", 60_000, 600_000);
    await seedPaid("QW2-MET-2", 120_000, 1_800_000);

    const res = await admin().parametricEngine.claimsPaidSpeedMetrics({
      claimType: "qw2_metrics_probe",
    });
    expect(res.sampleSize).toBe(2);
    expect(res.createdToPaidMs).toMatchObject({ p50: 600_000, p95: 1_800_000, count: 2 });
    expect(res.createdToApprovedMs).toMatchObject({ p50: 60_000, p95: 120_000, count: 2 });
    expect(res.approvedToPaidMs).toMatchObject({ p50: 540_000, p95: 1_680_000, count: 2 });

    // Empty slice ⇒ honest nulls.
    const empty = await admin().parametricEngine.claimsPaidSpeedMetrics({
      claimType: "qw2_no_such_type",
    });
    expect(empty.sampleSize).toBe(0);
    expect(empty.createdToPaidMs).toBeNull();
  });
});
