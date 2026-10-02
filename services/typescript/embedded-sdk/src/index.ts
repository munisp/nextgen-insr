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
 * - PostgreSQL: partner registry, quotes, purchases (durable, money-bearing)
 * - Keycloak: partner authentication (OAuth2 client credentials)
 * - APISIX: upstream for /api/embedded/* routes
 * - TigerBeetle: commission splits and payouts
 * - Permify: partner-level access control
 *
 * Persistence (2026-10-02, C2-a2, persistence-audit A2):
 *   partners/quotes/purchases were process-memory Maps and were lost on
 *   restart. They now live in service-local PostgreSQL tables
 *   (embedded_partners / embedded_quotes / embedded_purchases), created and
 *   owned by this service following the whatsapp-claims-bot pattern.
 *   The shared drizzle partner_products table (schema.ts:6018) is a
 *   partner→product embedding config (FK to insurance_products, apiKeyHash
 *   only, no permissions/webhookUrl) and does NOT fit the partner registry,
 *   so it is intentionally not reused here — flagged to orchestrator.
 *   Purchases are money-bearing: every read/write is fail-closed — when the
 *   DB is unavailable the caller gets 503, never a fake success.
 */

import express from 'express';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
import { Client as PgClient } from 'pg';

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 8109;
const DATABASE_URL =
  process.env.DATABASE_URL || 'postgresql://ngapp:ngapp@localhost:5432/ngapp';

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

// ── PostgreSQL store (2026-10-02, C2-a2) ─────────────────────────────────────

let db: PgClient;

async function initDB(): Promise<void> {
  db = new PgClient({ connectionString: DATABASE_URL });
  await db.connect();
  await db.query(`
    CREATE TABLE IF NOT EXISTS embedded_partners (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      api_key TEXT NOT NULL UNIQUE,
      environment TEXT NOT NULL DEFAULT 'sandbox',
      permissions TEXT[] NOT NULL DEFAULT '{}',
      commission_rate DOUBLE PRECISION NOT NULL DEFAULT 5,
      webhook_url TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS embedded_quotes (
      quote_id TEXT PRIMARY KEY,
      partner_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      premium BIGINT NOT NULL,
      coverage BIGINT NOT NULL,
      currency TEXT NOT NULL DEFAULT 'NGN',
      valid_until TIMESTAMPTZ NOT NULL,
      customer_email TEXT,
      metadata JSONB NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS embedded_purchases (
      purchase_id TEXT PRIMARY KEY,
      quote_id TEXT NOT NULL,
      partner_id TEXT NOT NULL,
      policy_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      premium BIGINT NOT NULL,
      commission BIGINT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_embedded_quotes_partner ON embedded_quotes(partner_id);
    CREATE INDEX IF NOT EXISTS idx_embedded_purchases_partner ON embedded_purchases(partner_id);
  `);

  // 2026-10-02 (C2-a2): seed the sandbox test partner ONLY when the partner
  // registry is empty. Previously it was re-seeded into an in-memory Map on
  // every boot; now that partners are durable, unconditional seeding would
  // resurrect the test key after deletion and conflict on api_key.
  const { rows } = await db.query('SELECT COUNT(*)::int AS n FROM embedded_partners');
  if (rows[0].n === 0) {
    await db.query(
      `INSERT INTO embedded_partners (id, name, api_key, environment, permissions, commission_rate)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        'partner-test-001',
        'Test Fintech',
        'sk_test_insureportal_embed_001',
        'sandbox',
        ['quote', 'purchase', 'claim', 'analytics'],
        15,
      ]
    );
    console.log('Embedded SDK: seeded sandbox test partner (empty registry)');
  }
  console.log('Embedded SDK: PostgreSQL connected');
}

// Row mappers
function rowToPartner(r: any): Partner {
  return {
    id: r.id,
    name: r.name,
    apiKey: r.api_key,
    environment: r.environment,
    permissions: r.permissions,
    commissionRate: r.commission_rate,
    webhookUrl: r.webhook_url ?? undefined,
    createdAt: new Date(r.created_at).toISOString(),
  };
}

function rowToQuote(r: any): EmbeddedQuote {
  return {
    quoteId: r.quote_id,
    partnerId: r.partner_id,
    productId: r.product_id,
    premium: Number(r.premium),
    coverage: Number(r.coverage),
    currency: r.currency,
    validUntil: new Date(r.valid_until).toISOString(),
    customerEmail: r.customer_email ?? undefined,
    metadata: r.metadata,
  };
}

// ── Middleware ────────────────────────────────────────────────────────────────

async function authenticatePartner(req: express.Request, res: express.Response, next: express.NextFunction) {
  const apiKey = req.headers['x-api-key'] as string || req.query.api_key as string;
  if (!apiKey) {
    return res.status(401).json({ error: 'API key required', code: 'MISSING_API_KEY' });
  }
  try {
    const { rows } = await db.query('SELECT * FROM embedded_partners WHERE api_key = $1', [apiKey]);
    if (rows.length === 0) {
      return res.status(401).json({ error: 'Invalid API key', code: 'INVALID_API_KEY' });
    }
    (req as any).partner = rowToPartner(rows[0]);
    next();
  } catch (err) {
    // 2026-10-02 (C2-a2): fail-closed — never authenticate without the DB.
    console.error('Embedded SDK: partner lookup failed', err);
    return res.status(503).json({ error: 'Datastore unavailable', code: 'DB_UNAVAILABLE' });
  }
}

// ── Endpoints ────────────────────────────────────────────────────────────────

app.get('/health', async (_req, res) => {
  let partnerCount = -1;
  try {
    const { rows } = await db.query('SELECT COUNT(*)::int AS n FROM embedded_partners');
    partnerCount = rows[0].n;
  } catch {
    // health still reports; negative count signals DB trouble
  }
  res.json({
    status: 'healthy',
    service: 'embedded-sdk',
    version: '1.0.0',
    partners_registered: partnerCount,
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
app.post('/api/v1/embedded/quotes', authenticatePartner, async (req, res) => {
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

  try {
    await db.query(
      `INSERT INTO embedded_quotes
         (quote_id, partner_id, product_id, premium, coverage, currency, valid_until, customer_email, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        quote.quoteId, quote.partnerId, quote.productId, quote.premium,
        quote.coverage, quote.currency, quote.validUntil,
        quote.customerEmail ?? null, JSON.stringify(quote.metadata),
      ]
    );
  } catch (err) {
    // 2026-10-02 (C2-a2): fail-closed — never acknowledge a quote we did not persist.
    console.error('Embedded SDK: quote insert failed', err);
    return res.status(503).json({ error: 'Datastore unavailable', code: 'DB_UNAVAILABLE' });
  }

  // Publish event
  publishEvent('embedded.quote.created', { quoteId: quote.quoteId, partnerId: partner.id, product: product_id });

  res.status(201).json(quote);
});

