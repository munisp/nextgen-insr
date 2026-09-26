/**
 * qWavePoolsTelematics.integration.test.ts — Q-wave Q3 (2026-09-25), proven
 * against the REAL PGlite database, mini-TigerBeetle ledger and mini-Redis.
 * No mocks on production paths.
 *
 * Coverage:
 *   1. Pool period-close computation (contributions/claims/reserve/surplus).
 *   2. Dual-control distribution: role-gated (financialProcedure "refund"),
 *      maker-checker SoD (proposer ≠ approver ≠ executor), real TB ledger
 *      leg per member line, idempotent replays.
 *   3. Surplus-cap invariant: lines summing above the distributable surplus
 *      abort execution with NO funds moved.
 *   4. Takaful wakala mode: operator fee deducted pre-distribution, Sharia
 *      disclosure returned, shares sum to the post-fee surplus.
 *   5. Telematics batch ingestion idempotency (clientTripId dedupe).
 *   6. Rolling score + bounded rating factor (0.70–1.30).
 *   7. calculatePremium applies the rating factor to motor products only.
 *   8. Usage-cover activation idempotency + expiry sweep.
 */
import { describe, it, beforeAll, afterAll } from "vitest";
import { eq, and } from "drizzle-orm";
import { getDb } from "../../server/db";
import { auditLog, customers, insuranceProducts, policies, users } from "../../drizzle/schema";
import {
  p2pPoolMembers,
  p2pPools,
  poolPeriods,
  poolSurplusDistributions,
  telematicsScores,
  telematicsTrips,
  usageCoverActivations,
} from "../../drizzle/schema.innovations";
import { expireDueUsageCover } from "../../server/routers/innovationRouters";
import {
  callerFor,
  adminUser,
  regularUser,
  approverUser,
  expectCounted as expect,
  expectTrpcError,
  resetAssertionCount,
  getAssertionCount,
  type TestUser,
} from "./helpers/trpc";

const FILE = "qWavePoolsTelematics";

// Dedicated identity namespaces (shared single PGlite DB across files).
const Q3_MEMBER_A: TestUser = { id: 960011, email: "q3-member-a@integration.local", name: "Q3 Member A", role: "user" };
const Q3_MEMBER_B: TestUser = { id: 960012, email: "q3-member-b@integration.local", name: "Q3 Member B", role: "user" };
const Q3_SUPERVISOR: TestUser = { id: 960041, email: "q3-supervisor@integration.local", name: "Q3 Supervisor", role: "supervisor" };

const POOL_ID = 960001;
const POLICY_ID = 960002;
const PRODUCT_ID = 960003;
const PERIOD_START = "2026-08-01";
const PERIOD_END = "2026-08-31";

async function seedPool(opts: { balance: number; mode?: string }): Promise<void> {
  const db = (await getDb())!;
  await db.insert(p2pPools).values({
    id: POOL_ID,
    poolName: "Q3 Test Pool",
    poolType: "community",
    productType: "motor",
    organiserId: adminUser.id,
    maxMembers: 50,
    contributionAmount: "10000",
    contributionFrequency: "monthly",
    poolBalance: opts.balance.toString(),
    reinsuranceThreshold: "100000",
    periodStart: PERIOD_START,
    periodEnd: PERIOD_END,
    status: "active",
  }).onConflictDoNothing();
  // Members: A contributed 6000, B contributed 4000 (60/40 shares).
  for (const m of [
    { id: 960011, customerId: Q3_MEMBER_A.id, paid: "6000" },
    { id: 960012, customerId: Q3_MEMBER_B.id, paid: "4000" },
  ]) {
    await db.insert(p2pPoolMembers).values({
      id: m.id,
      poolId: POOL_ID,
      customerId: m.customerId,
      contributionPaid: m.paid,
      status: "active",
    }).onConflictDoNothing();
  }
}

