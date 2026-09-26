/**
 * telematicsScoring.ts — Q-wave Q3 (2026-09-25): usage-based motor (UBI)
 * trip scoring and bounded rating factor.
 *
 * Deterministic, explainable scoring (Zego/Root-style lite model):
 *   tripScore = 100 − deductions, clamped 0..100
 *     hard brake        −2.0 each
 *     speeding event    −3.0 each
 *     aggressive corner −1.5 each
 *     night driving     −5.0 × (nightSeconds / durationSeconds)
 *     maxSpeed > 120    −10 once
 *
 * Rolling score = distance-weighted mean of trip scores over the trailing
 * window (default 30 days). Rating factor is bounded 0.70–1.30:
 *   factor = 1.30 − 0.60 × (score / 100)   →  score 100 ⇒ 0.70 (max discount)
 *                                            score  50 ⇒ 1.00 (neutral)
 *                                            score   0 ⇒ 1.30 (max loading)
 * No score history ⇒ factor 1.00 (default, never an implicit discount).
 */

export const TELEMATICS_WINDOW_DAYS_DEFAULT = 30;
export const RATING_FACTOR_MIN = 0.7;
export const RATING_FACTOR_MAX = 1.3;
export const RATING_FACTOR_DEFAULT = 1.0;

export interface TripInput {
  distanceKm: number;
  durationSeconds: number;
  hardBrakes: number;
  speedingEvents: number;
  corneringEvents: number;
  nightDrivingSeconds: number;
  maxSpeedKmh?: number | null;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const r2 = (n: number) => Math.round(n * 100) / 100;

export function scoreTrip(t: TripInput): number {
  let score = 100;
  score -= 2.0 * t.hardBrakes;
  score -= 3.0 * t.speedingEvents;
  score -= 1.5 * t.corneringEvents;
  if (t.durationSeconds > 0) {
    score -= 5.0 * clamp(t.nightDrivingSeconds / t.durationSeconds, 0, 1);
  }
  if (t.maxSpeedKmh != null && t.maxSpeedKmh > 120) score -= 10;
  return r2(clamp(score, 0, 100));
}

/** Distance-weighted rolling score; falls back to a plain mean for zero-distance trips. */
export function rollingScore(trips: Array<{ tripScore: number; distanceKm: number }>): number {
  if (trips.length === 0) return 0;
  const totalDist = trips.reduce((s, t) => s + t.distanceKm, 0);
  if (totalDist <= 0) {
    return r2(trips.reduce((s, t) => s + t.tripScore, 0) / trips.length);
  }
  const weighted = trips.reduce((s, t) => s + t.tripScore * t.distanceKm, 0);
  return r2(weighted / totalDist);
}

/** Score (0–100) → bounded rating factor (0.70–1.30). */
export function ratingFactorFromScore(score: number): number {
  return r2(clamp(1.3 - 0.6 * (clamp(score, 0, 100) / 100), RATING_FACTOR_MIN, RATING_FACTOR_MAX));
}
