import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";

import { deriveRefundTerms } from "../routers/disputeRefund";
import {
  flagRefundLoopIfAbusive,
  REFUND_LOOP_CUSTOMER_THRESHOLD,
  REFUND_LOOP_POLICY_THRESHOLD,
} from "../lib/refundLoopDetection";

// ── AB-19: server-derived refund terms (pure function) ─────────────────────
describe("deriveRefundTerms (AB-19)", () => {
  const tx = { id: 42, amount: "50000.00", customerAccount: "0123456789", destinationAccount: "9998887776" };

  it("rejects refund exceeding the original transaction amount", () => {
    expect(() => deriveRefundTerms(tx, { amount: 50001, accountNumber: "111" })).toThrow(/exceeds/);
  });

  it("forces destination to the original source account", () => {
    const t = deriveRefundTerms(tx, { amount: 5000, accountNumber: "attacker-acct" });
    expect(t.effectiveDestination).toBe("0123456789");
    expect(t.originalTxId).toBe(42);
  });

  it("falls back to destinationAccount when customerAccount is null", () => {
    const t = deriveRefundTerms({ ...tx, customerAccount: null }, { amount: 100, accountNumber: "x" });
    expect(t.effectiveDestination).toBe("9998887776");
  });

  it("passes through client values only when no original transaction exists", () => {
    const t = deriveRefundTerms(null, { amount: 7000, accountNumber: "client-acct" });
    expect(t.effectiveDestination).toBe("client-acct");
    expect(t.originalTxId).toBeNull();
  });
});

// ── AB-10: refund-loop velocity detection (PGlite, real SQL) ────────────────
describe("flagRefundLoopIfAbusive (AB-10)", () => {
  let pglite: PGlite;
  let db: ReturnType<typeof drizzle>;

  beforeAll(async () => {
    pglite = new PGlite();
    db = drizzle(pglite);
    await pglite.exec(`
      CREATE TABLE policies (id SERIAL PRIMARY KEY, "customerId" INTEGER NOT NULL);
      CREATE TYPE policy_status AS ENUM ('active','cancelled');
      CREATE TABLE policy_workflow_events (
        id SERIAL PRIMARY KEY, "policyId" INTEGER NOT NULL,
        "eventType" VARCHAR(64) NOT NULL, "createdAt" TIMESTAMP DEFAULT NOW() NOT NULL
      );
      CREATE TYPE fraud_severity AS ENUM ('critical','high','medium','low');
      CREATE TYPE fraud_status AS ENUM ('open','resolved','snoozed');
      CREATE TABLE fraud_alerts (
        id SERIAL PRIMARY KEY, "agentId" INTEGER, "transactionId" INTEGER,
        severity fraud_severity NOT NULL, type VARCHAR(128) NOT NULL,
        reason TEXT NOT NULL, "fraudScore" NUMERIC(5,2),
        status fraud_status DEFAULT 'open' NOT NULL, "tenantId" INTEGER,
        "createdAt" TIMESTAMP DEFAULT NOW() NOT NULL,
        "updatedAt" TIMESTAMP DEFAULT NOW() NOT NULL
      );
      INSERT INTO policies (id, "customerId") VALUES (1, 100), (2, 100), (3, 200);
    `);
  });

  afterAll(async () => { await pglite.close(); });

  it("does not flag a first cancellation", async () => {
    await pglite.exec(`INSERT INTO policy_workflow_events ("policyId","eventType") VALUES (3,'policy.cancelled')`);
    const r = await flagRefundLoopIfAbusive(db, { policyId: 3 });
    expect(r.flagged).toBe(false);
  });

  it("flags when the same policy is cancelled repeatedly", async () => {
    for (let i = 0; i < REFUND_LOOP_POLICY_THRESHOLD; i++) {
      await pglite.exec(`INSERT INTO policy_workflow_events ("policyId","eventType") VALUES (1,'policy.cancelled')`);
    }
    const r = await flagRefundLoopIfAbusive(db, { policyId: 1 });
    expect(r.policyCancels).toBeGreaterThanOrEqual(REFUND_LOOP_POLICY_THRESHOLD);
    expect(r.flagged).toBe(true);
  });

  it("flags a customer cancelling across many policies and writes a fraud alert", async () => {
    // customer 100 already has policy-1 cancels; add enough on policy 2
    for (let i = 0; i < REFUND_LOOP_CUSTOMER_THRESHOLD; i++) {
      await pglite.exec(`INSERT INTO policy_workflow_events ("policyId","eventType") VALUES (2,'policy.cancelled')`);
    }
    const r = await flagRefundLoopIfAbusive(db, { policyId: 2 });
    expect(r.customerCancels).toBeGreaterThanOrEqual(REFUND_LOOP_CUSTOMER_THRESHOLD);
    expect(r.flagged).toBe(true);
    const alerts = await pglite.query(`SELECT * FROM fraud_alerts WHERE type='refund_loop_velocity'`);
    expect(alerts.rows.length).toBeGreaterThanOrEqual(1);
  });

  it("ignores non-cancellation events", async () => {
    await pglite.exec(`INSERT INTO policy_workflow_events ("policyId","eventType") VALUES (3,'policy.renewed'),(3,'policy.renewed'),(3,'policy.renewed')`);
    const r = await flagRefundLoopIfAbusive(db, { policyId: 3 });
    expect(r.flagged).toBe(false);
  });
});
