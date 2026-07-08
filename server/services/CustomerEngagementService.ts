// @ts-check

/**
 * Customer Engagement and Gamification Service
 * 
 * Features:
 * - Achievement system with milestones
 * - Loyalty points and rewards
 * - Personalized recommendations
 * - Engagement scoring
 * - Referral program management
 * - Behavioral nudges
 * 
 * Usage:
 *   const engagement = new CustomerEngagementService();
 *   const rewards = await engagement.calculateRewards(customerId);
 *   const achievements = await engagement.getAchievements(customerId);
 */

import { db } from '../db.js';
import { transactions, customers, agents } from '../drizzle/schema.js';
import { eq, sql, gte } from 'drizzle-orm';

// Type Definitions
interface Achievement {
  id: string;
  name: string;
  description: string;
  icon: string;
  earnedDate?: string;
  progress: number; // 0-100
  requirement: number;
  category: string;
  points: number;
}

interface Reward {
  id: string;
  type: 'discount' | 'cashback' | 'bonus' | 'upgrade';
  value: number;
  currency: string;
  expiration: string;
  description: string;
  eligibility: string[];
}

interface EngagementScore {
  customerId: string;
  overall: number; // 0-100
  activity: number;
  loyalty: number;
  engagement: number;
  recommendations: string[];
}

interface ReferralStats {
  customerId: string;
  totalReferrals: number;
  activeReferrals: number;
  earnedRewards: number;
  referralCode: string;
  tier: string;
}

interface PersonalizedRecommendation {
  customerId: string;
  product: string;
  reason: string;
  confidence: number;
  priority: 'high' | 'medium' | 'low';
}

/**
 * Customer Engagement Service
 */
export class CustomerEngagementService {
  private readonly ACHIEVEMENTS = [
    {
      id: 'first_transaction',
      name: 'First Step',
      description: 'Complete your first transaction',
      icon: '🎯',
      requirement: 1,
      category: 'transactions',
      points: 50,
    },
    {
      id: 'ten_transactions',
      name: 'Regular User',
      description: 'Complete 10 transactions',
      icon: '⭐',
      requirement: 10,
      category: 'transactions',
      points: 100,
    },
    {
      id: 'fifty_transactions',
      name: 'Power User',
      description: 'Complete 50 transactions',
      icon: '🏆',
      requirement: 50,
      category: 'transactions',
      points: 250,
    },
    {
      id: 'hundred_transactions',
      name: 'Champion',
      description: 'Complete 100 transactions',
      icon: '👑',
      requirement: 100,
      category: 'transactions',
      points: 500,
    },
    {
      id: 'first_year',
      name: 'Loyal Member',
      description: 'Be a member for 1 year',
      icon: '🎉',
      requirement: 365,
      category: 'loyalty',
      points: 200,
    },
    {
      id: 'zero_claims',
      name: 'Risk-Free Customer',
      description: '12 months without claims',
      icon: '🛡️',
      requirement: 12,
      category: 'claims',
      points: 300,
    },
  ];

  /**
   * Calculate customer engagement score
   */
  async calculateEngagementScore(customerId: string): Promise<EngagementScore> {
    // Get customer data
    const [customer, recentTransactions] = await Promise.all([
      db
        .select()
        .from(customers)
        .where(eq(customers.id, customerId))
        .limit(1),
      db
        .select()
        .from(transactions)
        .where(eq(transactions.customerId, customerId))
        .limit(100),
    ]);

    if (!customer[0]) {
      throw new Error(`Customer ${customerId} not found`);
    }

    const txCount = recentTransactions.length;
    const lastActivity = recentTransactions.length > 0
      ? Math.max(...recentTransactions.map(t => t.createdAt.getTime()))
      : customer[0].createdAt.getTime();
    const daysSinceLastActivity = (Date.now() - lastActivity) / (1000 * 60 * 60 * 24);

    // Calculate activity score
    let activityScore = 30; // Base score
    if (txCount > 50) activityScore = 90;
    else if (txCount > 20) activityScore = 70;
    else if (txCount > 5) activityScore = 50;
    if (daysSinceLastActivity < 1) activityScore = Math.max(activityScore, 80);
    else if (daysSinceLastActivity < 7) activityScore = Math.max(activityScore, 60);

    // Calculate loyalty score
    let loyaltyScore = 30;
    const memberMonths = Math.floor(
      (Date.now() - customer[0].createdAt.getTime()) / (30 * 24 * 60 * 60 * 1000)
    );
    if (memberMonths > 24) loyaltyScore = 90;
    else if (memberMonths > 12) loyaltyScore = 70;
    else if (memberMonths > 6) loyaltyScore = 50;

    // Calculate engagement score
    let engagementScore = 40;
    const successRate = txCount > 0
      ? recentTransactions.filter(t => t.status === 'completed').length / txCount
      : 0;
    if (successRate > 0.95) engagementScore = 90;
    else if (successRate > 0.90) engagementScore = 70;
    else if (successRate > 0.80) engagementScore = 50;

    // Overall score
    const overall = Math.round(
      activityScore * 0.4 +
      loyaltyScore * 0.3 +
      engagementScore * 0.3
    );

    const recommendations: string[] = [];
    if (overall > 70) {
      recommendations.push('Customer is highly engaged - offer premium rewards');
    } else if (overall > 40) {
      recommendations.push('Customer is moderately engaged - increase engagement campaigns');
    } else {
      recommendations.push('Customer is disengaged - immediate re-engagement needed');
    }

    return {
      customerId,
      overall,
      activity: activityScore,
      loyalty: loyaltyScore,
      engagement: engagementScore,
      recommendations,
    };
  }

