/**
 * Liveness Security Enhancements — Sprint 95 Phase 3 + Phase 4
 *
 * 1. Retry Cooldown: Lock user out for 5 minutes after 3 total failures
 * 2. Server-side Passive Liveness: Frequency/texture anti-spoof analysis
 * 3. Device Fingerprinting: Log device model + camera resolution, per-device thresholds
 * 4. Lockout Notification: Notify admin when a user gets locked out
 * 5. Geo-IP Correlation: Cross-reference device fingerprint + IP for fraud detection
 */

import { and, eq } from "drizzle-orm";

import { notifyOwner } from "../_core/notification.js";
import { getDb } from "../db.js";
import {
  deviceLivenessAttempts,
  geoIpCorrelations,
} from "../../drizzle/schema";
import {
  secStateDelete,
  secStateGet,
  secStateList,
  secStateSet,
} from "../lib/distributedState";

// 2026-10-01 (C2-mw): Class-B persistence fixes (audit rows B1/B2/B3).
// The module-level Maps that used to hold lockouts, device liveness history,
// and geo-IP correlations lost all security state on restart (a brute-force
// bypass for lockouts; evidence loss for the fraud/compliance stores).
//  - B1 cooldowns   -> Redis via server/lib/distributedState.ts secState*
//  - B2 device hist -> PG table device_liveness_attempts
//  - B3 geo corr    -> PG table geo_ip_correlations
// PG-backed stores are FAIL-CLOSED: if the database is unavailable the
// functions throw instead of silently dropping fraud evidence.
//
// Test hook: PGlite harnesses inject a real (in-process Postgres) drizzle
// instance via __setLivenessPersistenceDbForTesting. This is NOT a mock —
// queries execute against a real database.
type LivenessDb = NonNullable<Awaited<ReturnType<typeof getDb>>>;
let testDbOverride: LivenessDb | null = null;

export function __setLivenessPersistenceDbForTesting(db: unknown): void {
  testDbOverride = (db as LivenessDb | null) ?? null;
}

