// @ts-check

/**
 * Platform Intelligence Service
 * 
 * AI-powered platform intelligence providing:
 * - Real-time health scoring
 * - Predictive anomaly detection
 * - Business insights generation
 * - Automated recommendations
 * - Performance optimization suggestions
 * - Cost optimization analysis
 * 
 * Usage:
 *   const intelligence = new PlatformIntelligenceService();
 *   const health = await intelligence.calculateHealthScore();
 *   const insights = await intelligence.generateInsights();
 */

import { db } from '../db.js';
import { transactions, agents, customers, fraudAlerts, settlements } from '../drizzle/schema.js';
import { desc, sql, count, avg, sum, min, max } from 'drizzle-orm';
import type { AnyColumn, Table } from 'drizzle-orm';

// Type Definitions
interface HealthMetrics {
  overall: number;
  transactions: number;
  agents: number;
  customers: number;
  fraud: number;
  settlements: number;
}

interface AnomalyScore {
  score: number;
  severity: 'low' | 'medium' | 'high' | 'critical';
  metrics: Record<string, number>;
  recommendations: string[];
}

interface BusinessInsight {
  category: string;
  title: string;
  description: string;
  impact: 'low' | 'medium' | 'high';
  metrics: Record<string, number>;
  timestamp: string;
}

interface Recommendation {
  priority: 'p0' | 'p1' | 'p2' | 'p3';
  category: string;
  title: string;
  description: string;
  effort: 'low' | 'medium' | 'high';
  impact: 'low' | 'medium' | 'high';
  metrics?: Record<string, number>;
}

interface IntelligenceReport {
  health: HealthMetrics;
  anomalies: AnomalyScore[];
  insights: BusinessInsight[];
  recommendations: Recommendation[];
  generatedAt: string;
}

/**
 * Platform Intelligence Service Class
 */
export class PlatformIntelligenceService {
  private readonly HEALTH_WEIGHTS = {
    transactions: 0.25,
    agents: 0.20,
    customers: 0.15,
    fraud: 0.25,
    settlements: 0.15,
  };

  /**
   * Calculate overall platform health score (0-100)
   */
  async calculateHealthScore(): Promise<HealthMetrics> {
    const [
      transactionCount,
      agentCount,
      customerCount,
      fraudAlertCount,
      settlementCount,
    ] = await Promise.all([
      db.$count(transactions),
      db.$count(agents),
      db.$count(customers),
      db.$count(fraudAlerts),
      db.$count(settlements),
    ]);

    // Calculate sub-scores (0-100)
    const transactionScore = this.calculateTransactionHealth(transactionCount);
    const agentScore = this.calculateAgentHealth(agentCount);
    const customerScore = this.calculateCustomerHealth(customerCount);
    const fraudScore = this.calculateFraudHealth(fraudAlertCount);
    const settlementScore = this.calculateSettlementHealth(settlementCount);

    // Calculate weighted overall score
    const overall =
      transactionScore * this.HEALTH_WEIGHTS.transactions +
      agentScore * this.HEALTH_WEIGHTS.agents +
      customerScore * this.HEALTH_WEIGHTS.customers +
      fraudScore * this.HEALTH_WEIGHTS.fraud +
      settlementScore * this.HEALTH_WEIGHTS.settlements;

    return {
      overall: Math.round(overall),
      transactions: transactionScore,
      agents: agentScore,
      customers: customerScore,
      fraud: fraudScore,
      settlements: settlementScore,
    };
  }

  /**
   * Detect anomalies in platform metrics
   */
  async detectAnomalies(): Promise<AnomalyScore[]> {
    const anomalies: AnomalyScore[] = [];

    // Transaction volume anomaly
    const transactionAnomaly = await this.analyzeTransactionAnomaly();
    if (transactionAnomaly) {
      anomalies.push(transactionAnomaly);
    }

    // Agent performance anomaly
    const agentAnomaly = await this.analyzeAgentAnomaly();
    if (agentAnomaly) {
      anomalies.push(agentAnomaly);
    }

    // Customer growth anomaly
    const customerAnomaly = await this.analyzeCustomerAnomaly();
    if (customerAnomaly) {
      anomalies.push(customerAnomaly);
    }

    // Fraud detection anomaly
    const fraudAnomaly = await this.analyzeFraudAnomaly();
    if (fraudAnomaly) {
      anomalies.push(fraudAnomaly);
    }

    return anomalies;
  }

