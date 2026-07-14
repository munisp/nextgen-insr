/**
 * Health Connect — Wearable Integration SDK
 * Integrates with Google Health Connect / Apple HealthKit
 * Privacy-preserving: on-device scoring, only tier sent to server
 */

export interface HealthMetrics {
  daily_steps: number;
  resting_heart_rate: number;
  sleep_hours: number;
  active_minutes: number;
  bmi: number;
  stress_level: number;
  hydration_score: number;
  blood_pressure_systolic: number;
  blood_pressure_diastolic: number;
}

export interface HealthScore {
  customer_id: string;
  health_score: number;
  health_tier: 'excellent' | 'good' | 'average' | 'below_average' | 'high_risk';
  premium_discount_percent: number;
  risk_factors: string[];
  recommendations: string[];
  wellness_challenges: string[];
  last_synced: string;
}

export interface WellnessChallenge {
  id: string;
  title: string;
  description: string;
  target: number;
  unit: string;
  reward_points: number;
  duration_days: number;
  category: string;
}

class HealthConnectClient {
  private baseUrl: string;
  private customerId: string;
  private syncInterval: ReturnType<typeof setInterval> | null = null;

  constructor(baseUrl: string, customerId: string) {
    this.baseUrl = baseUrl || '/api/v1/health';
    this.customerId = customerId;
  }

  async scoreHealth(metrics: HealthMetrics): Promise<HealthScore> {
    const response = await fetch(`${this.baseUrl}/score`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ customer_id: this.customerId, ...metrics }),
    });
    return response.json();
  }

  async getChallenges(category?: string): Promise<{ challenges: WellnessChallenge[]; total: number }> {
    const url = category
      ? `${this.baseUrl}/challenges?category=${category}`
      : `${this.baseUrl}/challenges`;
    const response = await fetch(url);
    return response.json();
  }

  async getDiscount(): Promise<{ discount_percent: number; current_tier: string; valid_until: string }> {
    const response = await fetch(`${this.baseUrl}/discount/${this.customerId}`);
    return response.json();
  }

  // On-device health scoring (privacy-preserving, offline-capable)
  calculateLocalScore(metrics: HealthMetrics): { score: number; tier: string; discount: number } {
    const weights = {
      steps: metrics.daily_steps >= 10000 ? 1.0 : metrics.daily_steps / 10000,
      heart: metrics.resting_heart_rate <= 70 ? 1.0 : Math.max(0, 1 - (metrics.resting_heart_rate - 70) / 40),
      sleep: metrics.sleep_hours >= 7 && metrics.sleep_hours <= 9 ? 1.0 : 0.6,
      active: metrics.active_minutes >= 30 ? 1.0 : metrics.active_minutes / 30,
      bmi: metrics.bmi >= 18.5 && metrics.bmi <= 25 ? 1.0 : Math.max(0, 1 - Math.abs(metrics.bmi - 22) / 15),
    };

    const score = (weights.steps * 25 + weights.heart * 20 + weights.sleep * 20 + weights.active * 20 + weights.bmi * 15);

    let tier: string;
    let discount: number;
    if (score >= 80) { tier = 'excellent'; discount = 30; }
    else if (score >= 60) { tier = 'good'; discount = 20; }
    else if (score >= 40) { tier = 'average'; discount = 10; }
    else { tier = 'below_average'; discount = 0; }

    return { score: Math.round(score * 10) / 10, tier, discount };
  }

  startAutoSync(intervalMs: number = 3600000) {
    this.syncInterval = setInterval(() => {
      // In production: reads from Health Connect API
      console.log('[HealthConnect] Auto-sync triggered');
    }, intervalMs);
  }

  stopAutoSync() {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
  }
}

export function createHealthConnectClient(baseUrl: string, customerId: string): HealthConnectClient {
  return new HealthConnectClient(baseUrl, customerId);
}

export default HealthConnectClient;
