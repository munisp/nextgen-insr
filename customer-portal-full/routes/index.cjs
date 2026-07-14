/**
 * Route Domain Module Index
 * 
 * Aggregates all domain-specific route handlers into a single Map.
 * Each domain module exports an object of { 'domain.action': handler } pairs.
 * 
 * Domain groupings:
 *   auth       — login, signup, refresh, 2FA, password reset, logout
 *   policies   — CRUD, renewal, comparison, applications
 *   claims     — filing, adjudication, evidence, routing, payouts
 *   payments   — collection, gateway, reconciliation, webhooks
 *   underwriting — risk scoring, premium calculation, rate tables
 *   compliance — NAICOM, NDPR, AML/KYC, audit trail
 *   financial  — IFRS 17, reinsurance, actuarial, ERP
 *   channels   — USSD, WhatsApp, Telegram, embedded, bancassurance
 *   ai         — ML models, fraud detection, churn, anomaly
 *   admin      — settings, RBAC, workflow, approvals, system health
 *   products   — marketplace, coverage, takaful, parametric, micro
 *   analytics  — dashboard, reports, customer 360, performance
 */
module.exports = { DOMAIN_MODULES: [
  'auth', 'policies', 'claims', 'payments', 'underwriting',
  'compliance', 'financial', 'channels', 'ai', 'admin',
  'products', 'analytics',
] };
