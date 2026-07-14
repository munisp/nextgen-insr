/**
 * Payment Microservice — extracted from monolith server.cjs
 * Handles: Paystack, Flutterwave, InsurePortal Pay, reconciliation, settlements
 * 
 * Runs independently on port 5011
 */
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const { Pool } = require('pg');

const app = express();
app.use(cors());
app.use(express.json());
const PORT = process.env.PAYMENT_PORT || 5011;

const pool = new Pool({
  host: process.env.PGHOST || 'localhost',
  port: parseInt(process.env.PGPORT || '5432'),
  database: process.env.PGDATABASE || 'ngapp',
  user: process.env.PGUSER || 'ngapp',
  password: process.env.PGPASSWORD || 'ngapp',
  max: 10,
});

async function q(sql, params = []) {
  const { rows } = await pool.query(sql, params);
  return rows;
}
async function q1(sql, params = []) {
  return (await q(sql, params))[0] || null;
}

const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY;
const FLUTTER_SECRET = process.env.FLUTTERWAVE_SECRET_KEY;

app.get('/health', (req, res) => res.json({ service: 'payment', status: 'healthy' }));

// Initiate payment
app.post('/payments/initiate', async (req, res) => {
  try {
    const { gateway, amount, email, currency, reference, metadata } = req.body;
    const ref = reference || `PAY-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    if (gateway === 'paystack') {
      if (!PAYSTACK_SECRET) {
        return res.json({ gateway: 'paystack', reference: ref, checkoutUrl: `https://checkout.paystack.com/test/${ref}`, status: 'sandbox' });
      }
      const resp = await fetch('https://api.paystack.co/transaction/initialize', {
        method: 'POST',
        headers: { Authorization: `Bearer ${PAYSTACK_SECRET}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: Math.round(amount * 100), email, reference: ref, currency: currency || 'NGN', metadata }),
      });
      const data = await resp.json();
      return res.json({ gateway: 'paystack', reference: ref, checkoutUrl: data.data?.authorization_url, status: data.status ? 'initiated' : 'failed' });
    }
    if (gateway === 'flutterwave') {
      if (!FLUTTER_SECRET) {
        return res.json({ gateway: 'flutterwave', reference: ref, checkoutUrl: `https://checkout.flutterwave.com/test/${ref}`, status: 'sandbox' });
      }
      const resp = await fetch('https://api.flutterwave.com/v3/payments', {
        method: 'POST',
        headers: { Authorization: `Bearer ${FLUTTER_SECRET}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ tx_ref: ref, amount, currency: currency || 'NGN', customer: { email }, redirect_url: `${process.env.APP_URL || 'http://localhost:5002'}/payment/callback` }),
      });
      const data = await resp.json();
      return res.json({ gateway: 'flutterwave', reference: ref, checkoutUrl: data.data?.link, status: data.status === 'success' ? 'initiated' : 'failed' });
    }
    // InsurePortal Pay (internal)
    return res.json({ gateway: 'insureportal', reference: ref, status: 'initiated', message: 'Direct bank transfer initiated' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Verify payment
app.get('/payments/verify/:reference', async (req, res) => {
  try {
    const { reference } = req.params;
    if (PAYSTACK_SECRET) {
      const resp = await fetch(`https://api.paystack.co/transaction/verify/${reference}`, { headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` } });
      const data = await resp.json();
      if (data.data) return res.json({ reference, status: data.data.status, amount: data.data.amount / 100, gateway: 'paystack' });
    }
    const txn = await q1('SELECT * FROM payment_transactions WHERE reference=$1', [reference]);
    res.json(txn || { reference, status: 'not_found' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Paystack webhook
app.post('/webhooks/paystack', (req, res) => {
  if (PAYSTACK_SECRET) {
    const hash = crypto.createHmac('sha512', PAYSTACK_SECRET).update(JSON.stringify(req.body)).digest('hex');
    if (hash !== req.headers['x-paystack-signature']) return res.status(401).send('Invalid signature');
  }
  const { event, data } = req.body;
  console.log(`[PAYSTACK] ${event}: ${data?.reference}`);
  if (event === 'charge.success') {
    pool.query(`INSERT INTO payment_transactions (reference, gateway, amount, currency, status, raw_response, created_at) VALUES ($1, 'paystack', $2, $3, 'success', $4, NOW()) ON CONFLICT (reference) DO UPDATE SET status='success'`,
      [data.reference, data.amount / 100, data.currency, JSON.stringify(data)]).catch(console.error);
  }
  res.sendStatus(200);
});

// Flutterwave webhook
app.post('/webhooks/flutterwave', (req, res) => {
  const { event, data } = req.body;
  console.log(`[FLUTTERWAVE] ${event}: ${data?.tx_ref}`);
  if (data?.status === 'successful') {
    pool.query(`INSERT INTO payment_transactions (reference, gateway, amount, currency, status, raw_response, created_at) VALUES ($1, 'flutterwave', $2, $3, 'success', $4, NOW()) ON CONFLICT (reference) DO UPDATE SET status='success'`,
      [data.tx_ref, data.amount, data.currency, JSON.stringify(data)]).catch(console.error);
  }
  res.sendStatus(200);
});

// Reconciliation
app.get('/payments/reconciliation', async (req, res) => {
  try {
    const stats = await q(`SELECT gateway, status, COUNT(*) as count, COALESCE(SUM(amount), 0) as total FROM payment_transactions GROUP BY gateway, status`);
    const pending = await q(`SELECT * FROM payment_transactions WHERE status='pending' AND created_at < NOW() - INTERVAL '1 hour' LIMIT 50`);
    res.json({ stats, pendingReconciliation: pending, generatedAt: new Date().toISOString() });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Settlements
app.get('/payments/settlements', async (req, res) => {
  try {
    const settlements = await q(`SELECT * FROM payment_settlements ORDER BY created_at DESC LIMIT 50`);
    res.json(settlements);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.listen(PORT, () => console.log(`Payment service running on port ${PORT}`));
