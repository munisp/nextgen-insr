/**
 * trpc.ts — integration test tRPC helpers.
 *
 * Composes the REAL routers under their production path names (see
 * server/routers.ts) using the REAL router() factory from server/_core/trpc,
 * so calls pass through the full production middleware chain
 * (observability -> sidecar -> requireUser -> requirePermify / requireAdmin).
 *
 * Auth is mocked at the context level: callerFor(user) builds a TrpcContext
 * with the given user (or null for anonymous), matching the shape produced by
 * server/_core/context.ts.
 */
import { expect } from "vitest";
import { TRPCError } from "@trpc/server";
import { router } from "../../../server/_core/trpc";
import type { TrpcContext } from "../../../server/_core/context";
import type { User } from "../../../drizzle/schema";
import { disputeRefundRouter } from "../../../server/routers/disputeRefund";
import { airtimeVendingRouter } from "../../../server/routers/airtimeVending";
import { txMonitorRouter } from "../../../server/routers/txMonitor";
import { managementRouter } from "../../../server/routers/management";
import { mlScoringServiceRouter } from "../../../server/routers/mlScoringService";
import { amlScreeningRouter } from "../../../server/routers/amlScreening";

// Same mount paths as server/routers.ts (production appRouter).
export const integrationRouter = router({
  disputeRefund: disputeRefundRouter,
  airtimeVending: airtimeVendingRouter,
  txMonitor: txMonitorRouter,
  management: managementRouter,
  mlScoring: mlScoringServiceRouter,
  amlScreening: amlScreeningRouter,
});

export type IntegrationRouter = typeof integrationRouter;

export type TestUser = Pick<User, "id" | "email" | "name" | "role">;

export const adminUser: TestUser = {
  id: 91001,
  email: "admin@integration.local",
  name: "Integration Admin",
  role: "admin",
};

export const regularUser: TestUser = {
  id: 91002,
  email: "agent@integration.local",
  name: "Integration Agent",
  role: "user",
};

/**
 * Build a caller for the given user (null = anonymous). The context matches
 * server/_core/context.ts: { req, res, user }.
 */
export function callerFor(user: TestUser | null) {
  const ctx = {
    user: user as User | null,
    req: { headers: {} } as unknown as TrpcContext["req"],
    res: {
      cookie: () => undefined,
      clearCookie: () => undefined,
    } as unknown as TrpcContext["res"],
  };
  return integrationRouter.createCaller(ctx);
}

// ── Per-file assertion counter ────────────────────────────────────────────────
// Suite runs with isolate:false in a single fork, so module state persists
// across files; each file resets the counter in a beforeAll hook and reports
// it in afterAll.
let assertionCount = 0;

export function resetAssertionCount(): void {
  assertionCount = 0;
}

export function getAssertionCount(): number {
  return assertionCount;
}

/** expect() wrapper that counts assertions for the per-file report. */
export function expectCounted<T>(actual: T) {
  assertionCount++;
  return expect(actual);
}

/**
 * Assert that a tRPC call rejects with a TRPCError carrying the given code.
 * Counts as 3 assertions (threw, instance, code).
 */
export async function expectTrpcError(
  call: Promise<unknown>,
  code:
    | "UNAUTHORIZED"
    | "FORBIDDEN"
    | "NOT_FOUND"
    | "BAD_REQUEST"
    | "PRECONDITION_FAILED"
    | "NOT_IMPLEMENTED"
    | "INTERNAL_SERVER_ERROR"
    | "CONFLICT"
): Promise<TRPCError> {
  try {
    await call;
  } catch (err) {
    assertionCount++;
    expect(err).toBeInstanceOf(TRPCError);
    assertionCount++;
    expect((err as TRPCError).code).toBe(code);
    return err as TRPCError;
  }
  assertionCount++;
  expect.unreachable(`Expected TRPCError with code ${code} but the call succeeded`);
  throw new Error("unreachable");
}
