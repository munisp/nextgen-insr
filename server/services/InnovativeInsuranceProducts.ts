// @ts-check

/**
 * Innovative Insurance Products Service
 * 
 * Features:
 * - Usage-Based Insurance (UBI)
 * - Microinsurance products
 * - Parametric insurance
 * - Embedded insurance
 * - Peer-to-peer insurance pools
 * - On-demand insurance
 * - Dynamic pricing engine
 * 
 * Usage:
 *   const products = new InnovativeInsuranceProducts();
 *   const quote = await products.generateUBIQuote(customerId);
 *   const microInsurance = await products.createMicroInsurance(policy);
 */

import { db } from '../db.js';
import { transactions, customers, agents } from '../drizzle/schema.js';
import { eq, sql, gte, and } from 'drizzle-orm';

// Type Definitions
interface InsuranceProduct {
  id: string;
  name: string;
  type: string;
  description: string;
  pricing: PricingModel;
  eligibility: EligibilityCriteria;
  coverage: CoverageDetails;
  status: 'active' | 'draft' | 'deprecated';
}

interface PricingModel {
  basePremium: number;
  pricingStrategy: 'flat' | 'dynamic' | 'usage_based' | 'parametric';
  riskFactors: RiskFactor[];
  discounts: Discount[];
}

interface RiskFactor {
  name: string;
  weight: number;
  range: [number, number];
  impact: 'positive' | 'negative';
}

interface Discount {
  name: string;
  type: 'percentage' | 'fixed';
  value: number;
  conditions: string[];
}

interface EligibilityCriteria {
  minAge: number;
  maxAge: number;
  minCreditScore?: number;
  requiredDocuments: string[];
  exclusions: string[];
}

interface CoverageDetails {
  sumInsured: number;
  deductible: number;
  coveragePeriod: string;
  coveredEvents: string[];
  exclusions: string[];
  benefits: Benefit[];
}

interface Benefit {
  name: string;
  description: string;
  limit: number;
  condition?: string;
}

interface Quote {
  quoteId: string;
  productId: string;
  customerId: string;
  premium: number;
  coverage: number;
  validity: string;
  riskScore: number;
  recommendations: string[];
}

interface Policy {
  policyId: string;
  productId: string;
  customerId: string;
  status: 'active' | 'pending' | 'cancelled' | 'expired';
  premium: number;
  coverage: number;
  startDate: string;
  endDate: string;
}

/**
 * Innovative Insurance Products Service
 */
