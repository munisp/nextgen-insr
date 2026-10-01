/**
 * memberClaims.test.ts — R3 batch 1 (2026-10-01, R3)
 *
 * Unit coverage for server/routers/memberClaims.ts (member claims surface).
 * Uses in-memory fakes — no live DB required (same pattern as
 * server/disputes.supervisor.test.ts). The DB fake records the drizzle where
 * conditions so caller-scoping (claims.claimantId = ctx.user.id /
 * policies.customerId = ctx.user.id) is asserted from the REAL SQL the router
 * built, not from fabricated rows.
 *
 * insuranceWorkflows.fileClaim is stubbed at the module boundary: the
 * delegation contract (same input in, claim out) is memberClaims' behavior
 * under test; insuranceWorkflows' own lifecycle/dedup logic has its own
 * coverage. Ownership guard (NOT_FOUND, non-enumerating) is exercised for
 * real here.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  makeAuthenticatedCtx,
  makeUnauthenticatedCtx,
} from "../../lib/__tests__/testHelpers";

// ── Fakes ────────────────────────────────────────────────────────────────────

/** Result queue + where-condition recorder behind a drizzle-shaped chain. */
function makeFakeDb() {
  const queue: unknown[][] = [];
  const wheres: unknown[] = [];
  const chain: Record<string, unknown> = {};
  const self = (): typeof chain => chain;
  for (const m of [
    "select",
    "from",
    "innerJoin",
    "leftJoin",
    "orderBy",
    "limit",
    "offset",
    "insert",
    "values",
    "set",
  ]) {
    chain[m] = vi.fn(self);
  }
  chain.where = vi.fn((cond: unknown) => {
    wheres.push(cond);
    return chain;
  });
  chain.returning = vi.fn(async () => queue.shift() ?? []);
  // drizzle query builders are thenable — awaiting the chain yields the next
  // queued result set.
  chain.then = (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) =>
    Promise.resolve(queue.shift() ?? []).then(onF, onR);
  return { db: chain, queue, wheres };
}

let fake: ReturnType<typeof makeFakeDb>;

vi.mock("../../db", () => ({
  getDb: async () => fake.db,
}));

// Module-boundary stub for the delegation target (see header).
const fileClaimSpy = vi.fn();
vi.mock("../insuranceWorkflows", () => ({
  insuranceWorkflowsRouter: {
    createCaller: () => ({ fileClaim: fileClaimSpy }),
  },
}));

import { memberClaimsRouter } from "../memberClaims";

/** Recursively collect Param values out of a drizzle SQL condition tree. */
function sqlParamValues(node: unknown, acc: unknown[] = []): unknown[] {
  if (node && typeof node === "object") {
    const rec = node as Record<string, unknown>;
    if (Array.isArray(rec.queryChunks)) {
      for (const chunk of rec.queryChunks) {
        const c = chunk as Record<string, unknown>;
        if (c && c.constructor?.name === "Param") acc.push(c.value);
        else sqlParamValues(chunk, acc);
      }
    }
  }
  return acc;
}

const memberCtx = () =>
  makeAuthenticatedCtx({
    user: {
      id: 4242,
      username: "member-a",
      role: "user",
      name: "Member A",
      email: "a@example.io",
    } as never,
  });

