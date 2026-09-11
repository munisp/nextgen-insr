/**
 * weeklyReport.ts — B7: weekly report section computations from REAL rows.
 *
 * Data sources (discovered from drizzle/schema.ts + drizzle/schema.additions.ts;
 * re-verify against the live schema before changing):
 *   - transactions section = transactions WHERE deletedAt IS NULL
 *                            AND createdAt IN [weekStart, weekEnd)
 *                            (counts by status/type, SUM(amount/fee/commission)
 *                            over status='success' rows only)
 *   - premiums section     = premiums WHERE status='paid'
 *                            AND paidDate IN [weekStart, weekEnd)
 *                            (premium payment ledger, schema.additions.ts)
 *   - claims section       = claims WHERE createdAt IN week (submitted) and
 *                            claims WHERE status='paid' AND settlementDate
 *                            IN week (settled count + SUM(paidAmount))
 *   - policies section     = policies WHERE createdAt IN week (new) and
 *                            policies WHERE status='active' (active book, as of
 *                            generation time)
 *   - agents section       = agents WHERE createdAt IN week (new) and
 *                            agents WHERE isActive AND deletedAt IS NULL
 *                            (active force, as of generation time)
 *
 * Sections the caller requests that have NO data source are returned with an
 * explicit 'no_data_source' marker — never with invented numbers.
 */
import { and, gte, isNull, lt, eq, sql } from "drizzle-orm";

import {
  agents,
  claims,
  policies,
  transactions,
} from "../../drizzle/schema";
import { premiums } from "../../drizzle/schema.additions";
import type { getDb } from "../db";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

/** Section names with a real, implemented data source. */
export const IMPLEMENTED_SECTIONS = [
  "transactions",
  "premiums",
  "claims",
  "policies",
  "agents",
] as const;
export type ImplementedSection = (typeof IMPLEMENTED_SECTIONS)[number];

export interface NoDataSourceMarker {
  section: string;
  status: "no_data_source";
  reason: string;
}

export interface TransactionsSection {
  dataSource: string;
  totalCount: number;
  successCount: number;
  failedCount: number;
  pendingCount: number;
  successVolume: number;
  successFees: number;
  successCommission: number;
  byType: { type: string; count: number }[];
}

export interface PremiumsSection {
  dataSource: string;
  paidCount: number;
  paidAmount: number;
  distinctPolicies: number;
}

export interface ClaimsSection {
  dataSource: string;
  submittedCount: number;
  settledCount: number;
  settledPaidAmount: number;
}

export interface PoliciesSection {
  dataSource: string;
  newCount: number;
  activeCount: number;
}

export interface AgentsSection {
  dataSource: string;
  newCount: number;
  activeCount: number;
}

export interface WeeklyReportSections {
  transactions?: TransactionsSection;
  premiums?: PremiumsSection;
  claims?: ClaimsSection;
  policies?: PoliciesSection;
  agents?: AgentsSection;
  /** Requested sections with no delivered data source (explicit markers). */
  unavailableSections: NoDataSourceMarker[];
}

function inWeek(column: unknown, weekStart: Date, weekEnd: Date) {
  // Half-open [weekStart, weekEnd) — a transaction at exactly weekEnd belongs
  // to the NEXT report, never double-counted.
  return and(
    gte(column as typeof transactions.createdAt, weekStart),
    lt(column as typeof transactions.createdAt, weekEnd)
  );
}

async function computeTransactionsSection(
  db: Db,
  weekStart: Date,
  weekEnd: Date
): Promise<TransactionsSection> {
  const base = and(isNull(transactions.deletedAt), inWeek(transactions.createdAt, weekStart, weekEnd));
  const [totals] = await db
    .select({
      totalCount: sql<number>`COUNT(*)`,
      successCount: sql<number>`COUNT(*) FILTER (WHERE ${transactions.status} = 'success')`,
      failedCount: sql<number>`COUNT(*) FILTER (WHERE ${transactions.status} = 'failed')`,
      pendingCount: sql<number>`COUNT(*) FILTER (WHERE ${transactions.status} = 'pending')`,
      successVolume: sql<string>`COALESCE(SUM(CAST(${transactions.amount} AS NUMERIC)) FILTER (WHERE ${transactions.status} = 'success'), 0)`,
      successFees: sql<string>`COALESCE(SUM(CAST(${transactions.fee} AS NUMERIC)) FILTER (WHERE ${transactions.status} = 'success'), 0)`,
      successCommission: sql<string>`COALESCE(SUM(CAST(${transactions.commission} AS NUMERIC)) FILTER (WHERE ${transactions.status} = 'success'), 0)`,
    })
    .from(transactions)
    .where(base);
  const typeRows = await db
    .select({
      type: transactions.type,
      count: sql<number>`COUNT(*)`,
    })
    .from(transactions)
    .where(base)
    .groupBy(transactions.type)
    .orderBy(transactions.type);
  return {
    dataSource:
      "transactions WHERE deletedAt IS NULL AND createdAt IN [weekStart, weekEnd); volume/fee/commission sums over status='success' rows",
    totalCount: Number(totals.totalCount),
    successCount: Number(totals.successCount),
    failedCount: Number(totals.failedCount),
    pendingCount: Number(totals.pendingCount),
    successVolume: Number(totals.successVolume),
    successFees: Number(totals.successFees),
    successCommission: Number(totals.successCommission),
    byType: typeRows.map(r => ({ type: String(r.type), count: Number(r.count) })),
  };
}