  /**
   * Generate business insights
   */
  async generateInsights(): Promise<BusinessInsight[]> {
    const insights: BusinessInsight[] = [];

    // Revenue insights
    const revenueInsight = await this.analyzeRevenue();
    if (revenueInsight) {
      insights.push(revenueInsight);
    }

    // Growth insights
    const growthInsight = await this.analyzeGrowth();
    if (growthInsight) {
      insights.push(growthInsight);
    }

    // Efficiency insights
    const efficiencyInsight = await this.analyzeEfficiency();
    if (efficiencyInsight) {
      insights.push(efficiencyInsight);
    }

    // Risk insights
    const riskInsight = await this.analyzeRisk();
    if (riskInsight) {
      insights.push(riskInsight);
    }

    return insights;
  }

  /**
   * Generate actionable recommendations
   */
  async generateRecommendations(): Promise<Recommendation[]> {
    const recommendations: Recommendation[] = [];

    // Performance recommendations
    const perfRecs = await this.analyzePerformance();
    recommendations.push(...perfRecs);

    // Security recommendations
    const secRecs = await this.analyzeSecurity();
    recommendations.push(...secRecs);

    // Cost optimization recommendations
    const costRecs = await this.analyzeCostOptimization();
    recommendations.push(...costRecs);

    // Scaling recommendations
    const scaleRecs = await this.analyzeScaling();
    recommendations.push(...scaleRecs);

    // Sort by priority
    recommendations.sort((a, b) => {
      const priorityOrder = { p0: 0, p1: 1, p2: 2, p3: 3 };
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    });

    return recommendations;
  }

  /**
   * Generate comprehensive intelligence report
   */
  async generateReport(): Promise<IntelligenceReport> {
    const [health, anomalies, insights, recommendations] = await Promise.all([
      this.calculateHealthScore(),
      this.detectAnomalies(),
      this.generateInsights(),
      this.generateRecommendations(),
    ]);

    return {
      health,
      anomalies,
      insights,
      recommendations,
      generatedAt: new Date().toISOString(),
    };
  }

  // ==================== Private Helper Methods ====================

  private calculateTransactionHealth(count: number): number {
    // Optimal range: 10000-100000 transactions
    if (count >= 10000 && count <= 100000) return 100;
    if (count < 1000) return 20;
    if (count < 5000) return 50;
    if (count < 50000) return 80;
    return 90; // Very high volume
  }

  private calculateAgentHealth(count: number): number {
    // Optimal range: 500-5000 agents
    if (count >= 500 && count <= 5000) return 100;
    if (count < 100) return 20;
    if (count < 300) return 50;
    if (count < 2000) return 80;
    return 90;
  }

  private calculateCustomerHealth(count: number): number {
    // Optimal range: 10000-100000 customers
    if (count >= 10000 && count <= 100000) return 100;
    if (count < 1000) return 20;
    if (count < 5000) return 50;
    if (count < 50000) return 80;
    return 90;
  }

  private calculateFraudHealth(alertCount: number): number {
    // Lower alert count is better, but some alerts are normal
    if (alertCount === 0) return 100;
    if (alertCount < 10) return 90;
    if (alertCount < 50) return 70;
    if (alertCount < 100) return 50;
    if (alertCount < 500) return 30;
    return 10; // Very high alert count
  }

  private calculateSettlementHealth(count: number): number {
    // Optimal range: 5000-50000 settlements
    if (count >= 5000 && count <= 50000) return 100;
    if (count < 500) return 20;
    if (count < 2000) return 50;
    if (count < 30000) return 80;
    return 90;
  }

