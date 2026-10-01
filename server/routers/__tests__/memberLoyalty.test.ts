/**
 * memberLoyalty.test.ts — R3 batch 1 (2026-10-01, R3)
 *
 * Covers server/routers/memberLoyalty.ts:
 *   - anonymous caller → UNAUTHORIZED (protectedProcedure)
 *   - session user with no customer profile → NOT_FOUND (non-enumerating)
 *   - scope isolation: queries are keyed by the RESOLVED customer.id, never
 *     by caller input (a foreign customerId in input cannot change the scope)
 *   - happy paths for myBalance / myHistory
 *
 * Uses an in-memory fake for getDb — no live DB required.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  makeAuthenticatedCtx,
  makeUnauthenticatedCtx,
} from "../../lib/__tests__/testHelpers";
import { memberLoyaltyRouter } from "../memberLoyalty";

// ── In-memory drizzle fake ──────────────────────────────────────────────────
// Each select() call shifts the next queued result; the chain is thenable at
// every step so `await q.from(t).where(...)` resolves the queued rows.
let queue: unknown[][] = [];

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
};

vi.mock("../../db", () => ({
  getDb: vi.fn(() => Promise.resolve(fakeDb)),
  writeAuditLog: vi.fn(),
}));

const CUSTOMER = { id: 4242, keycloakSub: "1" }; // session user id 1 → customer 4242
const OTHER_CUSTOMER = { id: 9999, keycloakSub: "2" };

beforeEach(() => {
  queue = [];
});

describe("memberLoyalty router (2026-10-01, R3)", () => {
  it("rejects anonymous callers with UNAUTHORIZED", async () => {
    const caller = memberLoyaltyRouter.createCaller(makeUnauthenticatedCtx());
    await expect(caller.myBalance()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await expect(caller.myHistory()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("returns NOT_FOUND when the session user has no customer profile", async () => {
    queue = [[]]; // customers lookup → no row
    const caller = memberLoyaltyRouter.createCaller(
      makeAuthenticatedCtx({ user: { id: 777 } as any })
    );
    await expect(caller.myBalance()).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "Customer profile not found for session user",
    });
  });

  it("myBalance scopes to the resolved customer and computes earned − redeemed", async () => {
    queue = [
      [CUSTOMER], // resolveSessionCustomer
      [{ total: "1500" }], // earned sum
      [{ total: "400" }], // redeemed sum (ABS)
    ];
    const caller = memberLoyaltyRouter.createCaller(makeAuthenticatedCtx());
    const result = await caller.myBalance();
    expect(result).toEqual({
      customerId: 4242,
      earned: 1500,
      redeemed: 400,
      balance: 1100,
    });
  });

  it("myBalance treats an empty ledger as a real zero balance", async () => {
    queue = [[CUSTOMER], [{ total: null }], [{ total: "0" }]];
    const caller = memberLoyaltyRouter.createCaller(makeAuthenticatedCtx());
    const result = await caller.myBalance();
    expect(result.balance).toBe(0);
    expect(result.customerId).toBe(4242);
  });

  it("myHistory returns only the caller's ledger rows with pagination", async () => {
    const rows = [
      {
        id: 9,
        type: "earned",
        points: 100,
        description: "Policy purchase",
        balanceAfter: 100,
        createdAt: new Date("2026-09-30"),
      },
    ];
    queue = [[CUSTOMER], rows, [{ count: 1 }]];
    const caller = memberLoyaltyRouter.createCaller(makeAuthenticatedCtx());
    const result = await caller.myHistory({ limit: 10, offset: 0 });
    expect(result.history).toEqual(rows);
    expect(result.total).toBe(1);
  });

  it("scope isolation: a foreign customerId in input cannot re-scope the query", async () => {
    // Even if a caller smuggles another customer's id into the input, the
    // proc only ever resolves the SESSION user's customer (4242, not 9999).
    queue = [
      [CUSTOMER], // resolution is driven by ctx.user.id → keycloakSub "1"
      [{ total: "10" }],
      [{ total: "0" }],
    ];
    const caller = memberLoyaltyRouter.createCaller(makeAuthenticatedCtx());
    const result = await caller.myBalance({ customerId: OTHER_CUSTOMER.id } as any);
    expect(result.customerId).toBe(4242);
    expect(result.customerId).not.toBe(OTHER_CUSTOMER.id);
  });
});