export class InnovativeInsuranceProducts {
  private readonly PRODUCTS: InsuranceProduct[] = [
    {
      id: 'ubi-auto',
      name: 'Usage-Based Auto Insurance',
      type: 'usage_based',
      description: 'Pay based on how much you drive and how safely you drive',
      pricing: {
        basePremium: 50000,
        pricingStrategy: 'usage_based',
        riskFactors: [
          { name: 'mileage', weight: 0.3, range: [0, 20000], impact: 'negative' },
          { name: 'driving_score', weight: 0.4, range: [0, 100], impact: 'positive' },
          { name: 'time_of_day', weight: 0.2, range: [0, 24], impact: 'negative' },
          { name: 'location_risk', weight: 0.1, range: [1, 10], impact: 'negative' },
        ],
        discounts: [
          { name: 'safe_driver', type: 'percentage', value: 20, conditions: ['driving_score > 80'] },
          { name: 'low_mileage', type: 'percentage', value: 15, conditions: ['mileage < 5000'] },
        ],
      },
      eligibility: {
        minAge: 18,
        maxAge: 75,
        requiredDocuments: ['license', 'vehicle_registration', 'insurance_history'],
        exclusions: ['commercial_use', 'racing'],
      },
      coverage: {
        sumInsured: 5000000,
        deductible: 50000,
        coveragePeriod: '12_months',
        coveredEvents: ['accident', 'theft', 'fire', 'natural_disaster'],
        exclusions: ['wear_and_tear', 'intentional_damage'],
        benefits: [
          { name: 'roadside_assistance', description: '24/7 roadside assistance', limit: 100000 },
          { name: 'rental_car', description: 'Rental car during repairs', limit: 50000 },
        ],
      },
      status: 'active',
    },
    {
      id: 'micro-health',
      name: 'Micro Health Insurance',
      type: 'microinsurance',
      description: 'Affordable micro health coverage with daily premium',
      pricing: {
        basePremium: 500,
        pricingStrategy: 'flat',
        riskFactors: [
          { name: 'age', weight: 0.3, range: [18, 80], impact: 'negative' },
          { name: 'health_status', weight: 0.4, range: [1, 10], impact: 'negative' },
          { name: 'location', weight: 0.2, range: [1, 5], impact: 'negative' },
        ],
        discounts: [
          { name: 'annual_prepayment', type: 'percentage', value: 25, conditions: ['pay_annually'] },
          { name: 'group_discount', type: 'percentage', value: 15, conditions: ['group_size > 10'] },
        ],
      },
      eligibility: {
        minAge: 18,
        maxAge: 65,
        requiredDocuments: ['nin', 'medical_questionnaire'],
        exclusions: ['pre_existing_conditions', 'cosmetic_procedures'],
      },
      coverage: {
        sumInsured: 500000,
        deductible: 5000,
        coveragePeriod: '12_months',
        coveredEvents: ['hospitalization', 'surgery', 'medication', 'maternity'],
        exclusions: ['cosmetic', 'experimental_treatment'],
        benefits: [
          { name: 'free_consultation', description: 'Free annual health checkup', limit: 15000 },
          { name: 'telemedicine', description: '24/7 telemedicine access', limit: 5000 },
        ],
      },
      status: 'active',
    },
    {
      id: 'parametric-flood',
      name: 'Parametric Flood Insurance',
      type: 'parametric',
      description: 'Automatic payout based on flood index data',
      pricing: {
        basePremium: 10000,
        pricingStrategy: 'parametric',
        riskFactors: [
          { name: 'flood_risk_index', weight: 0.5, range: [0, 100], impact: 'negative' },
          { name: 'property_value', weight: 0.3, range: [100000, 10000000], impact: 'negative' },
          { name: 'elevation', weight: 0.2, range: [0, 200], impact: 'positive' },
        ],
        discounts: [
          { name: 'early_adopter', type: 'percentage', value: 10, conditions: ['first_year'] },
        ],
      },
      eligibility: {
        minAge: 18,
        maxAge: 80,
        requiredDocuments: ['property_document', 'flood_zone_map'],
        exclusions: ['flood_zones_excluded'],
      },
      coverage: {
        sumInsured: 2000000,
        deductible: 0,
        coveragePeriod: '12_months',
        coveredEvents: ['flood_index_trigger'],
        exclusions: ['man-made_floods', 'war_damage'],
        benefits: [
          { name: 'automatic_payout', description: 'Automatic payout when flood index triggers', limit: 2000000 },
          { name: 'quick_settlement', description: 'Payout within 7 days of trigger', limit: 0 },
        ],
      },
      status: 'active',
    },
  ];

  /**
   * Generate Usage-Based Insurance quote
   */
  async generateUBIQuote(customerId: string, drivingData: {
    monthlyMileage: number;
    drivingScore: number;
    avgTimeOfDay: number;
    locationRisk: number;
  }): Promise<Quote> {
    const product = this.PRODUCTS.find(p => p.id === 'ubi-auto');
    if (!product) {
      throw new Error('UBI product not found');
    }

    // Calculate risk score
    let riskScore = 50; // Base score
    product.pricing.riskFactors.forEach(factor => {
      let factorScore = 0;
      switch (factor.name) {
        case 'mileage':
          factorScore = (drivingData.monthlyMileage * 12) / factor.range[1] * 100;
          break;
        case 'driving_score':
          factorScore = 100 - drivingData.drivingScore;
          break;
        case 'time_of_day':
          factorScore = drivingData.avgTimeOfDay > 22 || drivingData.avgTimeOfDay < 6 ? 80 : 20;
          break;
        case 'location_risk':
          factorScore = (drivingData.locationRisk / factor.range[1]) * 100;
          break;
      }

      if (factor.impact === 'negative') {
        riskScore += factorScore * factor.weight;
      } else {
        riskScore -= factorScore * factor.weight;
      }
    });

    riskScore = Math.max(0, Math.min(100, riskScore));

    // Calculate premium
    let premium = product.pricing.basePremium;

    // Apply risk-based adjustment
    if (riskScore > 70) {
      premium *= 1.3;
    } else if (riskScore < 30) {
      premium *= 0.7;
    }

    // Apply discounts
    product.pricing.discounts.forEach(discount => {
      if (this.checkDiscountConditions(discount, drivingData)) {
        if (discount.type === 'percentage') {
          premium *= (1 - discount.value / 100);
        } else {
          premium -= discount.value;
        }
      }
    });

    const recommendations: string[] = [];
    if (riskScore > 60) {
      recommendations.push('Consider defensive driving course to reduce premium');
    }
    if (drivingData.monthlyMileage < 500) {
      recommendations.push('Low mileage discount available');
    }

    return {
      quoteId: crypto.randomUUID(),
      productId: product.id,
      customerId,
      premium: Math.round(premium),
      coverage: product.coverage.sumInsured,
      validity: '30_days',
      riskScore: Math.round(riskScore),
      recommendations,
    };
  }

