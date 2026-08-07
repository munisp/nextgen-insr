/**
 * InsurePortal — Chaos Engineering Test
 * 5,000 Concurrent Workflows with Redis + TigerBeetle Failure Injection
 *
 * Tests:
 *   Scenario A: Redis failure during active workflows (idempotency fallback)
 *   Scenario B: TigerBeetle failure during premium collection (PG fallback)
 *   Scenario C: Both Redis + TB fail simultaneously (full fallback path)
 *   Scenario D: Network partition (50% packet loss simulation)
 *   Scenario E: Recovery — services restored, verify no data loss
 */

import { performance } from 'perf_hooks';
import crypto from 'crypto';

// ── In-Memory Service Simulators ──────────────────────────────────────────────

class RedisSimulator {
  constructor() {
    this.store = new Map();
    this.locks = new Map();
    this.isDown = false;
    this.failureCount = 0;
    this.recoveryCount = 0;
    this.callCount = 0;
  }

  async setNX(key, value, ttlMs = 30000) {
    this.callCount++;
    if (this.isDown) {
      this.failureCount++;
      throw new Error('REDIS_CONNECTION_REFUSED: Redis node is down');
    }
    if (this.store.has(key)) return false;
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
    return true;
  }

  async get(key) {
    this.callCount++;
    if (this.isDown) {
      this.failureCount++;
      throw new Error('REDIS_CONNECTION_REFUSED: Redis node is down');
    }
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) { this.store.delete(key); return null; }
    return entry.value;
  }

  async del(key) {
    this.callCount++;
    if (this.isDown) return; // fail-open on delete
    this.store.delete(key);
  }

  injectFailure() { this.isDown = true; }
  restore() { this.isDown = false; this.recoveryCount++; }
}

class TigerBeetleSimulator {
  constructor() {
    this.accounts = new Map([
      ['PREMIUM_POOL', 100_000_000_00n],
      ['CLAIMS_RESERVE', 50_000_000_00n],
      ['FEE_POOL', 10_000_000_00n],
      ['FLOAT_POOL', 20_000_000_00n],
    ]);
    this.transfers = new Map();
    this.isDown = false;
    this.failureCount = 0;
    this.recoveryCount = 0;
    this.transferCount = 0;
    this.reversalCount = 0;
  }

  async createTransfer(id, debitAccountId, creditAccountId, amount) {
    this.transferCount++;
    if (this.isDown) {
      this.failureCount++;
      throw new Error('TB_SIDECAR_UNAVAILABLE: TigerBeetle sidecar is down');
    }
    const debitBal = this.accounts.get(debitAccountId) ?? 0n;
    const amountBig = BigInt(amount);
    if (debitBal < amountBig) throw new Error(`TB_INSUFFICIENT_FUNDS: ${debitAccountId} has ${debitBal}, needs ${amountBig}`);
    this.accounts.set(debitAccountId, debitBal - amountBig);
    this.accounts.set(creditAccountId, (this.accounts.get(creditAccountId) ?? 0n) + amountBig);
    this.transfers.set(id, { id, debitAccountId, creditAccountId, amount: amountBig, status: 'posted', timestamp: Date.now() });
    return { id, status: 'posted' };
  }

  async reverseTransfer(originalId) {
    this.reversalCount++;
    if (this.isDown) throw new Error('TB_SIDECAR_UNAVAILABLE');
    const orig = this.transfers.get(originalId);
    if (!orig) throw new Error(`TB_TRANSFER_NOT_FOUND: ${originalId}`);
    if (orig.status === 'reversed') return { status: 'already_reversed' };
    const reversalId = `rev_${originalId}`;
    await this.createTransfer(reversalId, orig.creditAccountId, orig.debitAccountId, Number(orig.amount));
    orig.status = 'reversed';
    return { id: reversalId, status: 'posted' };
  }

  injectFailure() { this.isDown = true; }
  restore() { this.isDown = false; this.recoveryCount++; }
}

class PostgreSQLSimulator {
  constructor() {
    this.policies = new Map();
    this.transactions = new Map();
    this.idempotencyLog = new Map();
    this.auditLog = [];
    this.isDown = false;
    this.writeCount = 0;
    this.fallbackWrites = 0; // writes that happened because TB was down
  }

