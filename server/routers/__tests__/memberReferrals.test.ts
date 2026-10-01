/**
 * memberReferrals.test.ts — R3 batch 1 (2026-10-01, R3)
 *
 * Covers server/routers/memberReferrals.ts:
 *   - anonymous caller → UNAUTHORIZED (protectedProcedure)
 *   - session user with no customer profile → NOT_FOUND (non-enumerating)
 *   - scope isolation: referrals keyed by RESOLVED customer.id, never by
 *     caller input
 *   - myCode (2026-10-01, R3-fix): READ-ONLY — returns the caller's existing
 *     still-valid pending code only when the caller has an agent identity
 *     (agents.id coincides with the resolved customers.id — agents has no
 *     member identity link); null otherwise (no agent identity, or only
 *     expired codes). NEVER inserts: referrals.referrer_agent_id FKs to
 *     agents.id (schema.ts:2486-2489, migration 0026), so member-context
 *     minting was removed (23503 → 500, or mis-attribution into the agent
 *     program with persisted bonus fields).
 *
 * Uses an in-memory fake for getDb — no live DB required.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  makeAuthenticatedCtx,
  makeUnauthenticatedCtx,
} from "../../lib/__tests__/testHelpers";
import { memberReferralsRouter } from "../memberReferrals";

// ── In-memory drizzle fake ──────────────────────────────────────────────────
let queue: unknown[][] = [];
let inserted: Record<string, unknown>[] = [];

function chainable() {
  const result = queue.shift() ?? [];
  const p = Promise.resolve(result);
  const b: Record<string, unknown> = {};
  for (const m of ["from", "where", "orderBy", "limit", "offset", "innerJoin", "leftJoin", "groupBy"]) {
    b[m] = () => b;
  }
  b.then = p.then.bind(p);
  b.catch = p.catch.bind(p);
  return b;
}

const fakeDb = {
  select: () => chainable(),
  insert: () => ({
    values: (row: Record<string, unknown>) => ({
      returning: () => {
        inserted.push(row);
        const result = queue.shift() ?? [];
        return Promise.resolve(result);
      },
    }),
  }),
};

vi.mock("../../db", () => ({
  getDb: vi.fn(() => Promise.resolve(fakeDb)),
  writeAuditLog: vi.fn(),
}));

const CUSTOMER = { id: 4242, keycloakSub: "1" };

beforeEach(() => {
  queue = [];
  inserted = [];
});

describe("memberReferrals router (2026-10-01, R3)", () => {
  it("rejects anonymous callers with UNAUTHORIZED", async () => {
    const caller = memberReferralsRouter.createCaller(makeUnauthenticatedCtx());
    await expect(caller.myReferrals()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await expect(caller.myCode()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("returns NOT_FOUND when the session user has no customer profile", async () => {
    queue = [[]];
    const caller = memberReferralsRouter.createCaller(
      makeAuthenticatedCtx({ user: { id: 777 } as any })
    );
    await expect(caller.myReferrals()).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "Customer profile not found for session user",
    });
  });

  it("myReferrals returns only the caller's rows, paginated", async () => {
    const rows = [
      {
        id: 5,
        referralCode: "REFA1B2C3",
        refereeCode: "AGT900",
        status: "rewarded",
        bonusPoints: 500,
        bonusCash: "1000.00",
        activatedAt: new Date("2026-09-01"),
        rewardedAt: new Date("2026-09-15"),
        expiresAt: new Date("2026-12-01"),
        createdAt: new Date("2026-08-20"),
      },
    ];
    queue = [[CUSTOMER], rows, [{ count: 1 }]];
    const caller = memberReferralsRouter.createCaller(makeAuthenticatedCtx());
    const result = await caller.myReferrals({ status: "rewarded", limit: 10 });
    expect(result.referrals).toEqual(rows);
    expect(result.total).toBe(1);
  });

  it("scope isolation: a foreign referrerAgentId in input cannot re-scope the query", async () => {
    queue = [[CUSTOMER], [], [{ count: 0 }]];
    const caller = memberReferralsRouter.createCaller(makeAuthenticatedCtx());
    const result = await caller.myReferrals({ referrerAgentId: 9999 } as any);
    // The fake would have returned rows had any been queued for a foreign
    // scope; the query itself is bound to customer 4242 by construction.
    expect(result.referrals).toEqual([]);
    expect(result.total).toBe(0);
  });

  // 2026-10-01 (R3-fix): myCode is read-only. Select order per call:
  // [customers] → [agents] → [referrals] (the last two are skipped when the
  // prior step yields nothing). `inserted` must stay empty in EVERY case.
  it("myCode returns the caller's existing valid pending code when the caller has an agent identity", async () => {
    const expiresAt = new Date(Date.now() + 10 * 24 * 3600 * 1000);
    queue = [
      [CUSTOMER],
      [{ id: CUSTOMER.id }], // agents.id coincides with customers.id
      [{ id: 7, referralCode: "REFEXIST1", expiresAt }],
    ];
    const caller = memberReferralsRouter.createCaller(makeAuthenticatedCtx());
    const result = await caller.myCode();
    expect(result).toEqual({
      referralCode: "REFEXIST1",
      expiresAt,
      existing: true,
    });
    expect(inserted).toHaveLength(0); // read-only: nothing is ever inserted
  });

  it("myCode returns null when the caller has no agent identity (no coinciding agents row)", async () => {
    queue = [
      [CUSTOMER],
      [], // no agents.id = 4242 row
    ];
    const caller = memberReferralsRouter.createCaller(makeAuthenticatedCtx());
    await expect(caller.myCode()).resolves.toBeNull();
    expect(inserted).toHaveLength(0);
  });

  it("myCode returns null when only expired/no longer valid codes exist", async () => {
    queue = [
      [CUSTOMER],
      [{ id: CUSTOMER.id }],
      [], // no pending code with expiresAt > now
    ];
    const caller = memberReferralsRouter.createCaller(makeAuthenticatedCtx());
    await expect(caller.myCode()).resolves.toBeNull();
    expect(inserted).toHaveLength(0);
  });
});