async function computePremiumsSection(
  db: Db,
  weekStart: Date,
  weekEnd: Date
): Promise<PremiumsSection> {
  const [row] = await db
    .select({
      paidCount: sql<number>`COUNT(*)`,
      paidAmount: sql<string>`COALESCE(SUM(CAST(${premiums.amount} AS NUMERIC)), 0)`,
      distinctPolicies: sql<number>`COUNT(DISTINCT ${premiums.policyId})`,
    })
    .from(premiums)
    .where(
      and(eq(premiums.status, "paid"), inWeek(premiums.paidDate, weekStart, weekEnd))
    );
  return {
    dataSource:
      "premiums WHERE status='paid' AND paidDate IN [weekStart, weekEnd) (premium payment ledger)",
    paidCount: Number(row.paidCount),
    paidAmount: Number(row.paidAmount),
    distinctPolicies: Number(row.distinctPolicies),
  };
}

async function computeClaimsSection(
  db: Db,
  weekStart: Date,
  weekEnd: Date
): Promise<ClaimsSection> {
  const [submitted] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(claims)
    .where(inWeek(claims.createdAt, weekStart, weekEnd));
  const [settled] = await db
    .select({
      count: sql<number>`COUNT(*)`,
      paidAmount: sql<string>`COALESCE(SUM(CAST(${claims.paidAmount} AS NUMERIC)), 0)`,
    })
    .from(claims)
    .where(
      and(eq(claims.status, "paid"), inWeek(claims.settlementDate, weekStart, weekEnd))
    );
  return {
    dataSource:
      "claims submitted: createdAt IN week; claims settled: status='paid' AND settlementDate IN week (SUM of paidAmount)",
    submittedCount: Number(submitted.count),
    settledCount: Number(settled.count),
    settledPaidAmount: Number(settled.paidAmount),
  };
}

async function computePoliciesSection(
  db: Db,
  weekStart: Date,
  weekEnd: Date
): Promise<PoliciesSection> {
  const [newRows] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(policies)
    .where(inWeek(policies.createdAt, weekStart, weekEnd));
  const [active] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(policies)
    .where(eq(policies.status, "active"));
  return {
    dataSource:
      "policies new: createdAt IN week; policies active book: status='active' as of generation time",
    newCount: Number(newRows.count),
    activeCount: Number(active.count),
  };
}

async function computeAgentsSection(
  db: Db,
  weekStart: Date,
  weekEnd: Date
): Promise<AgentsSection> {
  const [newRows] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(agents)
    .where(inWeek(agents.createdAt, weekStart, weekEnd));
  const [active] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(agents)
    .where(and(eq(agents.isActive, true), isNull(agents.deletedAt)));
  return {
    dataSource:
      "agents new: createdAt IN week; agents active force: isActive AND deletedAt IS NULL as of generation time",
    newCount: Number(newRows.count),
    activeCount: Number(active.count),
  };
}

/**
 * Compute the requested report sections from the real database.
 *
 * `requestedSections` defaults to all implemented sections. Any requested
 * name that is not implemented is returned in `unavailableSections` with a
 * 'no_data_source' marker — nothing is fabricated.
 */
export async function computeWeeklyReportSections(
  db: Db,
  weekStart: Date,
  weekEnd: Date,
  requestedSections?: string[]
): Promise<WeeklyReportSections> {
  if (!(weekStart < weekEnd)) {
    throw new Error(
      `computeWeeklyReportSections: weekStart (${weekStart.toISOString()}) must be before weekEnd (${weekEnd.toISOString()})`
    );
  }
  const requested = requestedSections ?? [...IMPLEMENTED_SECTIONS];
  const sections: WeeklyReportSections = { unavailableSections: [] };
  for (const name of requested) {
    switch (name) {
      case "transactions":
        sections.transactions = await computeTransactionsSection(db, weekStart, weekEnd);
        break;
      case "premiums":
        sections.premiums = await computePremiumsSection(db, weekStart, weekEnd);
        break;
      case "claims":
        sections.claims = await computeClaimsSection(db, weekStart, weekEnd);
        break;
      case "policies":
        sections.policies = await computePoliciesSection(db, weekStart, weekEnd);
        break;
      case "agents":
        sections.agents = await computeAgentsSection(db, weekStart, weekEnd);
        break;
      default:
        sections.unavailableSections.push({
          section: name,
          status: "no_data_source",
          reason: `section '${name}' has no delivered data source in the runtime schema — omitted rather than fabricated`,
        });
    }
  }
  return sections;
}

/**
 * Default report window: the most recent COMPLETE ISO week (Monday 00:00:00
 * UTC → following Monday 00:00:00 UTC) relative to `now`. Pure calendar math
 * on the caller-supplied clock — no report data is derived here.
 */
export function defaultWeekWindow(now: Date): { weekStart: Date; weekEnd: Date } {
  const day = now.getUTCDay(); // 0=Sun..6=Sat
  const daysSinceMonday = (day + 6) % 7;
  const thisMonday = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysSinceMonday)
  );
  const weekStart = new Date(thisMonday.getTime() - 7 * 24 * 60 * 60 * 1000);
  return { weekStart, weekEnd: thisMonday };
}