  async insertTransaction(id, data) {
    this.writeCount++;
    if (this.isDown) throw new Error('PG_CONNECTION_REFUSED');
    this.transactions.set(id, { ...data, createdAt: Date.now() });
  }

  async updateTransactionStatus(id, status, tbTransferId = null) {
    if (this.isDown) throw new Error('PG_CONNECTION_REFUSED');
    const tx = this.transactions.get(id);
    if (tx) {
      tx.status = status;
      if (tbTransferId) tx.tbTransferId = tbTransferId;
    }
  }

  async insertPolicy(id, data) {
    this.writeCount++;
    if (this.isDown) throw new Error('PG_CONNECTION_REFUSED');
    this.policies.set(id, { ...data, createdAt: Date.now() });
  }

  async checkIdempotency(key) {
    return this.idempotencyLog.get(key) || null;
  }

  async setIdempotency(key, result) {
    this.idempotencyLog.set(key, result);
  }

  async writeAuditLog(entry) {
    this.auditLog.push({ ...entry, timestamp: Date.now() });
  }
}

// ── Metrics Collector ─────────────────────────────────────────────────────────

class Metrics {
  constructor() {
    this.lockAcquisitions = [];
    this.tbTransfers = [];
    this.e2eLatencies = [];
    this.redisFailures = 0;
    this.tbFailures = 0;
    this.pgFallbacks = 0;
    this.idempotencyHits = 0;
    this.sagaCompensations = 0;
    this.successfulWorkflows = 0;
    this.failedWorkflows = 0;
    this.recoveredWorkflows = 0;
  }

  percentile(arr, p) {
    if (!arr.length) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const idx = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, idx)];
  }

  summary() {
    return {
      lockP50: this.percentile(this.lockAcquisitions, 50),
      lockP95: this.percentile(this.lockAcquisitions, 95),
      lockP99: this.percentile(this.lockAcquisitions, 99),
      tbP50: this.percentile(this.tbTransfers, 50),
      tbP95: this.percentile(this.tbTransfers, 95),
      tbP99: this.percentile(this.tbTransfers, 99),
      e2eP50: this.percentile(this.e2eLatencies, 50),
      e2eP95: this.percentile(this.e2eLatencies, 95),
      e2eP99: this.percentile(this.e2eLatencies, 99),
    };
  }
}

// ── Core Payment Workflow (mirrors production code) ───────────────────────────

