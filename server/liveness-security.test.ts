// @ts-check

/**
 * Liveness Security Enhancements Tests — Sprint 95 Phase 3
 *
 * Tests:
 *  1. Retry Cooldown (lockout after 3 failures, 5-min duration, reset on success)
 *  2. Server-side Passive Liveness (texture/frequency analysis)
 *  3. Device Fingerprinting (model detection, threshold adaptation, history tracking)
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  isLockedOut,
  recordLivenessFailure,
  recordLivenessSuccess,
  clearCooldown,
  getCooldownStatus,
  analyzePassiveLiveness,
  createDeviceFingerprint,
  getDeviceThresholds,
  recordDeviceLivenessAttempt,
  getDeviceLivenessHistory,
  getAllDeviceHistories,
  getProblematicDevices,
} from "./middleware/livenessSecurityEnhancements.js";

// ═══════════════════════════════════════════════════════════════════════════════
// 1. RETRY COOLDOWN TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe("Retry Cooldown", () => {
  const testUser = `test-user-${Date.now()}`;

  it("should not be locked out initially", () => {
    const userId = `fresh-user-${Date.now()}`;
    const result = isLockedOut(userId);
    expect(result.locked).toBe(false);
    expect(result.failures).toBe(0);
    expect(result.remainingMs).toBe(0);
  });

  it("should track failures without locking before threshold", () => {
    const userId = `track-user-${Date.now()}`;
    const r1 = recordLivenessFailure(userId);
    expect(r1.locked).toBe(false);
    expect(r1.failures).toBe(1);

    const r2 = recordLivenessFailure(userId);
    expect(r2.locked).toBe(false);
    expect(r2.failures).toBe(2);
  });

  it("should lock out after 3 failures", () => {
    const userId = `lock-user-${Date.now()}`;
    recordLivenessFailure(userId);
    recordLivenessFailure(userId);
    const r3 = recordLivenessFailure(userId);

    expect(r3.locked).toBe(true);
    expect(r3.failures).toBe(3);
    expect(r3.remainingMs).toBeGreaterThan(0);
    expect(r3.remainingMs).toBeLessThanOrEqual(5 * 60 * 1000);
  });

  it("should report locked status when checking", () => {
    const userId = `check-lock-${Date.now()}`;
    recordLivenessFailure(userId);
    recordLivenessFailure(userId);
    recordLivenessFailure(userId);

    const status = isLockedOut(userId);
    expect(status.locked).toBe(true);
    expect(status.remainingMs).toBeGreaterThan(0);
  });

  it("should reset failures on success", () => {
    const userId = `reset-user-${Date.now()}`;
    recordLivenessFailure(userId);
    recordLivenessFailure(userId);

    recordLivenessSuccess(userId);

    const status = isLockedOut(userId);
    expect(status.locked).toBe(false);
    expect(status.failures).toBe(0);
  });

  it("should allow admin to clear cooldown", () => {
    const userId = `admin-clear-${Date.now()}`;
    recordLivenessFailure(userId);
    recordLivenessFailure(userId);
    recordLivenessFailure(userId);

    expect(isLockedOut(userId).locked).toBe(true);

    const cleared = clearCooldown(userId);
    expect(cleared).toBe(true);
    expect(isLockedOut(userId).locked).toBe(false);
  });

  it("should include locked users in cooldown status", () => {
    const userId = `status-user-${Date.now()}`;
    recordLivenessFailure(userId);
    recordLivenessFailure(userId);
    recordLivenessFailure(userId);

    const statuses = getCooldownStatus();
    const found = statuses.find(s => s.userId === userId);
    expect(found).toBeDefined();
    expect(found!.failures).toBe(3);
    expect(found!.lockedUntil).not.toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. SERVER-SIDE PASSIVE LIVENESS TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe("Server-side Passive Liveness", () => {
  it("should return a complete analysis result", () => {
    // Create a synthetic image with natural-looking byte patterns
    const imageData = Buffer.alloc(10000);
    for (let i = 0; i < imageData.length; i++) {
      imageData[i] = Math.floor(Math.random() * 200) + 28; // Moderate values
    }
    const base64 = imageData.toString("base64");

    const result = analyzePassiveLiveness(base64);

    expect(result).toHaveProperty("isLive");
    expect(result).toHaveProperty("confidence");
    expect(result).toHaveProperty("textureScore");
    expect(result).toHaveProperty("frequencyScore");
    expect(result).toHaveProperty("colorConsistencyScore");
    expect(result).toHaveProperty("edgeDensityScore");
    expect(result).toHaveProperty("moireDetected");
    expect(result).toHaveProperty("screenReflectionDetected");
    expect(result).toHaveProperty("printArtifactsDetected");
    expect(result).toHaveProperty("analysisMethod");
    expect(result).toHaveProperty("processingTimeMs");
    expect(result.analysisMethod).toBe("passive_texture_frequency");
  });

  it("should detect uniform images as potential prints", () => {
    // Create a very uniform image (low entropy = print-like)
    const imageData = Buffer.alloc(10000);
    imageData.fill(128); // All same value
    const base64 = imageData.toString("base64");

    const result = analyzePassiveLiveness(base64);
    expect(result.textureScore).toBeLessThan(0.4);
  });

  it("should detect high-frequency periodic patterns as screen artifacts", () => {
    // Create alternating high/low values (moiré-like pattern)
    const imageData = Buffer.alloc(10000);
    for (let i = 0; i < imageData.length; i++) {
      imageData[i] = i % 2 === 0 ? 240 : 10; // Extreme alternation
    }
    const base64 = imageData.toString("base64");

    const result = analyzePassiveLiveness(base64);
    // High-frequency alternation should be flagged
    expect(result.frequencyScore).toBeLessThan(0.5);
  });

  it("should detect screen reflections from bright pixels", () => {
    // Create image with >5% very bright pixels
    const imageData = Buffer.alloc(10000);
    for (let i = 0; i < imageData.length; i++) {
      imageData[i] = i < 600 ? 250 : Math.floor(Math.random() * 150) + 50;
    }
    const base64 = imageData.toString("base64");

    const result = analyzePassiveLiveness(base64);
    expect(result.screenReflectionDetected).toBe(true);
  });

  it("should produce confidence between 0 and 1", () => {
    const imageData = Buffer.alloc(5000);
    for (let i = 0; i < imageData.length; i++) {
      imageData[i] = Math.floor(Math.random() * 256);
    }
    const base64 = imageData.toString("base64");

    const result = analyzePassiveLiveness(base64);
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });

  it("should process quickly (< 100ms for typical image)", () => {
    const imageData = Buffer.alloc(50000);
    for (let i = 0; i < imageData.length; i++) {
      imageData[i] = Math.floor(Math.random() * 256);
    }
    const base64 = imageData.toString("base64");

    const result = analyzePassiveLiveness(base64);
    expect(result.processingTimeMs).toBeLessThan(100);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. DEVICE FINGERPRINTING TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe("Device Fingerprinting", () => {
  it("should create a fingerprint from device info", () => {
    const fp = createDeviceFingerprint({
      userAgent:
        "Mozilla/5.0 (Linux; Android 12; TECNO Pop 7 Build/SP1A.210812.016) AppleWebKit/537.36",
      cameraWidth: 640,
      cameraHeight: 480,
      screenWidth: 720,
      screenHeight: 1600,
      pixelRatio: 2,
    });

    expect(fp.deviceModel).toContain("TECNO Pop 7");
    expect(fp.osVersion).toBe("Android 12");
    expect(["Blink", "Unknown"]).toContain(fp.browserEngine);
    expect(fp.cameraResolution).toEqual({ width: 640, height: 480 });
    expect(fp.fingerprintHash).toBeTruthy();
    expect(fp.fingerprintHash.length).toBeGreaterThan(0);
  });

  it("should detect iPhone device model", () => {
    const fp = createDeviceFingerprint({
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
      cameraWidth: 1920,
      cameraHeight: 1080,
      screenWidth: 390,
      screenHeight: 844,
      pixelRatio: 3,
    });

    expect(fp.deviceModel).toBe("iPhone");
    expect(fp.osVersion).toBe("iOS 17.0");
    expect(["WebKit", "Unknown"]).toContain(fp.browserEngine);
  });

  it("should return relaxed thresholds for known budget devices", () => {
    const fp = createDeviceFingerprint({
      userAgent:
        "Mozilla/5.0 (Linux; Android 12; itel A60s Build/SP1A.210812.016) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0",
      cameraWidth: 320,
      cameraHeight: 240,
      screenWidth: 540,
      screenHeight: 960,
      pixelRatio: 1.5,
    });

    const thresholds = getDeviceThresholds(fp);
    // Budget device should have relaxed thresholds
    expect(thresholds.blinkThreshold).toBeLessThan(0.22);
    expect(thresholds.noiseToleranceFactor).toBeGreaterThan(1.0);
    expect(thresholds.maxRetries).toBeGreaterThanOrEqual(4);
  });

  it("should return standard thresholds for high-end devices", () => {
    const fp = createDeviceFingerprint({
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
      cameraWidth: 1920,
      cameraHeight: 1080,
      screenWidth: 390,
      screenHeight: 844,
      pixelRatio: 3,
    });

    const thresholds = getDeviceThresholds(fp);
    expect(thresholds.blinkThreshold).toBeGreaterThanOrEqual(0.2);
    expect(thresholds.noiseToleranceFactor).toBeLessThanOrEqual(1.5);
    expect(thresholds.maxRetries).toBeLessThanOrEqual(4);
  });

  it("should infer thresholds from camera resolution for unknown devices", () => {
    const fp = createDeviceFingerprint({
      userAgent:
        "Mozilla/5.0 (Linux; Android 11; Unknown Device Build/RQ3A) AppleWebKit/537.36",
      cameraWidth: 320,
      cameraHeight: 240,
      screenWidth: 480,
      screenHeight: 800,
      pixelRatio: 1,
    });

    const thresholds = getDeviceThresholds(fp);
    // Very low resolution (0.08MP) should get passive recommendation
    expect(thresholds.recommendedMethod).toBe("passive");
    expect(thresholds.noiseToleranceFactor).toBeGreaterThanOrEqual(2.0);
  });

  it("should record and retrieve device liveness history", () => {
    const fp = createDeviceFingerprint({
      userAgent:
        "Mozilla/5.0 (Linux; Android 12; Samsung A04 Build/SP1A) AppleWebKit/537.36",
      cameraWidth: 1280,
      cameraHeight: 720,
      screenWidth: 720,
      screenHeight: 1600,
      pixelRatio: 2,
    });

    recordDeviceLivenessAttempt(fp, true, "active_blink", 0.85);
    recordDeviceLivenessAttempt(fp, false, "active_blink", 0.35);
    recordDeviceLivenessAttempt(fp, true, "active_blink", 0.78);

    const history = getDeviceLivenessHistory(fp.fingerprintHash);
    expect(history).not.toBeNull();
    expect(history!.attempts.length).toBe(3);
    expect(history!.successRate).toBeCloseTo(2 / 3, 2);
    expect(history!.avgScore).toBeCloseTo((0.85 + 0.35 + 0.78) / 3, 2);
  });

  it("should identify problematic devices", () => {
    // Create a device with many failures
    const fp = createDeviceFingerprint({
      userAgent:
        "Mozilla/5.0 (Linux; Android 10; Problem Device Build/QQ3A) AppleWebKit/537.36",
      cameraWidth: 640,
      cameraHeight: 480,
      screenWidth: 720,
      screenHeight: 1280,
      pixelRatio: 2,
    });

    // Record 6 failures and 1 success (14% success rate)
    for (let i = 0; i < 6; i++) {
      recordDeviceLivenessAttempt(
        fp,
        false,
        "active_blink",
        0.2 + Math.random() * 0.1
      );
    }
    recordDeviceLivenessAttempt(fp, true, "active_blink", 0.6);

    const problematic = getProblematicDevices(5, 0.5);
    const found = problematic.find(d => d.fingerprint === fp.fingerprintHash);
    expect(found).toBeDefined();
    expect(found!.successRate).toBeLessThan(0.5);
  });

  it("should produce consistent fingerprint hashes for same device", () => {
    const params = {
      userAgent:
        "Mozilla/5.0 (Linux; Android 12; TECNO Pop 7 Build/SP1A) AppleWebKit/537.36",
      cameraWidth: 640,
      cameraHeight: 480,
      screenWidth: 720,
      screenHeight: 1600,
      pixelRatio: 2,
    };

    const fp1 = createDeviceFingerprint(params);
    const fp2 = createDeviceFingerprint(params);
    expect(fp1.fingerprintHash).toBe(fp2.fingerprintHash);
  });

  it("should produce different hashes for different devices", () => {
    const fp1 = createDeviceFingerprint({
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) AppleWebKit/605.1.15",
      cameraWidth: 1920,
      cameraHeight: 1080,
      screenWidth: 390,
      screenHeight: 844,
      pixelRatio: 3,
    });

    const fp2 = createDeviceFingerprint({
      userAgent:
        "Mozilla/5.0 (Linux; Android 12; Samsung A04) AppleWebKit/537.36",
      cameraWidth: 1280,
      cameraHeight: 720,
      screenWidth: 720,
      screenHeight: 1600,
      pixelRatio: 2,
    });

    expect(fp1.fingerprintHash).not.toBe(fp2.fingerprintHash);
  });

  it("should return all device histories for admin dashboard", () => {
    const histories = getAllDeviceHistories();
    expect(Array.isArray(histories)).toBe(true);
    // Should have entries from previous tests
    expect(histories.length).toBeGreaterThan(0);
  });
});
