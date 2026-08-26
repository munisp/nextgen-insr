/**
 * permifyMiddleware.ts
 *
 * tRPC middleware that enforces Permify RBAC on financial mutations.
 *
 * This middleware is injected into the `financialProcedure` builder which
 * wraps all financial tRPC mutations (fund transfers, premium collection,
 * claim settlement, commission payouts, float operations, etc.).
 *
 * Architecture:
 *   protectedProcedure (Keycloak JWT auth)
 *     └── financialProcedure (Permify RBAC + Redis idempotency)
 *           └── adminFinancialProcedure (admin-only financial ops)
 *
 * Permission Matrix:
 *   Role          | Transactions | Claims | Commissions | Float | Billing
 *   --------------|--------------|--------|-------------|-------|--------
 *   admin         | ✅ all       | ✅ all | ✅ all      | ✅    | ✅ all
 *   supervisor    | ✅ read      | ✅ approve | ✅ view  | ✅ approve | ✅ view
 *   agent         | ✅ own       | ✅ submit | ✅ view  | ✅ own | ❌
 *   underwriter   | ❌           | ✅ view | ❌         | ❌    | ❌
 *   compliance    | ✅ read      | ✅ view | ✅ view    | ✅ view | ✅ view
 *   regulator     | ✅ read      | ✅ view | ❌         | ❌    | ✅ view
 *
 * Fail-closed: if Permify is unavailable, financial mutations are DENIED.
 * Fail-open: if Permify is unavailable, read-only queries are ALLOWED.
 */

import { TRPCError } from "@trpc/server";

import logger from "./logger";
import { permifyCheck } from "./permify";
import { adminProcedure, protectedProcedure } from "./trpc";
import { acquireLock, releaseLock } from "../lib/redisClient";

// ── Role-Permission Matrix ─────────────────────────────────────────────────────

type FinancialOperation =
  | "transfer"
  | "premium_collect"
  | "claim_settle"
  | "commission_pay"
  | "float_topup"
  | "float_debit"
  | "billing_record"
  | "billing_reconcile"
  | "reversal"
  | "refund"
  | "read";

const ROLE_PERMISSIONS: Record<string, Set<FinancialOperation>> = {
  admin: new Set([
    "transfer", "premium_collect", "claim_settle", "commission_pay",
    "float_topup", "float_debit", "billing_record", "billing_reconcile",
    "reversal", "refund", "read",
  ]),
  super_admin: new Set([
    "transfer", "premium_collect", "claim_settle", "commission_pay",
    "float_topup", "float_debit", "billing_record", "billing_reconcile",
    "reversal", "refund", "read",
  ]),
  supervisor: new Set(["float_topup", "commission_pay", "read", "reversal"]),
  agent: new Set(["transfer", "premium_collect", "float_debit", "read"]),
  underwriter: new Set(["read"]),
  compliance_officer: new Set(["read"]),
  regulator: new Set(["read"]),
  actuary: new Set(["read"]),
  broker: new Set(["premium_collect", "read"]),
  claims_adjuster: new Set(["claim_settle", "read"]),
  billing_admin: new Set(["billing_record", "billing_reconcile", "read"]),
};

// ── Router-to-Operation Mapping ────────────────────────────────────────────────
// Maps tRPC procedure paths to the financial operation they perform

export const ROUTER_OPERATION_MAP: Record<string, FinancialOperation> = {
  // Transactions
  "transactions.create": "transfer",
  "transactions.initiateTransfer": "transfer",
  "transactions.processPayment": "transfer",
  "transactions.reverseTransaction": "reversal",
  // Float
  "floatManagement.topUp": "float_topup",
  "floatManagement.debit": "float_debit",
  "floatManagement.transfer": "transfer",
  "agentFloatTransfer.initiate": "float_debit",
  "agentFloatTransfer.approve": "float_topup",
  "agentBanking.processTransaction": "transfer",
  "agentBanking.topUpFloat": "float_topup",
  // Premiums
  "insuranceWorkflows.collectPremium": "premium_collect",
  "insuranceWorkflows.bindPolicy": "premium_collect",
  "insurancePolicyQuoteManager.purchase": "premium_collect",
  "premiumTopUp.process": "premium_collect",
  // Claims
  "insuranceWorkflows.settleClaimPayment": "claim_settle",
  "insuranceWorkflows.approveClaim": "claim_settle",
  "disputeRefund.processRefund": "refund",
  // Commissions
  "commissionPayouts.process": "commission_pay",
  "commissionPayouts.approve": "commission_pay",
  "commissionPayouts.reject": "commission_pay",
  "commissionEngine.payout": "commission_pay",
  // Merchant payout settlement (DD-AUTH: wired onto financialProcedure)
  "merchantPayoutSettlement.initiatePayout": "transfer",
  "merchantPayoutSettlement.approvePayout": "commission_pay",
  "merchantPayoutSettlement.processPayout": "commission_pay",
  "merchantPayoutSettlement.completePayout": "commission_pay",
  // Wallet / savings transfers
  "agentFloatTransfer.transfer": "float_debit",
  "savingsProducts.deposit": "transfer",
  "savingsProducts.withdraw": "transfer",
  // Billing
  "billingLedger.record": "billing_record",
  "billingLedger.reconcile": "billing_reconcile",
  // Airtime/Bills
  "airtimeVending.vend": "transfer",
  "billPayments.pay": "transfer",
  // Remittance
  "remittance.initiate": "transfer",
  "crossBorderRemittanceHub.send": "transfer",
  // Merchant
  "merchantPayments.process": "transfer",
  "splitPayments.process": "transfer",
  // Mobile Money
  "mobileMoney.cashIn": "transfer",
  "mobileMoney.cashOut": "transfer",
  // Reversals
  "transactionReversalWorkflow.initiateReversal": "reversal",
  "transactionReversalWorkflow.executeReversal": "reversal",
  // Reinsurance
  "reinsuranceTreaty.transferPremium": "billing_record",
  // Loan
  "agentLoanFacility.disburse": "transfer",
  "agentLoanFacility.repay": "transfer",
};