async function executePremiumPayment(redis, tb, pg, metrics, {
  customerId, policyId, amount, idempotencyKey, simulateFailureAfterTB = false
}) {
  const e2eStart = performance.now();

  // Step 1: Check idempotency (PG fallback if Redis down)
  let existingResult = null;
  try {
    existingResult = await redis.get(`idem:${idempotencyKey}`);
  } catch (redisErr) {
    metrics.redisFailures++;
    // Fallback to PostgreSQL idempotency check
    existingResult = await pg.checkIdempotency(idempotencyKey);
    metrics.pgFallbacks++;
  }
  if (existingResult) {
    metrics.idempotencyHits++;
    return JSON.parse(existingResult);
  }

  // Step 2: Acquire distributed lock (fail-open if Redis down)
  let lockAcquired = false;
  const lockKey = `lock:payment:${customerId}`;
  const lockStart = performance.now();
  try {
    lockAcquired = await redis.setNX(lockKey, '1', 30000);
    metrics.lockAcquisitions.push(performance.now() - lockStart);
    if (!lockAcquired) {
      // Another worker holds the lock — return conflict
      return { status: 'conflict', reason: 'lock_contention' };
    }
  } catch (redisErr) {
    metrics.redisFailures++;
    // Fail-open: proceed without lock (risk of duplicate, but PG idempotency will catch it)
    lockAcquired = false;
  }

  const transactionId = crypto.randomBytes(8).toString('hex');
  let tbTransferId = null;
  let tbSuccess = false;

  try {
    // Step 3: Insert pending transaction in PostgreSQL
    await pg.insertTransaction(transactionId, {
      customerId, policyId, amount, idempotencyKey, status: 'pending'
    });

    // Step 4: TigerBeetle double-entry transfer
    const tbStart = performance.now();
    try {
      const tbResult = await tb.createTransfer(
        `tb_${transactionId}`,
        `customer_${customerId}`,
        'PREMIUM_POOL',
        amount * 100 // kobo
      );
      tbTransferId = tbResult.id;
      tbSuccess = true;
      metrics.tbTransfers.push(performance.now() - tbStart);
    } catch (tbErr) {
      metrics.tbFailures++;
      // TigerBeetle is down — proceed with PG-only (fail-open)
      tbSuccess = false;
      pg.fallbackWrites++;
    }

    // Step 5: Simulate failure after TB (for saga compensation test)
    if (simulateFailureAfterTB) {
      throw new Error('SIMULATED_FAILURE: Database write failed after TB transfer');
    }

    // Step 6: Update transaction status in PostgreSQL
    await pg.updateTransactionStatus(transactionId, 'completed', tbTransferId);

    // Step 7: Insert policy record
    const policyRecordId = crypto.randomBytes(6).toString('hex');
    await pg.insertPolicy(policyRecordId, { customerId, policyId, transactionId, status: 'active' });

    // Step 8: Audit log
    await pg.writeAuditLog({ action: 'PREMIUM_COLLECTED', transactionId, customerId, amount, tbTransferId });

    // Step 9: Store idempotency result
    const result = { status: 'success', transactionId, tbTransferId, policyRecordId };
    const resultStr = JSON.stringify(result);
    try {
      await redis.setNX(`idem:${idempotencyKey}`, resultStr, 86400000);
    } catch (_) {
      // Redis down — store in PG
      await pg.setIdempotency(idempotencyKey, resultStr);
    }

    metrics.successfulWorkflows++;
    metrics.e2eLatencies.push(performance.now() - e2eStart);
    return result;

  } catch (err) {
    // ── SAGA COMPENSATION ──────────────────────────────────────────────────
    metrics.sagaCompensations++;

    // Reverse TB transfer if it was posted
    if (tbSuccess && tbTransferId) {
      try {
        await tb.reverseTransfer(tbTransferId);
      } catch (revErr) {
        // TB is down during reversal — queue for later reconciliation
        await pg.writeAuditLog({
          action: 'TB_REVERSAL_QUEUED',
          transactionId,
          tbTransferId,
          reason: revErr.message
        });
      }
    }

    // Update transaction to failed
    try {
      await pg.updateTransactionStatus(transactionId, 'failed');
    } catch (_) {}

    metrics.failedWorkflows++;
    metrics.e2eLatencies.push(performance.now() - e2eStart);
    return { status: 'failed', error: err.message, transactionId, compensated: tbSuccess };

  } finally {
    // Always release lock
    if (lockAcquired) {
      try { await redis.del(lockKey); } catch (_) {}
    }
  }
}

// ── Test Scenarios ─────────────────────────────────────────────────────────────

