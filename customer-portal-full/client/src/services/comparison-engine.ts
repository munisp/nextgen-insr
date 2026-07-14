/**
 * Insurance Comparison & Recommendation Client
 * Connects to comparison-engine Go service.
 * Offline-first: caches product catalog in IndexedDB.
 */

export interface InsuranceProduct {
  id: string;
  name: string;
  category: string;
  provider: string;
  premium_annual: number;
  coverage_amount: number;
  features: Record<string, boolean>;
  rating: number;
  claim_settlement_ratio: number;
}

export interface ComparisonResult {
  products: InsuranceProduct[];
  best_value_id: string;
  best_coverage_id: string;
  cheapest_id: string;
}

export interface Recommendation {
  product_id: string;
  product_name: string;
  match_score: number;
  reasons: string[];
  premium_annual: number;
}

export interface NeedsAnalysis {
  age: number;
  monthly_income: number;
  dependents: number;
  assets: string[];
  concerns: string[];
  budget_percentage: number;
}

const API_BASE = '/api/v1';

export async function compareProducts(category?: string): Promise<ComparisonResult> {
  const url = category ? `${API_BASE}/compare?category=${category}` : `${API_BASE}/compare`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error('Comparison failed');
  return resp.json();
}

export async function getRecommendations(needs: NeedsAnalysis): Promise<{
  recommendations: Recommendation[];
  budget_monthly: number;
  budget_annual: number;
  peer_comparison: string;
}> {
  const resp = await fetch(`${API_BASE}/recommend`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(needs),
  });
  if (!resp.ok) throw new Error('Recommendation failed');
  return resp.json();
}

export async function getInstantQuote(productId: string): Promise<{
  product: InsuranceProduct;
  quote: { premium_annual: number; premium_monthly: number; coverage: number; valid_until: string };
}> {
  const resp = await fetch(`${API_BASE}/quote?product_id=${productId}`);
  if (!resp.ok) throw new Error('Quote failed');
  return resp.json();
}