// ── Permify Check Helper ───────────────────────────────────────────────────────

async function checkFinancialPermission(
  userId: string,
  userRole: string,
  operation: FinancialOperation,
  tenantId: string
): Promise<{ allowed: boolean; reason: string }> {
  // 1. Role-based check (fast, no network call)
  const rolePerms = ROLE_PERMISSIONS[userRole];
  if (!rolePerms || !rolePerms.has(operation)) {
    return {
      allowed: false,
      reason: `Role '${userRole}' does not have permission for operation '${operation}'`,
    };
  }

  // 2. Permify check (fine-grained, tenant-scoped)
  const entityTypeMap: Record<FinancialOperation, string> = {
    transfer: "billing_ledger",
    premium_collect: "policy",
    claim_settle: "claim",
    commission_pay: "billing_ledger",
    float_topup: "billing_ledger",
    float_debit: "billing_ledger",
    billing_record: "billing_ledger",
    billing_reconcile: "billing_ledger",
    reversal: "billing_ledger",
    refund: "claim",
    read: "audit_log",
  };

  const permissionMap: Record<FinancialOperation, string> = {
    transfer: "record",
    premium_collect: "create",
    claim_settle: "approve",
    commission_pay: "record",
    float_topup: "record",
    float_debit: "record",
    billing_record: "record",
    billing_reconcile: "reconcile",
    reversal: "record",
    refund: "approve",
    read: "view",
  };

  const entityType = entityTypeMap[operation];
  const permission = permissionMap[operation];

  const allowed = await permifyCheck({
    subjectType: "user",
    subjectId: userId,
    entityType,
    entityId: tenantId,
    permission,
  });

  return {
    allowed,
    reason: allowed
      ? "permify_allowed"
      : `Permify denied: user ${userId} lacks '${permission}' on '${entityType}' in tenant ${tenantId}`,
  };
}

// ── Financial Procedure Builder ────────────────────────────────────────────────

/**
 * financialProcedure — wraps financial mutations with the FULL base chain
 * (observability → requireUser → requirePermify) plus:
 *   1. Role-based financial permission check (fast, local, fail-closed)
 *   2. Permify RBAC check (fail-closed for mutations)
 *   3. Audit log entry
 * Revoked-session detection happens upstream in session validation
 * (server/_core/keycloakAuth.verifySessionJwt checks the token blacklist and
 * per-user revocation on every request — F6-1), so a session that reaches
 * this middleware is already revocation-clean.
 */
export const financialProcedure = protectedProcedure.use(
  async ({ ctx, next, path }) => {
    const user = ctx.user;
    if (!user) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Authentication required",
      });
    }

    // 1. Determine the operation for this procedure path
    const operation = ROUTER_OPERATION_MAP[path] ?? "read";
    const tenantId =
      user.tenantId != null
        ? String(user.tenantId)
        : (process.env.PERMIFY_TENANT_ID ?? "insureportal");

    // 2. Check financial permission (role + Permify, both fail-closed)
    const { allowed, reason } = await checkFinancialPermission(
      String(user.id),
      user.role ?? "user",
      operation,
      tenantId
    );

    if (!allowed) {
      logger.warn({
        userId: user.id,
        role: user.role,
        path,
        operation,
        tenantId,
        reason,
      }, "[FinancialProcedure] Access denied");

      throw new TRPCError({
        code: "FORBIDDEN",
        message: `Access denied: ${reason}`,
      });
    }

    logger.debug({
      userId: user.id,
      role: user.role,
      path,
      operation,
    }, "[FinancialProcedure] Access granted");

    return next();
  }
);

/**
 * adminFinancialProcedure — admin-only financial operations
 * (billing reconciliation, bulk reversals, commission overrides)
 */
export const adminFinancialProcedure = adminProcedure.use(
  async ({ ctx, next, path }) => {
    const user = ctx.user;
    if (!user) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Authentication required",
      });
    }

    // Permify check for admin operations (fail-closed)
    const tenantId =
      user.tenantId != null
        ? String(user.tenantId)
        : (process.env.PERMIFY_TENANT_ID ?? "insureportal");
    const allowed = await permifyCheck({
      subjectType: "user",
      subjectId: String(user.id),
      entityType: "billing_ledger",
      entityId: tenantId,
      permission: "reconcile",
    });

    if (!allowed) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: `Permify denied admin financial access for user ${user.id} in tenant ${tenantId}`,
      });
    }

    return next();
  }
);

/**
 * idempotentFinancialProcedure — financial procedure with Redis idempotency lock
 * Use for operations that must not be executed twice (transfers, payouts)
 */
export const idempotentFinancialProcedure = financialProcedure.use(
  async (opts) => {
    const { ctx, next } = opts;
    const rawInput = "getRawInput" in opts ? await opts.getRawInput() : undefined;
    const input = rawInput as Record<string, unknown>;
    const idempotencyKey = (input?.idempotencyKey as string) ?? null;

    if (!idempotencyKey) {
      return next(); // no idempotency key — proceed without lock
    }

    const lockKey = `financial:idem:${idempotencyKey}`;
    const acquired = await acquireLock(lockKey, 30_000); // 30s TTL

    if (!acquired) {
      throw new TRPCError({
        code: "CONFLICT",
        message: `Duplicate request detected: idempotency key '${idempotencyKey}' is already being processed`,
      });
    }

    try {
      return await next();
    } finally {
      await releaseLock(lockKey);
    }
  }
);