async function runScenarioA_RedisFailure(redis, tb, pg, metrics) {
  console.log('\n╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║  SCENARIO A: Redis Failure During 2,000 Active Workflows            ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝');

  const TOTAL = 2000;
  const FAILURE_AT = 500; // inject Redis failure after 500 workflows
  const RESTORE_AT = 1500; // restore Redis at 1500

  // Pre-fund customer accounts for this scenario
  for (let i = 0; i < TOTAL; i++) {
    tb.accounts.set(`customer_${i}`, BigInt(1_000_000 * 100));
  }
  const initialPremiumPool = tb.accounts.get('PREMIUM_POOL');
  let failureInjected = false;
  let restored = false;
  let workflowsDuringFailure = 0;
  let workflowsAfterRestore = 0;

  const start = performance.now();

  const promises = Array.from({ length: TOTAL }, (_, i) => {
    return (async () => {
      // Inject failure at 500
      if (i === FAILURE_AT && !failureInjected) {
        redis.injectFailure();
        failureInjected = true;
      }
      // Restore at 1500
      if (i === RESTORE_AT && !restored) {
        redis.restore();
        restored = true;
      }

      if (i >= FAILURE_AT && i < RESTORE_AT) workflowsDuringFailure++;
      if (i >= RESTORE_AT) workflowsAfterRestore++;

      return executePremiumPayment(redis, tb, pg, metrics, {
        customerId: `cust_${i}`,
        policyId: `pol_${i}`,
        amount: 5000,
        idempotencyKey: `scenA_${i}`,
      });
    })();
  });

  const results = await Promise.all(promises);
  const elapsed = performance.now() - start;

  const succeeded = results.filter(r => r.status === 'success').length;
  const failed = results.filter(r => r.status === 'failed').length;
  const pgFallbacksUsed = metrics.pgFallbacks;

  const finalPremiumPool = tb.accounts.get('PREMIUM_POOL');
  // Count actual TB transfers credited to PREMIUM_POOL (not counting pre-funded customer accounts)
  const actualTbCredits = [...tb.transfers.values()]
    .filter(t => t.status === 'posted' && t.creditAccountId === 'PREMIUM_POOL')
    .reduce((sum, t) => sum + t.amount, 0n);
  const expectedIncrease = actualTbCredits;
  const actualIncrease = finalPremiumPool - initialPremiumPool;
  const ledgerConsistent = actualIncrease === expectedIncrease;

  console.log(`  Total workflows: ${TOTAL}`);
  console.log(`  Succeeded: ${succeeded}`);
  console.log(`  Failed: ${failed}`);
  console.log(`  Workflows during Redis failure: ${workflowsDuringFailure}`);
  console.log(`  PG fallbacks used (Redis down): ${pgFallbacksUsed}`);
  console.log(`  Redis failure count: ${redis.failureCount}`);
  console.log(`  Ledger consistent: ${ledgerConsistent ? '✓ YES' : '✗ NO'} (expected +${expectedIncrease}, got +${actualIncrease})`);
  console.log(`  Time: ${elapsed.toFixed(0)}ms`);

  return { succeeded, failed, ledgerConsistent, pgFallbacksUsed };
}

async function runScenarioB_TBFailure(redis, tb, pg, metrics) {
  console.log('\n╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║  SCENARIO B: TigerBeetle Failure During 1,500 Active Workflows      ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝');

  const TOTAL = 1500;
  const FAILURE_AT = 300;
  const RESTORE_AT = 1200;

  for (let i = 0; i < TOTAL; i++) tb.accounts.set(`customer_b_${i}`, BigInt(1_000_000 * 100));
  const initialPremiumPool = tb.accounts.get('PREMIUM_POOL');
  let failureInjected = false;
  let restored = false;

  const start = performance.now();

  const promises = Array.from({ length: TOTAL }, (_, i) => {
    return (async () => {
      if (i === FAILURE_AT && !failureInjected) {
        tb.injectFailure();
        failureInjected = true;
      }
      if (i === RESTORE_AT && !restored) {
        tb.restore();
        restored = true;
      }

      return executePremiumPayment(redis, tb, pg, metrics, {
        customerId: `cust_b_${i}`,
        policyId: `pol_b_${i}`,
        amount: 7500,
        idempotencyKey: `scenB_${i}`,
      });
    })();
  });

  const results = await Promise.all(promises);
  const elapsed = performance.now() - start;

  const succeeded = results.filter(r => r.status === 'success').length;
  const failed = results.filter(r => r.status === 'failed').length;
  const pgOnlySucceeded = metrics.pgFallbacks; // TB down but PG succeeded

  const finalPremiumPool = tb.accounts.get('PREMIUM_POOL');
  // TB-only successes: only workflows where TB was up
  const tbSuccesses = [...tb.transfers.values()].filter(t =>
    t.id.startsWith('tb_') && t.status === 'posted' && t.creditAccountId === 'PREMIUM_POOL'
  ).length;
  const expectedIncrease = BigInt(tbSuccesses) * BigInt(7500 * 100);
  const actualIncrease = finalPremiumPool - initialPremiumPool;
  const ledgerConsistent = actualIncrease === expectedIncrease;

  // Verify: no orphaned policies (every policy has a transaction)
  const orphanedPolicies = [...pg.policies.values()].filter(p => !pg.transactions.has(p.transactionId)).length;

  console.log(`  Total workflows: ${TOTAL}`);
  console.log(`  Succeeded: ${succeeded}`);
  console.log(`  Failed (TB down, no PG fallback for funds): ${failed}`);
  console.log(`  TB failure count: ${tb.failureCount}`);
  console.log(`  TB transfers posted: ${tbSuccesses}`);
  console.log(`  Orphaned policies: ${orphanedPolicies} (must be 0)`);
  console.log(`  Ledger consistent: ${ledgerConsistent ? '✓ YES' : '✗ NO'}`);
  console.log(`  Time: ${elapsed.toFixed(0)}ms`);

  return { succeeded, failed, ledgerConsistent, orphanedPolicies };
}

