// TypeScript enabled — Sprint 96 security audit
/**
 * Stripe Products & Pricing Configuration
 *
 * Defines the subscription tiers and one-time products for the InsurePortal POS platform.
 */

export interface PlanConfig {
  id: string;
  name: string;
  description: string;
  features: string[];
  monthlyPriceNGN: number; // in kobo (smallest unit)
  monthlyPriceUSD: number; // in cents
}

// Agent subscription tiers
export const AGENT_PLANS: PlanConfig[] = [
  {
    id: "basic",
    name: "Basic Agent",
    description: "Essential POS operations for individual agents",
    features: [
      "Cash-in & Cash-out",
      "Bill Payments & Airtime",
      "Basic Reporting",
      "Email Support",
      "Up to 100 transactions/day",
    ],
    monthlyPriceNGN: 500000, // ₦5,000
    monthlyPriceUSD: 500, // $5.00
  },
  {
    id: "standard",
    name: "Standard Agent",
    description: "Enhanced features for growing agents",
    features: [
      "All Basic features",
      "Fund Transfers",
      "Multi-Currency Operations",
      "Advanced Analytics",
      "Priority Support",
      "Up to 500 transactions/day",
      "Float Management Tools",
    ],
    monthlyPriceNGN: 1500000, // ₦15,000
    monthlyPriceUSD: 1500, // $15.00
  },
  {
    id: "premium",
    name: "Premium Agent",
    description: "Full platform access for super-agents",
    features: [
      "All Standard features",
      "Unlimited transactions",
      "Sub-agent management",
      "Custom branding",
      "API access",
      "Dedicated account manager",
      "Commission optimization",
      "Real-time fraud alerts",
    ],
    monthlyPriceNGN: 5000000, // ₦50,000
    monthlyPriceUSD: 5000, // $50.00
  },
];

// One-time products
export const ONE_TIME_PRODUCTS = [
  {
    id: "device-activation",
    name: "POS Device Activation Fee",
    description: "One-time activation fee for new service node",
    priceNGN: 1000000, // ₦10,000
    priceUSD: 1000, // $10.00
  },
  {
    id: "kyc-verification",
    name: "KYC Fast-Track Verification",
    description: "Priority KYC document processing (24-hour turnaround)",
    priceNGN: 200000, // ₦2,000
    priceUSD: 200, // $2.00
  },
  {
    id: "training-certification",
    name: "Agent Training & Certification",
    description: "Comprehensive training program with certification",
    priceNGN: 2500000, // ₦25,000
    priceUSD: 2500, // $25.00
  },
];
