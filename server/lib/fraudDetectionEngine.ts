// @ts-check
// TypeScript enabled — Sprint 96 security audit
/**
 * Real-Time Fraud Detection Engine
 *
 * Runs fraud detection rules on every transaction and emits alerts via SSE.
 * Rules: velocity limits, geofence violations, blacklist checks, anomaly detection.
 */

import { EventEmitter } from "events";

import { sql, and, eq, gte, desc } from "drizzle-orm";

import {
  transactions,
  fraudAlerts,
  velocityLimits,
  geofenceZones,
  agentGeofenceZones,
  fraudRules,
} from "../../drizzle/schema";
import type { InsertFraudAlert } from "../../drizzle/schema";
import { getDb } from "../db";



// ── SSE Event Bus ─────────────────────────────────────────────────────────────
export const fraudAlertBus = new EventEmitter();
fraudAlertBus.setMaxListeners(100); // Allow many concurrent SSE connections

// ── Rule Processor ────────────────────────────────────────────────────────────
export interface TransactionContext {
  id: number;
  agentId: number;
  amount: number;
  type: string;
  customerName?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  timestamp: Date;
}

export interface FraudDetectionResult {
  isFraud: boolean;
  severity: "critical" | "high" | "medium" | "low";
  type: string;
  reason: string;
  fraudScore: number;
  rulesFired: string[];
}

/**
 * Run all fraud detection rules on a transaction
 */
export async function detectFraud(
  tx: TransactionContext
): Promise<FraudDetectionResult> {
  const rulesFired: string[] = [];
  let maxSeverity: "critical" | "high" | "medium" | "low" = "low" as
    | "critical"
    | "high"
    | "medium"
    | "low";
  let fraudScore = 0;
  let reason = "";

  // ── Rule 1: Velocity Limit Check ───────────────────────────────────────────
  const velocityViolation = await checkVelocityLimit(tx);
  if (velocityViolation) {
    rulesFired.push("velocity_limit");
    maxSeverity = "high";
    fraudScore += 40;
    reason += `Velocity limit exceeded: ${velocityViolation}. `;
  }

  // ── Rule 2: Geofence Violation ─────────────────────────────────────────────
  const geofenceViolation = await checkGeofence(tx);
  if (geofenceViolation) {
    rulesFired.push("geofence_violation");
    if (maxSeverity !== "critical") maxSeverity = "high";
    fraudScore += 35;
    reason += `Transaction outside allowed geofence: ${geofenceViolation}. `;
  }

  // ── Rule 3: Blacklist Check ────────────────────────────────────────────────
  const blacklistHit = await checkBlacklist(tx);
  if (blacklistHit) {
    rulesFired.push("blacklist");
    maxSeverity = "critical";
    fraudScore += 60;
    reason += `Customer or agent on blacklist: ${blacklistHit}. `;
  }

  // ── Rule 4: Anomaly Detection (simple threshold) ───────────────────────────
  const anomaly = await checkAnomaly(tx);
  if (anomaly) {
    rulesFired.push("anomaly");
    if (maxSeverity !== "critical" && maxSeverity !== "high")
      maxSeverity = "medium";
    fraudScore += 25;
    reason += `Anomalous transaction pattern: ${anomaly}. `;
  }

  // ── Rule 5: Large Transaction (>₦500k) ─────────────────────────────────────
  if (tx.amount > 500000) {
    rulesFired.push("large_transaction");
    fraudScore += 15;
    reason += `Large transaction amount: ₦${tx.amount.toLocaleString()}. `;
  }

  // ── Rust fraud-gate: enhanced velocity + pattern scoring ─────────────────
  // Calls the Rust fraud-gate service (port 8090) for rules that require
  // in-memory velocity tracking across the last 60 minutes.
  // Fail-open: if fraud-gate is unavailable, use TypeScript-only score.
  const FRAUD_GATE_URL = process.env.FRAUD_GATE_URL || "http://localhost:8090";
  try {
    const rustResult = await fetch(`${FRAUD_GATE_URL}/check`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_id: tx.agentId,
        amount: tx.amount,
        transaction_type: tx.type,
        recipient: String(tx.id),
        trace_id: `FRD-${tx.id}`,
      }),
      signal: AbortSignal.timeout(2000), // 2s timeout — fraud check must be fast
    });
    if (rustResult.ok) {
      const rustData = await rustResult.json() as {
        allowed: boolean;
        risk_score: number;
        flags: string[];
        risk_level: string;
      };
      // Merge Rust flags into TypeScript result
      for (const flag of rustData.flags) {
        if (!rulesFired.includes(flag)) rulesFired.push(flag);
      }
      // Boost fraud score with Rust's velocity/pattern score
      fraudScore = Math.min(100, fraudScore + (rustData.risk_score * 0.4));
      if (!rustData.allowed && fraudScore < 60) fraudScore = 60;
      if (rustData.risk_level === "critical") maxSeverity = "critical";
      else if (rustData.risk_level === "high" && maxSeverity !== "critical") maxSeverity = "high";
    }
  } catch {
    // Fraud-gate unavailable — proceed with TypeScript-only detection
  }

  const isFraud = rulesFired.length > 0;
  return {
    isFraud,
    severity: maxSeverity,
    type: rulesFired.join(", "),
    reason: reason.trim() || "No fraud detected",
    fraudScore: Math.min(fraudScore, 100),
    rulesFired,
  };
}

/**
 * Create a fraud alert and emit it via SSE
 */