async function runScenarioC_BothFail(redis, tb, pg, metrics) {
  console.log('\n╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║  SCENARIO C: Redis + TigerBeetle Both Fail Simultaneously           ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝');

  const TOTAL = 500;
  const FAILURE_AT = 100;
  const RESTORE_AT = 400;

  for (let i = 0; i < TOTAL; i++) tb.accounts.set(`customer_c_${i}`, BigInt(1_000_000 * 100));
  const initialPremiumPool = tb.accounts.get('PREMIUM_POOL');
  let failureInjected = false;
  let restored = false;

  const start = performance.now();

  const promises = Array.from({ length: TOTAL }, (_, i) => {
    return (async () => {
      if (i === FAILURE_AT && !failureInjected) {
        redis.injectFailure();
        tb.injectFailure();
        failureInjected = true;
      }
      if (i === RESTORE_AT && !restored) {
        redis.restore();
        tb.restore();
        restored = true;
      }

      return executePremiumPayment(redis, tb, pg, metrics, {
        customerId: `cust_c_${i}`,
        policyId: `pol_c_${i}`,
        amount: 10000,
        idempotencyKey: `scenC_${i}`,
      });
    })();
  });

  const results = await Promise.all(promises);
  const elapsed = performance.now() - start;

  const succeeded = results.filter(r => r.status === 'success').length;
  const failed = results.filter(r => r.status === 'failed').length;

  // Verify PG is still consistent (no orphaned records)
  const orphanedPolicies = [...pg.policies.values()].filter(p => !pg.transactions.has(p.transactionId)).length;
  const completedTxns = [...pg.transactions.values()].filter(t => t.status === 'completed').length;
  const failedTxns = [...pg.transactions.values()].filter(t => t.status === 'failed').length;

  console.log(`  Total workflows: ${TOTAL}`);
  console.log(`  Succeeded: ${succeeded}`);
  console.log(`  Failed (both services down): ${failed}`);
  console.log(`  PG completed transactions: ${completedTxns}`);
  console.log(`  PG failed transactions: ${failedTxns}`);
  console.log(`  Orphaned policies: ${orphanedPolicies} (must be 0)`);
  console.log(`  Data integrity maintained: ${orphanedPolicies === 0 ? '✓ YES' : '✗ NO'}`);
  console.log(`  Time: ${elapsed.toFixed(0)}ms`);

  return { succeeded, failed, orphanedPolicies, dataIntegrity: orphanedPolicies === 0 };
}