describe("Q-wave Q3: pool surplus + telematics + usage cover (integration, real DB)", () => {
  beforeAll(async () => {
    resetAssertionCount();
    const db = (await getDb())!;
    for (const id of [adminUser.id, regularUser.id, approverUser.id, Q3_MEMBER_A.id, Q3_MEMBER_B.id, Q3_SUPERVISOR.id]) {
      await db.insert(customers).values({
        id,
        firstName: "Q3",
        lastName: `Cust${id}`,
        phone: `080${String(id).slice(-8)}`,
      }).onConflictDoNothing();
      await db.insert(users).values({
        id,
        keycloakSub: `q3-fixture-${id}`,
        email: `q3-${id}@integration.local`,
        name: `Q3 User ${id}`,
        role: id === adminUser.id ? "admin" : id === Q3_SUPERVISOR.id ? "supervisor" : "user",
      }).onConflictDoNothing();
    }
    await db.insert(insuranceProducts).values({
      id: PRODUCT_ID,
      productCode: "Q3-MOTOR-001",
      name: "Q3 Motor Comprehensive",
      coverageType: "motor",
      isActive: true,
    }).onConflictDoNothing();
    await db.insert(policies).values({
      id: POLICY_ID,
      policyNumber: "Q3-POL-000001",
      productId: PRODUCT_ID,
      customerId: Q3_MEMBER_A.id,
      status: "active",
      coverageType: "motor",
      sumInsured: "5000000",
      annualPremium: "100000",
    }).onConflictDoNothing();
    await seedPool({ balance: 10000 });
  });

  afterAll(() => console.log(`[integration] ${FILE}: ${getAssertionCount()} assertions`));

  // ── 1. Period close computation ──────────────────────────────────────────
  describe("pool period close", () => {
    it("regular users cannot close a period (financialProcedure gate)", async () => {
      await expectTrpcError(
        callerFor(regularUser).p2pPools.closePoolPeriod({
          poolId: POOL_ID, periodStart: PERIOD_START, periodEnd: PERIOD_END,
        }),
        "FORBIDDEN"
      );
    });

    it("staff close computes reserve + surplus honestly; replay is idempotent", async () => {
      const res = await callerFor(adminUser).p2pPools.closePoolPeriod({
        poolId: POOL_ID, periodStart: PERIOD_START, periodEnd: PERIOD_END, reserveBps: 2000,
      });
      expect(res.success).toBe(true);
      if (!("periodId" in res)) throw new Error("expected periodId");
      // closing 10000, reserve 20% = 2000, surplus = 8000.
      const db = (await getDb())!;
      const [period] = await db.select().from(poolPeriods).where(eq(poolPeriods.id, res.periodId));
      expect(period.status).toBe("closed");
      expect(parseFloat(period.closingBalance)).toBe(10000);
      expect(parseFloat(period.reserveAmount)).toBe(2000);
      expect(parseFloat(period.surplusAmount)).toBe(8000);
      expect(parseFloat(period.contributionsCollected)).toBe(10000);

      const replay = await callerFor(adminUser).p2pPools.closePoolPeriod({
        poolId: POOL_ID, periodStart: PERIOD_START, periodEnd: PERIOD_END, reserveBps: 2000,
      });
      expect(replay.idempotent).toBe(true);
    });
  });

  // ── 2/3. Dual-control distribution + surplus-cap invariant ───────────────
  describe("surplus distribution lifecycle", () => {
    let periodId: number;

    it("propose computes 60/40 pro-rata shares; maker-checker blocks self-approval", async () => {
      const db = (await getDb())!;
      const [period] = await db.select().from(poolPeriods)
        .where(and(eq(poolPeriods.poolId, POOL_ID), eq(poolPeriods.periodStart, PERIOD_START)));
      periodId = period.id;

      const res = await callerFor(adminUser).p2pPools.proposeSurplusDistribution({ periodId });
      expect(res.success).toBe(true);
      if (!("totalAmount" in res)) throw new Error("expected totalAmount");
      expect(res.lines).toBe(2);
      expect(res.totalAmount).toBe(8000);

      const lines = await db.select().from(poolSurplusDistributions)
        .where(eq(poolSurplusDistributions.periodId, periodId));
      const lineA = lines.find((l) => l.customerId === Q3_MEMBER_A.id)!;
      const lineB = lines.find((l) => l.customerId === Q3_MEMBER_B.id)!;
      expect(parseFloat(lineA.amount)).toBe(4800); // 60%
      expect(parseFloat(lineB.amount)).toBe(3200); // 40%
      expect(lineA.status).toBe("proposed");

      // SoD: the proposer (adminUser) cannot approve their own proposal.
      await expectTrpcError(
        callerFor(adminUser).p2pPools.approveSurplusDistribution({ periodId }),
        "FORBIDDEN"
      );
      // Non-staff cannot approve at all.
      await expectTrpcError(
        callerFor(regularUser).p2pPools.approveSurplusDistribution({ periodId }),
        "FORBIDDEN"
      );
    });

    it("execute before approval is refused loudly", async () => {
      await expectTrpcError(
        callerFor(Q3_SUPERVISOR).p2pPools.executeSurplusDistribution({ periodId }),
        "PRECONDITION_FAILED"
      );
    });

    it("approve by a different staff member; execute pays via real TB ledger with idempotent replay", async () => {
      const ap = await callerFor(Q3_SUPERVISOR).p2pPools.approveSurplusDistribution({ periodId });
      expect(ap.success).toBe(true);

      // SoD: the proposer cannot execute either.
      await expectTrpcError(
        callerFor(adminUser).p2pPools.executeSurplusDistribution({ periodId }),
        "FORBIDDEN"
      );

      const ex = await callerFor(approverUser).p2pPools.executeSurplusDistribution({ periodId });
      if (!("executed" in ex)) throw new Error("expected executed count");
      expect(ex.executed).toBe(2);
      expect(ex.failed).toBe(0);
      expect(ex.status).toBe("distributed");

      const db = (await getDb())!;
      const lines = await db.select().from(poolSurplusDistributions)
        .where(eq(poolSurplusDistributions.periodId, periodId));
      for (const l of lines) {
        expect(l.status).toBe("executed");
        expect(l.tbTransferId).toBeTruthy();
        expect(l.executedByUserId).toBe(approverUser.id);
      }
      // Pool balance debited by the distributed total.
      const [pool] = await db.select().from(p2pPools).where(eq(p2pPools.id, POOL_ID));
      expect(parseFloat(pool.poolBalance)).toBe(2000);

      // Replay: distributed period replays idempotently, never re-pays.
      const replay = await callerFor(approverUser).p2pPools.executeSurplusDistribution({ periodId });
      expect(replay.idempotent).toBe(true);
    });
  });

  describe("surplus-cap invariant", () => {
    it("lines tampered above the distributable surplus abort execution with no funds moved", async () => {
      const db = (await getDb())!;
      // Fresh pool + period with a small surplus.
      await db.insert(p2pPools).values({
        id: 960101, poolName: "Q3 Cap Pool", poolType: "community", productType: "motor",
        organiserId: adminUser.id, maxMembers: 50, contributionAmount: "1000",
        contributionFrequency: "monthly", poolBalance: "1000", reinsuranceThreshold: "100000",
        periodStart: "2026-08-01", periodEnd: "2026-08-31", status: "active",
      });
      await db.insert(p2pPoolMembers).values({
        id: 960111, poolId: 960101, customerId: Q3_MEMBER_A.id, contributionPaid: "1000", status: "active",
      });
      const close = await callerFor(adminUser).p2pPools.closePoolPeriod({
        poolId: 960101, periodStart: "2026-08-01", periodEnd: "2026-08-31", reserveBps: 2000,
      });
      if (!("periodId" in close)) throw new Error("expected periodId");
      const pid = close.periodId;
      await callerFor(adminUser).p2pPools.proposeSurplusDistribution({ periodId: pid });
      await callerFor(Q3_SUPERVISOR).p2pPools.approveSurplusDistribution({ periodId: pid });

      // Tamper: inflate the approved line above the surplus (800 → 5000).
      await db.update(poolSurplusDistributions)
        .set({ amount: "5000" })
        .where(eq(poolSurplusDistributions.periodId, pid));

      await expectTrpcError(
        callerFor(approverUser).p2pPools.executeSurplusDistribution({ periodId: pid }),
        "PRECONDITION_FAILED"
      );
      // No funds moved: balance and line status untouched.
      const [pool] = await db.select().from(p2pPools).where(eq(p2pPools.id, 960101));
      expect(parseFloat(pool.poolBalance)).toBe(1000);
      const [line] = await db.select().from(poolSurplusDistributions)
        .where(eq(poolSurplusDistributions.periodId, pid));
      expect(line.status).toBe("approved");
      expect(line.tbTransferId).toBeNull();
    });
  });

  // ── 4. Takaful wakala mode ───────────────────────────────────────────────
  describe("takaful wakala surplus mode", () => {
    it("wakala fee is deducted pre-distribution with Sharia disclosure; shares sum to post-fee surplus", async () => {
      const db = (await getDb())!;
      await db.insert(p2pPools).values({
        id: 960201, poolName: "Q3 Takaful Pool", poolType: "community", productType: "motor",
        organiserId: adminUser.id, maxMembers: 50, contributionAmount: "10000",
        contributionFrequency: "monthly", poolBalance: "10000", reinsuranceThreshold: "100000",
        periodStart: "2026-08-01", periodEnd: "2026-08-31", status: "active",
      });
      for (const m of [
        { id: 960211, customerId: Q3_MEMBER_A.id, paid: "6000" },
        { id: 960212, customerId: Q3_MEMBER_B.id, paid: "4000" },
      ]) {
        await db.insert(p2pPoolMembers).values({
          id: m.id, poolId: 960201, customerId: m.customerId, contributionPaid: m.paid, status: "active",
        });
      }
      const close = await callerFor(adminUser).p2pPools.closePoolPeriod({
        poolId: 960201, periodStart: "2026-08-01", periodEnd: "2026-08-31",
        reserveBps: 2000, distributionMode: "takaful_wakala", wakalaFeeBps: 1500,
      });
      if (!("periodId" in close)) throw new Error("expected periodId");
      const pid = close.periodId;
      const [period] = await db.select().from(poolPeriods).where(eq(poolPeriods.id, pid));
      expect(parseFloat(period.surplusAmount)).toBe(8000);
      expect(parseFloat(period.wakalaFeeAmount!)).toBe(1200); // 15% of 8000

      const prop = await callerFor(adminUser).p2pPools.proposeSurplusDistribution({ periodId: pid });
      if (!("shariaDisclosure" in prop)) throw new Error("expected disclosure");
      expect(prop.shariaDisclosure).toBeTruthy();
      expect(prop.shariaDisclosure!.mode).toBe("takaful_wakala");
      expect(prop.shariaDisclosure!.wakalaFeeAmount).toBe(1200);
      expect(prop.shariaDisclosure!.distributableSurplus).toBe(6800);
      expect(prop.totalAmount).toBe(6800);

      const lines = await db.select().from(poolSurplusDistributions)
        .where(eq(poolSurplusDistributions.periodId, pid));
      const sum = lines.reduce((s, l) => s + parseFloat(l.amount), 0);
      expect(sum).toBe(6800);
      const lineA = lines.find((l) => l.customerId === Q3_MEMBER_A.id)!;
      expect(parseFloat(lineA.amount)).toBe(4080); // 60% of 6800
    });
  });

  // ── 5/6. Telematics ingestion idempotency + scoring ──────────────────────
  describe("telematics UBI", () => {
    const batch = {
      policyId: POLICY_ID,
      trips: [
        {
          clientTripId: "q3-trip-00000001", deviceId: "dev-a",
          startedAt: "2026-09-20T08:00:00Z", endedAt: "2026-09-20T08:30:00Z",
          distanceKm: 25, durationSeconds: 1800, hardBrakes: 1, speedingEvents: 0,
          corneringEvents: 0, nightDrivingSeconds: 0, maxSpeedKmh: 95, rawEventCount: 120,
        },
        {
          clientTripId: "q3-trip-00000002", deviceId: "dev-a",
          startedAt: "2026-09-21T22:00:00Z", endedAt: "2026-09-21T23:00:00Z",
          distanceKm: 25, durationSeconds: 3600, hardBrakes: 6, speedingEvents: 4,
          corneringEvents: 2, nightDrivingSeconds: 3600, maxSpeedKmh: 135, rawEventCount: 200,
        },
      ],
    };

    it("batch ingest is idempotent by clientTripId; replay duplicates never double-count", async () => {
      const first = await callerFor(Q3_MEMBER_A).telematics.ingestTripBatch(batch);
      expect(first.inserted).toBe(2);
      expect(first.duplicates).toBe(0);

      const replay = await callerFor(Q3_MEMBER_A).telematics.ingestTripBatch(batch);
      expect(replay.inserted).toBe(0);
      expect(replay.duplicates).toBe(2);
      expect(replay.idempotent).toBe(true);

      const db = (await getDb())!;
      const trips = await db.select().from(telematicsTrips)
        .where(eq(telematicsTrips.policyId, POLICY_ID));
      expect(trips.length).toBe(2);
    });

    it("rolling score + rating factor stay inside bounds and persist per policy", async () => {
      const db = (await getDb())!;
      const [row] = await db.select().from(telematicsScores)
        .where(eq(telematicsScores.policyId, POLICY_ID));
      expect(row).toBeTruthy();
      const score = parseFloat(row.score);
      const factor = parseFloat(row.ratingFactor);
      // Trip 1 ≈ 98, trip 2 = 100 −12 −12 −3 −5 −10 = 58; equal distance ⇒ ≈78.
      expect(score).toBeGreaterThan(60);
      expect(score).toBeLessThan(95);
      expect(factor).toBeGreaterThanOrEqual(0.7);
      expect(factor).toBeLessThanOrEqual(1.3);
      expect(row.tripsCounted).toBe(2);

      const viaApi = await callerFor(Q3_MEMBER_A).telematics.getScore({ policyId: POLICY_ID });
      expect(viaApi.ratingFactor).toBeCloseTo(factor, 2);
      expect(["postgresql", "redis_cache"]).toContain(viaApi.source);
    });

    it("schema validation rejects malformed batches (fail-closed, nothing persisted)", async () => {
      await expectTrpcError(
        callerFor(Q3_MEMBER_A).telematics.ingestTripBatch({
          policyId: POLICY_ID,
          trips: [{
            clientTripId: "bad", deviceId: "dev-a", // too short
            startedAt: "2026-09-20T08:00:00Z", endedAt: "2026-09-20T08:30:00Z",
            distanceKm: 10, durationSeconds: 900, hardBrakes: 0, speedingEvents: 0,
            corneringEvents: 0, nightDrivingSeconds: 0, rawEventCount: 0,
          }],
        } as any),
        "BAD_REQUEST"
      );
      const db = (await getDb())!;
      const trips = await db.select().from(telematicsTrips)
        .where(eq(telematicsTrips.policyId, POLICY_ID));
      expect(trips.length).toBe(2); // unchanged
    });
  });

  // ── 7. Rating factor in calculatePremium ─────────────────────────────────
  describe("calculatePremium UBI rating factor", () => {
    it("motor premium reflects the telematics rating factor; neutral without a score", async () => {
      const rated = await callerFor(Q3_MEMBER_A).insuranceProductCatalog.calculatePremium({
        productId: PRODUCT_ID, sumInsured: 5000000, durationMonths: 12, policyId: POLICY_ID,
      });
      const db = (await getDb())!;
      const [row] = await db.select().from(telematicsScores)
        .where(eq(telematicsScores.policyId, POLICY_ID));
      const factor = parseFloat(row.ratingFactor);
      expect(rated.telematicsRatingFactor).toBeCloseTo(factor, 2);
      expect(rated.telematicsScore).toBeCloseTo(parseFloat(row.score), 2);
      // annualPremium = 5,000,000 × 2% × 1.0 × factor
      expect(rated.annualPremium).toBeCloseTo(100000 * factor, 0);

      const neutral = await callerFor(Q3_MEMBER_A).insuranceProductCatalog.calculatePremium({
        productId: PRODUCT_ID, sumInsured: 5000000, durationMonths: 12,
      });
      expect(neutral.telematicsRatingFactor).toBe(1.0);
      expect(neutral.annualPremium).toBe(100000);
    });
  });

  // ── 8. Usage cover activation + expiry ───────────────────────────────────
  describe("usage cover", () => {
    it("per-day activation is idempotent by clientActivationId", async () => {
      const first = await callerFor(Q3_MEMBER_A).usageCover.activateCover({
        policyId: POLICY_ID, coverType: "day", clientActivationId: "q3-uc-0000000001", days: 3,
      });
      expect(first.success).toBe(true);
      expect(first.idempotent).toBe(false);

      const replay = await callerFor(Q3_MEMBER_A).usageCover.activateCover({
        policyId: POLICY_ID, coverType: "day", clientActivationId: "q3-uc-0000000001", days: 3,
      });
      expect(replay.idempotent).toBe(true);
      expect(replay.activationId).toBe(first.activationId);

      const db = (await getDb())!;
      const rows = await db.select().from(usageCoverActivations)
        .where(eq(usageCoverActivations.clientActivationId, "q3-uc-0000000001"));
      expect(rows.length).toBe(1);
      expect(rows[0]!.status).toBe("active");
    });

    it("per-trip activation binds to a real trip and expires after trip end + grace", async () => {
      const db = (await getDb())!;
      const [trip] = await db.select().from(telematicsTrips)
        .where(eq(telematicsTrips.clientTripId, "q3-trip-00000001"));
      const res = await callerFor(Q3_MEMBER_A).usageCover.activateCover({
        policyId: POLICY_ID, coverType: "trip", clientActivationId: "q3-uc-0000000002", tripId: trip.id,
      });
      expect(res.success).toBe(true);
      if (!("expiresAt" in res)) throw new Error("expected expiresAt");
      const expected = new Date(new Date(trip.endedAt).getTime() + 2 * 3600 * 1000);
      expect(new Date(res.expiresAt).getTime()).toBe(expected.getTime());
    });

    it("expiry sweep flips due activations idempotently", async () => {
      const db = (await getDb())!;
      // Force the day activation into the past.
      await db.update(usageCoverActivations)
        .set({ expiresAt: new Date(Date.now() - 3600_000) })
        .where(eq(usageCoverActivations.clientActivationId, "q3-uc-0000000001"));
      const expired = await expireDueUsageCover(db);
      expect(expired).toBeGreaterThanOrEqual(1);
      const [row] = await db.select().from(usageCoverActivations)
        .where(eq(usageCoverActivations.clientActivationId, "q3-uc-0000000001"));
      expect(row.status).toBe("expired");
      // Idempotent re-run.
      expect(await expireDueUsageCover(db)).toBe(0);
    });

    // 2026-09-26 (verify-a finding #11a): overlap guard.
    it("adjacent non-overlapping activation is allowed; overlapping activation is rejected with CONFLICT", async () => {
      // Prior windows on POLICY_ID are all in the past (expired day cover,
      // past trip window), so a fresh day cover is adjacent/non-overlapping.
      const adjacent = await callerFor(Q3_MEMBER_A).usageCover.activateCover({
        policyId: POLICY_ID, coverType: "day", clientActivationId: "q3-uc-0000000010", days: 1,
      });
      expect(adjacent.success).toBe(true);
      expect(adjacent.idempotent).toBe(false);
      expect(adjacent.status).toBe("active");

      // A second activation with a DIFFERENT client key overlaps the live
      // window — double-cover refused loudly.
      await expectTrpcError(
        callerFor(Q3_MEMBER_A).usageCover.activateCover({
          policyId: POLICY_ID, coverType: "day", clientActivationId: "q3-uc-0000000011", days: 2,
        }),
        "CONFLICT"
      );

      const db = (await getDb())!;
      const rows = await db.select().from(usageCoverActivations)
        .where(eq(usageCoverActivations.clientActivationId, "q3-uc-0000000011"));
      expect(rows.length).toBe(0); // nothing persisted from the denied attempt
      // Denial audited.
      const audit = await db.select().from(auditLog)
        .where(and(eq(auditLog.action, "USAGE_COVER_OVERLAP_DENIED"), eq(auditLog.resourceId, String(POLICY_ID))));
      expect(audit.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ── 9. 2026-09-26 (verify-a finding #10): trip-ingest authorization ──────
  describe("telematics ingest authorization", () => {
    it("a non-owner cannot inject trips into another user's policy (audited denial)", async () => {
      await expectTrpcError(
        callerFor(Q3_MEMBER_B).telematics.ingestTripBatch({
          policyId: POLICY_ID, // owned by Q3_MEMBER_A
          trips: [{
            clientTripId: "q3-trip-evil-00001", deviceId: "dev-b",
            startedAt: "2026-09-24T08:00:00Z", endedAt: "2026-09-24T08:30:00Z",
            distanceKm: 10, durationSeconds: 1800, hardBrakes: 0, speedingEvents: 0,
            corneringEvents: 0, nightDrivingSeconds: 0, rawEventCount: 0,
          }],
        }),
        "FORBIDDEN"
      );
      const db = (await getDb())!;
      // Nothing persisted; the victim policy still has exactly its 2 trips.
      const trips = await db.select().from(telematicsTrips)
        .where(eq(telematicsTrips.policyId, POLICY_ID));
      expect(trips.length).toBe(2);
      // Denial audited fail-closed.
      const audit = await db.select().from(auditLog)
        .where(and(eq(auditLog.action, "TELEMATICS_INGEST_DENIED"), eq(auditLog.resourceId, String(POLICY_ID))));
      expect(audit.length).toBeGreaterThanOrEqual(1);
      expect(audit[0]!.status).toBe("failure");
    });

    it("staff may ingest for any policy; the owner still can", async () => {
      const db = (await getDb())!;
      await db.insert(policies).values({
        id: 960005, policyNumber: "Q3-POL-000005", productId: PRODUCT_ID,
        customerId: Q3_MEMBER_B.id, status: "active", coverageType: "motor",
        sumInsured: "1000000", annualPremium: "20000",
      }).onConflictDoNothing();

      const staff = await callerFor(adminUser).telematics.ingestTripBatch({
        policyId: 960005,
        trips: [{
          clientTripId: "q3-trip-staff-0001", deviceId: "dev-staff",
          startedAt: "2026-09-24T09:00:00Z", endedAt: "2026-09-24T09:30:00Z",
          distanceKm: 12, durationSeconds: 1800, hardBrakes: 0, speedingEvents: 0,
          corneringEvents: 0, nightDrivingSeconds: 0, rawEventCount: 10,
        }],
      });
      expect(staff.success).toBe(true);
      expect(staff.inserted).toBe(1);

      const owner = await callerFor(Q3_MEMBER_B).telematics.ingestTripBatch({
        policyId: 960005,
        trips: [{
          clientTripId: "q3-trip-owner-0001", deviceId: "dev-b",
          startedAt: "2026-09-24T10:00:00Z", endedAt: "2026-09-24T10:30:00Z",
          distanceKm: 8, durationSeconds: 1800, hardBrakes: 1, speedingEvents: 0,
          corneringEvents: 0, nightDrivingSeconds: 0, rawEventCount: 5,
        }],
      });
      expect(owner.success).toBe(true);
      expect(owner.inserted).toBe(1);
    });
  });

  // ── 10. 2026-09-26 (verify-a finding #6): debit-before-transfer ordering ──
  describe("surplus execute fund-mirroring (debit first, TB second)", () => {
    it("TB outage after the DB debit leaves a compensating credit-back; retry pays exactly once", async () => {
      const db = (await getDb())!;
      const ORDER_POOL = 960301;
      await db.insert(p2pPools).values({
        id: ORDER_POOL, poolName: "Q3 Ordering Pool", poolType: "community", productType: "motor",
        organiserId: adminUser.id, maxMembers: 50, contributionAmount: "5000",
        contributionFrequency: "monthly", poolBalance: "5000", reinsuranceThreshold: "100000",
        periodStart: "2026-08-01", periodEnd: "2026-08-31", status: "active",
      });
      await db.insert(p2pPoolMembers).values({
        id: 960311, poolId: ORDER_POOL, customerId: Q3_MEMBER_A.id, contributionPaid: "5000", status: "active",
      });
      const close = await callerFor(adminUser).p2pPools.closePoolPeriod({
        poolId: ORDER_POOL, periodStart: "2026-08-01", periodEnd: "2026-08-31", reserveBps: 2000,
      });
      if (!("periodId" in close)) throw new Error("expected periodId");
      const pid = close.periodId;
      await callerFor(adminUser).p2pPools.proposeSurplusDistribution({ periodId: pid });
      await callerFor(Q3_SUPERVISOR).p2pPools.approveSurplusDistribution({ periodId: pid });
      // Single line: 4000 (surplus 5000 − 20% reserve).

      const ledgerUrl = process.env.TB_SIDECAR_URL;
      if (!ledgerUrl) throw new Error("TB_SIDECAR_URL must be set by globalSetup for this boundary test");
      const down = await fetch(`${ledgerUrl}/__test/down`, { method: "POST" });
      expect(down.ok).toBe(true);
      try {
        // TB leg fails AFTER the balance-guarded debit; the compensating
        // credit-back must restore the pool balance (debit-first ordering).
        const ex = await callerFor(approverUser).p2pPools.executeSurplusDistribution({ periodId: pid });
        if (!("executed" in ex)) throw new Error("expected executed count");
        expect(ex.executed).toBe(0);
        expect(ex.failed).toBe(1);

        const [pool] = await db.select().from(p2pPools).where(eq(p2pPools.id, ORDER_POOL));
        expect(parseFloat(pool.poolBalance)).toBe(5000); // credit-back restored
        const [line] = await db.select().from(poolSurplusDistributions)
          .where(eq(poolSurplusDistributions.periodId, pid));
        expect(line.status).toBe("failed");
        expect(line.failureReason).toContain("compensating credit-back posted");
        expect(line.poolDebitedAt).toBeNull(); // compensation cleared the marker
        expect(line.tbTransferId).toBeNull();
      } finally {
        // Shared mini-ledger across the single-fork suite — always restore.
        await fetch(`${ledgerUrl}/__test/up`, { method: "POST" });
      }

      // Retry: ref-deduped TB leg pays exactly once; the pool is debited
      // exactly once (fresh debit after the successful credit-back).
      const retry = await callerFor(approverUser).p2pPools.executeSurplusDistribution({ periodId: pid });
      if (!("executed" in retry)) throw new Error("expected executed count");
      expect(retry.executed).toBe(1);
      expect(retry.failed).toBe(0);

      const [pool] = await db.select().from(p2pPools).where(eq(p2pPools.id, ORDER_POOL));
      expect(parseFloat(pool.poolBalance)).toBe(1000); // 5000 − 4000 once
      const [line] = await db.select().from(poolSurplusDistributions)
        .where(eq(poolSurplusDistributions.periodId, pid));
      expect(line.status).toBe("executed");
      expect(line.tbTransferId).toBeTruthy();

      // Independent ledger verification: one committed payout of 400000 kobo.
      const custAcct = await fetch(`${ledgerUrl}/accounts/customer-${Q3_MEMBER_A.id}`).then((r) => r.json());
      expect(parseInt(custAcct.credits_posted, 10)).toBe(400000 + 480000); // + earlier 4800 distribution
      const poolAcct = await fetch(`${ledgerUrl}/accounts/p2p-pool-${ORDER_POOL}`).then((r) => r.json());
      expect(parseInt(poolAcct.debits_posted, 10)).toBe(400000); // debited exactly once
    });
  });
});