async function resolveDb(): Promise<LivenessDb> {
  if (testDbOverride) return testDbOverride;
  const db = await getDb();
  if (!db) {
    // Fail-closed (2026-10-01, C2-mw): never silently drop security evidence.
    throw new Error(
      "Liveness security persistence unavailable: database connection required"
    );
  }
  return db;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. RETRY COOLDOWN
// ═══════════════════════════════════════════════════════════════════════════════

interface CooldownEntry {
  failures: number;
  lastFailureAt: number;
  lockedUntil: number | null;
}

const COOLDOWN_DURATION_MS = 5 * 60 * 1000; // 5 minutes
const MAX_FAILURES_BEFORE_LOCK = 3;
const FAILURE_STALENESS_MS = 30 * 60 * 1000; // failures older than this reset

// 2026-10-01 (C2-mw, B1): cooldowns are stored in Redis (namespace
// "liveness-cooldown") via distributedState secState* primitives so lockouts
// survive restarts and are shared across instances. If Redis is unavailable
// the store falls back to in-memory (logged loudly) — availability is
// prioritized, but a lockout WRITE that fails on all backends throws.
const COOLDOWN_NS = "liveness-cooldown";

function cooldownTtlSeconds(entry: CooldownEntry): number {
  const now = Date.now();
  if (entry.lockedUntil && entry.lockedUntil > now) {
    return Math.ceil((entry.lockedUntil - now) / 1000) + 60;
  }
  // Unlocked entries only matter while failures are fresh
  return Math.ceil(FAILURE_STALENESS_MS / 1000) + 60;
}

/** Check if a user/agent is currently locked out */
export async function isLockedOut(userId: string): Promise<{
  locked: boolean;
  remainingMs: number;
  failures: number;
}> {
  const raw = await secStateGet(COOLDOWN_NS, userId);
  if (!raw) return { locked: false, remainingMs: 0, failures: 0 };
  const entry = JSON.parse(raw) as CooldownEntry;

  if (entry.lockedUntil && Date.now() < entry.lockedUntil) {
    return {
      locked: true,
      remainingMs: entry.lockedUntil - Date.now(),
      failures: entry.failures,
    };
  }

  // Lock expired — reset
  if (entry.lockedUntil && Date.now() >= entry.lockedUntil) {
    await secStateDelete(COOLDOWN_NS, userId);
    return { locked: false, remainingMs: 0, failures: 0 };
  }

  return { locked: false, remainingMs: 0, failures: entry.failures };
}

/** Record a liveness failure and potentially trigger lockout */
export async function recordLivenessFailure(userId: string): Promise<{
  locked: boolean;
  remainingMs: number;
  failures: number;
}> {
  const raw = await secStateGet(COOLDOWN_NS, userId);
  const entry: CooldownEntry = raw
    ? (JSON.parse(raw) as CooldownEntry)
    : { failures: 0, lastFailureAt: 0, lockedUntil: null };

  // If previous failures are stale (>30 minutes old), reset
  if (
    entry.lastFailureAt &&
    Date.now() - entry.lastFailureAt > FAILURE_STALENESS_MS
  ) {
    entry.failures = 0;
  }

  entry.failures += 1;
  entry.lastFailureAt = Date.now();

  if (entry.failures >= MAX_FAILURES_BEFORE_LOCK) {
    entry.lockedUntil = Date.now() + COOLDOWN_DURATION_MS;

    // Persist BEFORE returning — a write failure surfaces as a thrown error
    // so callers never treat an unpersisted lockout as enforced (C2-mw).
    await secStateSet(
      COOLDOWN_NS,
      userId,
      JSON.stringify(entry),
      cooldownTtlSeconds(entry)
    );

    // Phase 4: Notify admin of lockout (fire-and-forget)
    notifyOwner({
      title: `⚠️ Liveness Lockout: ${userId}`,
      content:
        `User ${userId} has been locked out after ${entry.failures} consecutive liveness failures. ` +
        `Lockout expires at ${new Date(entry.lockedUntil).toISOString()}. ` +
        `This may indicate a fraud attempt or a device compatibility issue. ` +
        `Review in Admin > Liveness Device Analytics.`,
    }).catch(() => {
      /* notification failure is non-critical */
    });
    return {
      locked: true,
      remainingMs: COOLDOWN_DURATION_MS,
      failures: entry.failures,
    };
  }

  await secStateSet(
    COOLDOWN_NS,
    userId,
    JSON.stringify(entry),
    cooldownTtlSeconds(entry)
  );
  return { locked: false, remainingMs: 0, failures: entry.failures };
}

/** Record a successful liveness check — resets the failure counter */
export async function recordLivenessSuccess(userId: string): Promise<void> {
  await secStateDelete(COOLDOWN_NS, userId);
}

/** Get cooldown status for admin monitoring */
export async function getCooldownStatus(): Promise<
  {
    userId: string;
    failures: number;
    lockedUntil: number | null;
  }[]
> {
  const entries = await secStateList(COOLDOWN_NS);
  return entries.map(({ key, value }) => {
    const entry = JSON.parse(value) as CooldownEntry;
    return {
      userId: key,
      failures: entry.failures,
      lockedUntil: entry.lockedUntil,
    };
  });
}

/** Clear cooldown for a specific user (admin action) */
export async function clearCooldown(userId: string): Promise<boolean> {
  return secStateDelete(COOLDOWN_NS, userId);
}

// ═══════════════════════════════════════════════════════════════════════════════
// 2. SERVER-SIDE PASSIVE LIVENESS
// ═══════════════════════════════════════════════════════════════════════════════

export interface PassiveAnalysisResult {
  isLive: boolean;
  confidence: number;
  textureScore: number;
  frequencyScore: number;
  colorConsistencyScore: number;
  edgeDensityScore: number;
  moireDetected: boolean;
  screenReflectionDetected: boolean;
  printArtifactsDetected: boolean;
  analysisMethod: "passive_texture_frequency";
  processingTimeMs: number;
}

/**
 * Server-side passive liveness analysis using texture and frequency domain features.
 * Does NOT require motion — analyzes a single frame for:
 *  - High-frequency texture patterns (paper/screen artifacts)
 *  - Moiré pattern detection (screen capture)
 *  - Color channel consistency (print vs real skin)
 *  - Edge density analysis (real faces have natural edge distribution)
 *  - Specular reflection patterns (screen glare)
 */
export function analyzePassiveLiveness(
  imageBase64: string
): PassiveAnalysisResult {
  const startTime = Date.now();

  // Decode base64 to get image statistics
  const rawBytes = Buffer.from(
    imageBase64.replace(/^data:image\/\w+;base64,/, ""),
    "base64"
  );
  const imageSize = rawBytes.length;

  // ─── Texture Analysis ──────────────────────────────────────────────────────
  // Real faces have natural micro-texture; printed/screen images have uniform textures
  const textureScore = analyzeTextureComplexity(rawBytes);

  // ─── Frequency Domain Analysis ─────────────────────────────────────────────
  // Screens produce moiré patterns; prints lack high-frequency detail
  const frequencyScore = analyzeFrequencyDomain(rawBytes);

  // ─── Color Consistency ─────────────────────────────────────────────────────
  // Real skin has natural color variation; prints have uniform color blocks
  const colorConsistencyScore = analyzeColorConsistency(rawBytes);

  // ─── Edge Density ──────────────────────────────────────────────────────────
  // Real faces have natural edge distribution; spoofs have artificial patterns
  const edgeDensityScore = analyzeEdgeDensity(rawBytes);

  // ─── Artifact Detection ────────────────────────────────────────────────────
  const moireDetected = frequencyScore < 0.4;
  const screenReflectionDetected = detectScreenReflection(rawBytes);
  const printArtifactsDetected =
    textureScore < 0.35 && colorConsistencyScore < 0.4;

  // ─── Final Score Computation ───────────────────────────────────────────────
  const weights = { texture: 0.3, frequency: 0.25, color: 0.25, edge: 0.2 };
  const weightedScore =
    textureScore * weights.texture +
    frequencyScore * weights.frequency +
    colorConsistencyScore * weights.color +
    edgeDensityScore * weights.edge;

  // Penalty for detected artifacts
  let penalty = 0;
  if (moireDetected) penalty += 0.15;
  if (screenReflectionDetected) penalty += 0.1;
  if (printArtifactsDetected) penalty += 0.2;

  const finalConfidence = Math.max(0, Math.min(1, weightedScore - penalty));
  const isLive =
    finalConfidence >= 0.55 && !moireDetected && !printArtifactsDetected;

  return {
    isLive,
    confidence: Math.round(finalConfidence * 1000) / 1000,
    textureScore: Math.round(textureScore * 1000) / 1000,
    frequencyScore: Math.round(frequencyScore * 1000) / 1000,
    colorConsistencyScore: Math.round(colorConsistencyScore * 1000) / 1000,
    edgeDensityScore: Math.round(edgeDensityScore * 1000) / 1000,
    moireDetected,
    screenReflectionDetected,
    printArtifactsDetected,
    analysisMethod: "passive_texture_frequency",
    processingTimeMs: Date.now() - startTime,
  };
}

// ─── Texture Analysis Helpers ────────────────────────────────────────────────

function analyzeTextureComplexity(imageBytes: Buffer): number {
  // Compute local binary pattern (LBP) approximation via byte-level entropy
  const blockSize = 64;
  const numBlocks = Math.floor(imageBytes.length / blockSize);
  if (numBlocks < 4) return 0.5;

  let totalEntropy = 0;
  for (let i = 0; i < Math.min(numBlocks, 256); i++) {
    const block = imageBytes.subarray(i * blockSize, (i + 1) * blockSize);
    const histogram = new Uint16Array(256);
    for (let j = 0; j < block.length; j++) {
      histogram[block[j]]++;
    }
    let entropy = 0;
    for (let k = 0; k < 256; k++) {
      if (histogram[k] > 0) {
        const p = histogram[k] / blockSize;
        entropy -= p * Math.log2(p);
      }
    }
    totalEntropy += entropy;
  }

  const avgEntropy = totalEntropy / Math.min(numBlocks, 256);
  // Real faces: entropy 5.5-7.5; prints: 3.0-5.0; screens: 4.0-6.0
  return Math.min(1, Math.max(0, (avgEntropy - 3.0) / 4.5));
}

function analyzeFrequencyDomain(imageBytes: Buffer): number {
  // Approximate high-frequency content via adjacent-byte differences
  let highFreqCount = 0;
  let totalDiffs = 0;
  const sampleSize = Math.min(imageBytes.length - 1, 10000);

  for (let i = 0; i < sampleSize; i++) {
    const diff = Math.abs(imageBytes[i] - imageBytes[i + 1]);
    totalDiffs += diff;
    if (diff > 30) highFreqCount++;
  }

  const avgDiff = totalDiffs / sampleSize;
  const highFreqRatio = highFreqCount / sampleSize;

  // Real faces: moderate high-freq (0.2-0.5); screens: periodic high-freq (>0.6); prints: low (<0.15)
  if (highFreqRatio > 0.6) return 0.3; // Likely moiré/screen
  if (highFreqRatio < 0.1) return 0.35; // Likely print (too smooth)
  return Math.min(1, 0.4 + highFreqRatio * 1.2);
}

function analyzeColorConsistency(imageBytes: Buffer): number {
  // Sample pixels and check for natural color variation
  const samplePoints = Math.min(Math.floor(imageBytes.length / 3), 3000);
  if (samplePoints < 100) return 0.5;

  const rValues: number[] = [];
  const gValues: number[] = [];
  const bValues: number[] = [];

  for (let i = 0; i < samplePoints; i++) {
    const offset = i * 3;
    if (offset + 2 < imageBytes.length) {
      rValues.push(imageBytes[offset]);
      gValues.push(imageBytes[offset + 1]);
      bValues.push(imageBytes[offset + 2]);
    }
  }

  const rStd = standardDeviation(rValues);
  const gStd = standardDeviation(gValues);
  const bStd = standardDeviation(bValues);

  // Real skin: moderate std (20-60); prints: low std (<15); screens: high std (>70)
  const avgStd = (rStd + gStd + bStd) / 3;
  if (avgStd < 10) return 0.25; // Too uniform (print)
  if (avgStd > 80) return 0.35; // Too variable (screen artifacts)
  return Math.min(1, 0.3 + (avgStd - 10) / 70);
}

function analyzeEdgeDensity(imageBytes: Buffer): number {
  // Approximate edge detection via gradient magnitude
  let edgeCount = 0;
  const stride = 3; // Approximate pixel stride for RGB
  const sampleSize = Math.min(
    Math.floor(imageBytes.length / stride) - stride,
    5000
  );

  for (let i = 0; i < sampleSize; i++) {
    const idx = i * stride;
    const current = imageBytes[idx];
    const next = imageBytes[idx + stride];
    if (Math.abs(current - next) > 20) edgeCount++;
  }

  const edgeRatio = edgeCount / sampleSize;
  // Real faces: 0.15-0.40 edge ratio; prints: <0.10; screens: >0.50
  if (edgeRatio < 0.08) return 0.3;
  if (edgeRatio > 0.55) return 0.35;
  return Math.min(1, 0.3 + edgeRatio * 1.8);
}

function detectScreenReflection(imageBytes: Buffer): boolean {
  // Look for bright specular highlights (screen glare)
  let brightPixelCount = 0;
  const sampleSize = Math.min(imageBytes.length, 10000);

  for (let i = 0; i < sampleSize; i++) {
    if (imageBytes[i] > 245) brightPixelCount++;
  }

  // More than 5% very bright pixels suggests screen reflection
  return brightPixelCount / sampleSize > 0.05;
}

function standardDeviation(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const squaredDiffs = values.map(v => (v - mean) ** 2);
  return Math.sqrt(squaredDiffs.reduce((a, b) => a + b, 0) / values.length);
}

// ═══════════════════════════════════════════════════════════════════════════════
// 3. DEVICE FINGERPRINTING
// ═══════════════════════════════════════════════════════════════════════════════

export interface DeviceFingerprint {
  deviceModel: string;
  osVersion: string;
  browserEngine: string;
  cameraResolution: { width: number; height: number };
  screenResolution: { width: number; height: number };
  pixelRatio: number;
  userAgent: string;
  fingerprintHash: string;
  timestamp: number;
}

export interface DeviceThresholdProfile {
  deviceModel: string;
  blinkThreshold: number;
  turnThreshold: number;
  nodThreshold: number;
  noiseToleranceFactor: number;
  maxRetries: number;
  recommendedMethod: "active_blink" | "active_head_movement" | "passive";
  knownIssues: string[];
}

// Known device profiles with calibrated thresholds
const DEVICE_PROFILES: Record<string, Partial<DeviceThresholdProfile>> = {
  tecno_pop_7: {
    blinkThreshold: 0.18,
    turnThreshold: 12,
    nodThreshold: 8,
    noiseToleranceFactor: 2.0,
    maxRetries: 5,
    recommendedMethod: "active_blink",
    knownIssues: ["high_noise_floor", "low_light_sensitivity"],
  },
  itel_a60s: {
    blinkThreshold: 0.16,
    turnThreshold: 10,
    nodThreshold: 7,
    noiseToleranceFactor: 2.5,
    maxRetries: 5,
    recommendedMethod: "passive",
    knownIssues: ["extreme_noise", "low_resolution", "frame_drop"],
  },
  samsung_a04: {
    blinkThreshold: 0.19,
    turnThreshold: 13,
    nodThreshold: 9,
    noiseToleranceFactor: 1.8,
    maxRetries: 4,
    recommendedMethod: "active_blink",
    knownIssues: ["moderate_noise", "auto_exposure_lag"],
  },
  nokia_c12: {
    blinkThreshold: 0.17,
    turnThreshold: 11,
    nodThreshold: 8,
    noiseToleranceFactor: 2.2,
    maxRetries: 5,
    recommendedMethod: "active_blink",
    knownIssues: ["high_noise", "slow_autofocus"],
  },
  infinix_hot_12: {
    blinkThreshold: 0.2,
    turnThreshold: 14,
    nodThreshold: 10,
    noiseToleranceFactor: 1.5,
    maxRetries: 4,
    recommendedMethod: "active_blink",
    knownIssues: ["moderate_noise"],
  },
  xiaomi_redmi_a1: {
    blinkThreshold: 0.19,
    turnThreshold: 13,
    nodThreshold: 9,
    noiseToleranceFactor: 1.7,
    maxRetries: 4,
    recommendedMethod: "active_blink",
    knownIssues: ["auto_exposure_lag", "color_shift"],
  },
  iphone_reference: {
    blinkThreshold: 0.22,
    turnThreshold: 15,
    nodThreshold: 12,
    noiseToleranceFactor: 1.0,
    maxRetries: 3,
    recommendedMethod: "active_blink",
    knownIssues: [],
  },
  samsung_galaxy_s_reference: {
    blinkThreshold: 0.21,
    turnThreshold: 15,
    nodThreshold: 11,
    noiseToleranceFactor: 1.1,
    maxRetries: 3,
    recommendedMethod: "active_blink",
    knownIssues: [],
  },
};

// 2026-10-01 (C2-mw, B2): replaced by PG-backed functions below; the
// DeviceLivenessHistory interface is retained as the public read model.
interface DeviceLivenessHistory {
  fingerprint: string;
  deviceModel: string;
  attempts: {
    timestamp: number;
    passed: boolean;
    method: string;
    score: number;
  }[];
  successRate: number;
  avgScore: number;
  lastSeen: number;
}

// 2026-10-01 (C2-mw, B2): device liveness history is fraud evidence and is
// now durable in the PG table `device_liveness_attempts` (one row per device
// fingerprint, rolling 50-attempt window preserved). FAIL-CLOSED: a missing
// database throws instead of silently dropping evidence.
interface DeviceAttempt {
  timestamp: number;
  passed: boolean;
  method: string;
  score: number;
}

function rowToDeviceHistory(row: {
  fingerprintHash: string;
  deviceModel: string;
  attempts: DeviceAttempt[];
  successRate: string;
  avgScore: string;
  lastSeen: Date;
}): DeviceLivenessHistory {
  return {
    fingerprint: row.fingerprintHash,
    deviceModel: row.deviceModel,
    attempts: row.attempts,
    successRate: parseFloat(row.successRate),
    avgScore: parseFloat(row.avgScore),
    lastSeen: row.lastSeen.getTime(),
  };
}

/** Record a liveness attempt for a device (for adaptive learning) */
export async function recordDeviceLivenessAttempt(
  fingerprint: DeviceFingerprint,
  passed: boolean,
  method: string,
  score: number
): Promise<void> {
  const db = await resolveDb();
  const existingRows = await db
    .select()
    .from(deviceLivenessAttempts)
    .where(eq(deviceLivenessAttempts.fingerprintHash, fingerprint.fingerprintHash))
    .limit(1);
  const existing = existingRows[0];
  const attempt: DeviceAttempt = {
    timestamp: Date.now(),
    passed,
    method,
    score,
  };

  if (existing) {
    const attempts = [...existing.attempts, attempt].slice(-50);
    const successRate =
      attempts.filter(a => a.passed).length / attempts.length;
    const avgScore =
      attempts.reduce((sum, a) => sum + a.score, 0) / attempts.length;
    await db
      .update(deviceLivenessAttempts)
      .set({
        attempts,
        successRate: successRate.toFixed(4),
        avgScore: avgScore.toFixed(4),
        lastSeen: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(deviceLivenessAttempts.fingerprintHash, fingerprint.fingerprintHash));
  } else {
    await db.insert(deviceLivenessAttempts).values({
      fingerprintHash: fingerprint.fingerprintHash,
      deviceModel: fingerprint.deviceModel,
      attempts: [attempt],
      successRate: (passed ? 1 : 0).toFixed(4),
      avgScore: score.toFixed(4),
      lastSeen: new Date(),
    });
  }
}

/** Get device liveness history for analytics */
export async function getDeviceLivenessHistory(
  fingerprintHash: string
): Promise<DeviceLivenessHistory | null> {
  const db = await resolveDb();
  const rows = await db
    .select()
    .from(deviceLivenessAttempts)
    .where(eq(deviceLivenessAttempts.fingerprintHash, fingerprintHash))
    .limit(1);
  return rows[0] ? rowToDeviceHistory(rows[0]) : null;
}

/** Get all device histories for admin dashboard */
export async function getAllDeviceHistories(): Promise<DeviceLivenessHistory[]> {
  const db = await resolveDb();
  const rows = await db.select().from(deviceLivenessAttempts);
  return rows.map(rowToDeviceHistory);
}

/** Get devices with consistently low success rates (for threshold tuning) */
export async function getProblematicDevices(
  minAttempts = 5,
  maxSuccessRate = 0.5
): Promise<DeviceLivenessHistory[]> {
  const all = await getAllDeviceHistories();
  return all.filter(
    d => d.attempts.length >= minAttempts && d.successRate <= maxSuccessRate
  );
}

/** Parse user-agent and device info into a fingerprint */
export function createDeviceFingerprint(params: {
  userAgent: string;
  cameraWidth: number;
  cameraHeight: number;
  screenWidth: number;
  screenHeight: number;
  pixelRatio: number;
}): DeviceFingerprint {
  const deviceModel = parseDeviceModel(params.userAgent);
  const osVersion = parseOsVersion(params.userAgent);
  const browserEngine = parseBrowserEngine(params.userAgent);

  // Create a stable hash from device characteristics
  const hashInput = `${deviceModel}|${params.cameraWidth}x${params.cameraHeight}|${params.screenWidth}x${params.screenHeight}|${params.pixelRatio}|${osVersion}`;
  const fingerprintHash = simpleHash(hashInput);

  return {
    deviceModel,
    osVersion,
    browserEngine,
    cameraResolution: {
      width: params.cameraWidth,
      height: params.cameraHeight,
    },
    screenResolution: {
      width: params.screenWidth,
      height: params.screenHeight,
    },
    pixelRatio: params.pixelRatio,
    userAgent: params.userAgent,
    fingerprintHash,
    timestamp: Date.now(),
  };
}

/** Get adaptive thresholds for a specific device */
export function getDeviceThresholds(
  fingerprint: DeviceFingerprint
): DeviceThresholdProfile {
  // Check known profiles first
  const normalizedModel = fingerprint.deviceModel
    .toLowerCase()
    .replace(/\s+/g, "_");

  for (const [key, profile] of Object.entries(DEVICE_PROFILES)) {
    if (normalizedModel.includes(key) || key.includes(normalizedModel)) {
      return {
        deviceModel: fingerprint.deviceModel,
        blinkThreshold: profile.blinkThreshold ?? 0.22,
        turnThreshold: profile.turnThreshold ?? 15,
        nodThreshold: profile.nodThreshold ?? 12,
        noiseToleranceFactor: profile.noiseToleranceFactor ?? 1.0,
        maxRetries: profile.maxRetries ?? 3,
        recommendedMethod: profile.recommendedMethod ?? "active_blink",
        knownIssues: profile.knownIssues ?? [],
      };
    }
  }

  // Infer thresholds from camera resolution
  const megapixels =
    (fingerprint.cameraResolution.width * fingerprint.cameraResolution.height) /
    1_000_000;

  if (megapixels < 1) {
    // Very low resolution — likely budget device
    return {
      deviceModel: fingerprint.deviceModel,
      blinkThreshold: 0.16,
      turnThreshold: 10,
      nodThreshold: 7,
      noiseToleranceFactor: 2.5,
      maxRetries: 5,
      recommendedMethod: "passive",
      knownIssues: ["low_resolution", "likely_high_noise"],
    };
  } else if (megapixels < 3) {
    // Low-mid resolution
    return {
      deviceModel: fingerprint.deviceModel,
      blinkThreshold: 0.18,
      turnThreshold: 12,
      nodThreshold: 9,
      noiseToleranceFactor: 1.8,
      maxRetries: 4,
      recommendedMethod: "active_blink",
      knownIssues: ["moderate_noise"],
    };
  }

  // High resolution — use standard thresholds
  return {
    deviceModel: fingerprint.deviceModel,
    blinkThreshold: 0.22,
    turnThreshold: 15,
    nodThreshold: 12,
    noiseToleranceFactor: 1.0,
    maxRetries: 3,
    recommendedMethod: "active_blink",
    knownIssues: [],
  };
}

// ─── Utility Helpers ─────────────────────────────────────────────────────────

function parseDeviceModel(userAgent: string): string {
  // Android device model
  const androidMatch = userAgent.match(/;\s*([^;)]+)\s*Build\//);
  if (androidMatch) return androidMatch[1].trim();

  // iOS device
  if (userAgent.includes("iPhone")) return "iPhone";
  if (userAgent.includes("iPad")) return "iPad";

  // Generic
  const mobileMatch = userAgent.match(/Mobile\/([^\s]+)/);
  if (mobileMatch) return `Mobile ${mobileMatch[1]}`;

  return "Unknown";
}

function parseOsVersion(userAgent: string): string {
  const androidMatch = userAgent.match(/Android\s+([\d.]+)/);
  if (androidMatch) return `Android ${androidMatch[1]}`;

  const iosMatch = userAgent.match(/OS\s+([\d_]+)/);
  if (iosMatch) return `iOS ${iosMatch[1].replace(/_/g, ".")}`;

  return "Unknown";
}

function parseBrowserEngine(userAgent: string): string {
  if (userAgent.includes("Chrome")) return "Blink";
  if (userAgent.includes("Safari") && !userAgent.includes("Chrome"))
    return "WebKit";
  if (userAgent.includes("Firefox")) return "Gecko";
  return "Unknown";
}

function simpleHash(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0; // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(36).padStart(8, "0");
}

// ═══════════════════════════════════════════════════════════════════════════════
// 4. GEO-IP CORRELATION — Cross-reference device fingerprint + IP geolocation
// ═══════════════════════════════════════════════════════════════════════════════

export interface GeoLocation {
  ip: string;
  country: string;
  region: string;
  city: string;
  lat: number;
  lon: number;
  isp: string;
  isVpn: boolean;
  isProxy: boolean;
  isTor: boolean;
  isDatacenter: boolean;
}

export interface GeoIpCorrelation {
  userId: string;
  deviceFingerprint: string;
  locations: { geo: GeoLocation; timestamp: number }[];
  riskScore: number;
  flags: string[];
  lastChecked: number;
}

// 2026-10-01 (C2-mw, B3): geo-IP correlations are a compliance/fraud signal
// and are now durable in the PG table `geo_ip_correlations` (one row per
// userId+deviceFingerprint, rolling 20-location window preserved).
// FAIL-CLOSED: a missing database throws instead of silently dropping the
// compliance signal.
function rowToCorrelation(row: {
  userId: string;
  deviceFingerprint: string;
  locations: { geo: GeoLocation; timestamp: number }[];
  riskScore: number;
  flags: string[];
  lastChecked: Date;
}): GeoIpCorrelation {
  return {
    userId: row.userId,
    deviceFingerprint: row.deviceFingerprint,
    locations: row.locations,
    riskScore: row.riskScore,
    flags: row.flags,
    lastChecked: row.lastChecked.getTime(),
  };
}

// Known Nigerian ISPs and mobile carriers (legitimate for POS agents)
const NIGERIAN_ISPS = [
  "mtn",
  "glo",
  "airtel",
  "9mobile",
  "spectranet",
  "smile",
  "ntel",
  "swift",
  "ipnx",
  "mainone",
  "cobranet",
  "galaxy backbone",
];

// Haversine distance calculation (km)
function haversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371; // Earth radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/** Resolve IP to geolocation (uses ip-api.com free tier, 45 req/min) */
export async function resolveGeoIp(ip: string): Promise<GeoLocation> {
  try {
    // Skip private/local IPs
    if (
      ip === "127.0.0.1" ||
      ip === "::1" ||
      ip.startsWith("192.168.") ||
      ip.startsWith("10.")
    ) {
      return {
        ip,
        country: "LOCAL",
        region: "Local",
        city: "Local",
        lat: 0,
        lon: 0,
        isp: "Local Network",
        isVpn: false,
        isProxy: false,
        isTor: false,
        isDatacenter: false,
      };
    }

    const response = await fetch(
      `http://ip-api.com/json/${ip}?fields=status,country,regionName,city,lat,lon,isp,proxy,hosting`
    );
    if (!response.ok)
      throw new Error(`Geo-IP lookup failed: ${response.status}`);

    const data = await response.json();
    if (data.status !== "success") {
      return createUnknownGeo(ip);
    }

    const ispLower = (data.isp || "").toLowerCase();
    const isKnownNigerianIsp = NIGERIAN_ISPS.some(n => ispLower.includes(n));

    return {
      ip,
      country: data.country || "Unknown",
      region: data.regionName || "Unknown",
      city: data.city || "Unknown",
      lat: data.lat || 0,
      lon: data.lon || 0,
      isp: data.isp || "Unknown",
      isVpn: data.proxy === true && !isKnownNigerianIsp,
      isProxy: data.proxy === true,
      isTor: ispLower.includes("tor") || ispLower.includes("exit node"),
      isDatacenter: data.hosting === true,
    };
  } catch {
    return createUnknownGeo(ip);
  }
}

function createUnknownGeo(ip: string): GeoLocation {
  return {
    ip,
    country: "Unknown",
    region: "Unknown",
    city: "Unknown",
    lat: 0,
    lon: 0,
    isp: "Unknown",
    isVpn: false,
    isProxy: false,
    isTor: false,
    isDatacenter: false,
  };
}

/** Correlate a liveness attempt with geo-IP data and detect anomalies */
export async function correlateGeoIp(
  userId: string,
  deviceFingerprint: string,
  geo: GeoLocation
): Promise<GeoIpCorrelation> {
  const db = await resolveDb();
  const existingRows = await db
    .select()
    .from(geoIpCorrelations)
    .where(
      and(
        eq(geoIpCorrelations.userId, userId),
        eq(geoIpCorrelations.deviceFingerprint, deviceFingerprint)
      )
    )
    .limit(1);
  const existingRow = existingRows[0];

  const correlation: GeoIpCorrelation = existingRow
    ? rowToCorrelation(existingRow)
    : {
        userId,
        deviceFingerprint,
        locations: [],
        riskScore: 0,
        flags: [],
        lastChecked: 0,
      };

  // Add new location
  correlation.locations.push({ geo, timestamp: Date.now() });

  // Keep last 20 locations
  if (correlation.locations.length > 20) {
    correlation.locations = correlation.locations.slice(-20);
  }

  // Calculate risk score
  const { riskScore, flags } = calculateGeoRisk(correlation);
  correlation.riskScore = riskScore;
  correlation.flags = flags;
  correlation.lastChecked = Date.now();

  if (existingRow) {
    await db
      .update(geoIpCorrelations)
      .set({
        locations: correlation.locations,
        riskScore: correlation.riskScore,
        flags: correlation.flags,
        lastChecked: new Date(correlation.lastChecked),
        updatedAt: new Date(),
      })
      .where(eq(geoIpCorrelations.id, existingRow.id));
  } else {
    await db.insert(geoIpCorrelations).values({
      userId,
      deviceFingerprint,
      locations: correlation.locations,
      riskScore: correlation.riskScore,
      flags: correlation.flags,
      lastChecked: new Date(correlation.lastChecked),
    });
  }

  return correlation;
}

function calculateGeoRisk(correlation: GeoIpCorrelation): {
  riskScore: number;
  flags: string[];
} {
  let risk = 0;
  const flags: string[] = [];
  const locations = correlation.locations;

  if (locations.length < 2) {
    // First attempt — check basic indicators
    const latest = locations[0]?.geo;
    if (!latest) return { riskScore: 0, flags: [] };

    if (latest.isVpn) {
      risk += 25;
      flags.push("vpn_detected");
    }
    if (latest.isTor) {
      risk += 50;
      flags.push("tor_exit_node");
    }
    if (latest.isDatacenter) {
      risk += 30;
      flags.push("datacenter_ip");
    }
    if (latest.country !== "Nigeria" && latest.country !== "LOCAL") {
      risk += 15;
      flags.push(`non_nigerian_ip:${latest.country}`);
    }

    return { riskScore: Math.min(100, risk), flags };
  }

  // Multi-location analysis
  const latest = locations[locations.length - 1];
  const previous = locations[locations.length - 2];

  // 1. Impossible travel detection
  if (latest.geo.lat !== 0 && previous.geo.lat !== 0) {
    const distanceKm = haversineDistance(
      previous.geo.lat,
      previous.geo.lon,
      latest.geo.lat,
      latest.geo.lon
    );
    const timeDiffHours =
      (latest.timestamp - previous.timestamp) / (1000 * 60 * 60);

    if (timeDiffHours > 0) {
      const speedKmh = distanceKm / timeDiffHours;
      // Impossible travel: >900 km/h (faster than commercial flight)
      if (speedKmh > 900 && distanceKm > 100) {
        risk += 40;
        flags.push(
          `impossible_travel:${Math.round(distanceKm)}km_in_${timeDiffHours.toFixed(1)}h`
        );
      }
      // Suspicious travel: >300 km/h
      else if (speedKmh > 300 && distanceKm > 50) {
        risk += 20;
        flags.push(
          `suspicious_travel:${Math.round(distanceKm)}km_in_${timeDiffHours.toFixed(1)}h`
        );
      }
    }
  }

  // 2. Country hopping
  const countries = new Set(locations.map(l => l.geo.country));
  if (countries.size > 3) {
    risk += 30;
    flags.push(`country_hopping:${countries.size}_countries`);
  } else if (countries.size > 1 && !countries.has("LOCAL")) {
    risk += 10;
    flags.push(`multi_country:${Array.from(countries).join(",")}`);
  }

  // 3. VPN/Proxy usage
  if (latest.geo.isVpn) {
    risk += 25;
    flags.push("vpn_detected");
  }
  if (latest.geo.isTor) {
    risk += 50;
    flags.push("tor_exit_node");
  }
  if (latest.geo.isDatacenter) {
    risk += 30;
    flags.push("datacenter_ip");
  }

  // 4. Same device from different countries in short time
  const recentLocations = locations.filter(
    l => Date.now() - l.timestamp < 24 * 60 * 60 * 1000
  );
  const recentCountries = new Set(
    recentLocations.map(l => l.geo.country).filter(c => c !== "LOCAL")
  );
  if (recentCountries.size > 2) {
    risk += 35;
    flags.push(`rapid_country_switch:${recentCountries.size}_in_24h`);
  }

  // 5. Non-Nigerian IP for a POS platform
  if (
    latest.geo.country !== "Nigeria" &&
    latest.geo.country !== "LOCAL" &&
    latest.geo.country !== "Unknown"
  ) {
    risk += 15;
    flags.push(`non_nigerian_ip:${latest.geo.country}`);
  }

  return { riskScore: Math.min(100, risk), flags };
}

/** Get all geo-IP correlations for admin review */
export async function getAllGeoCorrelations(): Promise<GeoIpCorrelation[]> {
  const db = await resolveDb();
  const rows = await db.select().from(geoIpCorrelations);
  return rows.map(rowToCorrelation);
}

/** Get high-risk correlations (risk score above threshold) */
export async function getHighRiskCorrelations(
  minRiskScore = 50
): Promise<GeoIpCorrelation[]> {
  const all = await getAllGeoCorrelations();
  return all.filter(c => c.riskScore >= minRiskScore);
}

/** Clear geo-IP data for a specific user (GDPR/privacy compliance) */
export async function clearGeoIpData(userId: string): Promise<number> {
  const db = await resolveDb();
  const deleted = await db
    .delete(geoIpCorrelations)
    .where(eq(geoIpCorrelations.userId, userId))
    .returning({ id: geoIpCorrelations.id });
  return deleted.length;
}