describe("memberClaims router (R3 batch 1, 2026-10-01)", () => {
  beforeEach(() => {
    fake = makeFakeDb();
    fileClaimSpy.mockReset();
  });

  describe("auth gate (fail-closed)", () => {
    it("rejects anonymous callers with UNAUTHORIZED on every proc", async () => {
      const caller = memberClaimsRouter.createCaller(makeUnauthenticatedCtx());
      await expect(caller.myClaims(undefined)).rejects.toMatchObject({
        code: "UNAUTHORIZED",
      });
      await expect(caller.myClaim({ id: 1 })).rejects.toMatchObject({
        code: "UNAUTHORIZED",
      });
      await expect(caller.myPoliciesPicker()).rejects.toMatchObject({
        code: "UNAUTHORIZED",
      });
      await expect(
        caller.fileClaim({
          policyId: 1,
          claimType: "motor_comprehensive",
          incidentDate: "2026-09-01",
          claimedAmount: 1000,
          incidentDescription: "test",
        })
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    });
  });

  describe("myClaims", () => {
    it("scopes the query to claims.claimantId = ctx.user.id", async () => {
      fake.queue.push(
        [
          {
            id: 7,
            claimNumber: "CLM-AAA",
            policyId: 11,
            policyNumber: "POL-1",
            status: "submitted",
            claimType: "motor_comprehensive",
            incidentDate: new Date("2026-09-01"),
            reportedDate: new Date("2026-09-02"),
            claimedAmount: "1000.00",
            approvedAmount: null,
            paidAmount: null,
            createdAt: new Date("2026-09-02"),
          },
        ],
        [{ count: 1 }]
      );
      const caller = memberClaimsRouter.createCaller(memberCtx());
      const res = await caller.myClaims({ limit: 50, offset: 0 });
      expect(res.count).toBe(1);
      expect(res.claims[0].claimNumber).toBe("CLM-AAA");
      // Caller-scope isolation: every where condition on this query path
      // embeds the caller's id (claims.claimantId = 4242), never another id.
      expect(fake.wheres.length).toBeGreaterThan(0);
      for (const cond of fake.wheres) {
        expect(sqlParamValues(cond)).toContain(4242);
      }
    });
  });

  describe("myClaim", () => {
    it("returns NOT_FOUND for a foreign/nonexistent claim (non-enumerating)", async () => {
      // Ownership miss and nonexistent id are indistinguishable: the scoped
      // query simply returns no row.
      fake.queue.push([]);
      const caller = memberClaimsRouter.createCaller(memberCtx());
      await expect(caller.myClaim({ id: 999 })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
      expect(sqlParamValues(fake.wheres[0])).toContain(4242);
    });

    it("returns the claim and its documents for the caller's own claim", async () => {
      fake.queue.push(
        [
          {
            id: 7,
            claimNumber: "CLM-AAA",
            policyId: 11,
            policyNumber: "POL-1",
            status: "under_review",
            claimType: "fire_burglary",
            incidentDate: new Date("2026-09-01"),
            reportedDate: new Date("2026-09-02"),
            claimedAmount: "5000.00",
            approvedAmount: null,
            paidAmount: null,
            deductible: null,
            incidentDescription: "Kitchen fire",
            rejectionReason: null,
            settlementDate: null,
            createdAt: new Date("2026-09-02"),
            updatedAt: new Date("2026-09-02"),
          },
        ],
        [
          {
            id: 1,
            documentType: "photo",
            fileName: "damage.jpg",
            fileUrl: "https://files.example/damage.jpg",
            fileSize: 12345,
            mimeType: "image/jpeg",
            isVerified: false,
            createdAt: new Date("2026-09-02"),
          },
        ]
      );
      const caller = memberClaimsRouter.createCaller(memberCtx());
      const res = await caller.myClaim({ id: 7 });
      expect(res.claim.claimNumber).toBe("CLM-AAA");
      expect(res.documents).toHaveLength(1);
    });
  });

  describe("myPoliciesPicker", () => {
    it("returns the caller's active policies scoped by customerId", async () => {
      fake.queue.push([
        {
          id: 11,
          policyNumber: "POL-1",
          productName: "Motor Comprehensive",
          sumInsured: "5000000.00",
          startDate: new Date("2026-01-01"),
          endDate: new Date("2027-01-01"),
          status: "active",
        },
      ]);
      const caller = memberClaimsRouter.createCaller(memberCtx());
      const res = await caller.myPoliciesPicker();
      expect(res.policies).toHaveLength(1);
      expect(res.policies[0].policyNumber).toBe("POL-1");
      expect(sqlParamValues(fake.wheres[0])).toContain(4242);
    });
  });

  describe("fileClaim", () => {
    const input = {
      policyId: 11,
      claimType: "motor_comprehensive",
      incidentDate: "2026-09-01",
      claimedAmount: 250000,
      incidentDescription: "Rear-end collision on Third Mainland Bridge",
      documents: ["https://files.example/police-report.pdf"],
    };

    it("answers NOT_FOUND (non-enumerating) when the policy belongs to another member", async () => {
      fake.queue.push([{ id: 11, customerId: 9999, status: "active" }]);
      const caller = memberClaimsRouter.createCaller(memberCtx());
      await expect(caller.fileClaim(input)).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
      // Fail-closed: delegation never happens for a foreign policy.
      expect(fileClaimSpy).not.toHaveBeenCalled();
    });

    it("answers NOT_FOUND when the policy does not exist", async () => {
      fake.queue.push([]);
      const caller = memberClaimsRouter.createCaller(memberCtx());
      await expect(caller.fileClaim(input)).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
      expect(fileClaimSpy).not.toHaveBeenCalled();
    });

    it("rejects filing against a non-active owned policy", async () => {
      fake.queue.push([{ id: 11, customerId: 4242, status: "lapsed" }]);
      const caller = memberClaimsRouter.createCaller(memberCtx());
      await expect(caller.fileClaim(input)).rejects.toMatchObject({
        code: "BAD_REQUEST",
      });
      expect(fileClaimSpy).not.toHaveBeenCalled();
    });

    it("happy path: owned active policy delegates to insuranceWorkflows.fileClaim unchanged", async () => {
      fake.queue.push([{ id: 11, customerId: 4242, status: "active" }]);
      fileClaimSpy.mockResolvedValue({
        claim: { id: 77, claimNumber: "CLM-NEW", status: "submitted" },
        claimNumber: "CLM-NEW",
      });
      const caller = memberClaimsRouter.createCaller(memberCtx());
      const res = await caller.fileClaim(input);
      expect(fileClaimSpy).toHaveBeenCalledWith(input);
      expect(res.claimNumber).toBe("CLM-NEW");
    });
  });
});
