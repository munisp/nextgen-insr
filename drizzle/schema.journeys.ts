/**
 * Journey Execution Tracking Schema
 * Tracks all 20 Temporal journey executions for history, audit, and analytics
 */
import { pgTable, serial, text, integer, boolean, timestamp, jsonb, index } from "drizzle-orm/pg-core";

export const journeyExecutions = pgTable(
  "journey_executions",
  {
    id: serial("id").primaryKey(),
    journeyId: text("journey_id").notNull(),
    journeyName: text("journey_name").notNull(),
    workflowId: text("workflow_id").notNull().unique(),
    runId: text("run_id"),
    triggeredBy: integer("triggered_by"),
    inputSnapshot: jsonb("input_snapshot"),
    status: text("status").notNull().default("running"),
    currentStep: text("current_step").default("initializing"),
    resultSnapshot: jsonb("result_snapshot"),
    errorMessage: text("error_message"),
    startedAt: timestamp("started_at", { withTimezone: true }).defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    durationMs: integer("duration_ms"),
    idempotencyKey: text("idempotency_key").unique(),
    scheduled: boolean("scheduled").notNull().default(false),
    scheduleId: text("schedule_id"),
    metadata: jsonb("metadata").default({}),
  },
  t => ({
    je_journey_id_idx: index("je_journey_id_idx").on(t.journeyId),
    je_status_idx: index("je_status_idx").on(t.status),
    je_triggered_by_idx: index("je_triggered_by_idx").on(t.triggeredBy),
    je_started_at_idx: index("je_started_at_idx").on(t.startedAt),
    je_workflow_id_idx: index("je_workflow_id_idx").on(t.workflowId),
  })
);

export const journeyStepEvents = pgTable(
  "journey_step_events",
  {
    id: serial("id").primaryKey(),
    executionId: integer("execution_id").notNull(),
    stepName: text("step_name").notNull(),
    status: text("status").notNull(),
    service: text("service"),
    durationMs: integer("duration_ms"),
    errorMessage: text("error_message"),
    metadata: jsonb("metadata").default({}),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).defaultNow(),
  },
  t => ({
    jse_execution_id_idx: index("jse_execution_id_idx").on(t.executionId),
    jse_recorded_at_idx: index("jse_recorded_at_idx").on(t.recordedAt),
  })
);

export const journeySchedules = pgTable(
  "journey_schedules",
  {
    id: serial("id").primaryKey(),
    journeyId: text("journey_id").notNull(),
    scheduleId: text("schedule_id").notNull().unique(),
    cronExpression: text("cron_expression"),
    intervalMs: integer("interval_ms"),
    inputTemplate: jsonb("input_template").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    createdBy: integer("created_by"),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    nextRunAt: timestamp("next_run_at", { withTimezone: true }),
    runCount: integer("run_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  t => ({
    js_journey_id_idx: index("js_journey_id_idx").on(t.journeyId),
    js_enabled_idx: index("js_enabled_idx").on(t.enabled),
  })
);
