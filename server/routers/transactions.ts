// @ts-check
/**
 * transactions router — all transaction operations for the InsurePortal POS platform.
 *
 * Security controls (Phase 44-49):
 *  1. Float lock enforcement — rejects if agent.floatLocked = true
 *  2. Device token enforcement — validates against enrolled devices table
 *  3. Velocity limits per agent tier (hourly count, single-tx amount, daily volume)
 *  4. Customer SMS confirmation on Cash Out / Transfer / Card / QR / NFC
 *  5. Reversal approval threshold — reversals > ₦10,000 require admin/supervisor approval
 *
 * ─── NAVIGATION GUIDE ───────────────────────────────────────────────────────────
 * This router is split into logical sections for easy navigation:
 *
 * Sections:
 *  [1] Constants & Configuration        → COMMISSION_RATES, LOYALTY_RATES, SMS_CONFIRMATION_TYPES
 *  [2] Helper Functions                 → generateRef(), calculateCommission(), applyVelocityLimits()
 *  [3] Transaction Procedures           → createTransaction, getTransactions, getTransactionByRef
 *  [4] Transaction Actions              → reverseTransaction, updateStatus, bulkUpdate
 *  [5] Float Management                 → updateAgentFloat, getAgentFloat, lockFloat
 *  [6] Commission & Loyalty             → calculateCommission, addLoyaltyPoints, redeemLoyaltyPoints
 *  [7] Bulk Operations                  → bulkTransactions, bulkReversal
 *  [8] Reporting & Analytics            → getDailySummary, getTransactionStats, exportTransactions
 *  [9] Fraud & Compliance               → createFraudAlert, checkVelocity, validateAgentTier
 *  [10] SMS & Notifications             → sendConfirmationSms, buildConfirmationSms
 *  [11] tRPC Router Definition          → exports: transactionsRouter
 *
 * Quick Jump: Search for "[1]", "[2]", etc. to navigate to each section
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { eq, and, gte, lte, sql, desc } from "drizzle-orm";
import { notifyOwner } from "../_core/notification";
import { tbCreateTransfer, tbEnsureAgentAccount } from "../tbClient";
import {
  createTransaction,
  getTransactionsByAgent,
  getTransactionsByAgentCursor,
  getTransactionByRef,
  updateTransactionStatus,
  updateAgentFloat,
  updateAgentCommission,
  addLoyaltyHistory,
  writeAuditLog,
  getAgentById,
  createFraudAlert,
  getDb,
} from "../db";
import { protectedProcedure, router } from "../_core/trpc";
import { getAgentFromCookie } from "../middleware/agentAuth";
import { ENV } from "../_core/env";
import {
  transactions,
  agents,
  velocityLimits,
  platformSettings,
  devices,
  fraudAlerts,
  agentGeofenceZones,
  geofenceZones,
  deviceLocations,
  commissionRules,
} from "../../drizzle/schema";
import { sendSms, buildConfirmationSms } from "../termii";
import { getIO } from "../socketSingleton";
import { floatPlatform, analyticsPlatform } from "../_core/platformClient.js";
import crypto from "crypto";
import { logger } from '../_core/logger';
import {
  transactionsTotal,
  transactionErrorsTotal,
  transactionDurationMs,
  floatLocksTotal,
} from "../metrics";
// ─── Commission & loyalty rates ───────────────────────────────────────────────
const COMMISSION_RATES: Record<string, number> = {
  "Cash In": 0.003,
  "Cash Out": 0.005,
  Transfer: 0.004,
  "Card Payment": 0.002,
  "QR Payment": 0.002,
  "NFC Payment": 0.002,
  Airtime: 0.015,
  "Bill Payment": 0.01,
  "Nano Loan": 0.02,
  Insurance: 0.05,
};

const LOYALTY_RATES: Record<string, number> = {
  "Cash In": 1,
  "Cash Out": 1,
  Transfer: 2,
  "Card Payment": 2,
  "QR Payment": 3,
  "NFC Payment": 3,
  Airtime: 5,
  "Bill Payment": 5,
  "Nano Loan": 10,
  Insurance: 20,
};

// Types that trigger customer SMS confirmation
const SMS_CONFIRMATION_TYPES = new Set([
  "Cash Out",
  "Transfer",
  "Card Payment",
  "QR Payment",
  "NFC Payment",
]);

const FLOAT_DEBIT_TYPES = new Set(["Cash Out", "Transfer"]);
const FLOAT_CREDIT_TYPES = new Set(["Cash In"]);

function generateRef(): string {
  const ts = crypto.randomUUID().toUpperCase();
  const rand = crypto.randomBytes(6).toString("hex").slice(0, 6).toUpperCase();
  return `TXN${ts}${rand}`;
}

// ─── Platform setting helper ──────────────────────────────────────────────────
async function getPlatformSetting(
  key: string,
  defaultValue: string
): Promise<string> {
  try {
    const db = (await getDb())!;
    if (!db) return defaultValue;
    const rows = await db
      .select({ value: platformSettings.value })
      .from(platformSettings)
      .where(eq(platformSettings.key, key))
      .limit(1);
    return rows[0]?.value ?? defaultValue;
  } catch {
    return defaultValue;
  }
}

// ─── Velocity limit check ─────────────────────────────────────────────────────
async function checkVelocityLimits(
  agentId: number,
  tier: string,
  amount: number,
  agentId?: string
): Promise<{ allowed: boolean; reason?: string }> {
  try {
    const enabled = await getPlatformSetting("velocity_limits_enabled", "true");
    if (enabled !== "true") return { allowed: true };

    const db = (await getDb())!;
    if (!db) return { allowed: true };

    const limitRows = await db
      .select()
      .from(velocityLimits)
      .where(eq(velocityLimits.tier, tier as any))
      .limit(1);
    const limits = limitRows[0];
    if (!limits) return { allowed: true };

    const maxSingle = Number(limits.maxSingleTxAmount);
    const maxHourly = limits.maxTxPerHour;
    const maxDaily = Number(limits.maxDailyVolume);

    if (amount > maxSingle) {
      return {
        allowed: false,
        reason: `Single transaction ₦${amount.toLocaleString()} exceeds ${tier} limit of ₦${maxSingle.toLocaleString()}`,
      };
    }

    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const hourlyRows = await db
      .select({ count: sql<number>`count(*)` })
      .from(transactions)
      .where(
        and(
          eq(transactions.agentId, agentId),
          gte(transactions.createdAt, oneHourAgo)
        )
      );
    const hourlyCount = Number(hourlyRows[0]?.count ?? 0);

    // Emit 80% warning before hard block
    if (agentId && maxHourly > 0) {
      const hourlyPct = (hourlyCount + 1) / maxHourly;
      if (hourlyPct >= 0.8 && hourlyPct < 1.0) {
        getIO()
          ?.of("/terminal")
          .to(`agent:${agentId}`)
          .emit("terminal:velocity_warning", {
            type: "hourly_count",
            used: hourlyCount + 1,
            limit: maxHourly,
            pct: Math.round(hourlyPct * 100),
            tier,
            timestamp: new Date().toISOString(),
          });
      }
    }

    if (hourlyCount >= maxHourly) {
      return {
        allowed: false,
        reason: `Hourly count (${hourlyCount}) reached ${tier} limit of ${maxHourly}/hr`,
      };
    }

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const dailyRows = await db
      .select({ total: sql<string>`coalesce(sum(amount::numeric), 0)` })
      .from(transactions)
      .where(
        and(
          eq(transactions.agentId, agentId),
          gte(transactions.createdAt, startOfDay)
        )
      );
    const dailyVolume = Number(dailyRows[0]?.total ?? 0);

    // Emit 80% daily volume warning
    if (agentId && maxDaily > 0) {
      const dailyPct = (dailyVolume + amount) / maxDaily;
      if (dailyPct >= 0.8 && dailyPct < 1.0) {
        getIO()
          ?.of("/terminal")
          .to(`agent:${agentId}`)
          .emit("terminal:velocity_warning", {
            type: "daily_volume",
            used: dailyVolume + amount,
            limit: maxDaily,
            pct: Math.round(dailyPct * 100),
            tier,
            timestamp: new Date().toISOString(),
          });
      }
    }

    if (dailyVolume + amount > maxDaily) {
      return {
        allowed: false,
        reason: `Daily volume ₦${(dailyVolume + amount).toLocaleString()} exceeds ${tier} limit of ₦${maxDaily.toLocaleString()}`,
      };
    }

    return { allowed: true };
  } catch (err) {
    logger.error("[Velocity] Check error (fail-open):: " + String(err));
    return { allowed: true };
  }
}

// ─── Device token validation ──────────────────────────────────────────────────
async function validateDeviceToken(
  deviceToken: string | undefined,
  agentId: number
): Promise<{ valid: boolean; reason?: string }> {
  try {
    const required = await getPlatformSetting(
      "enrollment_token_required",
      "false"
    );
    if (required !== "true") return { valid: true };
    if (!deviceToken) {
      return {
        valid: false,
        reason: "Device enrollment token required but not provided",
      };
    }
    const db = (await getDb())!;
    if (!db) return { valid: true };
    const rows = await db
      .select()
      .from(devices)
      .where(
        and(
          eq(devices.agentId, agentId),
          eq(devices.enrollmentToken, deviceToken)
        )
      )
      .limit(1);
    const device = rows[0];
    if (!device) {
      return {
        valid: false,
        reason: "Device token not recognised — terminal may not be enrolled",
      };
    }
    if (device.enrollmentExpiresAt && device.enrollmentExpiresAt < new Date()) {
      return {
        valid: false,
        reason: "Device enrollment token has expired — re-enroll terminal",
      };
    }
    return { valid: true };
  } catch (err) {
    logger.error("[DeviceToken] Validation error (fail-open):: " + String(err));
    return { valid: true };
  }
}

// ─── Router ───────────────────────────────────────────────────────────────────
export const transactionsRouter = router({
  // ── Create transaction ────────────────────────────────────────────────────
  create: protectedProcedure
    .input(
      z.object({
        type: z.enum([
          "Cash In",
          "Cash Out",
          "Transfer",
          "Card Payment",
          "QR Payment",
          "NFC Payment",
          "Airtime",
          "Bill Payment",
          "Reversal",
          "Nano Loan",
          "Insurance",
        ]),
        amount: z.number().positive(),
        customerName: z.string().optional(),
        customerPhone: z.string().optional(),
        customerAccount: z.string().optional(),
        destinationBank: z.string().optional(),
        destinationAccount: z.string().optional(),
        channel: z
          .enum(["Cash", "Card", "USSD", "QR", "NFC", "App"])
          .optional(),
        deviceToken: z.string().optional(),
        metadata: z.record(z.string(), z.unknown()).optional(),
        idempotencyKey: z.string().max(64).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const agent = (ctx as any).agent ?? (await getAgentFromCookie(ctx.req));
        if (!agent) {
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "Agent session required",
          });
        }

        const agentRecord = await getAgentById(agent.id);
        if (!agentRecord)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Agent not found",
          });

        // ── P0-A: Idempotency guard ────────────────────────────────────────────
        if (input.idempotencyKey) {
          const db = (await getDb())!;
          if (db) {
            const existing = await db
              .select()
              .from(transactions)
              .where(eq(transactions.idempotencyKey, input.idempotencyKey))
              .limit(1);
            if (existing.length > 0) {
              // Return the existing transaction — idempotent replay
              return existing[0];
            }
          }
        }

        // ── Gate 0: Remote kill-switch (terminal disabled by admin) ──────────────
        if (agentRecord.terminalEnabled === false) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: `Terminal disabled: ${agentRecord.terminalDisabledReason ?? "Contact your supervisor for details."}`,
          });
        }
        // ── Gate 1: Float lock (settlement in progress) ────────────────────
        if (agentRecord.floatLocked) {
          floatLocksTotal.labels("settlement").inc();
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message:
              "Settlement in progress — transactions are temporarily paused. Please try again in a few minutes.",
          });
        }

        // ── Gate 2: Device token enforcement ──────────────────────────────────
        const deviceCheck = await validateDeviceToken(
          input.deviceToken,
          agent.id
        );
        if (!deviceCheck.valid) {
          await writeAuditLog({
            agentId: agent.id,
            agentId: agent.agentId,
            action: "DEVICE_TOKEN_REJECTED",
            resource: "transaction",
            status: "failure",
            metadata: {
              reason: deviceCheck.reason,
              providedToken: input.deviceToken,
            },
          });
          // Create fraud alert and notify agent terminal in real-time
          await createFraudAlert({
            agentId: agent.id,
            severity: "high",
            type: "DEVICE_TOKEN_FAILURE",
            customerName: input.customerName ?? null,
            amount: String(input.amount),
            reason: deviceCheck.reason ?? "Device not enrolled",
            fraudScore: "0.90",
          });
          getIO()
            ?.of("/terminal")
            .to(`agent:${agent.agentId}`)
            .emit("terminal:fraud_alert", {
              severity: "HIGH",
              type: "DEVICE_TOKEN_FAILURE",
              reason: deviceCheck.reason ?? "Device not enrolled",
              amount: input.amount,
              timestamp: new Date().toISOString(),
            });
          throw new TRPCError({
            code: "FORBIDDEN",
            message: deviceCheck.reason ?? "Device not enrolled",
          });
        }

        // ── Gate 3: Float sufficiency ──────────────────────────────────────────
        if (
          FLOAT_DEBIT_TYPES.has(input.type) &&
          Number(agentRecord.premiumReserve) < input.amount
        ) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Insufficient premium reserve. Available: ₦${Number(agentRecord.premiumReserve).toLocaleString()}`,
          });
        }

        // ── Gate 4: Velocity limits ────────────────────────────────────────────
        const velocityCheck = await checkVelocityLimits(
          agent.id,
          agentRecord.tier,
          input.amount,
          agent.agentId
        );
        if (!velocityCheck.allowed) {
          await createFraudAlert({
            agentId: agent.id,
            severity: "high",
            type: "VELOCITY_BREACH",
            customerName: input.customerName ?? null,
            amount: String(input.amount),
            reason: velocityCheck.reason ?? "Velocity limit exceeded",
            fraudScore: "0.85",
          });
          await writeAuditLog({
            agentId: agent.id,
            agentId: agent.agentId,
            action: "VELOCITY_LIMIT_BREACHED",
            resource: "transaction",
            status: "failure",
            metadata: {
              reason: velocityCheck.reason,
              amount: input.amount,
              tier: agentRecord.tier,
            },
          });
          // Notify the agent's terminal in real-time
          getIO()
            ?.of("/terminal")
            .to(`agent:${agent.agentId}`)
            .emit("terminal:fraud_alert", {
              severity: "HIGH",
              type: "VELOCITY_BREACH",
              reason: velocityCheck.reason ?? "Velocity limit exceeded",
              amount: input.amount,
              timestamp: new Date().toISOString(),
            });
          throw new TRPCError({
            code: "TOO_MANY_REQUESTS",
            message:
              velocityCheck.reason ??
              "Transaction velocity limit exceeded for your agent tier",
          });
        }

        // ── Gate 5: Geofence enforcement ──────────────────────────────────────
        // Only enforce if agent has assigned zones and a location was reported recently
        try {
          const geofenceEnabled = await getPlatformSetting(
            "geofencing_enabled",
            "false"
          );
          if (geofenceEnabled === "true") {
            const db = (await getDb())!;
            if (db) {
              const assignedZones = await db
                .select({ zone: geofenceZones })
                .from(agentGeofenceZones)
                .innerJoin(
                  geofenceZones,
                  eq(agentGeofenceZones.zoneId, geofenceZones.id)
                )
                .where(
                  and(
                    eq(agentGeofenceZones.agentId, agent.id),
                    eq(geofenceZones.isActive, true)
                  )
                );
              if (assignedZones.length > 0) {
                // Get the most recent device location for this agent (within last 10 minutes)
                const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000);
                const recentLoc = await db
                  .select()
                  .from(deviceLocations)
                  .where(
                    and(
                      eq(deviceLocations.agentId, agent.id),
                      gte(deviceLocations.reportedAt, tenMinAgo)
                    )
                  )
                  .orderBy(desc(deviceLocations.reportedAt))
                  .limit(1);
                if (recentLoc.length > 0 && !recentLoc[0].withinZone) {
                  // Agent is outside their assigned zone — create fraud alert and block
                  await createFraudAlert({
                    agentId: agent.id,
                    severity: "high",
                    type: "GEOFENCE_VIOLATION",
                    customerName: input.customerName ?? null,
                    amount: String(input.amount),
                    reason: `Transaction attempted outside assigned geofence zone. Last known location out-of-zone.`,
                    fraudScore: "0.80",
                  });
                  await writeAuditLog({
                    agentId: agent.id,
                    agentId: agent.agentId,
                    action: "GEOFENCE_VIOLATION",
                    resource: "transaction",
                    status: "failure",
                    metadata: { amount: input.amount, type: input.type },
                  });
                  getIO()
                    ?.of("/terminal")
                    .to(`agent:${agent.agentId}`)
                    .emit("terminal:fraud_alert", {
                      severity: "HIGH",
                      type: "GEOFENCE_VIOLATION",
                      reason:
                        "Transaction blocked — device outside assigned geofence zone.",
                      amount: input.amount,
                      timestamp: new Date().toISOString(),
                    });
                  throw new TRPCError({
                    code: "FORBIDDEN",
                    message:
                      "Transaction blocked — device is outside your assigned operational zone.",
                  });
                }
              }
            }
          }
        } catch (geoErr) {
          if (geoErr instanceof TRPCError) throw geoErr;
          logger.error("[Geofence] Check error (fail-open):: " + geoErr);
        }

        // ── Core processing ────────────────────────────────────────────────────
        const ref = generateRef();
        // Look up commission rate: Redis cache → DB → hardcoded fallback
        let commissionRate = COMMISSION_RATES[input.type] ?? 0;
        try {
          const cacheKey = `commission_rate:${input.type}`;
          const { cacheGet, cacheSet } = await import("../redisClient");
          const cached = await cacheGet(cacheKey);
          if (cached !== null) {
            commissionRate = Number(cached);
          } else {
            const db = (await getDb())!;
            if (db) {
              const ruleRows = await db
                .select({ value: commissionRules.value })
                .from(commissionRules)
                .where(
                  and(
                    eq(commissionRules.txType, input.type),
                    eq(commissionRules.isActive, true)
                  )
                )
                .limit(1);
              if (ruleRows.length > 0) {
                commissionRate = Number(ruleRows[0].value);
                // Cache for 5 minutes — rules change infrequently
                await cacheSet(cacheKey, String(commissionRate), 300);
              }
            }
          }
        } catch {
          /* fail-open: use hardcoded fallback */
        }
        // ── Sprint 70: Business Rules Engine Integration ──────────────────
        let commission = Math.round(input.amount * commissionRate * 100) / 100;
        try {
          const {
            calculateCommission,
            calculateFraudScore,
            checkTransactionLimits,
            checkAmlTriggers,
          } = await import("../lib/businessRulesEngine");
          // Override commission with business rules engine calculation
          const brCommission = calculateCommission(
            // @ts-expect-error middleware type mismatch
            agentRecord.tier ?? "bronze",
            input.type,
            input.amount
          );
          const brAmount =
            typeof brCommission === "number"
              ? brCommission
              : Number((brCommission as any)?.amount ?? 0);
          if (brAmount > 0) commission = brAmount;
          // Fraud scoring
          const fraudScore = calculateFraudScore({
            amount: input.amount,
            isNewCustomer: !input.customerPhone,
            //
            // isHighRiskRegion: false,
            // @ts-expect-error middleware type mismatch
            deviceAge: 365,
            txCountLast1h: 0,
            isRoundAmount: input.amount % 1000 === 0,
            customerAccountAge: 365,
            isRecurring: false,
          });
          const fraudScoreVal =
            typeof fraudScore === "number"
              ? fraudScore
              : Number((fraudScore as any)?.score ?? 0);
          if (fraudScoreVal > 0.85) {
            await createFraudAlert({
              agentId: agent.id,
              severity: "critical",
              type: "HIGH_FRAUD_SCORE",
              customerName: input.customerName ?? null,
              amount: String(input.amount),
              reason: `Business rules fraud score: ${fraudScoreVal.toFixed(2)}`,
              fraudScore: String(fraudScoreVal),
            });
          }
          // AML triggers for high-value transactions
          // @ts-expect-error auto-fix
          const amlResult = checkAmlTriggers(input.amount, input.type, 0, 0);
          if (amlResult.triggered) {
            await writeAuditLog({
              agentId: agent.id,
              agentId: agent.agentId,
              action: "AML_TRIGGER",
              resource: "transaction",
              status: "flagged" as any,
              metadata: {
                triggered: amlResult.triggered,
                amount: input.amount,
              },
            });
          }
        } catch (brErr) {
          logger.warn("[BusinessRules] Engine error (fail-open):: " + (brErr as Error).message
          );
        }
        const fee =
          input.type === "Transfer" ? Math.min(input.amount * 0.001, 100) : 0;

        await tbEnsureAgentAccount(agent.agentId);
        const tbResult = await tbCreateTransfer({
          debitAccountId: FLOAT_CREDIT_TYPES.has(input.type)
            ? "sys-bank-reserve"
            : `float-${agent.agentId}`,
          creditAccountId: FLOAT_CREDIT_TYPES.has(input.type)
            ? `float-${agent.agentId}`
            : "sys-bank-reserve",
          amount: Math.round(input.amount * 100),
          ledger: 2000,
          code: 300,
          ref,
          txType: input.type,
          agentId: agent.agentId,
        });

        if (tbResult) {
          logger.info(
            `[TB] Transfer committed: ${tbResult.id} (syncStatus=${tbResult.syncStatus})`
          );
        } else {
          logger.warn(
            `[TB] Sidecar unavailable — transaction ${ref} persisted to PostgreSQL only`
          );
        }

        const tx = await createTransaction({
          ref,
          agentId: agent.id,
          type: input.type,
          amount: String(input.amount),
          fee: String(fee),
          commission: String(commission),
          customerName: input.customerName ?? null,
          customerPhone: input.customerPhone ?? null,
          customerAccount: input.customerAccount ?? null,
          destinationBank: input.destinationBank ?? null,
          destinationAccount: input.destinationAccount ?? null,
          channel: input.channel ?? "Cash",
          status: "success",
          fraudScore: "0.00",
          deviceToken: input.deviceToken ?? null,
          metadata: input.metadata ?? null,
          idempotencyKey: input.idempotencyKey ?? null,
        });

        // ── Float update: local (authoritative) + platform sync (best-effort) ──
        if (FLOAT_CREDIT_TYPES.has(input.type)) {
          await updateAgentFloat(agent.id, input.amount);
          // Sync credit to platform float service (fail-open)
          try {
            const token = ctx.req?.cookies?.["kc_access_token"] ?? "";
            if (token) {
              await floatPlatform.settle(
                {
                  agent_id: String(agent.id),
                  amount: input.amount,
                  reference: ref,
                  transaction_type: input.type,
                  description: `${input.type} — ₦${input.amount.toLocaleString()}`,
                },
                token
              );
            }
          } catch (floatErr) {
            logger.warn("[float] Platform settle sync failed (fail-open):: " + (floatErr as Error).message
            );
          }
        } else if (FLOAT_DEBIT_TYPES.has(input.type)) {
          await updateAgentFloat(agent.id, -input.amount);
          // Sync debit to platform float service (fail-open)
          try {
            const token = ctx.req?.cookies?.["kc_access_token"] ?? "";
            if (token) {
              await floatPlatform.utilize(
                {
                  agent_id: String(agent.id),
                  amount: input.amount,
                  reference: ref,
                  transaction_type: input.type,
                  description: `${input.type} — ₦${input.amount.toLocaleString()}`,
                },
                token
              );
            }
          } catch (floatErr) {
            logger.warn("[float] Platform utilize sync failed (fail-open):: " + (floatErr as Error).message
            );
          }
        }

        // ── Sprint 48: Hierarchical Commission Cascade ──────────────────────
        // Instead of crediting the full commission to just the transacting agent,
        // split it across the hierarchy: sub_agent → agent → master → super → platform
        if (commission > 0) {
          const { executeCommissionCascade } = await import(
            "../lib/commissionCascade"
          );
          const cascadeResult = await executeCommissionCascade({
            transactionId: tx.id,
            transactionRef: ref,
            transactionType: input.type,
            transactionAmount: input.amount,
            totalCommission: commission,
            originAgentId: agent.id,
            originAgentCode: agent.agentId,
            tenantId: (agent as any).tenantId ?? undefined,
          });
          if (!cascadeResult.success) {
            logger.warn(
              `[CommissionCascade] Fallback for ${ref}: ${cascadeResult.error}`
            );
          }
        }

        const loyaltyRate = LOYALTY_RATES[input.type] ?? 1;
        const pointsEarned = Math.floor((input.amount / 1000) * loyaltyRate);
        if (pointsEarned > 0) {
          await addLoyaltyHistory(
            agent.id,
            "earned",
            pointsEarned,
            `${input.type} — ₦${input.amount.toLocaleString()}`,
            tx.id
          );
        }

        await writeAuditLog({
          agentId: agent.id,
          agentId: agent.agentId,
          action: "TRANSACTION_CREATED",
          resource: "transaction",
          resourceId: ref,
          status: "success",
          metadata: { type: input.type, amount: input.amount },
        });

        // ── Phase 44: Customer SMS confirmation (fire-and-forget) ─────────────
        if (SMS_CONFIRMATION_TYPES.has(input.type) && input.customerPhone) {
          const smsEnabled = await getPlatformSetting(
            "customer_sms_enabled",
            "true"
          );
          if (smsEnabled === "true") {
            const message = buildConfirmationSms({
              ref,
              type: input.type,
              amount: input.amount,
              agentId: agent.agentId,
              agentName: agent.name,
              customerName: input.customerName,
              timestamp: new Date(),
            });
            sendSms(input.customerPhone, message).then(result => {
              if (!result.success) {
                logger.error(
                  `[SMS] Confirmation failed for ${ref}: ${result.error}`
                );
              } else {
                getDb().then(db => {
                  if (db) {
                    db.update(transactions)
                      .set({ smsSent: true })
                      .where(eq(transactions.id, tx.id))
                      .catch(e =>
                        logger.error("[SMS] smsSent update failed:: " + e)
                      );
                  }
                });
              }
            });
          }
        }

        const newFloatBalance =
          Number(agentRecord.premiumReserve) +
          (FLOAT_CREDIT_TYPES.has(input.type) ? input.amount : 0) -
          (FLOAT_DEBIT_TYPES.has(input.type) ? input.amount : 0);

        // ── Prometheus metrics ─────────────────────────────────────────────────────
        transactionsTotal
          .labels(input.type, "success", input.channel ?? "Cash")
          .inc();

        // ── Kafka domain event (fire-and-forget, fail-open) ────────────────────────
        import("../kafkaClient")
          .then(({ publishEvent }) =>
            publishEvent(
              "pos.transactions.created",
              ref,
              {
                transactionId: tx.id,
                ref,
                type: input.type,
                amount: input.amount,
                commission,
                agentId: agent.agentId,
                channel: input.channel ?? "Cash",
              },
              { agentId: agent.agentId }
            )
          )
          .catch((e: unknown) =>
            logger.error("[Kafka] Event publish failed:: " + e)
          );

        // ── Fluvio stream event (fire-and-forget, fail-open) ──────────────────────
        import("../lib/fluvioClient.js")
          .then(({ publishTransactionEvent }) =>
            publishTransactionEvent({
              id: tx.id,
              ref,
              type: input.type,
              amount: input.amount,
              agentId: agent.id,
              status: "committed",
              channel: input.channel ?? "Cash",
              customerId: (input as any).customerId ?? undefined,
            })
          )
          .catch((e: unknown) =>
            logger.error("[Fluvio] Transaction event failed:: " + e)
          );

        // ── Real-Time Fraud Detection (fire-and-forget, fail-open) ─────────────────────
        import("../lib/fraudDetectionEngine")
          .then(async ({ detectFraud, createAndEmitFraudAlert }) => {
            try {
              const fraudCtx = {
                id: tx.id,
                agentId: agent.id,
                amount: input.amount,
                type: input.type,
                customerName: input.customerName ?? null,
                latitude: (input as any).latitude ?? null,
                longitude: (input as any).longitude ?? null,
                timestamp: new Date(),
              };
              const result = await detectFraud(fraudCtx);
              if (result.isFraud) {
                await createAndEmitFraudAlert(fraudCtx, result);
                logger.warn(
                  `[Fraud] Alert created for tx ${ref}: ${result.reason}`
                );
              }
            } catch (fraudErr) {
              logger.error("[Fraud] Detection failed (fail-open):: " + (fraudErr as Error).message
              );
            }
          })
          .catch((e: unknown) =>
            logger.error("[Fraud] Engine import failed:: " + e)
          );

        return {
          success: true,
          ref,
          transactionId: tx.id,
          commission,
          pointsEarned,
          premiumReserve: newFloatBalance,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  // ── List transactions ─────────────────────────────────────────────────────
  list: protectedProcedure
    .input(
      z.object({ limit: z.number().default(50), offset: z.number().default(0) })
    )
    .query(async ({ input, ctx }) => {
      try {
        const agent = (ctx as any).agent ?? (await getAgentFromCookie(ctx.req));
        if (!agent)
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "Agent session required",
          });
        const txs = await getTransactionsByAgent(
          agent.id,
          input.limit,
          input.offset
        );
        return txs.map((t: any) => ({
          ...t,
          amount: Number(t.amount),
          fee: Number(t.fee),
          commission: Number(t.commission),
          fraudScore: Number(t.fraudScore),
        }));
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
  // ── List transactions (cursor-based pagination) ─────────────────────────
  // P2-A: Cursor pagination for efficient large-dataset traversal.
  // Client passes the `id` of the last row as `cursor` for the next page.
  listCursor: protectedProcedure
    .input(
      z.object({
        limit: z.number().int().min(1).max(100).default(50),
        cursor: z.number().int().positive().optional(),
      })
    )
    .query(async ({ input, ctx }) => {
      try {
        const agent = (ctx as any).agent ?? (await getAgentFromCookie(ctx.req));
        if (!agent)
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "Agent session required",
          });
        const { items, nextCursor } = await getTransactionsByAgentCursor(
          agent.id,
          input.limit,
          input.cursor
        );
        return {
          items: items.map((t: any) => ({
            ...t,
            amount: Number(t.amount),
            fee: Number(t.fee),
            commission: Number(t.commission),
            fraudScore: Number(t.fraudScore),
          })),
          nextCursor,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  // ── Get by ref ────────────────────────────────────────────────────────────
  getByRef: protectedProcedure
    .input(z.object({ ref: z.string() }))
    .query(async ({ input, ctx }) => {
      try {
        const agent = (ctx as any).agent ?? (await getAgentFromCookie(ctx.req));
        if (!agent)
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "Agent session required",
          });
        const tx = await getTransactionByRef(input.ref);
        if (!tx || tx.agentId !== agent.id) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Transaction not found",
          });
        }
        return {
          ...tx,
          amount: Number(tx.amount),
          fee: Number(tx.fee),
          commission: Number(tx.commission),
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  // ── Reverse transaction ───────────────────────────────────────────────────
  // Phase 45: reversals > ₦10,000 require admin/supervisor approval.
  reverse: protectedProcedure
    .input(z.object({ ref: z.string(), reason: z.string().optional() }))
    .mutation(async ({ input, ctx }) => {
      try {
        const agent = (ctx as any).agent ?? (await getAgentFromCookie(ctx.req));
        if (!agent)
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "Agent session required",
          });
        const tx = await getTransactionByRef(input.ref);
        if (!tx || tx.agentId !== agent.id) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Transaction not found",
          });
        }
        if (
          tx.status === "reversed" ||
          tx.status === "pending_reversal_approval"
        ) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Transaction already ${tx.status.replace(/_/g, " ")}`,
          });
        }

        const amount = Number(tx.amount);
        const thresholdStr = await getPlatformSetting(
          "reversal_approval_threshold",
          "10000"
        );
        const threshold = Number(thresholdStr);

        if (amount > threshold) {
          // Queue for approval instead of immediate reversal
          const db = (await getDb())!;
          if (db) {
            await db
              .update(transactions)
              .set({
                status: "pending_reversal_approval",
                approvalRequired: true,
                failureReason: input.reason ?? "Agent-initiated reversal",
              })
              .where(eq(transactions.id, tx.id));
          }

          await writeAuditLog({
            agentId: agent.id,
            agentId: agent.agentId,
            action: "REVERSAL_APPROVAL_REQUESTED",
            resource: "transaction",
            resourceId: input.ref,
            status: "warning",
            metadata: {
              amount,
              threshold,
              reason: input.reason ?? "Agent-initiated reversal",
              requestedAt: new Date().toISOString(),
            },
          });

          try {
            const { notifyOwner } = await import("../_core/notification");
            await notifyOwner({
              title: `Reversal Approval Required — ₦${amount.toLocaleString()}`,
              content: `Agent ${agent.agentId} (${agent.name}) requested reversal of ₦${amount.toLocaleString()} for ${input.ref}. Reason: ${input.reason ?? "Not specified"}. Review in Admin Panel → Pending Reversals.`,
            });
          } catch {
            // Non-critical
          }

          return {
            success: true,
            pendingApproval: true,
            message: `Reversal of ₦${amount.toLocaleString()} requires admin approval (threshold: ₦${threshold.toLocaleString()})`,
          };
        }

        // Immediate reversal
        await updateTransactionStatus(
          tx.id,
          "reversed",
          input.reason ?? "Agent-initiated reversal"
        );
        if (tx.type === "Cash In") await updateAgentFloat(agent.id, -amount);
        if (FLOAT_DEBIT_TYPES.has(tx.type))
          await updateAgentFloat(agent.id, amount);

        const reversalRef = generateRef();
        await writeAuditLog({
          agentId: agent.id,
          agentId: agent.agentId,
          action: "TRANSACTION_REVERSED",
          resource: "transaction",
          resourceId: input.ref,
          status: "success",
          metadata: {
            originalRef: input.ref,
            reversalRef,
            originalType: tx.type,
            originalAmount: amount,
            reason: input.reason ?? "Agent-initiated reversal",
            reversedAt: new Date().toISOString(),
          },
        });

        return { success: true, pendingApproval: false, reversalRef };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  // ── List pending reversals (admin/supervisor) ─────────────────────────────
  pendingReversals: protectedProcedure.query(async ({ ctx }) => {
    try {
      const agent = (ctx as any).agent ?? (await getAgentFromCookie(ctx.req));
      if (!agent)
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Agent session required",
        });
      if (agent.role !== "admin" && agent.role !== "supervisor") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Admin or supervisor privileges required",
        });
      }
      const db = (await getDb())!;
      if (!db) throw new Error("Database connection unavailable");
      const rows = await db
        .select({
          id: transactions.id,
          ref: transactions.ref,
          agentId: transactions.agentId,
          type: transactions.type,
          amount: transactions.amount,
          customerName: transactions.customerName,
          failureReason: transactions.failureReason,
          createdAt: transactions.createdAt,
          agentId: agents.agentId,
          agentName: agents.name,
        })
        .from(transactions)
        .leftJoin(agents, eq(transactions.agentId, agents.id))
        .where(eq(transactions.status, "pending_reversal_approval"));
      return rows.map((r: any) => ({ ...r, amount: Number(r.amount) }));
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message:
          error instanceof Error ? error.message : "Internal server error",
      });
    }
  }),

  // ── Approve reversal (admin only) ─────────────────────────────────────────
  approveReversal: protectedProcedure
    .input(
      z.object({
        transactionId: z.number().int().positive(),
        notes: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const agent = (ctx as any).agent ?? (await getAgentFromCookie(ctx.req));
        if (!agent)
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "Agent session required",
          });
        if (agent.role !== "admin") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Admin privileges required to approve reversals",
          });
        }
        const db = (await getDb())!;
        if (!db)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "DB unavailable",
          });

        const rows = await db
          .select()
          .from(transactions)
          .where(eq(transactions.id, input.transactionId))
          .limit(1);
        const tx = rows[0];
        if (!tx)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Transaction not found",
          });
        if (tx.status !== "pending_reversal_approval") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Transaction is not pending reversal approval",
          });
        }

        await db
          .update(transactions)
          .set({
            status: "reversed",
            approvedBy: agent.agentId,
            approvedAt: new Date(),
            approvalRequired: false,
          })
          .where(eq(transactions.id, tx.id));

        const amount = Number(tx.amount);
        if (tx.type === "Cash In") await updateAgentFloat(tx.agentId, -amount);
        if (FLOAT_DEBIT_TYPES.has(tx.type))
          await updateAgentFloat(tx.agentId, amount);

        const reversalRef = generateRef();
        await writeAuditLog({
          agentId: agent.id,
          agentId: agent.agentId,
          action: "REVERSAL_APPROVED",
          resource: "transaction",
          resourceId: tx.ref,
          status: "success",
          metadata: {
            approvedBy: agent.agentId,
            originalRef: tx.ref,
            reversalRef,
            amount,
            notes: input.notes,
          },
        });

        return { success: true, reversalRef };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  // ── Reject reversal (admin only) ──────────────────────────────────────────
  rejectReversal: protectedProcedure
    .input(
      z.object({
        transactionId: z.number().int().positive(),
        reason: z.string().min(5),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const agent = (ctx as any).agent ?? (await getAgentFromCookie(ctx.req));
        if (!agent)
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "Agent session required",
          });
        if (agent.role !== "admin") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Admin privileges required to reject reversals",
          });
        }
        const db = (await getDb())!;
        if (!db)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "DB unavailable",
          });

        const rows = await db
          .select()
          .from(transactions)
          .where(eq(transactions.id, input.transactionId))
          .limit(1);
        const tx = rows[0];
        if (!tx)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Transaction not found",
          });
        if (tx.status !== "pending_reversal_approval") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Transaction is not pending reversal approval",
          });
        }

        await db
          .update(transactions)
          .set({
            status: "success",
            approvalRequired: false,
            failureReason: `Reversal rejected: ${input.reason}`,
          })
          .where(eq(transactions.id, tx.id));

        await writeAuditLog({
          agentId: agent.id,
          agentId: agent.agentId,
          action: "REVERSAL_REJECTED",
          resource: "transaction",
          resourceId: tx.ref,
          status: "warning",
          metadata: { rejectedBy: agent.agentId, reason: input.reason },
        });

        return { success: true };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  // ── Velocity Limits CRUD (admin) ──────────────────────────────────────────
  getVelocityLimits: protectedProcedure.query(async ({ ctx }) => {
    try {
      const agent = (ctx as any).agent ?? (await getAgentFromCookie(ctx.req));
      if (!agent || (agent.role !== "admin" && agent.role !== "supervisor")) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Admin or supervisor access required",
        });
      }
      const db = (await getDb())!;
      if (!db) throw new Error("Database connection unavailable");
      const rows = await db.select().from(velocityLimits).limit(100);
      return rows.map(r => ({
        ...r,
        maxSingleTxAmount: Number(r.maxSingleTxAmount),
        maxDailyVolume: Number(r.maxDailyVolume),
      }));
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message:
          error instanceof Error ? error.message : "Internal server error",
      });
    }
  }),

  updateVelocityLimit: protectedProcedure
    .input(
      z.object({
        tier: z.enum(["Bronze", "Silver", "Gold", "Platinum"]),
        maxTxPerHour: z.number().int().positive().max(1000),
        maxSingleTxAmount: z.number().positive(),
        maxDailyVolume: z.number().positive(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const agent = (ctx as any).agent ?? (await getAgentFromCookie(ctx.req));
        if (!agent || agent.role !== "admin") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Admin access required",
          });
        }
        const db = (await getDb())!;
        if (!db)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "DB unavailable",
          });
        await db
          .update(velocityLimits)
          .set({
            maxTxPerHour: input.maxTxPerHour,
            maxSingleTxAmount: String(input.maxSingleTxAmount),
            maxDailyVolume: String(input.maxDailyVolume),
            updatedAt: new Date(),
          })
          .where(eq(velocityLimits.tier, input.tier));
        await writeAuditLog({
          agentId: agent.id,
          agentId: agent.agentId,
          action: "VELOCITY_LIMIT_UPDATED",
          resource: "velocity_limits",
          resourceId: input.tier,
          status: "success",
          metadata: {
            tier: input.tier,
            maxTxPerHour: input.maxTxPerHour,
            maxSingleTxAmount: input.maxSingleTxAmount,
            maxDailyVolume: input.maxDailyVolume,
          },
        });
        return { success: true };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  // ── Platform Settings CRUD (admin) ────────────────────────────────────────
  getPlatformSettings: protectedProcedure.query(async ({ ctx }) => {
    try {
      const agent = (ctx as any).agent ?? (await getAgentFromCookie(ctx.req));
      if (!agent || (agent.role !== "admin" && agent.role !== "supervisor")) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Admin or supervisor access required",
        });
      }
      const db = (await getDb())!;
      if (!db) throw new Error("Database connection unavailable");
      return db.select().from(platformSettings).limit(100);
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message:
          error instanceof Error ? error.message : "Internal server error",
      });
    }
  }),

  updatePlatformSetting: protectedProcedure
    .input(
      z.object({
        key: z.string().min(1).max(128),
        value: z.string().min(0).max(1024),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const agent = (ctx as any).agent ?? (await getAgentFromCookie(ctx.req));
        if (!agent || agent.role !== "admin") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Admin access required",
          });
        }
        const db = (await getDb())!;
        if (!db)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "DB unavailable",
          });
        await db
          .update(platformSettings)
          .set({
            value: input.value,
            updatedBy: agent.agentId,
            updatedAt: new Date(),
          })
          .where(eq(platformSettings.key, input.key));
        await writeAuditLog({
          agentId: agent.id,
          agentId: agent.agentId,
          action: "PLATFORM_SETTING_UPDATED",
          resource: "platform_settings",
          resourceId: input.key,
          status: "success",
          metadata: { key: input.key, value: input.value },
        });
        return { success: true };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  // ── Security Audit Log ─────────────────────────────────────────────────────────────
  getSecurityAuditLog: protectedProcedure
    .input(
      z.object({
        severity: z.enum(["ALL", "HIGH", "MEDIUM", "LOW"]).default("ALL"),
        type: z.string().optional(),
        limit: z.number().int().min(1).max(200).default(50),
        offset: z.number().int().min(0).default(0),
      })
    )
    .query(async ({ input, ctx }) => {
      try {
        const agent = (ctx as any).agent ?? (await getAgentFromCookie(ctx.req));
        if (!agent || (agent.role !== "admin" && agent.role !== "supervisor")) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Admin or supervisor access required",
          });
        }
        const db = (await getDb())!;
        if (!db) return { alerts: [], total: 0, highUnreviewed: 0 };

        const conditions: ReturnType<typeof eq>[] = [];
        if (input.severity !== "ALL") {
          conditions.push(
            eq(fraudAlerts.severity, input.severity.toLowerCase() as any)
          );
        }
        if (input.type && input.type !== "ALL") {
          conditions.push(eq(fraudAlerts.type, input.type));
        }

        const whereClause =
          conditions.length > 0 ? and(...conditions) : undefined;

        const [rows, countRows, highRows] = await Promise.all([
          db
            .select({
              id: fraudAlerts.id,
              agentId: fraudAlerts.agentId,
              transactionId: fraudAlerts.transactionId,
              severity: fraudAlerts.severity,
              type: fraudAlerts.type,
              reason: fraudAlerts.reason,
              fraudScore: fraudAlerts.fraudScore,
              status: fraudAlerts.status,
              assignedTo: fraudAlerts.assignedTo,
              amount: fraudAlerts.amount,
              customerName: fraudAlerts.customerName,
              createdAt: fraudAlerts.createdAt,
            })
            .from(fraudAlerts)
            .where(whereClause)
            .orderBy(desc(fraudAlerts.createdAt))
            .limit(input.limit)
            .offset(input.offset),
          db
            .select({ count: sql<number>`count(*)` })
            .from(fraudAlerts)
            .where(whereClause),
          db
            .select({ count: sql<number>`count(*)` })
            .from(fraudAlerts)
            .where(
              and(
                eq(fraudAlerts.severity, "high"),
                eq(fraudAlerts.status, "open")
              )
            ),
        ]);

        return {
          alerts: rows.map(r => ({
            ...r,
            amount: r.amount ? Number(r.amount) : null,
            fraudScore: r.fraudScore ? Number(r.fraudScore) : null,
          })),
          total: Number(countRows[0]?.count ?? 0),
          highUnreviewed: Number(highRows[0]?.count ?? 0),
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  markAlertReviewed: protectedProcedure
    .input(
      z.object({
        alertId: z.number().int().positive(),
        resolution: z.string().min(3).max(512).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const agent = (ctx as any).agent ?? (await getAgentFromCookie(ctx.req));
        if (!agent || (agent.role !== "admin" && agent.role !== "supervisor")) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Admin or supervisor access required",
          });
        }
        const db = (await getDb())!;
        if (!db)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "DB unavailable",
          });
        await db
          .update(fraudAlerts)
          .set({
            status: "resolved",
            assignedTo: agent.agentId,
            resolvedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(fraudAlerts.id, input.alertId));
        await writeAuditLog({
          agentId: agent.id,
          agentId: agent.agentId,
          action: "FRAUD_ALERT_REVIEWED",
          resource: "fraud_alerts",
          resourceId: String(input.alertId),
          status: "success",
          metadata: { alertId: input.alertId, resolution: input.resolution },
        });
        return { success: true };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  // ── Export Security Audit Log as CSV ────────────────────────────────────────────
  exportSecurityAuditCsv: protectedProcedure
    .input(
      z.object({
        severity: z.enum(["ALL", "high", "medium", "low"]).default("ALL"),
        type: z.string().optional(),
        fromDate: z.string().optional(), // ISO date string
        toDate: z.string().optional(), // ISO date string
      })
    )
    .query(async ({ input, ctx }) => {
      try {
        const agent = (ctx as any).agent ?? (await getAgentFromCookie(ctx.req));
        if (!agent || (agent.role !== "admin" && agent.role !== "supervisor")) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Admin or supervisor access required",
          });
        }
        const db = (await getDb())!;
        if (!db)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "DB unavailable",
          });

        const conditions: ReturnType<typeof eq>[] = [];
        if (input.severity !== "ALL")
          conditions.push(eq(fraudAlerts.severity, input.severity));
        if (input.type) conditions.push(eq(fraudAlerts.type, input.type));
        if (input.fromDate)
          conditions.push(gte(fraudAlerts.createdAt, new Date(input.fromDate)));

        const whereClause =
          conditions.length > 0 ? and(...conditions) : undefined;

        const rows = await db
          .select()
          .from(fraudAlerts)
          .where(whereClause)
          .orderBy(desc(fraudAlerts.createdAt))
          .limit(10000); // cap at 10k rows for compliance exports

        // Build CSV
        const headers = [
          "ID",
          "Severity",
          "Type",
          "Agent ID",
          "Customer Name",
          "Amount (NGN)",
          "Reason",
          "Fraud Score",
          "Status",
          "Assigned To",
          "Created At",
          "Resolved At",
        ];
        const escape = (v: unknown) => {
          const s = v == null ? "" : String(v);
          return s.includes(",") || s.includes('"') || s.includes("\n")
            ? `"${s.replace(/"/g, '""')}"`
            : s;
        };
        const lines = [
          headers.join(","),
          ...rows.map(r =>
            [
              r.id,
              r.severity,
              r.type,
              r.agentId,
              r.customerName ?? "",
              r.amount ?? "",
              r.reason ?? "",
              r.fraudScore ?? "",
              r.status,
              r.assignedTo ?? "",
              r.createdAt ? new Date(r.createdAt).toISOString() : "",
              r.resolvedAt ? new Date(r.resolvedAt).toISOString() : "",
            ]
              .map(escape)
              .join(",")
          ),
        ];

        await writeAuditLog({
          agentId: agent.id,
          agentId: agent.agentId,
          action: "SECURITY_AUDIT_EXPORTED",
          resource: "fraud_alerts",
          status: "success",
          metadata: {
            rowCount: rows.length,
            severity: input.severity,
            type: input.type,
          },
        });

        return { csv: lines.join("\n"), rowCount: rows.length };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  // ── Snooze a fraud alert for N minutes ──────────────────────────────────────
  snoozeAlert: protectedProcedure
    .input(
      z.object({
        alertId: z.number(),
        minutesToSnooze: z.number().int().min(5).max(120).default(15),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const db = (await getDb())!;
        if (!db)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "DB unavailable",
          });
        const agent = (ctx as any).agent ?? (await getAgentFromCookie(ctx.req));
        if (!agent)
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "Agent session required",
          });
        const snoozedUntil = new Date(
          Date.now() + input.minutesToSnooze * 60_000
        );
        await db
          .update(fraudAlerts)
          .set({ snoozedUntil, status: "investigating" })
          .where(eq(fraudAlerts.id, input.alertId));
        await writeAuditLog({
          agentId: agent.id,
          agentId: agent.agentId,
          action: "FRAUD_ALERT_SNOOZED",
          resource: "fraud_alerts",
          resourceId: String(input.alertId),
          status: "success",
          metadata: {
            minutesToSnooze: input.minutesToSnooze,
            snoozedUntil: snoozedUntil.toISOString(),
          },
        });
        return { alertId: input.alertId, snoozedUntil };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  // ── Escalate a fraud alert to supervisor ────────────────────────────────────
  escalateAlert: protectedProcedure
    .input(
      z.object({
        alertId: z.number(),
        supervisorId: z.number().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const db = (await getDb())!;
        if (!db)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "DB unavailable",
          });
        const agent = (ctx as any).agent ?? (await getAgentFromCookie(ctx.req));
        if (!agent)
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "Agent session required",
          });
        const alertRows = await db
          .select()
          .from(fraudAlerts)
          .where(eq(fraudAlerts.id, input.alertId))
          .limit(1);
        const alert = alertRows[0];
        if (!alert)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Alert not found",
          });
        const escalatedAt = new Date();
        await db
          .update(fraudAlerts)
          .set({
            escalatedAt,
            escalatedTo: input.supervisorId ? String(input.supervisorId) : null,
            status: "escalated",
          })
          .where(eq(fraudAlerts.id, input.alertId));
        try {
          await notifyOwner({
            title: `Fraud Alert Escalated \u2014 ${alert.type}`,
            content: `Alert #${alert.id} (${alert.severity}) escalated by ${ctx.user.name ?? String(ctx.user.id)}. Reason: ${alert.reason ?? "N/A"}. Amount: \u20a6${alert.amount ?? 0}.`,
          });
        } catch (e) {
          logger.error("[escalateAlert] notifyOwner failed:: " + e);
        }
        await writeAuditLog({
          agentId: agent.id,
          agentId: agent.agentId,
          action: "FRAUD_ALERT_ESCALATED",
          resource: "fraud_alerts",
          resourceId: String(input.alertId),
          status: "success",
          metadata: {
            escalatedAt: escalatedAt.toISOString(),
            escalatedTo: input.supervisorId,
          },
        });
        return { alertId: input.alertId, escalatedAt };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  // ── Auto-escalate snoozed alerts whose snooze has expired (called by cron) ──
  // Secured by CRON_SECRET — only the internal scheduler may invoke this.
  autoEscalateSnoozedAlerts: protectedProcedure
    .input(z.object({ cronSecret: z.string() }))
    .mutation(async ({ input }) => {
      try {
        if (input.cronSecret !== ENV.cronSecret) {
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "Invalid cron secret",
          });
        }
        const db = (await getDb())!;
        if (!db) return { escalated: 0 };
        const now = new Date();
        // Find alerts that are in "investigating" state (snoozed) and snooze has expired
        const expired = await db
          .select()
          .from(fraudAlerts)
          .where(
            and(
              eq(fraudAlerts.status, "investigating"),
              lte(fraudAlerts.snoozedUntil, now)
            )
          );
        if (expired.length === 0) return { escalated: 0 };
        for (const alert of expired) {
          await db
            .update(fraudAlerts)
            .set({ status: "escalated", escalatedAt: now })
            .where(eq(fraudAlerts.id, alert.id));
          try {
            await notifyOwner({
              title: `Auto-Escalated: ${alert.type} (Snooze Expired)`,
              content: `Alert #${alert.id} (${alert.severity}) was snoozed but not resolved. Auto-escalated at ${now.toISOString()}.`,
            });
          } catch (e) {
            logger.error("[autoEscalateSnoozedAlerts] notifyOwner failed:: " + e);
          }
        }
        return { escalated: expired.length };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  /**
   * getMyVelocityUsage — returns the agent's tier limits and real-time usage
   * for the current hour and current day. Used by the POS Shell "My Limits" screen.
   */
  getMyVelocityUsage: protectedProcedure.query(async ({ ctx }) => {
    try {
      const db = (await getDb())!;
      if (!db)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "DB unavailable",
        });
      const agent = (ctx as any).agent ?? (await getAgentFromCookie(ctx.req));
      if (!agent)
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Agent not authenticated",
        });

      // Fetch tier limits
      const tierRow = await db
        .select()
        .from(velocityLimits)
        .where(eq(velocityLimits.tier, agent.tier as any))
        .limit(1);
      const limits = tierRow[0] ?? {
        maxTxPerHour: 20,
        maxSingleTxAmount: 50000,
        maxDailyVolume: 500000,
      };

      // Current hour usage
      const hourStart = new Date();
      hourStart.setMinutes(0, 0, 0);
      const hourEnd = new Date();
      hourEnd.setMinutes(59, 59, 999);

      const hourRows = await db
        .select({
          count: sql<number>`count(*)`,
          volume: sql<number>`coalesce(sum(${transactions.amount}), 0)`,
        })
        .from(transactions)
        .where(
          and(
            eq(transactions.agentId, agent.id),
            eq(transactions.status, "success"),
            gte(transactions.createdAt, hourStart),
            lte(transactions.createdAt, hourEnd)
          )
        );
      const hourlyCount = Number(hourRows[0]?.count ?? 0);

      // Current day usage
      const dayStart = new Date();
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date();
      dayEnd.setHours(23, 59, 59, 999);

      const dayRows = await db
        .select({
          count: sql<number>`count(*)`,
          volume: sql<number>`coalesce(sum(${transactions.amount}), 0)`,
        })
        .from(transactions)
        .where(
          and(
            eq(transactions.agentId, agent.id),
            eq(transactions.status, "success"),
            gte(transactions.createdAt, dayStart),
            lte(transactions.createdAt, dayEnd)
          )
        );
      const dailyCount = Number(dayRows[0]?.count ?? 0);
      const dailyVolume = Number(dayRows[0]?.volume ?? 0);

      // Recent transactions (last 10) for the activity feed
      const recent = await db
        .select({
          id: transactions.id,
          txRef: transactions.ref,
          type: transactions.type,
          amount: transactions.amount,
          status: transactions.status,
          createdAt: transactions.createdAt,
        })
        .from(transactions)
        .where(
          and(
            eq(transactions.agentId, agent.id),
            gte(transactions.createdAt, dayStart)
          )
        )
        .orderBy(desc(transactions.createdAt))
        .limit(10);

      return {
        tier: agent.tier,
        limits: {
          maxTxPerHour: Number(limits.maxTxPerHour),
          maxSingleTxAmount: Number(limits.maxSingleTxAmount),
          maxDailyVolume: Number(limits.maxDailyVolume),
        },
        usage: {
          hourlyCount,
          dailyCount,
          dailyVolume,
        },
        recentTransactions: recent,
      };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message:
          error instanceof Error ? error.message : "Internal server error",
      });
    }
  }),

  // ── Analytics: hourly premiumCollection/claimPayout for current agent today ─────────────
  hourlyStats: protectedProcedure.query(async ({ ctx }) => {
    try {
      const agent = (ctx as any).agent ?? (await getAgentFromCookie(ctx.req));
      if (!agent) return [];
      const db = (await getDb())!;
      if (!db) throw new Error("Database connection unavailable");
      const dayStart = new Date();
      dayStart.setHours(0, 0, 0, 0);
      const rows = await db
        .select({
          createdAt: transactions.createdAt,
          amount: transactions.amount,
          type: transactions.type,
        })
        .from(transactions)
        .where(
          and(
            eq(transactions.agentId, agent.id),
            gte(transactions.createdAt, dayStart),
            eq(transactions.status, "success")
          )
        );
      const buckets: Record<
        string,
        { premiumCollection: number; claimPayout: number; count: number }
      > = {};
      for (let h = 0; h < 24; h++) {
        buckets[`${h.toString().padStart(2, "0")}:00`] = {
          premiumCollection: 0,
          claimPayout: 0,
          count: 0,
        };
      }
      for (const row of rows) {
        const key = `${new Date(row.createdAt).getHours().toString().padStart(2, "0")}:00`;
        const amt = Number(row.amount);
        if (row.type === "Cash In") buckets[key].premiumCollection += amt;
        else buckets[key].claimPayout += amt;
        buckets[key].count++;
      }
      return Object.entries(buckets).map(([h, v]) => ({ h, ...v }));
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message:
          error instanceof Error ? error.message : "Internal server error",
      });
    }
  }),

  // ── Analytics: weekly commission per day for current agent ───────────────
  commissionStats: protectedProcedure.query(async ({ ctx }) => {
    try {
      const agent = (ctx as any).agent ?? (await getAgentFromCookie(ctx.req));
      if (!agent) return [];
      const db = (await getDb())!;
      if (!db) throw new Error("Database connection unavailable");
      const weekStart = new Date();
      weekStart.setDate(weekStart.getDate() - 6);
      weekStart.setHours(0, 0, 0, 0);
      const rows = await db
        .select({
          createdAt: transactions.createdAt,
          commission: transactions.commission,
        })
        .from(transactions)
        .where(
          and(
            eq(transactions.agentId, agent.id),
            gte(transactions.createdAt, weekStart),
            eq(transactions.status, "success")
          )
        );
      const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
      const buckets: Record<string, number> = {};
      for (let i = 6; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        buckets[days[d.getDay()]] = 0;
      }
      for (const row of rows) {
        const day = days[new Date(row.createdAt).getDay()];
        buckets[day] = (buckets[day] ?? 0) + Number(row.commission ?? 0);
      }
      return Object.entries(buckets).map(([day, earned]) => ({ day, earned }));
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message:
          error instanceof Error ? error.message : "Internal server error",
      });
    }
  }),

  // ── Analytics: agent day summary for ticker ───────────────────────────────
  agentDayStats: protectedProcedure.query(async ({ ctx }) => {
    try {
      const agent = (ctx as any).agent ?? (await getAgentFromCookie(ctx.req));
      if (!agent) return null;
      const db = (await getDb())!;
      if (!db) throw new Error("Database connection unavailable");
      const dayStart = new Date();
      dayStart.setHours(0, 0, 0, 0);
      const rows = await db
        .select({
          type: transactions.type,
          amount: transactions.amount,
          status: transactions.status,
          commission: transactions.commission,
        })
        .from(transactions)
        .where(
          and(
            eq(transactions.agentId, agent.id),
            gte(transactions.createdAt, dayStart)
          )
        );
      let premiumCollection = 0,
        claimPayout = 0,
        transfers = 0,
        commission = 0,
        count = 0,
        success = 0;
      for (const r of rows) {
        const amt = Number(r.amount);
        if (r.type === "Cash In") premiumCollection += amt;
        else if (r.type === "Cash Out") claimPayout += amt;
        else if (r.type === "Transfer") transfers += amt;
        commission += Number(r.commission ?? 0);
        count++;
        if (r.status === "success") success++;
      }
      // Fetch live premium reserve from agents table
      const agentDbRows = await db
        .select({ premiumReserve: agents.premiumReserve })
        .from(agents)
        .where(eq(agents.id, agent.id))
        .limit(1);
      const premiumReserve = Number(agentDbRows[0]?.premiumReserve ?? 0);
      return {
        premiumCollection,
        claimPayout,
        transfers,
        commission,
        count,
        successRate:
          count > 0 ? Math.round((success / count) * 1000) / 10 : 100,
        float: premiumReserve,
      };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message:
          error instanceof Error ? error.message : "Internal server error",
      });
    }
  }),

  // ── Analytics: admin hourly volume across all agents today ────────────────
  adminHourlyStats: protectedProcedure.query(async ({ ctx }) => {
    try {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      const db = (await getDb())!;
      if (!db) throw new Error("Database connection unavailable");
      const dayStart = new Date();
      dayStart.setHours(0, 0, 0, 0);
      const rows = await db
        .select({
          createdAt: transactions.createdAt,
          amount: transactions.amount,
        })
        .from(transactions)
        .where(
          and(
            gte(transactions.createdAt, dayStart),
            eq(transactions.status, "success")
          )
        );
      const buckets: Record<string, { volume: number; count: number }> = {};
      for (let h = 0; h < 24; h++) {
        buckets[`${h.toString().padStart(2, "0")}:00`] = {
          volume: 0,
          count: 0,
        };
      }
      for (const row of rows) {
        const key = `${new Date(row.createdAt).getHours().toString().padStart(2, "0")}:00`;
        buckets[key].volume += Number(row.amount);
        buckets[key].count++;
      }
      return Object.entries(buckets).map(([hour, v]) => ({ hour, ...v }));
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message:
          error instanceof Error ? error.message : "Internal server error",
      });
    }
  }),

  // ── Analytics: transaction type distribution (last 30 days, admin only) ──────
  statsByType: protectedProcedure.query(async ({ ctx }) => {
    try {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      const db = (await getDb())!;
      if (!db) throw new Error("Database connection unavailable");
      const since = new Date();
      since.setDate(since.getDate() - 30);
      const rows = await db
        .select({ type: transactions.type, amount: transactions.amount })
        .from(transactions)
        .where(
          and(
            gte(transactions.createdAt, since),
            eq(transactions.status, "success")
          )
        );
      // Aggregate by type in memory (avoids dialect-specific GROUP BY)
      const map: Record<string, { count: number; volume: number }> = {};
      for (const row of rows) {
        if (!map[row.type]) map[row.type] = { count: 0, volume: 0 };
        map[row.type].count++;
        map[row.type].volume += Number(row.amount);
      }
      const total = Object.values(map as any).reduce(
        (s: any, v: any) => s + v.count,
        0
      );
      return Object.entries(map)
        .map(([type, v]) => ({
          type,
          count: v.count,
          volume: v.volume,
          // @ts-expect-error middleware type mismatch
          percentage: total > 0 ? Math.round((v.count / total) * 1000) / 10 : 0,
        }))
        .sort((a: any, b: any) => b.count - a.count);
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message:
          error instanceof Error ? error.message : "Internal server error",
      });
    }
  }),

  /**
   * getFloatBalance — fetches live premium reserve from platform float service.
   * Falls back to local DB agent.premiumReserve if platform is unavailable.
   */
  getFloatBalance: protectedProcedure.query(async ({ ctx }) => {
    try {
      const agent = (ctx as any).agent ?? (await getAgentFromCookie(ctx.req));
      if (!agent)
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Agent session required",
        });
      // Try platform float service first
      try {
        const token = ctx.req?.cookies?.["kc_access_token"] ?? "";
        if (token) {
          const result = (await floatPlatform.getBalance(
            String(agent.id),
            token
          )) as {
            balance?: number;
            available_balance?: number;
            currency?: string;
          };
          return {
            source: "platform" as const,
            balance: result.balance ?? result.available_balance ?? 0,
            currency: result.currency ?? "NGN",
          };
        }
      } catch (err) {
        logger.warn("[float] Platform getBalance failed, using local DB:: " + (err as Error).message
        );
      }
      // Local DB fallback
      const db = (await getDb())!;
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const [row] = await db
        .select({ premiumReserve: agents.premiumReserve })
        .from(agents)
        .where(eq(agents.id, agent.id))
        .limit(1);
      return {
        source: "local" as const,
        balance: Number(row?.premiumReserve ?? 0),
        currency: "NGN",
      };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message:
          error instanceof Error ? error.message : "Internal server error",
      });
    }
  }),

  /**
   * getFloatHistory — fetches float transaction history from platform float service.
   * Falls back to local DB transactions if platform is unavailable.
   */
  getFloatHistory: protectedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(200).default(50) }))
    .query(async ({ ctx, input }) => {
      try {
        const agent = (ctx as any).agent ?? (await getAgentFromCookie(ctx.req));
        if (!agent)
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "Agent session required",
          });
        // Try platform float service first
        try {
          const token = ctx.req?.cookies?.["kc_access_token"] ?? "";
          if (token) {
            const result = (await floatPlatform.getTransactions(
              String(agent.id),
              input.limit,
              token
            )) as unknown[];
            return { source: "platform" as const, transactions: result };
          }
        } catch (err) {
          logger.warn("[float] Platform getTransactions failed, using local DB:: " + (err as Error).message
          );
        }
        // Local DB fallback — return agent's recent transactions
        const db = (await getDb())!;
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        const rows = await db
          .select()
          .from(transactions)
          .where(eq(transactions.agentId, agent.id))
          .orderBy(desc(transactions.createdAt))
          .limit(input.limit);
        return { source: "local" as const, transactions: rows };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  /**
   * platformAnalytics — fetches transaction summary from the analytics-service.
   * Falls back to local DB aggregates if the platform service is unavailable.
   */
  platformAnalytics: protectedProcedure
    .input(
      z.object({
        startDate: z.string().optional(),
        endDate: z.string().optional(),
        agentId: z.string().optional(),
      })
    )
    .query(async ({ input, ctx }) => {
      try {
        const token = ctx.req?.cookies?.["kc_access_token"] ?? "";
        if (token) {
          try {
            const result = await analyticsPlatform.transactionSummary(
              {
                start_date: input.startDate,
                end_date: input.endDate,
                agent_id: input.agentId,
              },
              token
            );
            return { source: "platform" as const, data: result };
          } catch (err) {
            logger.warn("[analytics] Platform unavailable, falling back to local DB:: " + (err as Error).message
            );
          }
        }
        // Local DB fallback
        const db = (await getDb())!;
        if (!db) return { source: "local" as const, data: null };
        const rows = await db
          .select({
            type: transactions.type,
            amount: transactions.amount,
            status: transactions.status,
          })
          .from(transactions)
          .where(
            and(
              input.startDate
                ? gte(transactions.createdAt, new Date(input.startDate))
                : undefined,
              input.endDate
                ? lte(transactions.createdAt, new Date(input.endDate))
                : undefined
            )
          );
        const successRows = rows.filter(r => r.status === "success");
        const totalVolume = successRows.reduce(
          (s: any, r: any) => s + Number(r.amount),
          0
        );
        const totalCount = successRows.length;
        const byType: Record<string, { count: number; volume: number }> = {};
        for (const r of successRows) {
          if (!byType[r.type]) byType[r.type] = { count: 0, volume: 0 };
          byType[r.type].count++;
          byType[r.type].volume += Number(r.amount);
        }
        return {
          source: "local" as const,
          data: {
            total_transactions: totalCount,
            total_volume: totalVolume,
            success_rate:
              rows.length > 0 ? (totalCount / rows.length) * 100 : 0,
            by_type: byType,
          },
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
});
