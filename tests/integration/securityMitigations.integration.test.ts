/**
 * securityMitigations.integration.test.ts — B3 (zero-undelivered-scope)
 * integration coverage for the real security mitigation tracker
 * (security_mitigations table, migration 0056) behind
 * securityAudit.getMitigations / listMitigations / createMitigation /
 * updateMitigationStatus / getMitigationStats.
 *
 * Rows are seeded directly into the real table — no mocks. No other
 * integration file touches security_mitigations (verified by grep at build
 * time), so every count asserted below is an exact known answer. The
 * beforeAll deletes any leftover W1C-MIT-% rows so re-runs on a reused
 * database stay deterministic.
 *
 * Seeded truth (all titles prefixed W1C-MIT-):
 *   M1 open            critical
 *   M2 in_progress     high
 *   M3 resolved        medium   (resolvedAt set)
 *   M4 accepted_risk   low
 *   M5 open            high
 * → totals: 5; byStatus open 2 / in_progress 1 / resolved 1 / accepted_risk 1;
 *   bySeverity critical 1 / high 2 / medium 1 / low 1
 */
import { eq, like } from "drizzle-orm";
import { describe, it, beforeAll, afterAll } from "vitest";

import { securityMitigations } from "../../drizzle/schema.additions";
import { getDb } from "../../server/db";
import {
  callerFor,
  adminUser,
  regularUser,
  expectCounted as expect,
  expectTrpcError,
  resetAssertionCount,
  getAssertionCount,
} from "./helpers/trpc";

const FILE = "securityMitigations";

let m1Id: number; // open
let m3Id: number; // resolved
let m4Id: number; // accepted_risk

async function seed() {
  const db = (await getDb())!;
  await db
    .delete(securityMitigations)
    .where(like(securityMitigations.title, "W1C-MIT-%"));
  const rows = await db
    .insert(securityMitigations)
    .values([
      {
        title: "W1C-MIT-1 patch edge TLS",
        description: "Edge TLS terminator on deprecated cipher suite",
        severity: "critical" as const,
        status: "open" as const,
        linkedFindingRef: "SCAN-1001",
      },
      {
        title: "W1C-MIT-2 rotate service keys",
        description: "Service keys older than 90 days",
        severity: "high" as const,
        status: "in_progress" as const,
        ownerUserId: 91001,
      },
      {
        title: "W1C-MIT-3 close open bucket",
        description: "Public read on logs bucket",
        severity: "medium" as const,
        status: "resolved" as const,
        resolvedAt: new Date("2026-01-15T00:00:00Z"),
      },
      {
        title: "W1C-MIT-4 legacy cipher on intranet",
        description: "Accepted until intranet decommission",
        severity: "low" as const,
        status: "accepted_risk" as const,
      },
      {
        title: "W1C-MIT-5 rate-limit auth endpoint",
        description: "Credential stuffing observed",
        severity: "high" as const,
        status: "open" as const,
      },
    ])
    .returning();
  m1Id = rows[0]!.id;
  m3Id = rows[2]!.id;
  m4Id = rows[3]!.id;
}

