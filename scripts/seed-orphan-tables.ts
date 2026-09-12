/**
 * Seed Orphan Tables — seeds the 25 formerly-orphan tables backed by the
 * Sprint-86 CRUD routers (agentBankAccountsCrud … trainingEnrollmentsCrud).
 *
 * Run:  DATABASE_URL=postgres://... npx tsx scripts/seed-orphan-tables.ts
 *
 * Behaviour contract:
 *  - REAL inserts against the live drizzle schema (drizzle/schema.ts) — no
 *    printed fake success: every row is inserted via drizzle and the final
 *    per-table counts are re-SELECTed from the database before reporting.
 *  - IDEMPOTENT: each seed row carries a deterministic natural key; a row
 *    is inserted only when no row with that key already exists, so re-running
 *    never duplicates. Exit code 0 on success, 1 on any DB error (loud).
 *  - Requires DATABASE_URL; refuses to run without it.
 */

import { and, eq, sql as dsql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import {
  agentBankAccounts,
  agentPerformanceScores,
  agentSuspensionLog,
  analyticsDashboards,
  biReportDefinitions,
  billingRevenuePeriods,
  commissionCascadeHistory,
  customerJourneySteps,
  dataConsentRecords,
  emailDeliveryLog,
  encryptedFields,
  floatReconciliations,
  geoFences,
  gl_accounts,
  gl_journal_entries,
  kycDocuments,
  notification_channels,
  notification_logs,
  observabilityAlerts,
  pnlReports,
  premiumFeeSchedules,
  realtime_tx_alerts,
  tenantBranding,
  trainingCourses,
  trainingEnrollments,
} from "../drizzle/schema";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("ERROR: DATABASE_URL environment variable is required");
  process.exit(1);
}

const client = postgres(DATABASE_URL);
const db = drizzle(client);

type AnyTable = any;

/**
 * Insert rows that do not yet exist, keyed by the given natural-key columns.
 * Returns { inserted, skipped } measured against the real table.
 */
async function ensureRows(
  table: AnyTable,
  keyColumns: string[],
  rows: Record<string, unknown>[],
  label: string
): Promise<{ inserted: number; skipped: number }> {
  let inserted = 0;
  let skipped = 0;
  for (const row of rows) {
    const where = and(
      ...keyColumns.map(col => eq(table[col], row[col] as never))
    );
    const existing = await db
      .select({ id: table.id })
      .from(table)
      .where(where)
      .limit(1);
    if (existing.length > 0) {
      skipped++;
      continue;
    }
    await db.insert(table).values(row as never);
    inserted++;
  }
  const [{ count }] = await db
    .select({ count: dsql<number>`count(*)::int` })
    .from(table);
  console.log(`  ${label}: +${inserted} inserted, ${skipped} already present (table now ${count} rows)`);
  return { inserted, skipped };
}

const DAY = 24 * 3600 * 1000;
const now = new Date();

