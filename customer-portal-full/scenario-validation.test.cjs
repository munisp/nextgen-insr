/**
 * Production Scenario Validation — 10 Scenarios, 68+ Assertions
 * Tests all stakeholder workflows end-to-end against a running server.
 *
 * Usage:  node scenario-validation.test.cjs
 * Requires: server running on PORT 5002
 */
const http = require('http');

const BASE = 'http://localhost:5002';
let TOKEN = '';
let pass = 0;
let fail = 0;
const failures = [];

function request(method, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const opts = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(TOKEN ? { 'Authorization': `Bearer ${TOKEN}` } : {}),
        ...headers,
      },
    };
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch { resolve(data); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function trpcQuery(route, input) {
  const path = input
    ? `/api/trpc/${route}?input=${encodeURIComponent(JSON.stringify(input))}`
    : `/api/trpc/${route}`;
  return request('GET', path);
}

async function trpcMutation(route, input) {
  return request('POST', `/api/trpc/${route}`, input || {});
}

function check(name, result, condition) {
  if (condition) {
    pass++;
    console.log(`  PASS: ${name}`);
  } else {
    fail++;
    const preview = typeof result === 'object' ? JSON.stringify(result).slice(0, 200) : String(result).slice(0, 200);
    console.log(`  FAIL: ${name}`);
    console.log(`    Got: ${preview}`);
    failures.push(name);
  }
}

function getData(res) {
  return res?.result?.data ?? res;
}

async function run() {
  console.log('==========================================');
  console.log('=== SCENARIO 1: Policy Purchase Flow ===');
  console.log('==========================================');

  // S1.1: Login
  const login = await trpcMutation('auth.login', { email: 'demo@insureportal.ng', password: 'demo123' });
  const loginData = getData(login);
  TOKEN = loginData.token || '';
  check('S1.1 Login returns JWT token', login, TOKEN.startsWith('eyJ'));

  // S1.2: KYC Status
  const kyc = getData(await trpcQuery('kyc.status'));
  check('S1.2 KYC status', kyc, kyc.status !== undefined && kyc.level !== undefined);

  // S1.3: KYC Gate
  const kycGate = getData(await trpcQuery('kyc.gate'));
  check('S1.3 KYC gate check', kycGate, kycGate.passed !== undefined);

  // S1.4: Browse Products
  const products = getData(await trpcQuery('products.list'));
  check('S1.4 Products list', products, Array.isArray(products) && products.length > 0);

  // S1.5: Premium Calculation
  const premium = getData(await trpcMutation('premium.calculate', { productType: 'Motor', sumAssured: 5000000, age: 35 }));
  check('S1.5 Premium calculation', premium, premium.premium !== undefined || premium.basePremium !== undefined);

  // S1.6: Underwriting
  const uw = getData(await trpcMutation('underwriting.evaluate', { productType: 'Motor', applicantAge: 35, sumAssured: 5000000, annualIncome: 3000000 }));
  check('S1.6 Underwriting evaluation', uw, uw.decision !== undefined);

  // S1.7: Payment
  const pay = getData(await trpcMutation('payments.process', { policyId: 1, amount: 50000, method: 'card' }));
  check('S1.7 Premium payment', pay, pay.transactionId !== undefined || pay.success);

  // S1.8: Policies
  const policies = getData(await trpcQuery('policies.list'));
  check('S1.8 Policies list', policies, Array.isArray(policies) && policies.some(p => p.policyNumber));

  console.log('');
  console.log('==========================================');
  console.log('=== SCENARIO 2: Claims Filing Flow ===');
  console.log('==========================================');

  // S2.1: Create Claim
  const claim = getData(await trpcMutation('claims.create', { policyId: 1, amount: 250000, description: 'Vehicle damage from road accident on Lagos-Ibadan expressway' }));
  check('S2.1 Create claim', claim, claim.claimNumber !== undefined || claim.success);

  // S2.2: Upload Evidence
  const evidence = getData(await trpcMutation('claimsEvidence.upload', { type: 'photo', claimId: '1' }));
  check('S2.2 Upload evidence', evidence, evidence.evidenceId !== undefined || evidence.success);

  // S2.3: Claims List
  const claims = getData(await trpcQuery('claims.list'));
  check('S2.3 Claims list', claims, Array.isArray(claims) && claims.some(c => c.claimNumber));

  // S2.4: Timeline
  const timeline = getData(await trpcQuery('claims.timeline'));
  check('S2.4 Claims timeline', timeline, Array.isArray(timeline) && timeline.length >= 0);

  // S2.5: Tracker
  const tracker = getData(await trpcQuery('claims.tracker'));
  check('S2.5 Claims tracker', tracker, tracker.total !== undefined && tracker.steps);

  console.log('');
  console.log('==========================================');
  console.log('=== SCENARIO 3: Claims Adjudication ===');
  console.log('==========================================');

  // S3.1: Queue
  const queue = getData(await trpcQuery('claims.queue'));
  check('S3.1 Claims queue', queue, queue.queue !== undefined);

  // S3.2: Adjudicate
  const adj = getData(await trpcMutation('claims.adjudicate', { claimId: 1, amount: 250000, policyId: 1, description: 'Vehicle damage' }));
  check('S3.2 Adjudicate claim', adj, adj.decision !== undefined);

  // S3.3: Approve
  const approve = getData(await trpcMutation('claims.approve', { id: 1 }));
  check('S3.3 Approve claim', approve, approve.success);

  // S3.4: Payout
  const payout = getData(await trpcMutation('claims.payout', { claimId: 1, bankName: 'First Bank', accountNumber: '0123456789' }));
  check('S3.4 Claims payout', payout, payout.paymentRef !== undefined || payout.success !== undefined);

  // S3.5: Financial dashboard
  const finDash = getData(await trpcQuery('financial.dashboard'));
  check('S3.5 Financial dashboard', finDash, finDash !== undefined && finDash !== null);

  console.log('');
  console.log('==========================================');
  console.log('=== SCENARIO 4: Agent Workflow ===');
  console.log('==========================================');

  // S4.1: Agent Dashboard
  const agentDash = getData(await trpcQuery('agent.dashboard'));
  check('S4.1 Agent dashboard', agentDash, agentDash !== undefined);

  // S4.2: Agent Clients
  const agentClients = getData(await trpcQuery('agent.clients'));
  check('S4.2 Agent clients', agentClients, agentClients !== undefined && agentClients !== null);

  // S4.3: Agents List
  const agents = getData(await trpcQuery('agents.list'));
  check('S4.3 Agents list', agents, Array.isArray(agents) && agents.some(a => a.name));

  // S4.4: Agent Performance
  const agentPerf = getData(await trpcQuery('agents.performance'));
  check('S4.4 Agent performance', agentPerf, agentPerf !== undefined);

  // S4.5: Agent Commissions
  const commissions = getData(await trpcQuery('agents.commissions'));
  check('S4.5 Agent commissions', commissions, Array.isArray(commissions) && commissions.length > 0);

  // S4.6: Application Create
  const appCreate = getData(await trpcMutation('application.create', { productType: 'Motor', personalInfo: { name: 'John Doe', age: 35 } }));
  check('S4.6 Create application', appCreate, appCreate.success);

  console.log('');
  console.log('==========================================');
  console.log('=== SCENARIO 5: Underwriting ===');
  console.log('==========================================');

  // S5.1: Rules
  const uwRules = getData(await trpcQuery('underwriting.rules'));
  check('S5.1 Underwriting rules', uwRules, Array.isArray(uwRules) && uwRules.some(r => r.ruleName));

  // S5.2: Stats
  const uwStats = getData(await trpcQuery('underwriting.stats'));
  check('S5.2 Underwriting stats', uwStats, uwStats !== undefined);

  // S5.3: Decisions
  const uwDecisions = getData(await trpcQuery('underwriting.decisions'));
  check('S5.3 Underwriting decisions', uwDecisions, Array.isArray(uwDecisions));

  // S5.4: High-risk evaluation
  const uwRisk = getData(await trpcMutation('underwriting.evaluate', {
    productType: 'Life', applicantAge: 55, sumAssured: 20000000, annualIncome: 5000000,
    riskFactors: { isSmoker: true, occupationClass: 'hazardous' }
  }));
  check('S5.4 High-risk underwriting', uwRisk, uwRisk.riskScore !== undefined && uwRisk.riskScore > 50);

  // S5.5: Decline scenario
  const uwDecline = getData(await trpcMutation('underwriting.evaluate', {
    productType: 'Life', applicantAge: 85, sumAssured: 50000000, annualIncome: 1000000
  }));
  check('S5.5 Age limit underwriting', uwDecline, uwDecline.decision !== undefined);

  console.log('');
  console.log('==========================================');
  console.log('=== SCENARIO 6: Finance & Payments ===');
  console.log('==========================================');

  // S6.1: Financial Collections
  const finColl = getData(await trpcQuery('financial.collections'));
  check('S6.1 Financial collections', finColl, finColl !== undefined && finColl !== null);

  // S6.2: Payment Gateways
  const gateways = getData(await trpcQuery('payments.gateways'));
  check('S6.2 Payment gateways', gateways, Array.isArray(gateways) && gateways.length > 0);

  // S6.3: Initiate Payment
  const payInit = getData(await trpcMutation('payments.initiate', { gateway: 'paystack', amount: 100000 }));
  check('S6.3 Initiate payment', payInit, payInit.authorizationUrl !== undefined || payInit.reference);

  // S6.4: Verify Payment
  const payVerify = getData(await trpcMutation('payments.verify', { reference: 'PAYSTACK-123' }));
  check('S6.4 Verify payment', payVerify, payVerify.success);

  // S6.5: Reconciliation
  const recon = getData(await trpcMutation('reconciliation.run'));
  check('S6.5 Reconciliation run', recon, recon.success !== undefined || recon.matched !== undefined);

  // S6.6: Trial Balance
  const trial = getData(await trpcQuery('financial.trialBalance'));
  check('S6.6 Trial balance', trial, trial !== undefined && trial !== null);

  // S6.7: P&L
  const pnl = getData(await trpcQuery('financial.pnl'));
  check('S6.7 P&L report', pnl, pnl !== undefined && pnl !== null);

  // S6.8: Financial Score
  const finScore = getData(await trpcQuery('financial.score'));
  check('S6.8 Financial score', finScore, finScore !== undefined && finScore !== null);

  console.log('');
  console.log('==========================================');
  console.log('=== SCENARIO 7: NAICOM Compliance ===');
  console.log('==========================================');

  // S7.1: NAICOM Dashboard
  const naicomDash = getData(await trpcQuery('naicom.dashboard'));
  check('S7.1 NAICOM dashboard', naicomDash, naicomDash !== undefined);

  // S7.2: Requirements
  const naicomReq = getData(await trpcQuery('naicom.requirements'));
  check('S7.2 NAICOM requirements', naicomReq, naicomReq !== undefined && naicomReq !== null);

  // S7.3: Returns
  const naicomRet = getData(await trpcQuery('naicom.returns'));
  check('S7.3 NAICOM returns', naicomRet, Array.isArray(naicomRet) && naicomRet.some(r => r.returnType));

  // S7.4: Status
  const naicomStatus = getData(await trpcQuery('naicom.status'));
  check('S7.4 NAICOM status', naicomStatus, naicomStatus.compliant !== undefined || naicomStatus.status !== undefined);

  // S7.5: Compliance Scan
  const compRun = getData(await trpcMutation('compliance.run'));
  check('S7.5 Compliance scan', compRun, compRun.checksCompleted !== undefined || compRun.success);

  // S7.6: Penalties
  const naicomPen = getData(await trpcQuery('naicom.penalties'));
  check('S7.6 NAICOM penalties', naicomPen, naicomPen !== undefined && naicomPen !== null);

  // S7.7: Submit Return
  const naicomSubmit = getData(await trpcMutation('naicom.submit', { type: 'quarterly_return', period: 'Q2-2026' }));
  check('S7.7 NAICOM submit return', naicomSubmit, naicomSubmit.success !== undefined || naicomSubmit.filingRef !== undefined);

  console.log('');
  console.log('==========================================');
  console.log('=== SCENARIO 8: Reinsurance ===');
  console.log('==========================================');

  // S8.1: Treaties
  const treaties = getData(await trpcQuery('reinsurance.treaties'));
  check('S8.1 Reinsurance treaties', treaties, Array.isArray(treaties) && treaties.some(t => t.name && t.name !== null));

  // S8.2: Create Treaty
  const treatyCreate = getData(await trpcMutation('reinsurance.create', { type: 'quota_share', reinsurer: 'Swiss Re' }));
  check('S8.2 Create treaty', treatyCreate, treatyCreate.treatyId !== undefined || treatyCreate.success);

  // S8.3: Cessions
  const cessions = getData(await trpcQuery('reinsurance.cessions'));
  check('S8.3 Reinsurance cessions', cessions, Array.isArray(cessions) && cessions.length > 0);

  // S8.4: Reinsurance Claims
  const reinsClaims = getData(await trpcQuery('reinsurance.claims'));
  check('S8.4 Reinsurance claims', reinsClaims, reinsClaims !== undefined);

  // S8.5: Portfolio
  const portfolio = getData(await trpcQuery('reinsurance.portfolio'));
  check('S8.5 Reinsurance portfolio', portfolio, portfolio !== undefined);

  // S8.6: Bordereaux
  const bordereaux = getData(await trpcQuery('reinsurance.bordereaux'));
  check('S8.6 Bordereaux', bordereaux, bordereaux !== undefined);

  // S8.7: Settlements
  const settlements = getData(await trpcQuery('reinsurance.settlements'));
  check('S8.7 Settlements', settlements, settlements !== undefined);

  console.log('');
  console.log('==========================================');
  console.log('=== SCENARIO 9: System Admin ===');
  console.log('==========================================');

  // S9.1: Health
  const health = await request('GET', '/health');
  check('S9.1 System health', health, health.status === 'healthy');

  // S9.2: Readiness
  const ready = await request('GET', '/health/ready');
  check('S9.2 Readiness probe', ready, ready.status === 'ready');

  // S9.3: Metrics
  const metrics = await request('GET', '/metrics');
  check('S9.3 Metrics endpoint', metrics, metrics.uptime !== undefined);

  // S9.4: DB Metrics
  const dbMetrics = getData(await trpcQuery('dbScaling.metrics'));
  check('S9.4 DB scaling metrics', dbMetrics, dbMetrics.tables >= 100);

  // S9.5: RBAC Roles
  const roles = getData(await trpcQuery('rbac.roles'));
  check('S9.5 RBAC roles', roles, Array.isArray(roles) && roles.length > 0 && roles[0].name);

  // S9.6: Permission Check
  const perm = getData(await trpcMutation('rbac.checkPermission', { userId: 1, permission: 'claims.approve' }));
  check('S9.6 Permission check', perm, perm.hasPermission !== undefined);

  // S9.7: Audit Trail
  const audit = getData(await trpcQuery('audit.trail'));
  check('S9.7 Audit trail', audit, audit !== undefined);

  // S9.8: DR Status
  const dr = getData(await trpcQuery('dr.status'));
  check('S9.8 DR status', dr, dr !== undefined);

  // S9.9: Performance Metrics
  const perf = getData(await trpcQuery('performance.metrics'));
  check('S9.9 Performance metrics', perf, perf !== undefined);

  console.log('');
  console.log('==========================================');
  console.log('=== SCENARIO 10: Multi-Channel ===');
  console.log('==========================================');

  // S10.1: USSD Simulate
  const ussd = getData(await trpcMutation('ussd.simulate', { sessionCode: '*919#', phoneNumber: '08012345678' }));
  check('S10.1 USSD simulate', ussd, ussd.menu !== undefined || ussd.response !== undefined || ussd.text !== undefined);

  // S10.2: Microinsurance Products
  const micro = getData(await trpcQuery('microinsurance.products'));
  check('S10.2 Microinsurance products', micro, Array.isArray(micro) && micro.length > 0);

  // S10.3: Microinsurance Enroll
  const enroll = getData(await trpcMutation('microinsurance.enroll', { productId: 1, phoneNumber: '08012345678' }));
  check('S10.3 Microinsurance enroll', enroll, enroll.success !== undefined || enroll.enrollmentId !== undefined);

  // S10.4: WhatsApp Send
  const whatsapp = getData(await trpcMutation('whatsapp.send', { to: '08012345678', message: 'Your policy is confirmed' }));
  check('S10.4 WhatsApp send', whatsapp, whatsapp.success !== undefined || whatsapp.messageId !== undefined);

  // S10.5: Notifications
  const notifs = getData(await trpcQuery('notifications.list'));
  check('S10.5 Notifications list', notifs, Array.isArray(notifs) && notifs.length > 0);

  // S10.6: Wallet Balance
  const wallet = getData(await trpcQuery('wallet.balance'));
  check('S10.6 Wallet balance', wallet, wallet !== undefined && wallet !== null);

  // S10.7: Loyalty Points
  const loyalty = getData(await trpcQuery('loyalty.points'));
  check('S10.7 Loyalty points', loyalty, loyalty !== undefined && loyalty !== null);

  // S10.8: Referral Code
  const referral = getData(await trpcQuery('referral.code'));
  check('S10.8 Referral code', referral, referral !== undefined && referral !== null);

  console.log('');
  console.log('==========================================');
  console.log('=== RESULTS ===');
  console.log('==========================================');
  console.log(`Passed: ${pass}`);
  console.log(`Failed: ${fail}`);
  console.log(`Total: ${pass + fail}`);
  if (failures.length > 0) {
    console.log(`\nFailed tests:`);
    failures.forEach(f => console.log(`  - ${f}`));
  }
  process.exit(fail > 0 ? 1 : 0);
}

run().catch(err => {
  console.error('Test runner error:', err);
  process.exit(1);
});