// Purchase policy from quote
app.post('/api/v1/embedded/purchases', authenticatePartner, async (req, res) => {
  const { quote_id } = req.body;
  const partner = (req as any).partner as Partner;

  let quote: EmbeddedQuote;
  try {
    const { rows } = await db.query(
      'SELECT * FROM embedded_quotes WHERE quote_id = $1 AND valid_until > NOW()',
      [quote_id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Quote not found or expired' });
    }
    quote = rowToQuote(rows[0]);
  } catch (err) {
    // 2026-10-02 (C2-a2): fail-closed on money-bearing path.
    console.error('Embedded SDK: quote lookup failed', err);
    return res.status(503).json({ error: 'Datastore unavailable', code: 'DB_UNAVAILABLE' });
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

  try {
    await db.query(
      `INSERT INTO embedded_purchases
         (purchase_id, quote_id, partner_id, policy_id, status, premium, commission, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        purchase.purchaseId, purchase.quoteId, purchase.partnerId, purchase.policyId,
        purchase.status, purchase.premium, purchase.commission, purchase.createdAt,
      ]
    );
  } catch (err) {
    // 2026-10-02 (C2-a2): fail-closed — a purchase that is not durable is a
    // failed purchase; never pretend success on the money path.
    console.error('Embedded SDK: purchase insert failed', err);
    return res.status(503).json({ error: 'Datastore unavailable', code: 'DB_UNAVAILABLE' });
  }

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
app.get('/api/v1/embedded/analytics', authenticatePartner, async (req, res) => {
  const partner = (req as any).partner as Partner;
  try {
    // 2026-10-02: partner-scoped, real data only — no hardcoded placeholders.
    const [quoteCount, agg, top] = await Promise.all([
      db.query(
        'SELECT COUNT(*)::int AS n FROM embedded_quotes WHERE partner_id = $1',
        [partner.id]
      ),
      db.query(
        `SELECT COUNT(*)::int AS n,
                COALESCE(SUM(premium), 0)::bigint AS premium,
                COALESCE(SUM(commission), 0)::bigint AS commission
           FROM embedded_purchases WHERE partner_id = $1`,
        [partner.id]
      ),
      db.query(
        `SELECT q.product_id AS product,
                COUNT(*)::int AS count,
                COALESCE(SUM(q.premium), 0)::bigint AS premium
           FROM embedded_quotes q
          WHERE q.partner_id = $1
          GROUP BY q.product_id
          ORDER BY count DESC, q.product_id ASC
          LIMIT 5`,
        [partner.id]
      ),
    ]);
    const totalQuotes = quoteCount.rows[0].n;
    const totalPurchases = agg.rows[0].n;
    res.json({
      partner_id: partner.id,
      total_quotes: totalQuotes,
      total_purchases: totalPurchases,
      total_premium: Number(agg.rows[0].premium),
      total_commission: Number(agg.rows[0].commission),
      conversion_rate: totalQuotes > 0 ? totalPurchases / totalQuotes : 0,
      top_products: top.rows.map((r: any) => ({
        product: r.product,
        count: r.count,
        premium: Number(r.premium),
      })),
    });
  } catch (err) {
    console.error('Embedded SDK: analytics query failed', err);
    return res.status(503).json({ error: 'Datastore unavailable', code: 'DB_UNAVAILABLE' });
  }
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
// 2026-10-02 (C2-a2): fail-closed boot — if PostgreSQL is unreachable the
// service must not start and serve money-bearing endpoints from memory.

export async function start(): Promise<void> {
  await initDB();
  app.listen(PORT, () => {
    console.log(`Embedded Insurance SDK service running on port ${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  });
}

if (require.main === module) {
  start().catch((err) => {
    console.error('Embedded SDK: startup failed (PostgreSQL unavailable)', err);
    process.exit(1);
  });
}

export default app;