async function seed() {
  console.log("Seeding orphan tables (idempotent, natural-key dedupe)...");

  // ── agent_bank_accounts (agentBankAccountsCrud) ──────────────────────────
  await ensureRows(agentBankAccounts, ["agentId", "accountNumber"], [
    { agentId: 1, bankName: "GTBank", bankCode: "058", accountNumber: "0123456789", accountName: "SEED AGENT ONE", isDefault: true, verified: true },
    { agentId: 2, bankName: "Access Bank", bankCode: "044", accountNumber: "0098765432", accountName: "SEED AGENT TWO", isDefault: true, verified: true },
    { agentId: 3, bankName: "Zenith Bank", bankCode: "057", accountNumber: "2233445566", accountName: "SEED AGENT THREE", isDefault: true, verified: false },
  ], "agent_bank_accounts");

  // ── agent_performance_scores (agentPerformanceScoresCrud) ────────────────
  await ensureRows(agentPerformanceScores, ["agentId", "period"], [
    { agentId: 1, period: "2026-07", txVolume: "4500000.00", txCount: 812, commissionEarned: "67500.00", customerCount: 240, disputeRate: "0.40", uptimePercent: "99.10", overallScore: "87.50", rank: 1 },
    { agentId: 2, period: "2026-07", txVolume: "2100000.00", txCount: 430, commissionEarned: "31500.00", customerCount: 150, disputeRate: "1.10", uptimePercent: "97.80", overallScore: "74.20", rank: 2 },
  ], "agent_performance_scores");

  // ── agent_suspension_log (agentSuspensionLogCrud) ────────────────────────
  await ensureRows(agentSuspensionLog, ["agentId", "action", "reason"], [
    { agentId: 3, action: "suspend", reason: "SEED: velocity rule breach (>20 tx/hour)", performedBy: 1, previousStatus: "active", newStatus: "suspended" },
    { agentId: 3, action: "reinstate", reason: "SEED: manual review cleared", performedBy: 1, previousStatus: "suspended", newStatus: "active" },
  ], "agent_suspension_log");

  // ── analytics_dashboards (analyticsDashboardsCrud) ───────────────────────
  await ensureRows(analyticsDashboards, ["name", "ownerId"], [
    { name: "SEED Executive Overview", description: "Platform KPIs for executives", ownerId: 1, isPublic: false, layout: JSON.stringify({ widgets: ["kpi", "tx-chart"] }), filters: JSON.stringify({ period: "30d" }), refreshInterval: 300 },
    { name: "SEED Operations Board", description: "Agent/network ops monitoring", ownerId: 1, isPublic: true, layout: JSON.stringify({ widgets: ["agent-map", "alerts"] }), filters: "{}", refreshInterval: 60 },
  ], "analytics_dashboards");

  // ── bi_report_definitions (biReportDefinitionsCrud) ──────────────────────
  await ensureRows(biReportDefinitions, ["name"], [
    { name: "SEED Daily Revenue Report", description: "Daily platform revenue by product", reportType: "revenue", dataSource: "transactions", query: "select date, sum(amount) from transactions group by 1", schedule: "0 6 * * *", recipients: "finance@example.com", isActive: true, createdBy: 1 },
    { name: "SEED Weekly Agent Performance", description: "Agent KPI weekly rollup", reportType: "agent_performance", dataSource: "agent_performance_scores", query: "select agent_id, overall_score from agent_performance_scores", schedule: "0 7 * * 1", recipients: "ops@example.com", isActive: true, createdBy: 1 },
  ], "bi_report_definitions");

  // ── billing_revenue_periods (billingRevenuePeriodsCrud) ──────────────────
  await ensureRows(billingRevenuePeriods, ["periodType", "periodStart"], [
    {
      periodType: "monthly",
      periodStart: new Date(now.getTime() - 31 * DAY),
      periodEnd: new Date(now.getTime() - DAY),
      transactionCount: 15420,
      grossVolume: "98200000.00",
      totalFees: "1473000.00",
      totalClientRevenue: "1200000.00",
      totalPlatformRevenue: "273000.00",
      totalAgentCommissions: "540000.00",
      totalSwitchFees: "98000.00",
      totalAggregatorFees: "45000.00",
      activeAgents: 320,
      activeFieldAgents: 285,
      avgTxPerAgent: "48.19",
      billingModel: "revenue_share",
      currency: "NGN",
      computedAt: now,
      dataSourceHash: "seed-brp-2026-07",
    },
  ], "billing_revenue_periods");

  // ── commission_cascade_history (commissionCascadeHistoryCrud) ────────────
  await ensureRows(commissionCascadeHistory, ["transactionRef", "recipientAgentCode"], [
    { transactionId: 900001, transactionRef: "SEED-TX-900001", transactionType: "cash_in", transactionAmount: "150000.00", totalCommission: "2250.00", originAgentId: 1, originAgentCode: "AGT-001", recipientAgentId: 11, recipientAgentCode: "AGT-SUP-01", recipientHierarchyRole: "super_agent", recipientHierarchyLevel: 2, splitPercentage: "15.00", commissionAmount: "337.50", status: "credited", creditedAt: now },
    { transactionId: 900001, transactionRef: "SEED-TX-900001", transactionType: "cash_in", transactionAmount: "150000.00", totalCommission: "2250.00", originAgentId: 1, originAgentCode: "AGT-001", recipientAgentId: 21, recipientAgentCode: "AGT-AGG-01", recipientHierarchyRole: "aggregator", recipientHierarchyLevel: 3, splitPercentage: "5.00", commissionAmount: "112.50", status: "credited", creditedAt: now },
  ], "commission_cascade_history");

  // ── customer_journey_steps (customerJourneyEventsCrud) ───────────────────
  await ensureRows(customerJourneySteps, ["customerId", "stepType"], [
    { customerId: 5001, stepType: "awareness", status: "completed", completedAt: new Date(now.getTime() - 20 * DAY), metadata: JSON.stringify({ channel: "agent_referral" }) },
    { customerId: 5001, stepType: "onboarding", status: "completed", completedAt: new Date(now.getTime() - 18 * DAY), metadata: JSON.stringify({ kycLevel: "tier2" }) },
    { customerId: 5001, stepType: "first_transaction", status: "completed", completedAt: new Date(now.getTime() - 17 * DAY), metadata: JSON.stringify({ product: "motor_insurance" }) },
  ], "customer_journey_steps");

  // ── data_consent_records (dataConsentRecordsCrud) ────────────────────────
  await ensureRows(dataConsentRecords, ["entityType", "entityId", "consentType"], [
    { entityType: "customer", entityId: 5001, consentType: "data_processing", granted: true, grantedAt: new Date(now.getTime() - 20 * DAY), ipAddress: "102.89.0.1", userAgent: "seed-script", version: 1 },
    { entityType: "customer", entityId: 5001, consentType: "marketing", granted: false, grantedAt: new Date(now.getTime() - 20 * DAY), version: 1 },
  ], "data_consent_records");

  // ── email_delivery_log (emailDeliveryLogCrud) ────────────────────────────
  await ensureRows(emailDeliveryLog, ["toAddress", "subject"], [
    { emailQueueId: null, provider: "console", providerMessageId: "seed-msg-001", toAddress: "customer5001@example.com", subject: "SEED Welcome to the platform", status: "delivered", metadata: { template: "welcome" } },
    { emailQueueId: null, provider: "console", providerMessageId: "seed-msg-002", toAddress: "agent001@example.com", subject: "SEED Commission statement", status: "bounced", bouncedAt: now, errorMessage: "mailbox full", metadata: { template: "commission" } },
  ], "email_delivery_log");

  // ── encrypted_fields (encryptedFieldsCrud) ───────────────────────────────
  await ensureRows(encryptedFields, ["tableName", "fieldName"], [
    { tableName: "agents", fieldName: "bvn", encryptionKeyId: "seed-key-2026-01", algorithm: "AES-256-GCM", lastRotatedAt: new Date(now.getTime() - 60 * DAY), isActive: true },
    { tableName: "customers", fieldName: "nin", encryptionKeyId: "seed-key-2026-01", algorithm: "AES-256-GCM", lastRotatedAt: new Date(now.getTime() - 60 * DAY), isActive: true },
  ], "encrypted_fields");

  // ── float_reconciliations (floatReconciliationsCrud) ─────────────────────
  await ensureRows(floatReconciliations, ["agentId", "date"], [
    { agentId: 1, date: new Date(now.getTime() - DAY), expectedBalance: "500000.00", actualBalance: "500000.00", discrepancy: "0.00", status: "resolved", resolvedBy: 1, resolvedAt: now, notes: "SEED: clean reconciliation" },
    { agentId: 2, date: new Date(now.getTime() - DAY), expectedBalance: "250000.00", actualBalance: "247500.00", discrepancy: "-2500.00", status: "pending", notes: "SEED: under investigation" },
  ], "float_reconciliations");

  // ── geo_fences (geoFencesCrud) ───────────────────────────────────────────
  await ensureRows(geoFences, ["name"], [
    { name: "SEED Lagos Island", regionCode: "LA-ISL", centerLat: "6.4541", centerLng: "3.3947", radiusKm: "8.0", isActive: true },
    { name: "SEED Abuja Central", regionCode: "FC-CTR", centerLat: "9.0579", centerLng: "7.4951", radiusKm: "12.0", isActive: true },
  ], "geo_fences");

  // ── gl_accounts (glAccountsCrud) ─────────────────────────────────────────
  await ensureRows(gl_accounts, ["accountCode"], [
    { accountCode: "1000", accountName: "SEED Cash and Float", accountType: "asset", currency: "NGN", balance: 0, isActive: true, description: "Agent float settlement account" },
    { accountCode: "4000", accountName: "SEED Fee Revenue", accountType: "revenue", currency: "NGN", balance: 0, isActive: true, description: "Transaction fee income" },
    { accountCode: "5000", accountName: "SEED Commission Expense", accountType: "expense", currency: "NGN", balance: 0, isActive: true, description: "Agent commissions payable" },
  ], "gl_accounts");

  // ── gl_journal_entries (glJournalEntriesCrud) ────────────────────────────
  const accts = await db.select().from(gl_accounts);
  const byCode = Object.fromEntries(accts.map((a: any) => [a.accountCode, a.id]));
  if (byCode["1000"] && byCode["4000"]) {
    await ensureRows(gl_journal_entries, ["entryNumber"], [
      { entryNumber: "SEED-JE-0001", description: "SEED: fee revenue recognition", debitAccountId: byCode["1000"], creditAccountId: byCode["4000"], amount: 150000, currency: "NGN", referenceType: "seed", referenceId: "seed-brp-2026-07", postedBy: "seed-script", status: "posted", postedAt: now },
    ], "gl_journal_entries");
  } else {
    throw new Error("gl_accounts seed rows missing — cannot seed journal entries against real account ids");
  }

  // ── kyc_documents (kycDocumentsCrud) ─────────────────────────────────────
  await ensureRows(kycDocuments, ["agentId", "docType"], [
    { agentId: 1, docType: "BVN", docNumber: "SEED-BVN-001", status: "verified", verifiedBy: 1, verifiedAt: new Date(now.getTime() - 90 * DAY) },
    { agentId: 1, docType: "utility_bill", docUrl: "https://example.com/seed/utility.pdf", status: "pending" },
    { agentId: 2, docType: "NIN", docNumber: "SEED-NIN-002", status: "verified", verifiedBy: 1, verifiedAt: new Date(now.getTime() - 80 * DAY) },
  ], "kyc_documents");

  // ── notification_channels (notificationChannelsCrud) ─────────────────────
  await ensureRows(notification_channels, ["name"], [
    { name: "SEED Primary SMS", channelType: "sms", config: JSON.stringify({ provider: "africastalking", senderId: "INSURE" }), isActive: true, priority: 1 },
    { name: "SEED Primary Email", channelType: "email", config: JSON.stringify({ provider: "smtp", from: "no-reply@example.com" }), isActive: true, priority: 2 },
  ], "notification_channels");

  // ── notification_logs (notificationLogsCrud) ─────────────────────────────
  const channels = await db.select().from(notification_channels);
  const smsChannel = channels.find((c: any) => c.channelType === "sms");
  if (smsChannel) {
    await ensureRows(notification_logs, ["recipientId", "subject"], [
      { channelId: smsChannel.id, recipientId: "+2348012345678", recipientType: "agent", subject: "SEED Float low", body: "SEED: your float balance is below threshold", status: "delivered", sentAt: now, deliveredAt: now, retryCount: 0 },
    ], "notification_logs");
  } else {
    throw new Error("notification_channels seed rows missing — cannot seed logs against real channel ids");
  }

  // ── observability_alerts (observabilityAlertsCrud) ───────────────────────
  await ensureRows(observabilityAlerts, ["alertName", "service"], [
    { alertName: "SEED HighAPIErrorRate", service: "api-gateway", severity: "critical", metric: "error_rate", threshold: "5.0", currentValue: "7.2", status: "firing" },
    { alertName: "SEED SlowPostgres", service: "postgresql", severity: "warning", metric: "query_p99_ms", threshold: "500", currentValue: "620", status: "acknowledged", acknowledgedBy: 1, acknowledgedAt: now },
  ], "observability_alerts");

  // ── pnl_reports (pnlReportsCrud) ─────────────────────────────────────────
  await ensureRows(pnlReports, ["period", "periodType"], [
    { period: "2026-07", periodType: "monthly", agentId: null, regionCode: "NG", totalRevenue: "1473000.00", totalCommission: "540000.00", totalFees: "98000.00", operatingCosts: "610000.00", netMargin: "225000.00", txCount: 15420, txVolume: "98200000.00" },
  ], "pnl_reports");

  // ── premium_fee_schedules (tenantFeeOverridesCrud) ───────────────────────
  await ensureRows(premiumFeeSchedules, ["tenantId", "productType", "feeType"], [
    { tenantId: 1, productType: "motor", feeType: "percentage", feeValue: "2.50", minFee: "500.00", maxFee: "50000.00", description: "SEED: motor premium processing fee", isActive: true },
    { tenantId: 1, productType: "health", feeType: "flat", feeValue: "250.00", description: "SEED: health policy flat fee", isActive: true },
  ], "premium_fee_schedules");

  // ── realtime_tx_alerts (realtimeTxAlertsCrud) ────────────────────────────
  await ensureRows(realtime_tx_alerts, ["transactionId", "alertType"], [
    { transactionId: "SEED-TX-900001", alertType: "high_amount", severity: "medium", message: "SEED: single transaction above review threshold", metadata: JSON.stringify({ amount: 150000 }), acknowledged: false },
    { transactionId: "SEED-TX-900002", alertType: "velocity", severity: "high", message: "SEED: 23 transactions in 5 minutes from one agent", metadata: JSON.stringify({ count: 23, windowMinutes: 5 }), acknowledged: true, acknowledgedBy: "seed-reviewer", acknowledgedAt: now },
  ], "realtime_tx_alerts");

  // ── tenant_branding (tenantBrandingCrud) ─────────────────────────────────
  await ensureRows(tenantBranding, ["tenantId"], [
    { tenantId: 1, logoUrl: "https://example.com/seed/logo.png", primaryColor: "#0B5FFF", secondaryColor: "#00B894", accentColor: "#FDCB6E", backgroundColor: "#FFFFFF", textColor: "#1A1A1A", fontFamily: "Inter", brandName: "SEED Tenant", tagline: "Insurance for everyone", supportEmail: "support@example.com", isLive: false },
  ], "tenant_branding");

  // ── training_courses (trainingCoursesCrud) ───────────────────────────────
  await ensureRows(trainingCourses, ["title"], [
    { title: "SEED AML/CFT Compliance Basics", description: "CBN AML requirements for agents", category: "compliance", contentType: "video", contentUrl: "https://example.com/seed/aml-course", durationMinutes: 45, passingScore: 80, isMandatory: true, isActive: true, version: 1, createdBy: 1 },
    { title: "SEED POS Operations", description: "Terminal handling and settlement", category: "operations", contentType: "document", contentUrl: "https://example.com/seed/pos-guide", durationMinutes: 30, passingScore: 70, isMandatory: false, isActive: true, version: 1, createdBy: 1 },
  ], "training_courses");

  // ── training_enrollments (trainingEnrollmentsCrud) ───────────────────────
  const courses = await db.select().from(trainingCourses);
  const aml = courses.find((c: any) => c.title === "SEED AML/CFT Compliance Basics");
  if (aml) {
    await ensureRows(trainingEnrollments, ["courseId", "agentId"], [
      { courseId: aml.id, agentId: 1, status: "completed", progress: 100, score: 92, startedAt: new Date(now.getTime() - 30 * DAY), completedAt: new Date(now.getTime() - 29 * DAY) },
      { courseId: aml.id, agentId: 2, status: "in_progress", progress: 40, startedAt: new Date(now.getTime() - 5 * DAY) },
    ], "training_enrollments");
  } else {
    throw new Error("training_courses seed rows missing — cannot seed enrollments against real course ids");
  }

  console.log("Orphan-table seed complete. All counts above were re-SELECTed from the database.");
}

seed()
  .then(async () => {
    await client.end();
    process.exit(0);
  })
  .catch(async err => {
    console.error("SEED FAILED (loud):", err);
    await client.end().catch(() => {});
    process.exit(1);
  });
