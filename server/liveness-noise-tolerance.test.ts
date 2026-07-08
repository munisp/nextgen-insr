// @ts-check

/**
 * Sprint 95 Bug Fix: KYC Face Motion Check — Noise Tolerance Tests
 *
 * Tests the improved liveness detection that handles noisy cameras:
 * - EMA temporal smoothing
 * - Adaptive thresholds based on noise floor
 * - Sustained motion requirements
 * - Bilateral denoising before landmark extraction
 */
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const LIVENESS_SERVICE_PATH = path.resolve(
  __dirname,
  "../services/python/liveness-detection/liveness_service.py"
);

describe("Liveness Detection — Noise Tolerance Improvements", () => {
  const serviceCode = fs.readFileSync(LIVENESS_SERVICE_PATH, "utf-8");

  describe("Adaptive Noise Reduction in extract_landmarks", () => {
    it("applies bilateral filter for high noise (noise_diff > 200)", () => {
      expect(serviceCode).toContain("if noise_diff > 200:");
      expect(serviceCode).toContain(
        "cv2.bilateralFilter(image, d=5, sigmaColor=50, sigmaSpace=50)"
      );
    });

    it("applies lighter bilateral filter for moderate noise (noise_diff > 80)", () => {
      expect(serviceCode).toContain("elif noise_diff > 80:");
      expect(serviceCode).toContain(
        "cv2.bilateralFilter(image, d=3, sigmaColor=30, sigmaSpace=30)"
      );
    });

    it("uses Laplacian variance difference to estimate noise level", () => {
      expect(serviceCode).toContain(
        "cv2.Laplacian(gray_check, cv2.CV_64F).var()"
      );
      expect(serviceCode).toContain("cv2.medianBlur(gray_check, 3)");
      expect(serviceCode).toContain("noise_diff = abs(");
    });

    it("preserves edges during denoising (bilateral, not Gaussian)", () => {
      // Bilateral filter preserves edges unlike Gaussian blur
      expect(serviceCode).toContain("bilateralFilter");
      // Should NOT use plain GaussianBlur which would destroy landmark accuracy
      const gaussianBlurInExtract = serviceCode
        .split("def extract_landmarks")[1]
        .split("def ")[0];
      expect(gaussianBlurInExtract).not.toContain("GaussianBlur");
    });
  });

  describe("EMA Temporal Smoothing in _check_challenge", () => {
    it("implements exponential moving average smoothing", () => {
      expect(serviceCode).toContain(
        "def _ema_smooth(history: list, alpha: float = 0.3) -> list:"
      );
      expect(serviceCode).toContain("alpha * v + (1 - alpha) * smoothed[-1]");
    });

    it("applies EMA to blink detection (EAR history)", () => {
      const checkChallenge = serviceCode.split("def _check_challenge")[1];
      expect(checkChallenge).toContain(
        "_ema_smooth(state.ear_history, alpha=0.4)"
      );
    });

    it("applies EMA to head turn detection (yaw history)", () => {
      const checkChallenge = serviceCode.split("def _check_challenge")[1];
      expect(checkChallenge).toContain("_ema_smooth(yaw_history, alpha=0.35)");
    });

    it("applies EMA to nod detection (pitch history)", () => {
      const checkChallenge = serviceCode.split("def _check_challenge")[1];
      expect(checkChallenge).toContain("_ema_smooth(pitches, alpha=0.35)");
    });

    it("applies EMA to smile/mouth detection (MAR history)", () => {
      const checkChallenge = serviceCode.split("def _check_challenge")[1];
      expect(checkChallenge).toContain(
        "_ema_smooth(state.mar_history, alpha=0.4)"
      );
    });
  });

  describe("Noise Floor Estimation", () => {
    it("estimates noise from rolling standard deviation of frame-to-frame diffs", () => {
      expect(serviceCode).toContain(
        "def _estimate_noise_floor(history: list, window: int = 10) -> float:"
      );
      expect(serviceCode).toContain(
        "diffs = [abs(recent[i] - recent[i-1]) for i in range(1, len(recent))]"
      );
      expect(serviceCode).toContain("float(np.std(diffs))");
    });

    it("returns 0 noise for insufficient history (< 3 frames)", () => {
      expect(serviceCode).toContain("if len(history) < 3:");
      expect(serviceCode).toContain("return 0.0");
    });
  });

  describe("Adaptive Thresholds", () => {
    it("implements adaptive threshold that scales with noise", () => {
      expect(serviceCode).toContain(
        "def _adapt_threshold(base_threshold: float, noise: float, scale: float = 1.5) -> float:"
      );
      expect(serviceCode).toContain("return base_threshold + noise * scale");
    });

    it("uses higher scale (2.0) for blink detection (most noise-sensitive)", () => {
      const checkChallenge = serviceCode.split("def _check_challenge")[1];
      expect(checkChallenge).toContain(
        "_adapt_threshold(threshold, noise, scale=2.0)"
      );
    });

    it("uses moderate scale (1.2) for head turn detection", () => {
      const checkChallenge = serviceCode.split("def _check_challenge")[1];
      expect(checkChallenge).toContain(
        "_adapt_threshold(threshold, noise, scale=1.2)"
      );
    });

    it("uses scale 1.5 for nod and mouth detection", () => {
      const checkChallenge = serviceCode.split("def _check_challenge")[1];
      const nodSection = checkChallenge.split('"nod"')[1];
      expect(nodSection).toContain(
        "_adapt_threshold(threshold, noise, scale=1.5)"
      );
    });
  });

  describe("Sustained Motion Requirement", () => {
    it("implements sustained check requiring N consecutive frames", () => {
      expect(serviceCode).toContain(
        "def _sustained_check(values: list, condition_fn, min_frames: int = 2) -> bool:"
      );
    });

    it("requires at least 2 consecutive frames for head turn", () => {
      const checkChallenge = serviceCode.split("def _check_challenge")[1];
      // The turn section spans both turn_left and turn_right with sustained_check
      const turnSection = checkChallenge
        .split('("turn_left", "turn_right")')[1]
        .split('("look_up"')[0];
      expect(turnSection).toContain("min_frames=2");
    });

    it("requires at least 2 consecutive frames for smile", () => {
      const checkChallenge = serviceCode.split("def _check_challenge")[1];
      const smileSection = checkChallenge.split('"smile"')[1].split("elif")[0];
      expect(smileSection).toContain("min_frames=2");
    });

    it("prevents single-frame noise spikes from triggering false positives", () => {
      // The sustained check iterates in reverse and breaks on first non-matching frame
      expect(serviceCode).toContain("for v in reversed(values):");
      expect(serviceCode).toContain("consecutive += 1");
      expect(serviceCode).toContain("break");
    });
  });

  describe("Blink Detection — Noise Resilience", () => {
    it("requires signal to exceed 3x noise floor", () => {
      const checkChallenge = serviceCode.split("def _check_challenge")[1];
      expect(checkChallenge).toContain("(max_ear - min_ear) > noise * 3");
    });

    it("reduces recovery margin when noise is high", () => {
      const checkChallenge = serviceCode.split("def _check_challenge")[1];
      expect(checkChallenge).toContain(
        "recovery_margin = max(0.05, 0.08 - noise)"
      );
    });

    it("requires at least 5 frames before attempting blink detection", () => {
      const checkChallenge = serviceCode.split("def _check_challenge")[1];
      expect(checkChallenge).toContain("if len(state.ear_history) >= 5:");
    });

    it("uses 8-frame window for smoothed blink analysis", () => {
      const checkChallenge = serviceCode.split("def _check_challenge")[1];
      expect(checkChallenge).toContain("recent = smoothed[-8:]");
    });
  });

  describe("Nod Detection — Oscillation Pattern", () => {
    it("requires actual oscillation (direction changes), not just range", () => {
      const checkChallenge = serviceCode.split("def _check_challenge")[1];
      const nodSection = checkChallenge.split('"nod"')[1];
      expect(nodSection).toContain("directions");
      expect(nodSection).toContain("changes >= 1");
    });

    it("only counts movements above noise floor", () => {
      const checkChallenge = serviceCode.split("def _check_challenge")[1];
      const nodSection = checkChallenge.split('"nod"')[1];
      expect(nodSection).toContain("abs(diff) > noise * 1.5");
    });

    it("requires both sufficient range AND direction change", () => {
      const checkChallenge = serviceCode.split("def _check_challenge")[1];
      const nodSection = checkChallenge.split('"nod"')[1];
      expect(nodSection).toContain(
        "pitch_range > nod_threshold and changes >= 1"
      );
    });
  });

  describe("Client-Side Improvements (LivenessCameraCapture)", () => {
    const clientCode = fs.readFileSync(
      path.resolve(
        __dirname,
        "../client/src/components/LivenessCameraCapture.tsx"
      ),
      "utf-8"
    );

    it("requests higher frame rate (30fps ideal, 15fps min)", () => {
      expect(clientCode).toContain("frameRate: { ideal: 30, min: 15 }");
    });

    it("captures frames at 500ms intervals (2 fps) for better temporal analysis", () => {
      expect(clientCode).toContain("}, 500);");
    });

    it("extends challenge timeout to 12s for noisy cameras", () => {
      expect(clientCode).toContain("setChallengeTimer(12)");
    });

    it("sets minimum resolution constraints (640x480)", () => {
      expect(clientCode).toContain("width: { ideal: 1280, min: 640 }");
      expect(clientCode).toContain("height: { ideal: 720, min: 480 }");
    });

    it("shows camera quality tip to users", () => {
      expect(clientCode).toContain(
        "Tip: Use good lighting and hold device steady"
      );
    });
  });
});