  /**
   * Get customer achievements
   */
  async getAchievements(customerId: string): Promise<Achievement[]> {
    const [customer, transactions] = await Promise.all([
      db
        .select()
        .from(customers)
        .where(eq(customers.id, customerId))
        .limit(1),
      db
        .select()
        .from(transactions)
        .where(eq(transactions.customerId, customerId))
        .limit(1000),
    ]);

    if (!customer[0]) {
      throw new Error(`Customer ${customerId} not found`);
    }

    const txCount = transactions.length;
    const memberDays = Math.floor(
      (Date.now() - customer[0].createdAt.getTime()) / (1000 * 60 * 60 * 24)
    );

    return this.ACHIEVEMENTS.map(achievement => {
      let progress = 0;
      let earnedDate: string | undefined;

      switch (achievement.id) {
        case 'first_transaction':
        case 'ten_transactions':
        case 'fifty_transactions':
        case 'hundred_transactions':
          progress = Math.min((txCount / achievement.requirement) * 100, 100);
          if (txCount >= achievement.requirement) {
            earnedDate = transactions[txCount - achievement.requirement]?.createdAt.toISOString();
          }
          break;
        case 'first_year':
          progress = Math.min((memberDays / achievement.requirement) * 100, 100);
          if (memberDays >= achievement.requirement) {
            earnedDate = new Date(customer[0].createdAt.getTime() + achievement.requirement * 24 * 60 * 60 * 1000).toISOString();
          }
          break;
      }

      return {
        ...achievement,
        progress: Math.round(progress),
        earnedDate,
      };
    });
  }

  /**
   * Calculate rewards for customer
   */
  async calculateRewards(customerId: string): Promise<Reward[]> {
    const [customer, transactions] = await Promise.all([
      db
        .select()
        .from(customers)
        .where(eq(customers.id, customerId))
        .limit(1),
      db
        .select()
        .from(transactions)
        .where(eq(transactions.customerId, customerId))
        .limit(100),
    ]);

    if (!customer[0]) {
      throw new Error(`Customer ${customerId} not found`);
    }

    const txCount = transactions.length;
    const totalValue = transactions.reduce((sum, t) => sum + (t.amount || 0), 0);

    const rewards: Reward[] = [];

    // Transaction milestone rewards
    if (txCount >= 50) {
      rewards.push({
        id: crypto.randomUUID(),
        type: 'cashback',
        value: 5000,
        currency: 'NGN',
        expiration: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        description: '50 transaction milestone cashback',
        eligibility: ['50+ transactions'],
      });
    }

    if (txCount >= 100) {
      rewards.push({
        id: crypto.randomUUID(),
        type: 'discount',
        value: 15,
        currency: 'NGN',
        expiration: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
        description: '15% premium discount for champion customers',
        eligibility: ['100+ transactions'],
      });
    }

    // High value customer rewards
    if (totalValue > 1000000) {
      rewards.push({
        id: crypto.randomUUID(),
        type: 'upgrade',
        value: 1,
        currency: 'NGN',
        expiration: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
        description: 'VIP customer status upgrade',
        eligibility: ['₦1M+ total transactions'],
      });
    }

    return rewards;
  }

  /**
   * Get referral statistics
   */
  async getReferralStats(customerId: string): Promise<ReferralStats> {
    const referralCode = crypto.randomUUID().substring(0, 8).toUpperCase();

    // Simulate referral data (would be fetched from database in production)
    return {
      customerId,
      totalReferrals: 0,
      activeReferrals: 0,
      earnedRewards: 0,
      referralCode,
      tier: 'bronze',
    };
  }

  /**
   * Get personalized recommendations
   */
  async getRecommendations(customerId: string): Promise<PersonalizedRecommendation[]> {
    const [customer, transactions] = await Promise.all([
      db
        .select()
        .from(customers)
        .where(eq(customers.id, customerId))
        .limit(1),
      db
        .select()
        .from(transactions)
        .where(eq(transactions.customerId, customerId))
        .limit(100),
    ]);

    if (!customer[0]) {
      throw new Error(`Customer ${customerId} not found`);
    }

    const recommendations: PersonalizedRecommendation[] = [];

    // Recommend based on transaction patterns
    const highValueTransactions = transactions.filter(t => (t.amount || 0) > 100000);
    if (highValueTransactions.length > 5) {
      recommendations.push({
        customerId,
        product: 'Premium Insurance Bundle',
        reason: 'High-value transaction pattern detected',
        confidence: 0.85,
        priority: 'high',
      });
    }

    // Recommend based on customer tenure
    const memberMonths = Math.floor(
      (Date.now() - customer[0].createdAt.getTime()) / (30 * 24 * 60 * 60 * 1000)
    );
    if (memberMonths > 6) {
      recommendations.push({
        customerId,
        product: 'Loyalty Rewards Program',
        reason: 'Eligible for loyalty benefits after 6 months',
        confidence: 0.95,
        priority: 'medium',
      });
    }

    return recommendations;
  }

  /**
   * Calculate total engagement points
   */
  async calculatePoints(customerId: string): Promise<{
    totalPoints: number;
    pointsEarned: number;
    pointsRedeemed: number;
    availablePoints: number;
  }> {
    const achievements = await this.getAchievements(customerId);
    const earnedAchievements = achievements.filter(a => a.progress >= 100);

    const pointsEarned = earnedAchievements.reduce((sum, a) => sum + a.points, 0);

    return {
      totalPoints: pointsEarned,
      pointsEarned,
      pointsRedeemed: 0,
      availablePoints: pointsEarned,
    };
  }
}

// Export singleton instance
export const customerEngagement = new CustomerEngagementService();