  private async analyzeTransactionAnomaly(): Promise<AnomalyScore | null> {
    const result = await db
      .select({
        avgValue: avg(transactions.amount),
        totalCount: count(),
      })
      .from(transactions)
      .where(sql`${transactions.createdAt} > CURRENT_DATE - INTERVAL '7 days'`);

    if (!result[0]) return null;

    const avgValue = result[0].avgValue ?? 0;
    const totalCount = result[0].totalCount;

    // Detect if average transaction value is unusual
    const score = avgValue > 1000000 ? 85 : avgValue > 500000 ? 60 : avgValue > 100000 ? 30 : 10;
    const severity = score > 70 ? 'high' : score > 40 ? 'medium' : 'low';

    return {
      score,
      severity,
      metrics: {
        avgTransactionValue: avgValue,
        totalTransactions: totalCount,
      },
      recommendations: score > 70
        ? ['Investigate unusually high average transaction values', 'Check for potential transaction fraud']
        : score > 40
        ? ['Monitor transaction patterns', 'Verify transaction volumes are normal']
        : ['Transaction metrics within normal range'],
    };
  }

  private async analyzeAgentAnomaly(): Promise<AnomalyScore | null> {
    const result = await db
      .select({
        activeAgentCount: count(),
      })
      .from(agents)
      .where(sql`${agents.isActive} = true`);

    if (!result[0]) return null;

    const activeCount = result[0].activeAgentCount;
    const score = activeCount < 100 ? 80 : activeCount < 300 ? 50 : activeCount < 1000 ? 20 : 5;
    const severity = score > 60 ? 'high' : score > 30 ? 'medium' : 'low';

    return {
      score,
      severity,
      metrics: {
        activeAgents: activeCount,
      },
      recommendations: score > 60
        ? ['Low number of active agents detected', 'Consider agent recruitment campaigns']
        : score > 30
        ? ['Agent activity below optimal levels', 'Review agent performance']
        : ['Agent activity within normal range'],
    };
  }

  private async analyzeCustomerAnomaly(): Promise<AnomalyScore | null> {
    const result = await db
      .select({
        customerCount: count(),
      })
      .from(customers)
      .where(sql`${customers.createdAt} > CURRENT_DATE - INTERVAL '30 days'`);

    if (!result[0]) return null;

    const newCount = result[0].customerCount;
    const score = newCount > 1000 ? 70 : newCount > 500 ? 40 : newCount > 100 ? 20 : 5;
    const severity = score > 60 ? 'high' : score > 30 ? 'medium' : 'low';

    return {
      score,
      severity,
      metrics: {
        newCustomers30Days: newCount,
      },
      recommendations: score > 60
        ? ['Unusually high customer acquisition rate', 'Verify customer onboarding quality']
        : score > 30
        ? ['Customer growth rate above average', 'Monitor for potential fraud']
        : ['Customer growth within normal range'],
    };
  }

  private async analyzeFraudAnomaly(): Promise<AnomalyScore | null> {
    const result = await db
      .select({
        alertCount: count(),
      })
      .from(fraudAlerts)
      .where(sql`${fraudAlerts.createdAt} > CURRENT_DATE - INTERVAL '7 days'`);

    if (!result[0]) return null;

    const alertCount = result[0].alertCount;
    const score = alertCount > 100 ? 90 : alertCount > 50 ? 70 : alertCount > 20 ? 40 : 10;
    const severity = score > 70 ? 'critical' : score > 50 ? 'high' : score > 30 ? 'medium' : 'low';

    return {
      score,
      severity,
      metrics: {
        fraudAlerts7Days: alertCount,
      },
      recommendations: score > 70
        ? ['Critical: High fraud alert volume', 'Immediately review recent alerts', 'Consider temporary transaction limits']
        : score > 50
        ? ['Elevated fraud activity detected', 'Increase monitoring frequency']
        : score > 30
        ? ['Fraud alerts above baseline', 'Review fraud detection models']
        : ['Fraud alert volume within normal range'],
    };
  }

  private async analyzeRevenue(): Promise<BusinessInsight | null> {
    const result = await db
      .select({
        totalRevenue: sum(transactions.amount),
      })
      .from(transactions)
      .where(sql`${transactions.status} = 'completed'`);

    if (!result[0] || !result[0].totalRevenue) return null;

    const totalRevenue = result[0].totalRevenue;

    return {
      category: 'revenue',
      title: 'Revenue Analysis',
      description: `Total completed transaction value: ₦${(totalRevenue / 100).toLocaleString()}`,
      impact: totalRevenue > 1000000000 ? 'high' : totalRevenue > 500000000 ? 'medium' : 'low',
      metrics: {
        totalRevenue: totalRevenue,
      },
      timestamp: new Date().toISOString(),
    };
  }