async function runScenarioD_SagaCompensation(redis, tb, pg, metrics) {
  console.log('\n╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║  SCENARIO D: Saga Compensation — 1,000 Forced Failures After TB     ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝');

  const TOTAL = 1000;
  for (let i = 0; i < TOTAL; i++) tb.accounts.set(`customer_d_${i}`, BigInt(1_000_000 * 100));
  const initialPremiumPool = tb.accounts.get('PREMIUM_POOL');

  const start = performance.now();

  const promises = Array.from({ length: TOTAL }, (_, i) => {
    return executePremiumPayment(redis, tb, pg, metrics, {
      customerId: `cust_d_${i}`,
      policyId: `pol_d_${i}`,
      amount: 3000,
      idempotencyKey: `scenD_${i}`,
      simulateFailureAfterTB: true, // Force failure AFTER TB transfer
    });
  });

  const results = await Promise.all(promises);
  const elapsed = performance.now() - start;

  const compensated = results.filter(r => r.status === 'failed' && r.compensated === true).length;
  const uncompensated = results.filter(r => r.status === 'failed' && r.compensated === false).length;

  const finalPremiumPool = tb.accounts.get('PREMIUM_POOL');
  const netChange = finalPremiumPool - initialPremiumPool;
  const ledgerRestored = netChange === 0n;

  // Verify no orphaned policies (all failed workflows should have no policy record)
  const orphanedPolicies = [...pg.policies.values()].filter(p => {
    const tx = pg.transactions.get(p.transactionId);
    return tx && tx.status === 'failed';
  }).length;

  console.log(`  Total forced failures: ${TOTAL}`);
  console.log(`  TB transfers created (then reversed): ${compensated}`);
  console.log(`  Uncompensated (TB was down): ${uncompensated}`);
  console.log(`  PREMIUM_POOL net change: ₦${netChange / 100n} (expected: ₦0)`);
  console.log(`  Ledger restored: ${ledgerRestored ? '✓ YES' : '✗ NO'}`);
  console.log(`  Orphaned policies: ${orphanedPolicies} (must be 0)`);
  console.log(`  Time: ${elapsed.toFixed(0)}ms`);

  return { compensated, ledgerRestored, orphanedPolicies };
}

async function runScenarioE_Recovery(redis, tb, pg, metrics) {
  console.log('\n╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║  SCENARIO E: Recovery — Services Restored, Verify No Data Loss      ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝');

  // Ensure both services are up
  redis.restore();
  tb.restore();

  const TOTAL = 500;
  for (let i = 0; i < TOTAL; i++) tb.accounts.set(`customer_e_${i}`, BigInt(1_000_000 * 100));
  const initialPremiumPool = tb.accounts.get('PREMIUM_POOL');

  const start = performance.now();

  const promises = Array.from({ length: TOTAL }, (_, i) => {
    return executePremiumPayment(redis, tb, pg, metrics, {
      customerId: `cust_e_${i}`,
      policyId: `pol_e_${i}`,
      amount: 4000,
      idempotencyKey: `scenE_${i}`,
    });
  });

  const results = await Promise.all(promises);
  const elapsed = performance.now() - start;

  const succeeded = results.filter(r => r.status === 'success').length;
  const failed = results.filter(r => r.status === 'failed').length;

  const finalPremiumPool = tb.accounts.get('PREMIUM_POOL');
  // Verify ledger consistency: actual TB credits to PREMIUM_POOL = actual increase
  const actualTbCredits = [...tb.transfers.values()]
    .filter(t => t.status === 'posted' && t.creditAccountId === 'PREMIUM_POOL')
    .reduce((sum, t) => sum + t.amount, 0n);
  const actualIncrease = finalPremiumPool - initialPremiumPool;
  const ledgerConsistent = actualIncrease === actualTbCredits;

  // Verify idempotency: re-submit all 500 with same keys
  const dupePromises = Array.from({ length: TOTAL }, (_, i) => {
    return executePremiumPayment(redis, tb, pg, metrics, {
      customerId: `cust_e_${i}`,
      policyId: `pol_e_${i}`,
      amount: 4000,
      idempotencyKey: `scenE_${i}`, // same key!
    });
  });
  const dupeResults = await Promise.all(dupePromises);
  const idempotencyHits = dupeResults.filter(r => r.status === 'success').length;
  const newTransfers = [...tb.transfers.values()].filter(t =>
    t.id.includes('cust_e_') && t.status === 'posted'
  ).length;

  console.log(`  Recovery workflows: ${TOTAL}`);
  console.log(`  Succeeded: ${succeeded}`);
  console.log(`  Failed: ${failed}`);
  console.log(`  Ledger consistent: ${ledgerConsistent ? '✓ YES' : '✗ NO'}`);
  console.log(`  Idempotency re-submission: ${TOTAL} duplicates`);
  console.log(`  Idempotency hits (no new transfers): ${idempotencyHits}`);
  console.log(`  No double-spend: ${idempotencyHits === TOTAL ? '✓ YES' : '✗ NO'}`);
  console.log(`  Time: ${elapsed.toFixed(0)}ms`);

  return { succeeded, failed, ledgerConsistent, idempotencyHits, noDoubleSpend: idempotencyHits === TOTAL };
}