describe("securityAudit mitigation tracker (B3)", () => {
  beforeAll(async () => {
    resetAssertionCount();
    await seed();
  });

  afterAll(() => {
    console.log(`[${FILE}] assertions: ${getAssertionCount()}`);
  });

  // ── Authz ────────────────────────────────────────────────────────────────
  it("rejects anonymous callers (UNAUTHORIZED)", async () => {
    const caller = callerFor(null);
    await expectTrpcError(
      caller.securityAudit.getMitigations({}),
      "UNAUTHORIZED"
    );
  });

  it("rejects non-admin create (FORBIDDEN)", async () => {
    const caller = callerFor(regularUser);
    await expectTrpcError(
      caller.securityAudit.createMitigation({
        title: "W1C-MIT-nope",
        description: "should not be created",
        severity: "low",
      }),
      "FORBIDDEN"
    );
  });

  it("rejects non-admin status update (FORBIDDEN)", async () => {
    const caller = callerFor(regularUser);
    await expectTrpcError(
      caller.securityAudit.updateMitigationStatus({
        id: m1Id,
        status: "resolved",
      }),
      "FORBIDDEN"
    );
  });

  // ── Real reads ───────────────────────────────────────────────────────────
  it("getMitigations returns the real seeded rows", async () => {
    const caller = callerFor(regularUser);
    const rows = await caller.securityAudit.getMitigations({});
    expect(Array.isArray(rows)).toBe(true);
    const mine = rows.filter(r => r.title.startsWith("W1C-MIT-"));
    expect(mine.length).toBe(5);
    expect(rows.length).toBe(5); // no other file seeds this table
    const m1 = mine.find(r => r.title === "W1C-MIT-1 patch edge TLS");
    expect(m1?.severity).toBe("critical");
    expect(m1?.status).toBe("open");
    expect(m1?.linkedFindingRef).toBe("SCAN-1001");
  });

  it("listMitigations filters by status and severity with real counts", async () => {
    const caller = callerFor(regularUser);
    const open = await caller.securityAudit.listMitigations({
      status: "open",
    });
    expect(open.total).toBe(2);
    expect(
      open.data.every(r => r.status === "open" && r.title.startsWith("W1C-MIT-"))
    ).toBe(true);
    const high = await caller.securityAudit.listMitigations({
      severity: "high",
    });
    expect(high.total).toBe(2);
    const openHigh = await caller.securityAudit.listMitigations({
      status: "open",
      severity: "high",
    });
    expect(openHigh.total).toBe(1);
    expect(openHigh.data[0]?.title).toBe("W1C-MIT-5 rate-limit auth endpoint");
  });

  it("getMitigationStats returns exact known-answer counts", async () => {
    const caller = callerFor(regularUser);
    const stats = await caller.securityAudit.getMitigationStats();
    expect(stats.total).toBe(5);
    expect(stats.byStatus).toEqual({
      open: 2,
      in_progress: 1,
      resolved: 1,
      accepted_risk: 1,
    });
    expect(stats.bySeverity).toEqual({
      critical: 1,
      high: 2,
      medium: 1,
      low: 1,
    });
  });

  // ── Real writes ──────────────────────────────────────────────────────────
  it("createMitigation (admin) inserts a real row, then we clean it up", async () => {
    const caller = callerFor(adminUser);
    const created = await caller.securityAudit.createMitigation({
      title: "W1C-MIT-6 created via API",
      description: "admin-created mitigation row",
      severity: "medium",
      ownerUserId: adminUser.id,
    });
    expect(created.id).toBeGreaterThan(0);
    expect(created.status).toBe("open");
    expect(created.ownerUserId).toBe(adminUser.id);
    const db = (await getDb())!;
    const [row] = await db
      .select()
      .from(securityMitigations)
      .where(eq(securityMitigations.id, created.id))
      .limit(1);
    expect(row?.title).toBe("W1C-MIT-6 created via API");
    await db
      .delete(securityMitigations)
      .where(eq(securityMitigations.id, created.id));
  });

  // ── Transition guard ─────────────────────────────────────────────────────
  it("allows open → in_progress → resolved and sets resolvedAt", async () => {
    const caller = callerFor(adminUser);
    const inProgress = await caller.securityAudit.updateMitigationStatus({
      id: m1Id,
      status: "in_progress",
    });
    expect(inProgress.status).toBe("in_progress");
    expect(inProgress.resolvedAt).toBeNull();
    const resolved = await caller.securityAudit.updateMitigationStatus({
      id: m1Id,
      status: "resolved",
    });
    expect(resolved.status).toBe("resolved");
    expect(resolved.resolvedAt).not.toBeNull();
  });

  it("fails loud on invalid transition resolved → accepted_risk", async () => {
    const caller = callerFor(adminUser);
    const err = await expectTrpcError(
      caller.securityAudit.updateMitigationStatus({
        id: m3Id,
        status: "accepted_risk",
      }),
      "BAD_REQUEST"
    );
    expect(err.message).toContain("resolved");
    expect(err.message).toContain("accepted_risk");
  });

  it("fails loud on invalid transition accepted_risk → resolved", async () => {
    const caller = callerFor(adminUser);
    await expectTrpcError(
      caller.securityAudit.updateMitigationStatus({
        id: m4Id,
        status: "resolved",
      }),
      "BAD_REQUEST"
    );
  });

  it("allows resolved → open (reopen) and clears resolvedAt", async () => {
    const caller = callerFor(adminUser);
    const reopened = await caller.securityAudit.updateMitigationStatus({
      id: m3Id,
      status: "open",
    });
    expect(reopened.status).toBe("open");
    expect(reopened.resolvedAt).toBeNull();
    // restore seeded truth for the stats determinism of re-runs
    const db = (await getDb())!;
    await db
      .update(securityMitigations)
      .set({ status: "resolved", resolvedAt: new Date("2026-01-15T00:00:00Z") })
      .where(eq(securityMitigations.id, m3Id));
  });

  it("fails loud NOT_FOUND on unknown mitigation id", async () => {
    const caller = callerFor(adminUser);
    await expectTrpcError(
      caller.securityAudit.updateMitigationStatus({
        id: 999_999_999,
        status: "open",
      }),
      "NOT_FOUND"
    );
  });
});