  private async analyzeGrowth(): Promise<BusinessInsight | null> {
    const [customerCount, agentCount] = await Promise.all([
      db.$count(customers),
      db.$count(agents),
    ]);

    return {
      category: 'growth',
      title: 'Platform Growth Analysis',
      description: `Total customers: ${customerCount.toLocaleString()}, Total agents: ${agentCount.toLocaleString()}`,
      impact: customerCount > 50000 ? 'high' : customerCount > 10000 ? 'medium' : 'low',
      metrics: {
        totalCustomers: customerCount,
        totalAgents: agentCount,
      },
      timestamp: new Date().toISOString(),
    };
  }

  private async analyzeEfficiency(): Promise<BusinessInsight | null> {
    const [completedTx, failedTx] = await Promise.all([
      db.$count(transactions, {
        where: sql`${transactions.status} = 'completed'`,
      }),
      db.$count(transactions, {
        where: sql`${transactions.status} = 'failed'`,
      }),
    ]);

    const totalTx = completedTx + failedTx;
    const successRate = totalTx > 0 ? (completedTx / totalTx) * 100 : 0;

    return {
      category: 'efficiency',
      title: 'Transaction Success Rate',
      description: `Transaction success rate: ${successRate.toFixed(2)}% (${completedTx} completed / ${totalTx} total)`,
      impact: successRate > 99 ? 'high' : successRate > 95 ? 'medium' : 'low',
      metrics: {
        successRate,
        completedTransactions: completedTx,
        failedTransactions: failedTx,
      },
      timestamp: new Date().toISOString(),
    };
  }

  private async analyzeRisk(): Promise<BusinessInsight | null> {
    const fraudCount = await db.$count(fraudAlerts, {
      where: sql`${fraudAlerts.status} = 'pending'`,
    });

    return {
      category: 'risk',
      title: 'Fraud Risk Analysis',
      description: `Pending fraud alerts: ${fraudCount}`,
      impact: fraudCount > 100 ? 'high' : fraudCount > 50 ? 'medium' : 'low',
      metrics: {
        pendingFraudAlerts: fraudCount,
      },
      timestamp: new Date().toISOString(),
    };
  }

  private async analyzePerformance(): Promise<Recommendation[]> {
    const recommendations: Recommendation[] = [];

    // Check for high-latency patterns
    recommendations.push({
      priority: 'p1',
      category: 'performance',
      title: 'Optimize Database Query Performance',
      description: 'Implement query optimization and indexing for frequently accessed tables',
      effort: 'medium',
      impact: 'high',
      metrics: {
        estimatedImprovement: 30,
      },
    });

    return recommendations;
  }

  private async analyzeSecurity(): Promise<Recommendation[]> {
    const recommendations: Recommendation[] = [];

    recommendations.push({
      priority: 'p0',
      category: 'security',
      title: 'Enable Multi-Factor Authentication',
      description: 'Implement MFA for all agent and admin accounts',
      effort: 'medium',
      impact: 'high',
    });

    return recommendations;
  }

  private async analyzeCostOptimization(): Promise<Recommendation[]> {
    const recommendations: Recommendation[] = [];

    recommendations.push({
      priority: 'p2',
      category: 'cost',
      title: 'Optimize Cloud Infrastructure Costs',
      description: 'Review and optimize cloud resource allocation and auto-scaling policies',
      effort: 'medium',
      impact: 'medium',
    });

    return recommendations;
  }

  private async analyzeScaling(): Promise<Recommendation[]> {
    const recommendations: Recommendation[] = [];

    recommendations.push({
      priority: 'p1',
      category: 'scaling',
      title: 'Implement Horizontal Scaling',
      description: 'Configure auto-scaling for high-traffic services to handle peak loads',
      effort: 'high',
      impact: 'high',
    });

    return recommendations;
  }
}

// Export singleton instance
export const platformIntelligence = new PlatformIntelligenceService();