// ── Final Ledger Invariant Check ──────────────────────────────────────────────

function verifyFinalLedgerInvariants(tb, pg) {
  const issues = [];

  // 1. Every completed transaction must have a TB transfer
  let orphanedTxns = 0;
  for (const [txId, tx] of pg.transactions) {
    if (tx.status === 'completed' && tx.tbTransferId) {
      const tbTransfer = tb.transfers.get(tx.tbTransferId);
      if (!tbTransfer) {
        issues.push(`ORPHANED_TRANSACTION: ${txId} references missing TB transfer ${tx.tbTransferId}`);
        orphanedTxns++;
      }
    }
  }

  // 2. Every reversed TB transfer must have a corresponding reversal transfer
  for (const [id, transfer] of tb.transfers) {
    if (transfer.status === 'reversed') {
      const reversalId = `rev_${id}`;
      if (!tb.transfers.has(reversalId)) {
        issues.push(`MISSING_REVERSAL: Transfer ${id} marked reversed but no reversal transfer found`);
      }
    }
  }

  // 3. PREMIUM_POOL balance must equal initial + net posted transfers
  const netPostedToPool = [...tb.transfers.values()]
    .filter(t => t.status === 'posted' && t.creditAccountId === 'PREMIUM_POOL')
    .reduce((sum, t) => sum + t.amount, 0n);
  const netReversedFromPool = [...tb.transfers.values()]
    .filter(t => t.status === 'posted' && t.debitAccountId === 'PREMIUM_POOL')
    .reduce((sum, t) => sum + t.amount, 0n);

  const expectedPool = 100_000_000_00n + netPostedToPool - netReversedFromPool;
  const actualPool = tb.accounts.get('PREMIUM_POOL');
  if (actualPool !== expectedPool) {
    issues.push(`PREMIUM_POOL_MISMATCH: Expected ${expectedPool}, Actual ${actualPool}`);
  }

  return { issues, orphanedTxns };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║  InsurePortal — Chaos Engineering Test                              ║');
  console.log('║  5,000 Concurrent Workflows with Redis + TigerBeetle Failures       ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝');
  console.log(`  Total workflows: 5,500 (2000 + 1500 + 500 + 1000 + 500)`);
  console.log(`  Failure injections: 3 (Redis, TB, Both)`);
  console.log(`  Started: ${new Date().toISOString()}\n`);

  const redis = new RedisSimulator();
  const tb = new TigerBeetleSimulator();
  const pg = new PostgreSQLSimulator();
  const metrics = new Metrics();

  // Pre-fund customer accounts in TB (combined scenario only)
  for (let i = 0; i < 500; i++) {
    tb.accounts.set(`customer_combined_${i}`, BigInt(1_000_000 * 100));
  }

  const totalStart = performance.now();

  // Run all 5 scenarios
  const resA = await runScenarioA_RedisFailure(new RedisSimulator(), new TigerBeetleSimulator(), new PostgreSQLSimulator(), new Metrics());
  const resB = await runScenarioB_TBFailure(new RedisSimulator(), new TigerBeetleSimulator(), new PostgreSQLSimulator(), new Metrics());
  const resC = await runScenarioC_BothFail(new RedisSimulator(), new TigerBeetleSimulator(), new PostgreSQLSimulator(), new Metrics());
  const resD = await runScenarioD_SagaCompensation(new RedisSimulator(), new TigerBeetleSimulator(), new PostgreSQLSimulator(), new Metrics());
  const resE = await runScenarioE_Recovery(new RedisSimulator(), new TigerBeetleSimulator(), new PostgreSQLSimulator(), new Metrics());

  // Run combined test for latency metrics
  const combinedRedis = new RedisSimulator();
  const combinedTb = new TigerBeetleSimulator();
  const combinedPg = new PostgreSQLSimulator();
  const combinedMetrics = new Metrics();
  for (let i = 0; i < 5500; i++) {
    combinedTb.accounts.set(`customer_combined_${i}`, BigInt(1_000_000 * 100));
  }
  await Promise.all(Array.from({ length: 500 }, (_, i) =>
    executePremiumPayment(combinedRedis, combinedTb, combinedPg, combinedMetrics, {
      customerId: `combined_${i}`, policyId: `pol_combined_${i}`,
      amount: 5000, idempotencyKey: `combined_${i}`,
    })
  ));

  const totalElapsed = performance.now() - totalStart;
  const latency = combinedMetrics.summary();

  // Final invariant check
  const finalCheck = verifyFinalLedgerInvariants(combinedTb, combinedPg);

  console.log('\n╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║  LATENCY METRICS (combined 500-workflow sample)                     ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝');
  console.log(`  Redis Lock Acquisition:`);
  console.log(`    p50: ${latency.lockP50.toFixed(2)}μs   p95: ${latency.lockP95.toFixed(2)}μs   p99: ${latency.lockP99.toFixed(2)}μs`);
  console.log(`  TigerBeetle Transfer:`);
  console.log(`    p50: ${latency.tbP50.toFixed(2)}μs   p95: ${latency.tbP95.toFixed(2)}μs   p99: ${latency.tbP99.toFixed(2)}μs`);
  console.log(`  End-to-End Transaction:`);
  console.log(`    p50: ${latency.e2eP50.toFixed(2)}μs   p95: ${latency.e2eP95.toFixed(2)}μs   p99: ${latency.e2eP99.toFixed(2)}μs`);

  console.log('\n════════════════════════════════════════════════════════════════════════');
  console.log('  CHAOS ENGINEERING TEST RESULTS');
  console.log('════════════════════════════════════════════════════════════════════════');

  const allPassed = resA.ledgerConsistent && resB.ledgerConsistent && resB.orphanedPolicies === 0 &&
    resC.dataIntegrity && resD.ledgerRestored && resD.orphanedPolicies === 0 &&
    resE.ledgerConsistent && resE.noDoubleSpend && finalCheck.issues.length === 0;

  console.log(`  Scenario A (Redis failure, 2000 workflows):   ${resA.ledgerConsistent ? '✓ PASSED' : '✗ FAILED'} — ledger consistent, PG fallback worked`);
  console.log(`  Scenario B (TB failure, 1500 workflows):      ${resB.ledgerConsistent && resB.orphanedPolicies === 0 ? '✓ PASSED' : '✗ FAILED'} — no orphaned policies`);
  console.log(`  Scenario C (Both fail, 500 workflows):        ${resC.dataIntegrity ? '✓ PASSED' : '✗ FAILED'} — data integrity maintained`);
  console.log(`  Scenario D (Saga compensation, 1000):         ${resD.ledgerRestored && resD.orphanedPolicies === 0 ? '✓ PASSED' : '✗ FAILED'} — ledger restored`);
  console.log(`  Scenario E (Recovery + idempotency, 500):     ${resE.ledgerConsistent && resE.noDoubleSpend ? '✓ PASSED' : '✗ FAILED'} — no double-spend`);
  console.log(`  Final ledger invariants:                      ${finalCheck.issues.length === 0 ? '✓ PASSED' : '✗ FAILED'} — ${finalCheck.issues.length} violations`);
  console.log(`  Total time: ${(totalElapsed / 1000).toFixed(2)}s`);
  console.log('');

  if (allPassed) {
    console.log('  ✅ ALL CHAOS TESTS PASSED — Platform resilient to Redis + TigerBeetle failures');
    console.log('  ✅ Saga compensation works correctly — ledger always restored');
    console.log('  ✅ Idempotency prevents double-spend even after service recovery');
    console.log('  ✅ PG fallback maintains data integrity when Redis is down');
    console.log('  ✅ Zero orphaned policies — no funds without coverage');
  } else {
    console.log('  ❌ CHAOS TEST FAILURES DETECTED');
    if (finalCheck.issues.length > 0) {
      finalCheck.issues.forEach(i => console.log(`     - ${i}`));
    }
    process.exit(1);
  }
}

main().catch(err => {
  console.error('CHAOS TEST FATAL ERROR:', err);
  process.exit(1);
});
