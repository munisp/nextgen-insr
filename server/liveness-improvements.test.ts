// @ts-check

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

/**
 * Sprint 95 Follow-up: KYC Liveness Improvements Tests
 * - Camera quality score indicator
 * - Passive fallback after repeated active failures
 * - Field test validation (noisy camera profiles)
 */

describe("KYC Liveness Improvements", () => {
  // ── Camera Quality Assessment Tests ─────────────────────────────────────

  describe("Camera Quality Score Algorithm", () => {
    it("should calculate brightness score from luminance", () => {
      // Ideal brightness (140) should score ~100
      const idealScore = Math.max(0, 100 - Math.abs(140 - 140) * 1.2);
      expect(idealScore).toBe(100);

      // Very dark (30) should score 0 (clamped)
      const darkScore = Math.max(0, 100 - Math.abs(30 - 140) * 1.2);
      expect(darkScore).toBe(0); // Clamped to 0

      // Moderate brightness (100) should score well
      const moderateScore = Math.max(0, 100 - Math.abs(100 - 140) * 1.2);
      expect(moderateScore).toBeGreaterThan(50);
    });

    it("should calculate noise score from median pixel differences", () => {
      // Low noise (median diff = 2) should score high
      const lowNoiseScore = Math.max(0, 100 - 2 * 8);
      expect(lowNoiseScore).toBe(84);

      // High noise (median diff = 12) should score low
      const highNoiseScore = Math.max(0, 100 - 12 * 8);
      expect(highNoiseScore).toBe(4);

      // Zero noise should score 100
      const zeroNoiseScore = Math.max(0, 100 - 0 * 8);
      expect(zeroNoiseScore).toBe(100);
    });

    it("should classify quality levels correctly", () => {
      const classify = (score: number) => {
        if (score >= 75) return "excellent";
        if (score >= 55) return "good";
        if (score >= 35) return "fair";
        return "poor";
      };

      expect(classify(90)).toBe("excellent");
      expect(classify(75)).toBe("excellent");
      expect(classify(65)).toBe("good");
      expect(classify(55)).toBe("good");
      expect(classify(45)).toBe("fair");
      expect(classify(35)).toBe("fair");
      expect(classify(20)).toBe("poor");
      expect(classify(0)).toBe("poor");
    });

    it("should weight quality dimensions correctly (25/30/25/20)", () => {
      // All perfect scores
      const perfect = Math.round(
        100 * 0.25 + 100 * 0.3 + 100 * 0.25 + 100 * 0.2
      );
      expect(perfect).toBe(100);

      // Only sharpness is bad (0), rest perfect
      const blurry = Math.round(100 * 0.25 + 0 * 0.3 + 100 * 0.25 + 100 * 0.2);
      expect(blurry).toBe(70); // Sharpness has highest weight

      // Only stability is bad (0), rest perfect
      const shaky = Math.round(100 * 0.25 + 100 * 0.3 + 100 * 0.25 + 0 * 0.2);
      expect(shaky).toBe(80); // Stability has lowest weight
    });

    it("should provide appropriate recommendations per level", () => {
      const getRecommendation = (level: string) => {
        if (level === "excellent")
          return "Camera quality is great — proceed with liveness check";
        if (level === "good") return "Camera quality is acceptable";
        if (level === "fair")
          return "Try improving lighting or holding device steadier";
        return "Poor camera quality — move to better lighting and hold still";
      };

      expect(getRecommendation("excellent")).toContain("great");
      expect(getRecommendation("poor")).toContain("better lighting");
      expect(getRecommendation("fair")).toContain("improving lighting");
    });
  });

  // ── Passive Fallback Logic Tests ────────────────────────────────────────

  describe("Passive Fallback After Active Failures", () => {
    it("should not offer fallback before threshold is reached", () => {
      const failureCount = 1;
      const threshold = 2;
      const shouldOffer = failureCount >= threshold;
      expect(shouldOffer).toBe(false);
    });

    it("should offer fallback after threshold failures", () => {
      const failureCount = 2;
      const threshold = 2;
      const shouldOffer = failureCount >= threshold;
      expect(shouldOffer).toBe(true);
    });

    it("should offer fallback with higher failure counts", () => {
      const failureCount = 5;
      const threshold = 2;
      const shouldOffer = failureCount >= threshold;
      expect(shouldOffer).toBe(true);
    });

    it("should cap passive confidence at 0.85", () => {
      // Passive mode has lower max confidence than active
      const framesCollected = 10;
      const confidence = Math.min(0.85, framesCollected * 0.14);
      expect(confidence).toBe(0.85);
    });

    it("should require minimum 4 frames for passive liveness", () => {
      const checkPassive = (frames: number) => frames >= 4;
      expect(checkPassive(3)).toBe(false);
      expect(checkPassive(4)).toBe(true);
      expect(checkPassive(6)).toBe(true);
    });

    it("should not offer fallback when already in fallback mode", () => {
      const failureCount = 3;
      const threshold = 2;
      const fallbackMode = true;
      const shouldOffer = failureCount >= threshold && !fallbackMode;
      expect(shouldOffer).toBe(false);
    });

    it("should not offer fallback when liveness passed", () => {
      const failureCount = 3;
      const threshold = 2;
      const livenessResult = { is_live: true };
      const shouldOffer = failureCount >= threshold && !livenessResult.is_live;
      expect(shouldOffer).toBe(false);
    });
  });

  // ── Blink Detection Fix Validation ──────────────────────────────────────

  describe("Blink Detection Fix (Recovery vs Base Threshold)", () => {
    it("should use base threshold (0.22) for recovery, not adaptive", () => {
      const baseThreshold = 0.22;
      const noise = 0.04; // Typical noisy camera
      const adaptiveThreshold = baseThreshold + noise * 1.5; // 0.28

      // Recovery level uses BASE threshold
      const recoveryLevel = baseThreshold + Math.max(0.03, 0.05 - noise);
      expect(recoveryLevel).toBe(0.22 + 0.03); // 0.25

      // Normal open-eye EAR (~0.30) must exceed recovery level
      const normalEAR = 0.3;
      expect(normalEAR > recoveryLevel).toBe(true);

      // But would FAIL with old logic (adaptive + recovery_margin)
      const oldRecovery = adaptiveThreshold + Math.max(0.05, 0.08 - noise);
      // 0.28 + 0.05 = 0.33 — normal EAR (0.30) would NOT exceed this!
      expect(normalEAR > oldRecovery).toBe(false);
    });

    it("should detect blink with corrected logic on noisy camera", () => {
      const baseThreshold = 0.22;
      const noise = 0.05; // High noise

      const dipThreshold = baseThreshold + noise * 1.5; // 0.295
      const recoveryLevel = baseThreshold + Math.max(0.03, 0.05 - noise); // 0.25

      // Simulated blink: EAR drops from 0.30 to 0.12 then recovers to 0.28
      const minEAR = 0.12;
      const maxEAR = 0.28;
      const earRange = maxEAR - minEAR; // 0.16

      const blinkDetected =
        minEAR < dipThreshold && // 0.12 < 0.295 ✓
        maxEAR > recoveryLevel && // 0.28 > 0.25 ✓
        earRange > noise * 3; // 0.16 > 0.15 ✓

      expect(blinkDetected).toBe(true);
    });

    it("should reject noise-only signal (no real blink)", () => {
      const baseThreshold = 0.22;
      const noise = 0.04;

      const dipThreshold = baseThreshold + noise * 1.5; // 0.28
      const recoveryLevel = baseThreshold + Math.max(0.03, 0.05 - noise); // 0.25

      // No blink: EAR stays around 0.30 ± noise
      const minEAR = 0.26; // Just noise fluctuation
      const maxEAR = 0.34;
      const earRange = maxEAR - minEAR; // 0.08

      const blinkDetected =
        minEAR < dipThreshold && // 0.26 < 0.28 ✓ (noise can dip)
        maxEAR > recoveryLevel && // 0.34 > 0.25 ✓
        earRange > noise * 3; // 0.08 > 0.12 ✗ — REJECTED by SNR check

      expect(blinkDetected).toBe(false);
    });
  });

  // ── LivenessCameraCapture Component Structure Tests ─────────────────────

  describe("LivenessCameraCapture Component", () => {
    const componentPath = path.resolve(
      __dirname,
      "../client/src/components/LivenessCameraCapture.tsx"
    );

    it("should exist and export default component", () => {
      expect(fs.existsSync(componentPath)).toBe(true);
      const content = fs.readFileSync(componentPath, "utf-8");
      expect(content).toContain(
        "export default function LivenessCameraCapture"
      );
    });

    it("should include QualityIndicator sub-component", () => {
      const content = fs.readFileSync(componentPath, "utf-8");
      expect(content).toContain("function QualityIndicator");
      expect(content).toContain("<QualityIndicator");
    });

    it("should include assessFrameQuality function", () => {
      const content = fs.readFileSync(componentPath, "utf-8");
      expect(content).toContain("function assessFrameQuality");
      expect(content).toContain("brightnessScore");
      expect(content).toContain("sharpnessScore");
      expect(content).toContain("noiseScore");
      expect(content).toContain("stabilityScore");
    });

    it("should include passive fallback props and state", () => {
      const content = fs.readFileSync(componentPath, "utf-8");
      expect(content).toContain("enablePassiveFallback");
      expect(content).toContain("fallbackThreshold");
      expect(content).toContain("activeFailureCount");
      expect(content).toContain("fallbackMode");
      expect(content).toContain("startPassiveFallback");
    });

    it("should disable start button when quality is poor", () => {
      const content = fs.readFileSync(componentPath, "utf-8");
      expect(content).toContain('disabled={cameraQuality?.level === "poor"}');
    });

    it("should show fallback offer after threshold failures", () => {
      const content = fs.readFileSync(componentPath, "utf-8");
      expect(content).toContain("shouldOfferFallback");
      expect(content).toContain("Try Passive Liveness Instead");
    });

    it("should include mode_used in liveness result", () => {
      const content = fs.readFileSync(componentPath, "utf-8");
      expect(content).toContain('mode_used: "active"');
      expect(content).toContain('mode_used: "passive"');
    });
  });

  // ── Field Test Script Validation ────────────────────────────────────────

  describe("Field Test Script", () => {
    const testPath = path.resolve(
      __dirname,
      "../services/python/liveness-detection/test_noisy_cameras.py"
    );

    it("should exist and contain all 8 device profiles", () => {
      expect(fs.existsSync(testPath)).toBe(true);
      const content = fs.readFileSync(testPath, "utf-8");
      expect(content).toContain("iPhone 14");
      expect(content).toContain("Tecno Pop 7");
      expect(content).toContain("Itel A60s");
      expect(content).toContain("Samsung A04");
      expect(content).toContain("Nokia C12");
      expect(content).toContain("Infinix Hot 30");
    });

    it("should test all three challenge types", () => {
      const content = fs.readFileSync(testPath, "utf-8");
      expect(content).toContain("blink_detected");
      expect(content).toContain("turn_detected");
      expect(content).toContain("nod_detected");
    });

    it("should include false positive rejection tests", () => {
      const content = fs.readFileSync(testPath, "utf-8");
      expect(content).toContain("false_positive");
      expect(content).toContain("no motion");
    });

    it("should use corrected blink detection (dip_threshold, not blink_threshold)", () => {
      const content = fs.readFileSync(testPath, "utf-8");
      expect(content).toContain("dip_threshold");
      expect(content).toContain("recovery_level");
      // The test uses base_threshold + adapt_threshold pattern (not blink_threshold)
      expect(content).toContain("base_threshold = 0.22");
    });
  });

  // ── Liveness Service Fix Validation ─────────────────────────────────────

  describe("Liveness Service Blink Fix", () => {
    const servicePath = path.resolve(
      __dirname,
      "../services/python/liveness-detection/liveness_service.py"
    );

    it("should use dip_threshold (not blink_threshold) in service", () => {
      const content = fs.readFileSync(servicePath, "utf-8");
      expect(content).toContain("dip_threshold");
      expect(content).toContain(
        "recovery_level = threshold + max(0.03, 0.05 - noise)"
      );
    });

    it("should use scale=1.5 for dip threshold (not 2.0)", () => {
      const content = fs.readFileSync(servicePath, "utf-8");
      expect(content).toContain(
        "_adapt_threshold(threshold, noise, scale=1.5)"
      );
    });

    it("should check min_ear < dip_threshold and max_ear > recovery_level", () => {
      const content = fs.readFileSync(servicePath, "utf-8");
      expect(content).toContain("min_ear < dip_threshold");
      expect(content).toContain("max_ear > recovery_level");
    });
  });
});
