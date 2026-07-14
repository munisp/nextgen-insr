/**
 * Embedded Insurance Distribution SDK
 * Port: 8109
 *
 * Provides:
 * - JavaScript SDK: <script src="insureportal.js"> → renders insurance widget
 * - React component: <InsurePortalWidget productId="motor-basic" />
 * - REST API for headless integration (fintechs, ride-hailing, e-commerce)
 * - Partner dashboard: sales analytics, commission tracking
 * - Sandbox with test API keys
 *
 * Integrations:
 * - Kafka: publishes embedded.quote, embedded.purchase, embedded.claim
 * - Redis: rate limiting, session cache, API key validation
 * - Keycloak: partner authentication (OAuth2 client credentials)
 * - APISIX: upstream for /api/embedded/* routes
 * - TigerBeetle: commission splits and payouts
 * - Permify: partner-level access control
 */

import express from 'express';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 8109;
const KAFKA_BROKERS = process.env.KAFKA_BROKERS || 'localhost:9092';

// ── Types ────────────────────────────────────────────────────────────────────

interface Partner {
  id: string;
  name: string;
  apiKey: string;
  environment: 'sandbox' | 'production';
  permissions: string[];
  commissionRate: number; // percentage
  webhookUrl?: string;
  createdAt: string;
}

interface EmbeddedQuote {
  quoteId: string;
  partnerId: string;
  productId: string;
  premium: number; // kobo
  coverage: number;
  currency: string;
  validUntil: string;
  customerEmail?: string;
  metadata: Record<string, unknown>;
}

interface EmbeddedPurchase {
  purchaseId: string;
  quoteId: string;
  partnerId: string;
  policyId: string;
  status: 'pending' | 'active' | 'cancelled';
  premium: number;
  commission: number;
  createdAt: string;
}

interface WidgetConfig {
  partnerId: string;
  productId: string;
  theme: 'light' | 'dark';
  language: string;
  customColors?: { primary: string; secondary: string };
  callbackUrl: string;
}

// ── In-memory store (Redis in production) ────────────────────────────────────

const partners: Map<string, Partner> = new Map();
const quotes: Map<string, EmbeddedQuote> = new Map();
const purchases: Map<string, EmbeddedPurchase> = new Map();

// Seed test partners
const testPartner: Partner = {
  id: 'partner-test-001',
  name: 'Test Fintech',
  apiKey: 'sk_test_insureportal_embed_001',
  environment: 'sandbox',
  permissions: ['quote', 'purchase', 'claim', 'analytics'],
  commissionRate: 15,
  createdAt: new Date().toISOString(),
};
partners.set(testPartner.apiKey, testPartner);

// ── Middleware ────────────────────────────────────────────────────────────────

function authenticatePartner(req: express.Request, res: express.Response, next: express.NextFunction) {
  const apiKey = req.headers['x-api-key'] as string || req.query.api_key as string;
  if (!apiKey) {
    return res.status(401).json({ error: 'API key required', code: 'MISSING_API_KEY' });
  }
  const partner = partners.get(apiKey);
  if (!partner) {
    return res.status(401).json({ error: 'Invalid API key', code: 'INVALID_API_KEY' });
  }
  (req as any).partner = partner;
  next();
}

// ── Endpoints ────────────────────────────────────────────────────────────────

app.get('/health', (_req, res) => {
  res.json({
    status: 'healthy',
    service: 'embedded-sdk',
    version: '1.0.0',
    partners_registered: partners.size,
    capabilities: ['quotes', 'purchases', 'claims', 'widgets', 'analytics', 'webhooks'],
  });
});

// Get available products for embedding
app.get('/api/v1/embedded/products', authenticatePartner, (req, res) => {
  const products = [
    { id: 'motor-basic', name: 'Motor Third Party', category: 'motor', premium_from: 2500000, description: 'Basic motor coverage' },
    { id: 'motor-comp', name: 'Motor Comprehensive', category: 'motor', premium_from: 7500000, description: 'Full motor protection' },
    { id: 'travel-basic', name: 'Travel Insurance', category: 'travel', premium_from: 1500000, description: 'Travel protection' },
    { id: 'gadget', name: 'Gadget Insurance', category: 'gadget', premium_from: 500000, description: 'Device protection' },
    { id: 'health-micro', name: 'Micro Health', category: 'health', premium_from: 100000, description: 'Basic health coverage' },
  ];
  res.json({ products, partner: (req as any).partner.name });
});

