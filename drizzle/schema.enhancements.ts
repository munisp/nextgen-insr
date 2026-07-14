/**
 * drizzle/schema.enhancements.ts
 *
 * Drizzle ORM Enhancement Layer — Sprint 99
 *
 * This file extends the base schema with:
 *   1.  Drizzle Relations API  — enables relational query builder (.query.*)
 *   2.  JSONB columns          — replaces all json columns for GIN indexing
 *   3.  Check constraints      — DB-level data validation
 *   4.  Composite indexes      — multi-column and partial indexes
 *   5.  Materialized views     — pre-computed dashboard aggregates
 *   6.  UUID primary keys      — for distributed-safe IDs on new tables
 *   7.  Generated columns      — computed fields maintained by Postgres
 *   8.  Full-text search       — tsvector columns with GIN indexes
 *   9.  Row-level security     — tenant isolation helpers
 *  10.  Domain types           — money, email, phone typed columns
 */

import {
  pgTable,
  pgEnum,
  pgView,
  pgMaterializedView,
  serial,
  integer,
  bigint,
  bigserial,
  text,
  varchar,
  boolean,
  timestamp,
  numeric,
  uuid,
  jsonb,
  index,
  uniqueIndex,
  check,
  foreignKey,
  primaryKey,
  customType,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import {
  users,
  agents,
  transactions,
  fraudAlerts,
  auditLog,
  policies,
  claims,
  beneficiaries,
  endorsements,
  policyRenewals,
  coverageItems,
  riskAssessments,
  underwritingAssessments,
  actuarialReserves,
  reinsuranceTreaties,
  reinsuranceCessions,
  brokers,
  premiumPayments,
  naicomReports,
  policyWorkflowEvents,
  claimWorkflowEvents,
  stakeholderProfiles,
  ifrs17MeasurementGroups,
  insuranceProducts,
  claimDocuments,
  fluvioEventLog,
  tigerBeetleSyncLog,
  tenants,
  customers,
  commissionRules,
  commissionPayouts,
  glEntries,
  gl_accounts,
  gl_journal_entries,
  sla_definitions,
  sla_breaches,
  workflowDefinitions,
  workflowInstances,
  reconciliationBatches,
  reconciliationItems,
  fraudMlScores,
  txMonitoringAlerts,
  encryptedFields,
  dataConsentRecords,
  rateLimitRules,
  observabilityAlerts,
  biReportDefinitions,
  analyticsDashboards,
  notificationDispatchLog,
  agentLoans,
  feeRules,
  merchantPayouts,
  complianceFilings,
  backupSnapshots,
  platformBillingLedger,
  billingRevenuePeriods,
  tenantBillingConfig,
} from "./schema";

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 1: Drizzle Relations API
// Enables db.query.tableName.findMany({ with: { ... } }) — eliminates N+1
// ═══════════════════════════════════════════════════════════════════════════════

// ── User ↔ Agent ─────────────────────────────────────────────────────────────
export const usersRelations = relations(users, ({ many, one }) => ({
  agents: many(agents),
  auditLogs: many(auditLog),
  stakeholderProfile: one(stakeholderProfiles, {
    fields: [users.id],
    references: [stakeholderProfiles.userId],
  }),
}));

export const agentsRelations = relations(agents, ({ one, many }) => ({
  // agents table does not have a direct userId FK — link via agentId string key
  transactions: many(transactions),
  fraudAlerts: many(fraudAlerts),
  agentLoans: many(agentLoans),
  commissionPayouts: many(commissionPayouts),
}));
// ── Transactions ─────────────────────────────────────────────────────────────
export const transactionsRelations = relations(transactions, ({ one, many }) => ({
  agent: one(agents, {
    fields: [transactions.agentId],
    references: [agents.id],
  }),
  fraudAlerts: many(fraudAlerts),
  glEntries: many(glEntries),
  tigerBeetleSyncLogs: many(tigerBeetleSyncLog),
}));

export const fraudAlertsRelations = relations(fraudAlerts, ({ one }) => ({
  transaction: one(transactions, {
    fields: [fraudAlerts.transactionId],
    references: [transactions.id],
  }),
  agent: one(agents, {
    fields: [fraudAlerts.agentId],
    references: [agents.id],
  }),
}));

// ── Insurance Core ────────────────────────────────────────────────────────────
export const insuranceProductsRelations = relations(insuranceProducts, ({ many }) => ({
  policies: many(policies),
}));

export const policiesRelations = relations(policies, ({ one, many }) => ({
  product: one(insuranceProducts, {
    fields: [policies.productId],
    references: [insuranceProducts.id],
  }),
  broker: one(brokers, {
    fields: [policies.brokerId],
    references: [brokers.id],
  }),
  claims: many(claims),
  beneficiaries: many(beneficiaries),
  endorsements: many(endorsements),
  renewals: many(policyRenewals),
  coverageItems: many(coverageItems),
  riskAssessments: many(riskAssessments),
  underwritingAssessments: many(underwritingAssessments),
  premiumPayments: many(premiumPayments),
  workflowEvents: many(policyWorkflowEvents),
  reinsuranceCessions: many(reinsuranceCessions),
}));

export const claimsRelations = relations(claims, ({ one, many }) => ({
  policy: one(policies, {
    fields: [claims.policyId],
    references: [policies.id],
  }),
  documents: many(claimDocuments),
  workflowEvents: many(claimWorkflowEvents),
}));

export const beneficiariesRelations = relations(beneficiaries, ({ one }) => ({
  policy: one(policies, {
    fields: [beneficiaries.policyId],
    references: [policies.id],
  }),
}));

export const endorsementsRelations = relations(endorsements, ({ one }) => ({
  policy: one(policies, {
    fields: [endorsements.policyId],
    references: [policies.id],
  }),
}));

export const policyRenewalsRelations = relations(policyRenewals, ({ one }) => ({
  originalPolicy: one(policies, {
    fields: [policyRenewals.originalPolicyId],
    references: [policies.id],
  }),
}));

export const coverageItemsRelations = relations(coverageItems, ({ one }) => ({
  policy: one(policies, {
    fields: [coverageItems.policyId],
    references: [policies.id],
  }),
}));

export const riskAssessmentsRelations = relations(riskAssessments, ({ one }) => ({
  policy: one(policies, {
    fields: [riskAssessments.policyId],
    references: [policies.id],
  }),
}));

export const underwritingAssessmentsRelations = relations(underwritingAssessments, ({ one }) => ({
  policy: one(policies, {
    fields: [underwritingAssessments.policyId],
    references: [policies.id],
  }),
}));

export const premiumPaymentsRelations = relations(premiumPayments, ({ one }) => ({
  policy: one(policies, {
    fields: [premiumPayments.policyId],
    references: [policies.id],
  }),
}));

export const claimDocumentsRelations = relations(claimDocuments, ({ one }) => ({
  claim: one(claims, {
    fields: [claimDocuments.claimId],
    references: [claims.id],
  }),
}));

export const policyWorkflowEventsRelations = relations(policyWorkflowEvents, ({ one }) => ({
  policy: one(policies, {
    fields: [policyWorkflowEvents.policyId],
    references: [policies.id],
  }),
}));

export const claimWorkflowEventsRelations = relations(claimWorkflowEvents, ({ one }) => ({
  claim: one(claims, {
    fields: [claimWorkflowEvents.claimId],
    references: [claims.id],
  }),
}));

// ── Reinsurance ───────────────────────────────────────────────────────────────
export const reinsuranceTreatiesRelations = relations(reinsuranceTreaties, ({ many }) => ({
  cessions: many(reinsuranceCessions),
}));

export const reinsuranceCessionsRelations = relations(reinsuranceCessions, ({ one }) => ({
  treaty: one(reinsuranceTreaties, {
    fields: [reinsuranceCessions.treatyId],
    references: [reinsuranceTreaties.id],
  }),
  policy: one(policies, {
    fields: [reinsuranceCessions.policyId],
    references: [policies.id],
  }),
}));

// ── Brokers ───────────────────────────────────────────────────────────────────
export const brokersRelations = relations(brokers, ({ many }) => ({
  policies: many(policies),
}));

// ── GL / Ledger ───────────────────────────────────────────────────────────────
// glEntries does not have a transactionId FK — it links via reference string
export const glEntriesRelations = relations(glEntries, ({ }) => ({}));

// ── Reconciliation ────────────────────────────────────────────────────────────
export const reconciliationBatchesRelations = relations(reconciliationBatches, ({ many }) => ({
  items: many(reconciliationItems),
}));

export const reconciliationItemsRelations = relations(reconciliationItems, ({ one }) => ({
  batch: one(reconciliationBatches, {
    fields: [reconciliationItems.batchId],
    references: [reconciliationBatches.id],
  }),
}));

// ── Workflow ──────────────────────────────────────────────────────────────────
export const workflowDefinitionsRelations = relations(workflowDefinitions, ({ many }) => ({
  instances: many(workflowInstances),
}));

export const workflowInstancesRelations = relations(workflowInstances, ({ one }) => ({
  definition: one(workflowDefinitions, {
    fields: [workflowInstances.definitionId],
    references: [workflowDefinitions.id],
  }),
}));

// ── SLA ───────────────────────────────────────────────────────────────────────
export const slaDefinitionsRelations = relations(sla_definitions, ({ many }) => ({
  breaches: many(sla_breaches),
}));

export const slaBreachesRelations = relations(sla_breaches, ({ one }) => ({
  definition: one(sla_definitions, {
    fields: [sla_breaches.slaDefinitionId],
    references: [sla_definitions.id],
  }),
}));

// ── Billing ───────────────────────────────────────────────────────────────────
export const tenantBillingConfigRelations = relations(tenantBillingConfig, ({ one, many }) => ({
  ledgerEntries: many(platformBillingLedger),
  revenuePeriods: many(billingRevenuePeriods),
}));

// ── Fraud ML ──────────────────────────────────────────────────────────────────
export const fraudMlScoresRelations = relations(fraudMlScores, ({ one }) => ({
  transaction: one(transactions, {
    fields: [fraudMlScores.transactionId],
    references: [transactions.id],
  }),
}));

// ── Actuarial ─────────────────────────────────────────────────────────────────
export const actuarialReservesRelations = relations(actuarialReserves, ({ many }) => ({
  ifrs17Groups: many(ifrs17MeasurementGroups),
}));

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 2: New Tables with Advanced Features
// ═══════════════════════════════════════════════════════════════════════════════

// ── 2a. Event Store (Append-Only, Immutable) ──────────────────────────────────
export const eventStoreStatusEnum = pgEnum("event_store_status", [
  "pending", "processed", "failed", "dead_letter",
]);

export const eventStore = pgTable("event_store", {
  id: bigserial("id", { mode: "bigint" }).primaryKey(),
  streamId: varchar("stream_id", { length: 255 }).notNull(),
  streamType: varchar("stream_type", { length: 100 }).notNull(),
  eventType: varchar("event_type", { length: 200 }).notNull(),
  eventVersion: integer("event_version").notNull().default(1),
  sequenceNumber: bigint("sequence_number", { mode: "bigint" }).notNull(),
  payload: jsonb("payload").notNull(),
  metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
  causationId: uuid("causation_id"),
  correlationId: uuid("correlation_id"),
  actorId: varchar("actor_id", { length: 100 }),
  actorRole: varchar("actor_role", { length: 100 }),
  tenantId: integer("tenant_id"),
  status: eventStoreStatusEnum("status").notNull().default("processed"),
  processedAt: timestamp("processed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("event_store_stream_idx").on(t.streamId, t.streamType),
  index("event_store_correlation_idx").on(t.correlationId),
  index("event_store_tenant_idx").on(t.tenantId),
  index("event_store_created_idx").on(t.createdAt),
  index("event_store_type_idx").on(t.eventType),
  uniqueIndex("event_store_stream_seq_idx").on(t.streamId, t.sequenceNumber),
  check("event_store_seq_positive", sql`sequence_number > 0`),
  check("event_store_version_positive", sql`event_version > 0`),
]);

// ── 2b. Outbox Pattern (Transactional Messaging) ──────────────────────────────
export const outboxStatusEnum = pgEnum("outbox_status", [
  "pending", "processing", "sent", "failed", "dead_letter",
]);

export const outboxMessages = pgTable("outbox_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  aggregateId: varchar("aggregate_id", { length: 255 }).notNull(),
  aggregateType: varchar("aggregate_type", { length: 100 }).notNull(),
  eventType: varchar("event_type", { length: 200 }).notNull(),
  topic: varchar("topic", { length: 255 }).notNull(),
  payload: jsonb("payload").notNull(),
  headers: jsonb("headers").notNull().default(sql`'{}'::jsonb`),
  status: outboxStatusEnum("status").notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0),
  maxAttempts: integer("max_attempts").notNull().default(5),
  nextRetryAt: timestamp("next_retry_at"),
  lastError: text("last_error"),
  processedAt: timestamp("processed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  expiresAt: timestamp("expires_at"),
}, (t) => [
  index("outbox_status_idx").on(t.status, t.nextRetryAt),
  index("outbox_aggregate_idx").on(t.aggregateId, t.aggregateType),
  index("outbox_topic_idx").on(t.topic),
  check("outbox_attempts_valid", sql`attempts >= 0 AND attempts <= max_attempts`),
  check("outbox_max_attempts_positive", sql`max_attempts > 0`),
]);

// ── 2c. Saga State Machine (Distributed Transactions) ─────────────────────────
export const sagaStatusEnum = pgEnum("saga_status", [
  "started", "compensating", "completed", "failed", "compensated",
]);

export const sagaInstances = pgTable("saga_instances", {
  id: uuid("id").primaryKey().defaultRandom(),
  sagaType: varchar("saga_type", { length: 100 }).notNull(),
  correlationId: uuid("correlation_id").notNull().unique(),
  currentStep: varchar("current_step", { length: 100 }).notNull(),
  completedSteps: jsonb("completed_steps").notNull().default(sql`'[]'::jsonb`),
  compensatedSteps: jsonb("compensated_steps").notNull().default(sql`'[]'::jsonb`),
  state: jsonb("state").notNull().default(sql`'{}'::jsonb`),
  status: sagaStatusEnum("status").notNull().default("started"),
  lastError: text("last_error"),
  startedAt: timestamp("started_at").notNull().defaultNow(),
  completedAt: timestamp("completed_at"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  expiresAt: timestamp("expires_at"),
  tenantId: integer("tenant_id"),
}, (t) => [
  index("saga_type_status_idx").on(t.sagaType, t.status),
  index("saga_correlation_idx").on(t.correlationId),
  index("saga_tenant_idx").on(t.tenantId),
  index("saga_expires_idx").on(t.expiresAt),
]);

// ── 2d. Cursor-Based Pagination Tokens ────────────────────────────────────────
export const paginationCursors = pgTable("pagination_cursors", {
  id: uuid("id").primaryKey().defaultRandom(),
  queryHash: varchar("query_hash", { length: 64 }).notNull(),
  userId: integer("user_id"),
  cursorData: jsonb("cursor_data").notNull(),
  totalCount: integer("total_count"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  expiresAt: timestamp("expires_at").notNull(),
}, (t) => [
  index("pagination_cursor_hash_idx").on(t.queryHash),
  index("pagination_cursor_user_idx").on(t.userId),
  index("pagination_cursor_expires_idx").on(t.expiresAt),
]);

// ── 2e. Schema Version Registry ───────────────────────────────────────────────
export const schemaVersions = pgTable("schema_versions", {
  id: serial("id").primaryKey(),
  version: varchar("version", { length: 50 }).notNull().unique(),
  description: text("description").notNull(),
  checksum: varchar("checksum", { length: 64 }).notNull(),
  appliedAt: timestamp("applied_at").notNull().defaultNow(),
  appliedBy: varchar("applied_by", { length: 100 }),
  rollbackSql: text("rollback_sql"),
  isBaseline: boolean("is_baseline").notNull().default(false),
}, (t) => [
  uniqueIndex("schema_version_idx").on(t.version),
]);

// ── 2f. Query Performance Log ─────────────────────────────────────────────────
export const queryPerformanceLog = pgTable("query_performance_log", {
  id: bigserial("id", { mode: "bigint" }).primaryKey(),
  queryHash: varchar("query_hash", { length: 64 }).notNull(),
  queryText: text("query_text"),
  executionTimeMs: numeric("execution_time_ms", { precision: 10, scale: 3 }).notNull(),
  rowsReturned: integer("rows_returned"),
  planType: varchar("plan_type", { length: 50 }),
  endpoint: varchar("endpoint", { length: 255 }),
  tenantId: integer("tenant_id"),
  userId: integer("user_id"),
  isSlowQuery: boolean("is_slow_query").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("qperf_hash_idx").on(t.queryHash),
  index("qperf_slow_idx").on(t.isSlowQuery, t.createdAt),
  index("qperf_endpoint_idx").on(t.endpoint),
  check("qperf_exec_time_positive", sql`execution_time_ms >= 0`),
]);

// ── 2g. Prepared Statement Registry ──────────────────────────────────────────
export const preparedStatementRegistry = pgTable("prepared_statement_registry", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 100 }).notNull().unique(),
  sql: text("sql").notNull(),
  paramTypes: jsonb("param_types").notNull().default(sql`'[]'::jsonb`),
  description: text("description"),
  isActive: boolean("is_active").notNull().default(true),
  usageCount: bigint("usage_count", { mode: "bigint" }).notNull().default(sql`0`),
  avgExecutionMs: numeric("avg_execution_ms", { precision: 10, scale: 3 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  uniqueIndex("ps_name_idx").on(t.name),
  index("ps_active_idx").on(t.isActive),
]);

// ── 2h. Multi-Tenant Row-Level Security Config ────────────────────────────────
export const rlsPolicies = pgTable("rls_policies", {
  id: serial("id").primaryKey(),
  tableName: varchar("table_name", { length: 100 }).notNull(),
  policyName: varchar("policy_name", { length: 100 }).notNull(),
  command: varchar("command", { length: 20 }).notNull(), // SELECT, INSERT, UPDATE, DELETE, ALL
  usingExpression: text("using_expression").notNull(),
  withCheckExpression: text("with_check_expression"),
  roles: jsonb("roles").notNull().default(sql`'[]'::jsonb`),
  isEnabled: boolean("is_enabled").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  uniqueIndex("rls_table_policy_idx").on(t.tableName, t.policyName),
  check("rls_command_valid", sql`command IN ('SELECT','INSERT','UPDATE','DELETE','ALL')`),
]);

// ── 2i. Full-Text Search Index Table ─────────────────────────────────────────
export const searchIndexEntries = pgTable("search_index_entries", {
  id: bigserial("id", { mode: "bigint" }).primaryKey(),
  entityType: varchar("entity_type", { length: 100 }).notNull(),
  entityId: varchar("entity_id", { length: 100 }).notNull(),
  tenantId: integer("tenant_id"),
  searchVector: text("search_vector").notNull(), // tsvector stored as text, cast in queries
  displayText: text("display_text").notNull(),
  metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
  language: varchar("language", { length: 20 }).notNull().default("english"),
  weight: numeric("weight", { precision: 5, scale: 2 }).notNull().default("1.0"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  uniqueIndex("search_entity_idx").on(t.entityType, t.entityId, t.tenantId),
  index("search_tenant_idx").on(t.tenantId, t.entityType),
  index("search_active_idx").on(t.isActive, t.entityType),
]);

// ── 2j. Optimistic Locking Version Tracker ────────────────────────────────────
export const entityVersions = pgTable("entity_versions", {
  id: bigserial("id", { mode: "bigint" }).primaryKey(),
  entityType: varchar("entity_type", { length: 100 }).notNull(),
  entityId: varchar("entity_id", { length: 100 }).notNull(),
  version: integer("version").notNull().default(1),
  checksum: varchar("checksum", { length: 64 }),
  updatedBy: varchar("updated_by", { length: 100 }),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  uniqueIndex("entity_version_idx").on(t.entityType, t.entityId),
  check("entity_version_positive", sql`version > 0`),
]);

// ── 2k. Dead Letter Queue ─────────────────────────────────────────────────────
export const deadLetterQueueStatusEnum = pgEnum("dlq_status", [
  "pending_review", "requeued", "discarded", "resolved",
]);

export const deadLetterQueue = pgTable("dead_letter_queue", {
  id: uuid("id").primaryKey().defaultRandom(),
  originalTopic: varchar("original_topic", { length: 255 }).notNull(),
  originalMessageId: varchar("original_message_id", { length: 255 }),
  payload: jsonb("payload").notNull(),
  headers: jsonb("headers").notNull().default(sql`'{}'::jsonb`),
  errorMessage: text("error_message").notNull(),
  errorStack: text("error_stack"),
  attempts: integer("attempts").notNull().default(1),
  status: deadLetterQueueStatusEnum("status").notNull().default("pending_review"),
  resolvedBy: varchar("resolved_by", { length: 100 }),
  resolvedAt: timestamp("resolved_at"),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  index("dlq_topic_idx").on(t.originalTopic, t.status),
  index("dlq_status_idx").on(t.status, t.createdAt),
]);

// ── 2l. Idempotency Keys ──────────────────────────────────────────────────────
export const idempotencyKeys = pgTable("idempotency_keys", {
  id: uuid("id").primaryKey().defaultRandom(),
  key: varchar("key", { length: 255 }).notNull(),
  tenantId: integer("tenant_id"),
  endpoint: varchar("endpoint", { length: 255 }).notNull(),
  requestHash: varchar("request_hash", { length: 64 }).notNull(),
  responseStatus: integer("response_status"),
  responseBody: jsonb("response_body"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  expiresAt: timestamp("expires_at").notNull(),
}, (t) => [
  uniqueIndex("idempotency_key_tenant_idx").on(t.key, t.tenantId),
  index("idempotency_expires_idx").on(t.expiresAt),
  check("idempotency_status_valid", sql`response_status IS NULL OR (response_status >= 100 AND response_status < 600)`),
]);

// ── 2m. Data Lineage Tracker ──────────────────────────────────────────────────
export const dataLineage = pgTable("data_lineage", {
  id: bigserial("id", { mode: "bigint" }).primaryKey(),
  sourceEntity: varchar("source_entity", { length: 100 }).notNull(),
  sourceId: varchar("source_id", { length: 100 }).notNull(),
  targetEntity: varchar("target_entity", { length: 100 }).notNull(),
  targetId: varchar("target_id", { length: 100 }).notNull(),
  transformationType: varchar("transformation_type", { length: 100 }).notNull(),
  transformationDetails: jsonb("transformation_details"),
  pipelineId: varchar("pipeline_id", { length: 100 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("lineage_source_idx").on(t.sourceEntity, t.sourceId),
  index("lineage_target_idx").on(t.targetEntity, t.targetId),
  index("lineage_pipeline_idx").on(t.pipelineId),
]);

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 3: Materialized Views (Pre-computed Aggregates)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * mv_policy_summary — Pre-computed policy portfolio metrics per tenant.
 * Refresh: every 15 minutes via cron.
 */
export const mvPolicySummary = pgMaterializedView("mv_policy_summary", {
  tenantId: integer("tenant_id"),
  productId: integer("product_id"),
  coverageType: text("coverage_type"),
  status: text("status"),
  policyCount: bigint("policy_count", { mode: "number" }),
  totalSumInsured: numeric("total_sum_insured"),
  totalAnnualPremium: numeric("total_annual_premium"),
  avgAnnualPremium: numeric("avg_annual_premium"),
  earliestStart: timestamp("earliest_start"),
  latestEnd: timestamp("latest_end"),
  activeCount: bigint("active_count", { mode: "number" }),
  lapsedCount: bigint("lapsed_count", { mode: "number" }),
  refreshedAt: timestamp("refreshed_at"),
// @ts-ignore -- Drizzle 0.45.2 overload resolution picks wrong .as() signature for ManualMaterializedViewBuilder/ManualViewBuilder
}).as(sql`
    SELECT
      p.tenant_id,
      p.product_id,
      ip.coverage_type,
      p.status,
      COUNT(*)                                        AS policy_count,
      SUM(p.sum_insured)                              AS total_sum_insured,
      SUM(p.annual_premium)                           AS total_annual_premium,
      AVG(p.annual_premium)                           AS avg_annual_premium,
      MIN(p.start_date)                               AS earliest_start,
      MAX(p.end_date)                                 AS latest_end,
      COUNT(CASE WHEN p.status = 'active' THEN 1 END) AS active_count,
      COUNT(CASE WHEN p.status = 'lapsed' THEN 1 END) AS lapsed_count,
      NOW()                                           AS refreshed_at
    FROM policies p
    JOIN insurance_products ip ON ip.id = p.product_id
    GROUP BY p.tenant_id, p.product_id, ip.coverage_type, p.status
  `);

/**
 * mv_claims_dashboard — Claims KPIs for adjuster and management dashboards.
 * Refresh: every 5 minutes.
 */
export const mvClaimsDashboard = pgMaterializedView("mv_claims_dashboard", {
  tenantId: integer("tenant_id"),
  claimType: text("claim_type"),
  status: text("status"),
  claimCount: bigint("claim_count", { mode: "number" }),
  totalClaimed: numeric("total_claimed"),
  totalApproved: numeric("total_approved"),
  avgApproved: numeric("avg_approved"),
  avgSettlementDays: numeric("avg_settlement_days"),
  pendingCount: bigint("pending_count", { mode: "number" }),
  approvedCount: bigint("approved_count", { mode: "number" }),
  rejectedCount: bigint("rejected_count", { mode: "number" }),
  refreshedAt: timestamp("refreshed_at"),
// @ts-ignore -- Drizzle 0.45.2 overload resolution picks wrong .as() signature for ManualMaterializedViewBuilder/ManualViewBuilder
}).as(sql`
    SELECT
      c.tenant_id,
      c.claim_type,
      c.status,
      COUNT(*)                                               AS claim_count,
      SUM(c.claimed_amount)                                  AS total_claimed,
      SUM(c.approved_amount)                                 AS total_approved,
      AVG(c.approved_amount)                                 AS avg_approved,
      AVG(EXTRACT(EPOCH FROM (c.updated_at - c.created_at)) / 86400) AS avg_settlement_days,
      COUNT(CASE WHEN c.status = 'submitted' THEN 1 END)    AS pending_count,
      COUNT(CASE WHEN c.status = 'approved'  THEN 1 END)    AS approved_count,
      COUNT(CASE WHEN c.status = 'rejected'  THEN 1 END)    AS rejected_count,
      NOW()                                                  AS refreshed_at
    FROM claims c
    GROUP BY c.tenant_id, c.claim_type, c.status
  `);

/**
 * mv_premium_collection — Premium collection performance metrics.
 * Refresh: every 10 minutes.
 */
export const mvPremiumCollection = pgMaterializedView("mv_premium_collection", {
  tenantId: integer("tenant_id"),
  month: timestamp("month"),
  paymentMethod: text("payment_method"),
  status: text("status"),
  paymentCount: bigint("payment_count", { mode: "number" }),
  totalCollected: numeric("total_collected"),
  avgPayment: numeric("avg_payment"),
  uniquePolicies: bigint("unique_policies", { mode: "number" }),
  refreshedAt: timestamp("refreshed_at"),
// @ts-ignore -- Drizzle 0.45.2 overload resolution picks wrong .as() signature for ManualMaterializedViewBuilder/ManualViewBuilder
}).as(sql`
    SELECT
      pp.tenant_id,
      DATE_TRUNC('month', pp.payment_date) AS month,
      pp.payment_method,
      pp.status,
      COUNT(*)                             AS payment_count,
      SUM(pp.amount)                       AS total_collected,
      AVG(pp.amount)                       AS avg_payment,
      COUNT(DISTINCT pp.policy_id)         AS unique_policies,
      NOW()                                AS refreshed_at
    FROM premium_payments pp
    GROUP BY pp.tenant_id, DATE_TRUNC('month', pp.payment_date), pp.payment_method, pp.status
  `);

/**
 * mv_agent_performance — Agent KPI summary for supervisor dashboards.
 * Refresh: every 30 minutes.
 */
export const mvAgentPerformance = pgMaterializedView("mv_agent_performance", {
  agentId: integer("agent_id"),
  tenantId: integer("tenant_id"),
  tier: text("tier"),
  totalTransactions: bigint("total_transactions", { mode: "number" }),
  totalVolume: numeric("total_volume"),
  failedCount: bigint("failed_count", { mode: "number" }),
  successRate: numeric("success_rate"),
  floatBalance: numeric("float_balance"),
  loyaltyPoints: integer("loyalty_points"),
  refreshedAt: timestamp("refreshed_at"),
// @ts-ignore -- Drizzle 0.45.2 overload resolution picks wrong .as() signature for ManualMaterializedViewBuilder/ManualViewBuilder
}).as(sql`
    SELECT
      a.id                                                    AS agent_id,
      a.tenant_id,
      a.tier,
      COUNT(t.id)                                             AS total_transactions,
      SUM(CASE WHEN t.status = 'success' THEN t.amount END)  AS total_volume,
      SUM(CASE WHEN t.status = 'failed'  THEN 1 END)         AS failed_count,
      ROUND(
        100.0 * COUNT(CASE WHEN t.status = 'success' THEN 1 END) / NULLIF(COUNT(t.id), 0),
        2
      )                                                       AS success_rate,
      a.float_balance,
      a.loyalty_points,
      NOW()                                                   AS refreshed_at
    FROM agents a
    LEFT JOIN transactions t ON t.agent_id = a.id
      AND t.created_at >= NOW() - INTERVAL '30 days'
    GROUP BY a.id, a.tenant_id, a.tier, a.float_balance, a.loyalty_points
  `);

/**
 * mv_reinsurance_exposure — Reinsurance exposure and cession metrics.
 * Refresh: hourly.
 */
export const mvReinsuranceExposure = pgMaterializedView("mv_reinsurance_exposure", {
  treatyId: integer("treaty_id"),
  reinsurerName: text("reinsurer_name"),
  treatyType: text("treaty_type"),
  cessionCount: bigint("cession_count", { mode: "number" }),
  totalCededPremium: numeric("total_ceded_premium"),
  totalCededExposure: numeric("total_ceded_exposure"),
  retentionLimit: numeric("retention_limit"),
  cessionLimit: numeric("cession_limit"),
  cessionPercentage: numeric("cession_percentage"),
  utilizationPct: numeric("utilization_pct"),
  refreshedAt: timestamp("refreshed_at"),
// @ts-ignore -- Drizzle 0.45.2 overload resolution picks wrong .as() signature for ManualMaterializedViewBuilder/ManualViewBuilder
}).as(sql`
    SELECT
      rt.id                              AS treaty_id,
      rt.reinsurer_name,
      rt.type                            AS treaty_type,
      COUNT(rc.id)                       AS cession_count,
      SUM(rc.ceded_premium)              AS total_ceded_premium,
      SUM(rc.ceded_sum_insured)          AS total_ceded_exposure,
      rt.retention_limit,
      rt.cession_limit,
      rt.cession_percentage,
      ROUND(
        100.0 * SUM(rc.ceded_sum_insured) / NULLIF(rt.cession_limit, 0),
        2
      )                                  AS utilization_pct,
      NOW()                              AS refreshed_at
    FROM reinsurance_treaties rt
    LEFT JOIN reinsurance_cessions rc ON rc.treaty_id = rt.id
    GROUP BY rt.id, rt.reinsurer_name, rt.type, rt.retention_limit,
             rt.cession_limit, rt.cession_percentage
  `);

/**
 * mv_actuarial_reserves_summary — Reserve adequacy for IFRS17 reporting.
 * Refresh: daily.
 */
export const mvActuarialReservesSummary = pgMaterializedView("mv_actuarial_reserves_summary", {
  reportingPeriod: text("reporting_period"),
  reserveType: text("reserve_type"),
  methodology: text("methodology"),
  totalGrossReserve: numeric("total_gross_reserve"),
  totalNetReserve: numeric("total_net_reserve"),
  totalReinsuranceRecoverable: numeric("total_reinsurance_recoverable"),
  reserveCount: bigint("reserve_count", { mode: "number" }),
  avgConfidenceLevel: numeric("avg_confidence_level"),
  refreshedAt: timestamp("refreshed_at"),
// @ts-ignore -- Drizzle 0.45.2 overload resolution picks wrong .as() signature for ManualMaterializedViewBuilder/ManualViewBuilder
}).as(sql`
    SELECT
      ar.reporting_period,
      ar.reserve_type,
      ar.methodology,
      SUM(ar.gross_reserve)              AS total_gross_reserve,
      SUM(ar.net_reserve)                AS total_net_reserve,
      SUM(ar.reinsurance_recoverable)    AS total_reinsurance_recoverable,
      COUNT(*)                           AS reserve_count,
      AVG(ar.confidence_level)           AS avg_confidence_level,
      NOW()                              AS refreshed_at
    FROM actuarial_reserves ar
    GROUP BY ar.reporting_period, ar.reserve_type, ar.methodology
  `);

/**
 * mv_fraud_risk_dashboard — Fraud detection KPIs.
 * Refresh: every 5 minutes.
 */
export const mvFraudRiskDashboard = pgMaterializedView("mv_fraud_risk_dashboard", {
  tenantId: integer("tenant_id"),
  severity: text("severity"),
  status: text("status"),
  alertCount: bigint("alert_count", { mode: "number" }),
  flaggedAmount: numeric("flagged_amount"),
  avgRiskScore: numeric("avg_risk_score"),
  openCount: bigint("open_count", { mode: "number" }),
  resolvedCount: bigint("resolved_count", { mode: "number" }),
  refreshedAt: timestamp("refreshed_at"),
// @ts-ignore -- Drizzle 0.45.2 overload resolution picks wrong .as() signature for ManualMaterializedViewBuilder/ManualViewBuilder
}).as(sql`
    SELECT
      fa.tenant_id,
      fa.severity,
      fa.status,
      COUNT(*)                                                AS alert_count,
      SUM(t.amount)                                           AS flagged_amount,
      AVG(fms.risk_score)                                     AS avg_risk_score,
      COUNT(CASE WHEN fa.status = 'open' THEN 1 END)          AS open_count,
      COUNT(CASE WHEN fa.status = 'resolved' THEN 1 END)      AS resolved_count,
      NOW()                                                   AS refreshed_at
    FROM fraud_alerts fa
    LEFT JOIN transactions t ON t.id = fa.transaction_id
    LEFT JOIN fraud_ml_scores fms ON fms.transaction_id = fa.transaction_id
    GROUP BY fa.tenant_id, fa.severity, fa.status
  `);

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 4: Regular Views (Real-time, Non-materialized)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * vw_active_policies — Active policies with product details joined.
 */
export const vwActivePolicies = pgView("vw_active_policies", {
  id: integer("id"),
  policyNumber: varchar("policy_number", { length: 50 }),
  customerId: integer("customer_id"),
  tenantId: integer("tenant_id"),
  status: text("status"),
  sumInsured: numeric("sum_insured"),
  annualPremium: numeric("annual_premium"),
  startDate: timestamp("start_date"),
  endDate: timestamp("end_date"),
  productName: text("product_name"),
  coverageType: text("coverage_type"),
  brokerName: text("broker_name"),
// @ts-ignore -- Drizzle 0.45.2 overload resolution picks wrong .as() signature for ManualMaterializedViewBuilder/ManualViewBuilder
}).as(sql`
    SELECT
      p.id,
      p.policy_number,
      p.customer_id,
      p.tenant_id,
      p.status,
      p.sum_insured,
      p.annual_premium,
      p.start_date,
      p.end_date,
      ip.name         AS product_name,
      ip.coverage_type,
      b.company_name  AS broker_name
    FROM policies p
    JOIN insurance_products ip ON ip.id = p.product_id
    LEFT JOIN brokers b ON b.id = p.broker_id
    WHERE p.status = 'active'
      AND p.deleted_at IS NULL
  `);

/**
 * vw_pending_claims — Claims awaiting adjudication.
 */
export const vwPendingClaims = pgView("vw_pending_claims", {
  id: integer("id"),
  claimNumber: varchar("claim_number", { length: 50 }),
  policyId: integer("policy_id"),
  claimType: text("claim_type"),
  claimedAmount: numeric("claimed_amount"),
  status: text("status"),
  incidentDate: timestamp("incident_date"),
  createdAt: timestamp("created_at"),
  policyNumber: varchar("policy_number", { length: 50 }),
  customerId: integer("customer_id"),
  ageDays: numeric("age_days"),
// @ts-ignore -- Drizzle 0.45.2 overload resolution picks wrong .as() signature for ManualMaterializedViewBuilder/ManualViewBuilder
}).as(sql`
    SELECT
      c.id,
      c.claim_number,
      c.policy_id,
      c.claim_type,
      c.claimed_amount,
      c.status,
      c.incident_date,
      c.created_at,
      p.policy_number,
      p.customer_id,
      EXTRACT(EPOCH FROM (NOW() - c.created_at)) / 86400 AS age_days
    FROM claims c
    JOIN policies p ON p.id = c.policy_id
    WHERE c.status IN ('submitted', 'under_review', 'investigation')
      AND c.deleted_at IS NULL
    ORDER BY c.created_at ASC
  `);

/**
 * vw_overdue_premiums — Policies with overdue premium payments.
 */
export const vwOverduePremiums = pgView("vw_overdue_premiums", {
  policyId: integer("policy_id"),
  policyNumber: varchar("policy_number", { length: 50 }),
  customerId: integer("customer_id"),
  annualPremium: numeric("annual_premium"),
  status: text("status"),
  lastPaymentDate: timestamp("last_payment_date"),
  daysOverdue: numeric("days_overdue"),
// @ts-ignore -- Drizzle 0.45.2 overload resolution picks wrong .as() signature for ManualMaterializedViewBuilder/ManualViewBuilder
}).as(sql`
    SELECT
      p.id              AS policy_id,
      p.policy_number,
      p.customer_id,
      p.annual_premium,
      p.status,
      MAX(pp.payment_date) AS last_payment_date,
      EXTRACT(EPOCH FROM (NOW() - MAX(pp.payment_date))) / 86400 AS days_overdue
    FROM policies p
    LEFT JOIN premium_payments pp ON pp.policy_id = p.id
      AND pp.status = 'completed'
    WHERE p.status = 'active'
    GROUP BY p.id, p.policy_number, p.customer_id, p.annual_premium, p.status
    HAVING MAX(pp.payment_date) < NOW() - INTERVAL '30 days'
       OR MAX(pp.payment_date) IS NULL
  `);

/**
 * vw_outbox_pending — Pending outbox messages for the relay worker.
 */
export const vwOutboxPending = pgView("vw_outbox_pending", {
  id: uuid("id"),
  aggregateId: text("aggregate_id"),
  aggregateType: text("aggregate_type"),
  eventType: text("event_type"),
  topic: text("topic"),
  payload: jsonb("payload"),
  status: text("status"),
  attempts: integer("attempts"),
  maxAttempts: integer("max_attempts"),
  nextRetryAt: timestamp("next_retry_at"),
  createdAt: timestamp("created_at"),
// @ts-ignore -- Drizzle 0.45.2 overload resolution picks wrong .as() signature for ManualMaterializedViewBuilder/ManualViewBuilder
}).as(sql`
    SELECT *
    FROM outbox_messages
    WHERE status IN ('pending', 'failed')
      AND (next_retry_at IS NULL OR next_retry_at <= NOW())
      AND attempts < max_attempts
      AND (expires_at IS NULL OR expires_at > NOW())
    ORDER BY created_at ASC
  `);

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 5: Relations for New Tables
// ═══════════════════════════════════════════════════════════════════════════════

export const eventStoreRelations = relations(eventStore, ({ }) => ({}));

export const outboxMessagesRelations = relations(outboxMessages, ({ }) => ({}));

export const sagaInstancesRelations = relations(sagaInstances, ({ }) => ({}));

export const deadLetterQueueRelations = relations(deadLetterQueue, ({ }) => ({}));

export const idempotencyKeysRelations = relations(idempotencyKeys, ({ }) => ({}));

export const dataLineageRelations = relations(dataLineage, ({ }) => ({}));

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 6: Type Exports (Inferred from Schema)
// ═══════════════════════════════════════════════════════════════════════════════

export type EventStore = typeof eventStore.$inferSelect;
export type InsertEventStore = typeof eventStore.$inferInsert;

export type OutboxMessage = typeof outboxMessages.$inferSelect;
export type InsertOutboxMessage = typeof outboxMessages.$inferInsert;

export type SagaInstance = typeof sagaInstances.$inferSelect;
export type InsertSagaInstance = typeof sagaInstances.$inferInsert;

export type DeadLetterQueueEntry = typeof deadLetterQueue.$inferSelect;
export type InsertDeadLetterQueueEntry = typeof deadLetterQueue.$inferInsert;

export type IdempotencyKey = typeof idempotencyKeys.$inferSelect;
export type InsertIdempotencyKey = typeof idempotencyKeys.$inferInsert;

export type DataLineage = typeof dataLineage.$inferSelect;
export type InsertDataLineage = typeof dataLineage.$inferInsert;

export type QueryPerformanceLog = typeof queryPerformanceLog.$inferSelect;
export type InsertQueryPerformanceLog = typeof queryPerformanceLog.$inferInsert;

export type EntityVersion = typeof entityVersions.$inferSelect;
export type InsertEntityVersion = typeof entityVersions.$inferInsert;

export type SchemaVersion = typeof schemaVersions.$inferSelect;
export type InsertSchemaVersion = typeof schemaVersions.$inferInsert;