export async function createAndEmitFraudAlert(
  tx: TransactionContext,
  result: FraudDetectionResult
): Promise<number> {
  const db = (await getDb())!;
  if (!db) throw new Error("DB unavailable");

  const alert: InsertFraudAlert = {
    agentId: tx.agentId,
    transactionId: tx.id,
    severity: result.severity,
    type: result.type,
    customerName: tx.customerName || undefined,
    amount: String(tx.amount),
    reason: result.reason,
    fraudScore: String(result.fraudScore),
    status: "open",
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const [inserted] = await db.insert(fraudAlerts).values(alert).returning();

  // Emit to SSE subscribers
  fraudAlertBus.emit("alert", {
    ...inserted,
    amount: Number(inserted.amount),
    fraudScore: Number(inserted.fraudScore),
  });

  return inserted.id;
}

// ── Rule Implementations ──────────────────────────────────────────────────────

async function checkVelocityLimit(
  tx: TransactionContext
): Promise<string | null> {
  const db = (await getDb())!;
  if (!db) return null;

  // Count transactions in the last hour
  const oneHourAgo = new Date(tx.timestamp.getTime() - 60 * 60 * 1000);
  const recentTxs = await db
    .select({ count: sql<number>`count(*)` })
    .from(transactions)
    .where(
      and(
        eq(transactions.agentId, tx.agentId),
        gte(transactions.createdAt, oneHourAgo)
      )
    );

  const count = Number(recentTxs[0]?.count || 0);
  // Default velocity limit: 50 transactions per hour
  const maxTxPerHour = 50;
  if (count > maxTxPerHour) {
    return `${count} transactions in last hour (limit: ${maxTxPerHour})`;
  }

  return null;
}

async function checkGeofence(tx: TransactionContext): Promise<string | null> {
  if (!tx.latitude || !tx.longitude) return null;

  const db = (await getDb())!;
  if (!db) return null;

  // Get agent's assigned geofences
  const assignments = await db
    .select({
      zoneName: geofenceZones.name,
      centerLat: geofenceZones.latitude,
      centerLon: geofenceZones.longitude,
      radius: geofenceZones.radiusMetres,
    })
    .from(agentGeofenceZones)
    .innerJoin(geofenceZones, eq(agentGeofenceZones.zoneId, geofenceZones.id))
    .where(eq(agentGeofenceZones.agentId, tx.agentId));

  if (assignments.length === 0) return null;

  // Check if transaction is within any assigned geofence
  for (const zone of assignments) {
    const distance = haversineDistance(
      tx.latitude,
      tx.longitude,
      Number(zone.centerLat),
      Number(zone.centerLon)
    );
    if (distance <= Number(zone.radius)) {
      return null; // Inside geofence, OK
    }
  }

  return `Transaction at (${tx.latitude}, ${tx.longitude}) outside all assigned geofences`;
}

async function checkBlacklist(tx: TransactionContext): Promise<string | null> {
  const db = (await getDb())!;
  if (!db) return null;

  // Fetch all enabled blacklist rules from the fraud_rules table
  const blacklistRules = await db
    .select()
    .from(fraudRules)
    .where(
      and(eq(fraudRules.category, "blacklist"), eq(fraudRules.enabled, true))
    )
    .limit(50);

  if (!blacklistRules.length) return null;

  // Each blacklist rule's description may contain a comma-separated list of
  // blocked phone numbers, agent IDs, or amount patterns to match against.
  for (const rule of blacklistRules) {
    if (!rule.description) continue;
    const entries = rule.description
      .split(",")
      .map(e => e.trim().toLowerCase());

    // Check if customer name matches a blacklisted entry
    if (tx.customerName) {
      const nameLower = tx.customerName.toLowerCase();
      if (entries.some(e => nameLower.includes(e) && e.length > 3)) {
        // Increment hit count
        await db
          .update(fraudRules)
          .set({ hitCount: (rule.hitCount ?? 0) + 1, lastHitAt: new Date() })
          .where(eq(fraudRules.id, rule.id));
        return `Customer "${tx.customerName}" matched blacklist rule: ${rule.name}`;
      }
    }

    // Check if transaction amount matches a blacklisted exact amount
    if (
      entries.some(
        e => !isNaN(Number(e)) && Math.abs(Number(e) - tx.amount) < 0.01
      )
    ) {
      await db
        .update(fraudRules)
        .set({ hitCount: (rule.hitCount ?? 0) + 1, lastHitAt: new Date() })
        .where(eq(fraudRules.id, rule.id));
      return `Transaction amount ${tx.amount} matched blacklist rule: ${rule.name}`;
    }
  }

  return null;
}

async function checkAnomaly(tx: TransactionContext): Promise<string | null> {
  const db = (await getDb())!;
  if (!db) return null;

  // Get agent's average transaction amount in last 30 days
  const thirtyDaysAgo = new Date(
    tx.timestamp.getTime() - 30 * 24 * 60 * 60 * 1000
  );
  const stats = await db
    .select({
      avg: sql<number>`AVG(CAST(${transactions.amount} AS DECIMAL))`,
      stddev: sql<number>`STDDEV(CAST(${transactions.amount} AS DECIMAL))`,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.agentId, tx.agentId),
        gte(transactions.createdAt, thirtyDaysAgo)
      )
    );

  const avg = Number(stats[0]?.avg || 0);
  const stddev = Number(stats[0]?.stddev || 0);

  // Flag if transaction is >3 standard deviations from mean
  if (stddev > 0 && Math.abs(tx.amount - avg) > 3 * stddev) {
    return `Amount ₦${tx.amount.toLocaleString()} is ${Math.abs(tx.amount - avg) / stddev}σ from mean ₦${avg.toLocaleString()}`;
  }

  return null;
}

// ── Haversine Distance (meters) ───────────────────────────────────────────────
function haversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371e3; // Earth radius in meters
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}
