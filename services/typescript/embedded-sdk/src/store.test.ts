/**
 * Persistence tests for embedded-sdk (2026-10-02, C2-a2, persistence-audit A2).
 *
 * REAL-POSTGRES tests — no mocks/fakes/stubs. They connect to the database at
 * process.env.DATABASE_URL (default postgresql://ngapp:ngapp@localhost:5432/ngapp,
 * the same default the service uses) and SKIP if no PostgreSQL is reachable.
 * The test schema is isolated via a random table suffix is NOT used; instead the
 * tests run against the service's own tables and clean up the rows they create.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { Client as PgClient } from 'pg';

const DATABASE_URL =
  process.env.DATABASE_URL || 'postgresql://ngapp:ngapp@localhost:5432/ngapp';

async function pgReachable(): Promise<boolean> {
  const c = new PgClient({ connectionString: DATABASE_URL, connectionTimeoutMillis: 3000 });
  try {
    await c.connect();
    await c.end();
    return true;
  } catch {
    return false;
  }
}

const TEST_PORT = 18109;
const API = `http://127.0.0.1:${TEST_PORT}`;
const TEST_KEY = 'sk_test_insureportal_embed_001';

test('embedded-sdk persistence (real PostgreSQL)', async (t) => {
  if (!(await pgReachable())) {
    t.skip('PostgreSQL unreachable at ' + DATABASE_URL + ' — skipping real-PG tests');
    return;
  }

  // Boot the real service against the real DB.
  process.env.DATABASE_URL = DATABASE_URL;
  process.env.PORT = String(TEST_PORT);
  const { start } = require('./index');
  await start();
  await new Promise((r) => setTimeout(r, 300));

  const db = new PgClient({ connectionString: DATABASE_URL });
  await db.connect();

  await t.test('test partner seeded exactly once (empty-registry seed)', async () => {
    const { rows } = await db.query(
      'SELECT COUNT(*)::int AS n FROM embedded_partners WHERE api_key = $1',
      [TEST_KEY]
    );
    assert.equal(rows[0].n, 1);
  });

  await t.test('auth: missing/invalid key rejected, test key accepted', async () => {
    let r = await fetch(`${API}/api/v1/embedded/products`);
    assert.equal(r.status, 401);
    r = await fetch(`${API}/api/v1/embedded/products`, { headers: { 'x-api-key': 'sk_wrong' } });
    assert.equal(r.status, 401);
    r = await fetch(`${API}/api/v1/embedded/products`, { headers: { 'x-api-key': TEST_KEY } });
    assert.equal(r.status, 200);
  });

  let quoteId = '';
  await t.test('quote is persisted to PostgreSQL (survives outside process memory)', async () => {
    const r = await fetch(`${API}/api/v1/embedded/quotes`, {
      method: 'POST',
      headers: { 'x-api-key': TEST_KEY, 'content-type': 'application/json' },
      body: JSON.stringify({ product_id: 'motor-basic', sum_insured: 10000000 }),
    });
    assert.equal(r.status, 201);
    const q = await r.json();
    quoteId = q.quoteId;
    // Verify durability by reading the row through an independent connection.
    const { rows } = await db.query('SELECT * FROM embedded_quotes WHERE quote_id = $1', [quoteId]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].partner_id, 'partner-test-001');
    assert.equal(Number(rows[0].premium), 500000);
  });

  await t.test('purchase is persisted to PostgreSQL (money-bearing, durable)', async () => {
    const r = await fetch(`${API}/api/v1/embedded/purchases`, {
      method: 'POST',
      headers: { 'x-api-key': TEST_KEY, 'content-type': 'application/json' },
      body: JSON.stringify({ quote_id: quoteId }),
    });
    assert.equal(r.status, 201);
    const p = await r.json();
    assert.equal(p.commission, 75000); // 15% of 500000
    const { rows } = await db.query(
      'SELECT * FROM embedded_purchases WHERE purchase_id = $1',
      [p.purchaseId]
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].status, 'active');
    // cleanup of rows created by this test
    await db.query('DELETE FROM embedded_purchases WHERE purchase_id = $1', [p.purchaseId]);
    await db.query('DELETE FROM embedded_quotes WHERE quote_id = $1', [quoteId]);
  });

  await t.test('purchase with unknown quote fails closed (404)', async () => {
    const r = await fetch(`${API}/api/v1/embedded/purchases`, {
      method: 'POST',
      headers: { 'x-api-key': TEST_KEY, 'content-type': 'application/json' },
      body: JSON.stringify({ quote_id: 'QT-doesnotexist' }),
    });
    assert.equal(r.status, 404);
  });

  await t.test('analytics reads from PostgreSQL', async () => {
    const r = await fetch(`${API}/api/v1/embedded/analytics`, {
      headers: { 'x-api-key': TEST_KEY },
    });
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.equal(body.partner_id, 'partner-test-001');
    assert.equal(typeof body.total_quotes, 'number');
  });

  await t.test('analytics: real per-partner counts and top-products ordering', async () => {
    // Seed a second partner plus quotes/purchases for two partners/products.
    const P2 = 'partner-test-002';
    const P2_KEY = 'sk_test_insureportal_embed_002';
    await db.query(
      `INSERT INTO embedded_partners (id, name, api_key, environment, permissions, commission_rate)
       VALUES ($1, $2, $3, 'sandbox', $4, 10)
       ON CONFLICT (id) DO NOTHING`,
      [P2, 'Second Test Partner', P2_KEY, ['quote', 'purchase', 'analytics']]
    );

    const seedQuote = async (qid: string, pid: string, product: string, premium: number) => {
      await db.query(
        `INSERT INTO embedded_quotes (quote_id, partner_id, product_id, premium, coverage, valid_until)
         VALUES ($1, $2, $3, $4, 1000000, NOW() + interval '1 day')
         ON CONFLICT (quote_id) DO NOTHING`,
        [qid, pid, product, premium]
      );
    };
    const seedPurchase = async (pid_: string, qid: string, pid2: string, premium: number) => {
      await db.query(
        `INSERT INTO embedded_purchases (purchase_id, quote_id, partner_id, policy_id, status, premium, commission)
         VALUES ($1, $2, $3, $4, 'active', $5, $6)
         ON CONFLICT (purchase_id) DO NOTHING`,
        [pid_, qid, pid2, `POL-${qid}`, premium, Math.round(premium * 0.15)]
      );
    };

    // partner 1: 2 quotes for gadget, 1 for motor-comp; partner 2: 1 quote for gadget
    await seedQuote('QT-an-1', 'partner-test-001', 'gadget', 500000);
    await seedQuote('QT-an-2', 'partner-test-001', 'gadget', 700000);
    await seedQuote('QT-an-3', 'partner-test-001', 'motor-comp', 7500000);
    await seedQuote('QT-an-4', P2, 'gadget', 900000);
    await seedPurchase('PUR-an-1', 'QT-an-1', 'partner-test-001', 500000);

    try {
      const r1 = await fetch(`${API}/api/v1/embedded/analytics`, {
        headers: { 'x-api-key': TEST_KEY },
      });
      assert.equal(r1.status, 200);
      const a1 = await r1.json();

      const r2 = await fetch(`${API}/api/v1/embedded/analytics`, {
        headers: { 'x-api-key': P2_KEY },
      });
      assert.equal(r2.status, 200);
      const a2 = await r2.json();

      // Partner scoping: partner 2 must NOT see partner 1's quotes.
      assert.equal(a2.partner_id, P2);
      assert.equal(a2.total_quotes, 1);
      assert.equal(a2.total_purchases, 0);
      assert.deepEqual(a2.top_products, [{ product: 'gadget', count: 1, premium: 900000 }]);

      // Partner 1 sees only its own rows; ordering: gadget (2) before motor-comp (1).
      assert.equal(a1.partner_id, 'partner-test-001');
      assert.equal(a1.total_quotes, 3);
      assert.equal(a1.total_purchases, 1);
      assert.equal(a1.total_premium, 500000);
      assert.deepEqual(a1.top_products, [
        { product: 'gadget', count: 2, premium: 1200000 },
        { product: 'motor-comp', count: 1, premium: 7500000 },
      ]);
    } finally {
      await db.query("DELETE FROM embedded_purchases WHERE purchase_id LIKE 'PUR-an-%'");
      await db.query("DELETE FROM embedded_quotes WHERE quote_id LIKE 'QT-an-%'");
      await db.query('DELETE FROM embedded_partners WHERE id = $1', [P2]);
    }
  });

  await db.end();
  process.exit(0); // close the listening server so node:test can exit
});
