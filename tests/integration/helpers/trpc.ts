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
import { agentFloatTransferRouter } from "../../../server/routers/agentFloatTransfer";
import { transactionsRouter } from "../../../server/routers/transactions";
import { insuranceWorkflowsRouter } from "../../../server/routers/insuranceWorkflows";
import { agentRouter } from "../../../server/routers/agent";
import { multiTenantIsolationRouter } from "../../../server/routers/multiTenantIsolation";
import { pinResetRouter } from "../../../server/routers/pinReset";
import { encryptedFieldsRouter } from "../../../server/routers/encryptedFieldsCrud";
import { tenantAdminRouter } from "../../../server/routers/tenantAdmin";
import { commissionPayoutsRouter } from "../../../server/routers/commissionPayouts";
import { premiumTopUpRouter } from "../../../server/routers/premiumTopUp";
import { auditComplianceRouter } from "../../../server/routers/auditCompliance";
import { gdprDashboardRouter } from "../../../server/routers/gdprDashboard";
import { fxRatesRouter } from "../../../server/routers/fxRates";
import { billPaymentsRouter } from "../../../server/routers/billPayments";
import { mobileMoneyRouter } from "../../../server/routers/mobileMoney";
import { billingLedgerRouter } from "../../../server/routers/billingLedger";
import { dbSchemaPushRouter } from "../../../server/routers/dbSchemaPush";
import { securityAuditRouter } from "../../../server/routers/securityAudit";

// Same mount paths as server/routers.ts (production appRouter).
export const integrationRouter = router({
  disputeRefund: disputeRefundRouter,
  agentFloatTransfer: agentFloatTransferRouter,
  // Imported and mounted (same path as production) so the suite can never
  // again miss a module-level SyntaxError in this money path (F-01 boot blocker).
  transactions: transactionsRouter,
  airtimeVending: airtimeVendingRouter,
  txMonitor: txMonitorRouter,
  management: managementRouter,
  mlScoring: mlScoringServiceRouter,
  amlScreening: amlScreeningRouter,
  insuranceWorkflows: insuranceWorkflowsRouter,
  agent: agentRouter,
  multiTenantIsolation: multiTenantIsolationRouter,
  pinReset: pinResetRouter,
  // DD-TSSEC (A7-6): mounted under the production path so the owner-or-admin
  // contract is exercised through the real middleware chain.
  encryptedFields: encryptedFieldsRouter,
  tenantAdmin: tenantAdminRouter,
  // F-02: additional money paths under the real middleware chain.
  commissionPayouts: commissionPayoutsRouter,
  premiumTopUp: premiumTopUpRouter,
  auditCompliance: auditComplianceRouter,
  gdprDashboard: gdprDashboardRouter,
  // Provider-integration routers (F-02) — same mount paths as production.
  fxRates: fxRatesRouter,
  billPayments: billPaymentsRouter,
  mobileMoney: mobileMoneyRouter,
  // F-12 (wave-3): rewired-from-mockware routers under test — same mount paths
  // as production.
  billingLedger: billingLedgerRouter,
  dbSchemaPush: dbSchemaPushRouter,
  securityAudit: securityAuditRouter,
});

export type IntegrationRouter = typeof integrationRouter;

export type TestUser = Pick<User, "id" | "email" | "name" | "role"> & {
  /** Optional tenant assignment; undefined/null = platform-level (unscoped). */
  tenantId?: number | null;
};

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
 * Second staff identity for maker-checker flows (F7-2): payout approve /
 * process must be executed by a DIFFERENT staff user than the requester.
 */
export const approverUser: TestUser = {
  id: 91003,
  email: "approver@integration.local",
  name: "Integration Approver",
  role: "admin",
};

/**
 * Build a caller for the given user (null = anonymous). The context matches
 * server/_core/context.ts: { req, res, user }.
 */
export function callerFor(user: TestUser | null, requestId?: string) {
  const ctx = {
    user: user as User | null,
    req: {
      headers: requestId ? { "x-request-id": requestId } : {},
    } as unknown as TrpcContext["req"],
    res: {
      cookie: () => undefined,
      clearCookie: () => undefined,
    } as unknown as TrpcContext["res"],
    requestId: requestId ?? "integration-test-request",
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
