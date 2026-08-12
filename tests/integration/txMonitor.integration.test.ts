/**
 * txMonitor.integration.test.ts — real-DB integration tests for transaction
 * monitoring alert lifecycle.
 *
 * Proves:
 *   - getAlerts reads seeded fraud_alerts rows and honours the severity filter
 *   - acknowledgeAlert persists open -> investigating with assignee = caller
 *   - resolveAlert persists resolved + resolvedAt and writes a REAL audit_log
 *     row (tx_alert_resolved)
 *   - NOT_FOUND / BAD_REQUEST on bad ids
 *   - anonymous mutations are rejected and the row stays open
 */
import { describe, it, beforeAll, afterAll } from "vitest";
import { eq, and } from "drizzle-orm";
import { getDb } from "../../server/db";
import { fraudAlerts, auditLog } from "../../drizzle/schema";
import {
  callerFor,
  adminUser,
  expectCounted as expect,
  expectTrpcError,
  resetAssertionCount,
  getAssertionCount,
} from "./helpers/trpc";

const FILE = "txMonitor";

let alertAckId = 0;
let alertResolveId = 0;
let alertAnonId = 0;

async function seedAlert(severity: "critical" | "low", reason: string): Promise<number> {
  const db = (await getDb())!;
  const [row] = await db
    .insert(fraudAlerts)
    .values({
      agentId: 1,
      severity,
      type: "RULE-IT",
      amount: "125000.00",
      reason,
      status: "open",
    })
    .returning({ id: fraudAlerts.id });
  return row!.id;
}

async function alertById(id: number) {
  const db = (await getDb())!;
  const [row] = await db.select().from(fraudAlerts).where(eq(fraudAlerts.id, id));
  return row;
}

describe("txMonitor router (integration, real DB)", () => {
  beforeAll(async () => {
    resetAssertionCount();
    alertAckId = await seedAlert("critical", "IT fixture: ack target");
    alertResolveId = await seedAlert("critical", "IT fixture: resolve target");
    alertAnonId = await seedAlert("low", "IT fixture: anon target");
  });

  afterAll(() => {
    console.log(`[integration] ${FILE}: ${getAssertionCount()} assertions`);
  });

  it("getAlerts reads seeded fraud_alerts and filters by severity", async () => {
    const caller = callerFor(adminUser);

    const all = await caller.txMonitor.getAlerts();
    expect(all.total).toBeGreaterThanOrEqual(3);
    const seededIds = all.alerts.map(a => a.id);
    expect(seededIds).toContain(String(alertAckId));
    expect(seededIds).toContain(String(alertResolveId));
    expect(seededIds).toContain(String(alertAnonId));

    const criticalOnly = await caller.txMonitor.getAlerts({ severity: "critical" });
    expect(criticalOnly.total).toBeGreaterThanOrEqual(2);
    expect(criticalOnly.alerts.every(a => a.severity === "critical")).toBe(true);
    expect(
      criticalOnly.alerts.some(a => a.id === String(alertAnonId))
    ).toBe(false);
  });

  it("acknowledgeAlert persists open -> investigating with assignee = caller email", async () => {
    const caller = callerFor(adminUser);
    const res = await caller.txMonitor.acknowledgeAlert({
      alertId: String(alertAckId),
    });
    expect(res.success).toBe(true);

    const row = await alertById(alertAckId);
    expect(row!.status).toBe("investigating");
    expect(row!.assignedTo).toBe(adminUser.email);
  });

  it("resolveAlert persists resolved + resolvedAt and writes a real audit_log row", async () => {
    const caller = callerFor(adminUser);
    const res = await caller.txMonitor.resolveAlert({
      alertId: String(alertResolveId),
      resolution: "Confirmed legitimate agent float movement",
    });
    expect(res.success).toBe(true);
    expect(res.status).toBe("resolved");

    const row = await alertById(alertResolveId);
    expect(row!.status).toBe("resolved");
    expect(row!.resolvedAt).not.toBeNull();

    // The audit trail row must actually exist in audit_log.
    const db = (await getDb())!;
    const auditRows = await db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.action, "tx_alert_resolved"),
          eq(auditLog.resourceId, String(alertResolveId))
        )
      );
    expect(auditRows.length).toBe(1);
    expect(auditRows[0]!.resource).toBe("fraud_alert");
    expect(auditRows[0]!.status).toBe("success");
  });

  it("acknowledgeAlert on a missing id throws NOT_FOUND", async () => {
    const caller = callerFor(adminUser);
    await expectTrpcError(
      caller.txMonitor.acknowledgeAlert({ alertId: "99999999" }),
      "NOT_FOUND"
    );
  });

  it("acknowledgeAlert on a non-numeric id throws BAD_REQUEST", async () => {
    const caller = callerFor(adminUser);
    await expectTrpcError(
      caller.txMonitor.acknowledgeAlert({ alertId: "not-a-number" }),
      "BAD_REQUEST"
    );
  });

  it("resolveAlert on a missing id throws NOT_FOUND", async () => {
    const caller = callerFor(adminUser);
    await expectTrpcError(
      caller.txMonitor.resolveAlert({
        alertId: "99999999",
        resolution: "no such alert",
      }),
      "NOT_FOUND"
    );
  });

  it("anonymous mutation is rejected and the row stays open", async () => {
    const caller = callerFor(null);
    await expectTrpcError(
      caller.txMonitor.acknowledgeAlert({ alertId: String(alertAnonId) }),
      "UNAUTHORIZED"
    );
    await expectTrpcError(
      caller.txMonitor.resolveAlert({
        alertId: String(alertAnonId),
        resolution: "anonymous attempt",
      }),
      "UNAUTHORIZED"
    );

    const row = await alertById(alertAnonId);
    expect(row!.status).toBe("open");
    expect(row!.resolvedAt).toBeNull();
  });
});