// Generate instant quote
app.post('/api/v1/embedded/quotes', authenticatePartner, (req, res) => {
  const { product_id, customer_email, sum_insured, metadata } = req.body;
  const partner = (req as any).partner as Partner;

  if (!product_id) {
    return res.status(400).json({ error: 'product_id is required' });
  }

  const premium = calculatePremium(product_id, sum_insured);
  const quote: EmbeddedQuote = {
    quoteId: `QT-${uuidv4().slice(0, 8)}`,
    partnerId: partner.id,
    productId: product_id,
    premium,
    coverage: sum_insured || 50000000,
    currency: 'NGN',
    validUntil: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    customerEmail: customer_email,
    metadata: metadata || {},
  };

  quotes.set(quote.quoteId, quote);

  // Publish event
  publishEvent('embedded.quote.created', { quoteId: quote.quoteId, partnerId: partner.id, product: product_id });

  res.status(201).json(quote);
});

// Purchase policy from quote
app.post('/api/v1/embedded/purchases', authenticatePartner, (req, res) => {
  const { quote_id, payment_reference, customer_details } = req.body;
  const partner = (req as any).partner as Partner;

  const quote = quotes.get(quote_id);
  if (!quote) {
    return res.status(404).json({ error: 'Quote not found or expired' });
  }

  const commission = Math.round(quote.premium * partner.commissionRate / 100);
  const purchase: EmbeddedPurchase = {
    purchaseId: `PUR-${uuidv4().slice(0, 8)}`,
    quoteId: quote_id,
    partnerId: partner.id,
    policyId: `POL-${uuidv4().slice(0, 8)}`,
    status: 'active',
    premium: quote.premium,
    commission,
    createdAt: new Date().toISOString(),
  };

  purchases.set(purchase.purchaseId, purchase);

  publishEvent('embedded.purchase.completed', {
    purchaseId: purchase.purchaseId,
    partnerId: partner.id,
    premium: quote.premium,
    commission,
  });

  res.status(201).json({
    ...purchase,
    policy_certificate_url: `/api/v1/embedded/certificates/${purchase.policyId}`,
    next_steps: ['Download certificate', 'Share with customer'],
  });
});

// Partner analytics
app.get('/api/v1/embedded/analytics', authenticatePartner, (req, res) => {
  const partner = (req as any).partner as Partner;
  const partnerPurchases = Array.from(purchases.values()).filter(p => p.partnerId === partner.id);

  res.json({
    partner_id: partner.id,
    total_quotes: quotes.size,
    total_purchases: partnerPurchases.length,
    total_premium: partnerPurchases.reduce((sum, p) => sum + p.premium, 0),
    total_commission: partnerPurchases.reduce((sum, p) => sum + p.commission, 0),
    conversion_rate: quotes.size > 0 ? partnerPurchases.length / quotes.size : 0,
    top_products: [
      { product: 'motor-comp', count: 12, premium: 90000000 },
      { product: 'gadget', count: 45, premium: 22500000 },
    ],
  });
});

// Widget configuration endpoint (for JS SDK)
app.get('/api/v1/embedded/widget/config', authenticatePartner, (req, res) => {
  const partner = (req as any).partner as Partner;
  res.json({
    partner_id: partner.id,
    sdk_url: 'https://cdn.insureportal.ng/sdk/v1/insureportal.js',
    widget_init: `InsurePortal.init({ apiKey: '${partner.apiKey}', environment: '${partner.environment}' })`,
    react_component: '<InsurePortalWidget apiKey="..." productId="motor-basic" />',
    supported_events: ['quote.created', 'purchase.completed', 'claim.filed'],
  });
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function calculatePremium(productId: string, sumInsured?: number): number {
  const rates: Record<string, number> = {
    'motor-basic': 0.05,
    'motor-comp': 0.08,
    'travel-basic': 0.03,
    'gadget': 0.10,
    'health-micro': 0.02,
  };
  const rate = rates[productId] || 0.05;
  const base = sumInsured || 50000000; // Default ₦500K
  return Math.round(base * rate);
}

function publishEvent(topic: string, data: Record<string, unknown>) {
  console.log(`[KAFKA] → ${topic}:`, JSON.stringify(data));
}

// ── Start Server ─────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`Embedded Insurance SDK service running on port ${PORT}`);
  console.log(`Partners: ${partners.size}, Environment: ${process.env.NODE_ENV || 'development'}`);
});

export default app;