  /**
   * Create Micro Insurance policy
   */
  async createMicroInsurance(customerId: string, productType: string, duration: number = 30): Promise<Policy> {
    const product = this.PRODUCTS.find(p => p.type === 'microinsurance' && p.id === productType);
    if (!product) {
      throw new Error('Micro insurance product not found');
    }

    const premium = product.pricing.basePremium * duration;

    const policy: Policy = {
      policyId: crypto.randomUUID(),
      productId: product.id,
      customerId,
      status: 'pending',
      premium,
      coverage: product.coverage.sumInsured,
      startDate: new Date().toISOString(),
      endDate: new Date(Date.now() + duration * 24 * 60 * 60 * 1000).toISOString(),
    };

    // Create policy record
    await db.insert(sql`policies`).values(policy);

    return policy;
  }

  /**
   * Generate Parametric Insurance trigger
   */
  async generateParametricTrigger(productId: string, triggerData: {
    indexValue: number;
    threshold: number;
    location: { lat: number; lng: number };
  }): Promise<{
    triggered: boolean;
    payout: number;
    productId: string;
    triggerData: typeof triggerData;
  }> {
    const product = this.PRODUCTS.find(p => p.id === productId);
    if (!product || product.pricing.pricingStrategy !== 'parametric') {
      throw new Error('Parametric product not found');
    }

    const triggered = triggerData.indexValue >= triggerData.threshold;
    const payout = triggered ? product.coverage.sumInsured : 0;

    return {
      triggered,
      payout,
      productId,
      triggerData,
    };
  }

  /**
   * Calculate dynamic premium
   */
  async calculateDynamicPremium(customerId: string, productId: string): Promise<{
    basePremium: number;
    adjustedPremium: number;
    riskScore: number;
    factors: Array<{ name: string; impact: number }>;
  }> {
    const product = this.PRODUCTS.find(p => p.id === productId);
    if (!product) {
      throw new Error('Product not found');
    }

    // Get customer data
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

    let riskScore = 50;
    const factors: Array<{ name: string; impact: number }> = [];

    // Analyze transaction history
    const successRate = transactions.length > 0
      ? transactions.filter(t => t.status === 'completed').length / transactions.length
      : 0;

    if (successRate < 0.9) {
      riskScore += 20;
      factors.push({ name: 'payment_reliability', impact: 20 });
    }

    // Calculate final premium
    let adjustedPremium = product.pricing.basePremium * (1 + riskScore / 100);

    // Apply discounts
    product.pricing.discounts.forEach(discount => {
      adjustedPremium *= (1 - discount.value / 100);
    });

    return {
      basePremium: product.pricing.basePremium,
      adjustedPremium: Math.round(adjustedPremium),
      riskScore,
      factors,
    };
  }

  /**
   * Get available products
   */
  async getAvailableProducts(): Promise<InsuranceProduct[]> {
    return this.PRODUCTS.filter(p => p.status === 'active');
  }

  /**
   * Check discount conditions
   */
  private checkDiscountConditions(
    discount: Discount,
    drivingData: Record<string, number>
  ): boolean {
    return discount.conditions.every(condition => {
      const [field, operator, value] = condition.split(/\s*(>|<|>=|<=|=)\s*/);
      if (!field || !operator || !value) return true;

      const actual = drivingData[field];
      if (actual === undefined) return false;

      const numValue = parseFloat(value);

      switch (operator) {
        case '>': return actual > numValue;
        case '<': return actual < numValue;
        case '>=': return actual >= numValue;
        case '<=': return actual <= numValue;
        case '=': return actual === numValue;
        default: return false;
      }
    });
  }
}

// Export singleton instance
export const innovativeProducts = new InnovativeInsuranceProducts();
