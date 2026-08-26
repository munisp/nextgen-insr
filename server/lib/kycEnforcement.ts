/**
 * DD-AUTH: wires the previously dead businessRulesEngine.checkKycLimits into
 * transfer/payout initiation paths (money-map: wallet transfers, payouts).
 *
 * Fail-CLOSED policy:
 *  - customer record resolves → its KYC tier limits are enforced
 *  - no customer record → the CBN Tier-0 ("none") floor is enforced
 *  - DB unavailable → throws (the initiating mutation fails closed)
 */
import { TRPCError } from "@trpc/server";
import { and, eq, gte, sql } from "drizzle-orm";

import { customers, transactions } from "../../drizzle/schema";
import { getDb } from "../db";
import { checkKycLimits, type KycLevel } from "./businessRulesEngine";

/** customers.kycLevel is an integer tier; map it onto the rules-engine enum. */
export function mapKycTier(level: number | null | undefined): KycLevel {
  switch (level) {
    case 1:
      return "basic";
    case 2:
      return "standard";
    case 3:
      return "enhanced";
    case 4:
      return "full";
    default:
      return level != null && level > 4 ? "full" : "none";
  }
}

/**
 * Enforce KYC single/daily/monthly limits for a customer-initiated money
 * movement identified by phone number. Throws FORBIDDEN on breach.
 */
export async function enforceCustomerKycLimits(params: {
  customerPhone: string;
  amount: number;
}): Promise<void> {
  const db = await getDb();
  if (!db) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "KYC limit check unavailable (fail-closed)",
    });
  }

  const [customer] = await db
    .select({ kycLevel: customers.kycLevel })
    .from(customers)
    .where(eq(customers.phone, params.customerPhone))
    .limit(1);
  const kycLevel = mapKycTier(customer?.kycLevel);

  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const rows = await db
    .select({
      amount: transactions.amount,
      createdAt: transactions.createdAt,
      isDaily: sql<boolean>`${transactions.createdAt} >= ${dayStart}`,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.customerPhone, params.customerPhone),
        gte(transactions.createdAt, monthStart)
      )
    )
    .limit(5000);

  let dailyTotal = 0;
  let monthlyTotal = 0;
  for (const row of rows) {
    const amount = Number(row.amount ?? 0);
    if (!Number.isFinite(amount)) continue;
    monthlyTotal += amount;
    if (row.isDaily) dailyTotal += amount;
  }

  const result = checkKycLimits(
    kycLevel,
    params.amount,
    dailyTotal,
    monthlyTotal
  );
  if (!result.allowed) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: result.reason ?? "KYC transaction limit exceeded",
    });
  }
}
