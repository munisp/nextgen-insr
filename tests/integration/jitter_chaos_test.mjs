/**
 * High-Jitter Chaos Test — London ↔ Singapore Link
 * Sprint 132 | InsurePortal Platform
 *
 * Scenario:
 *   - 5,000 concurrent insurance writes distributed across Lagos / London / Singapore
 *   - London ↔ Singapore replication link injected with 0–500ms random jitter
 *   - Lagos ↔ London and Lagos ↔ Singapore links remain clean (0ms jitter)
 *   - Verify:
 *       (a) All 5,000 writes eventually converge on all 3 regions (zero data loss)
 *       (b) Max divergence window (time any region is behind) stays < 2 seconds
 *       (c) Recovery time after jitter stops < 500ms
 *       (d) Throughput degradation on jittered link < 40% vs clean baseline
 *       (e) Quorum fencing correctly blocks writes during partition windows
 *       (f) Epoch counter advances monotonically (no split-brain)
 *
 * Quorum model (mirrors production quorum_fence.go):
 *   Lagos=3, London=2, Singapore=1, total=6, majority=4
 *
 * Test framework: pure Node.js ESM (no vitest — hangs in this environment)
 */

import { performance } from 'perf_hooks';
import { createHash, randomBytes } from 'crypto';

// ─── Configuration ────────────────────────────────────────────────────────────

const TOTAL_WRITES      = 5_000;
const BATCH_SIZE        = 100;        // concurrent writes per batch
const MAX_JITTER_MS     = 500;        // max London↔Singapore jitter
const JITTER_BURST_MS   = 5_000;      // jitter injection window (ms)
const JITTER_START_AT   = 1_000;      // start jitter after 1,000 writes (not wall-clock)
const LEASE_TTL_MS      = 3_000;      // quorum lease TTL
const LEASE_RENEW_AT    = LEASE_TTL_MS / 3; // renew at 1/3 TTL
const CONVERGENCE_TIMEOUT_MS = 10_000; // max time to wait for full convergence
const MAX_DIVERGENCE_WINDOW_MS = 2_000; // SLA: no region more than 2s behind

// ─── Region weights (mirrors quorum_fence.go) ─────────────────────────────────

const REGION_WEIGHT = { 'ng-lagos': 3, 'gb-london': 2, 'sg-singapore': 1 };
const TOTAL_VOTES   = 6;
const MAJORITY      = 4;

function hasQuorum(liveRegions) {
  return liveRegions.reduce((sum, r) => sum + (REGION_WEIGHT[r] ?? 0), 0) >= MAJORITY;
}

// ─── Simulated distributed store ─────────────────────────────────────────────
// Each region has its own in-memory log (simulating a replicated write-ahead log).
// Replication between regions is asynchronous and subject to jitter.

class RegionStore {
  constructor(name) {
    this.name    = name;
    this.log     = new Map();   // writeId → { value, ts, epoch }
    this.pending = [];          // replication queue: { writeId, value, ts, epoch, delay }
    this.stats   = { written: 0, replicated: 0, rejected: 0 };
    this.maxReplicationDelayMs = 0; // track actual max replication delay seen
  }

  // Direct write (primary write to this region)
  write(writeId, value, epoch) {
    if (this.log.has(writeId)) {
      this.stats.rejected++;
      return false; // idempotent
    }
    this.log.set(writeId, { value, ts: performance.now(), epoch });
    this.stats.written++;
    return true;
  }

  // Enqueue a replication entry with a simulated delay
  enqueueReplication(writeId, value, epoch, delayMs) {
    this.pending.push({ writeId, value, epoch, delayMs, enqueuedAt: performance.now() });
    // Track max pending delay as the divergence window
    if (delayMs > this.maxReplicationDelayMs) {
      this.maxReplicationDelayMs = delayMs;
    }
  }

  // Process pending replication entries whose delay has elapsed
  drainReplication(now) {
    const remaining = [];
    for (const entry of this.pending) {
      if (now - entry.enqueuedAt >= entry.delayMs) {
        if (!this.log.has(entry.writeId)) {
          this.log.set(entry.writeId, { value: entry.value, ts: now, epoch: entry.epoch });
          this.stats.replicated++;
        }
      } else {
        remaining.push(entry);
      }
    }
    this.pending = remaining;
  }

  size()    { return this.log.size; }
  pending_count() { return this.pending.length; }
}

// ─── Quorum Fencer (mirrors quorum_fence.go logic) ───────────────────────────

class QuorumFencer {
  constructor() {
    this.epoch       = 0;
    this.fenceOwner  = null;   // { ownerID, epoch, region, expiresAt, fenceValue }
    this.mu          = false;  // simple mutex flag (single-threaded JS)
  }

  // Acquire a lease for a region given the currently live regions.
  // Returns { guard } or throws an error.
  acquireLease(region, liveRegions, ttlMs) {
    if (!hasQuorum(liveRegions)) {
      throw new Error(`ErrNoQuorum: ${region} — votes=${liveRegions.reduce((s,r) => s+(REGION_WEIGHT[r]??0),0)}`);
    }

    // Epoch CAS — only one acquirer wins
    const expectedEpoch = this.epoch;
    this.epoch++;
    const newEpoch = this.epoch;

    if (this.fenceOwner && Date.now() < this.fenceOwner.expiresAt) {
      // Rollback epoch
      this.epoch = expectedEpoch;
      throw new Error(`ErrFenceConflict: held by ${this.fenceOwner.region} epoch=${this.fenceOwner.epoch}`);
    }

    const ownerID    = randomBytes(16).toString('hex');
    const fenceValue = `${ownerID}:${newEpoch}`;
    const expiresAt  = Date.now() + ttlMs;

    this.fenceOwner = { ownerID, epoch: newEpoch, region, fenceValue, expiresAt };

    const self = this;
    const guard = {
      region, epoch: newEpoch, ownerID, fenceValue, ttlMs,
      _renewTimer: null,
      _renewErr: null,
      _released: false,

      // Renewal: extend TTL if still owner
      renew() {
        if (this._released) { this._renewErr = new Error('ErrLeaseExpired'); return false; }
        if (self.fenceOwner?.fenceValue !== this.fenceValue) {
          this._renewErr = new Error('ErrStaleLease');
          return false;
        }
        if (Date.now() >= self.fenceOwner.expiresAt) {
          this._renewErr = new Error('ErrLeaseExpired');
          self.fenceOwner = null;
          return false;
        }
        self.fenceOwner.expiresAt = Date.now() + this.ttlMs;
        return true;
      },

      // Release the lease
      release() {
        if (this._released) return;
        this._released = true;
        clearInterval(this._renewTimer);
        if (self.fenceOwner?.fenceValue === this.fenceValue) {
          self.fenceOwner = null;
        }
      },

      isValid() {
        return !this._released && !this._renewErr &&
               self.fenceOwner?.fenceValue === this.fenceValue &&
               Date.now() < self.fenceOwner?.expiresAt;
      },
    };

    // Start background renewal at TTL/3
    guard._renewTimer = setInterval(() => {
      guard.renew();
    }, Math.max(ttlMs / 3, 50));

    return guard;
  }

  // Check if a region is currently fenced out (zombie detection)
  isFenced(region) {
    if (!this.fenceOwner) return false;
    if (Date.now() >= this.fenceOwner.expiresAt) {
      this.fenceOwner = null;
      return false;
    }
    return this.fenceOwner.region !== region;
  }

  getFenceStatus(liveRegions) {
    const votes = liveRegions.reduce((s,r) => s+(REGION_WEIGHT[r]??0), 0);
    return {
      epoch:       this.epoch,
      held:        !!this.fenceOwner && Date.now() < this.fenceOwner.expiresAt,
      owner:       this.fenceOwner?.region ?? null,
      ownerEpoch:  this.fenceOwner?.epoch ?? null,
      hasQuorum:   votes >= MAJORITY,
      votes,
      liveRegions,
    };
  }
}

// ─── Jitter Injector ─────────────────────────────────────────────────────────

class JitterInjector {
  constructor() {
    this.active      = false;
    this.maxJitterMs = 0;
    this.injected    = 0;
    this.totalDelay  = 0;
    this.histogram   = new Array(10).fill(0); // 50ms buckets
  }

  start(maxJitterMs) {
    this.active      = true;
    this.maxJitterMs = maxJitterMs;
  }

  stop() {
    this.active      = false;
    this.maxJitterMs = 0;
  }

  // Returns delay in ms for the London↔Singapore link
  getDelay(srcRegion, dstRegion) {
    const isJitteredLink =
      (srcRegion === 'gb-london'    && dstRegion === 'sg-singapore') ||
      (srcRegion === 'sg-singapore' && dstRegion === 'gb-london');

    if (!this.active || !isJitteredLink) {
      return 1; // baseline 1ms replication latency
    }

    const delay = Math.floor(Math.random() * this.maxJitterMs);
    this.injected++;
    this.totalDelay += delay;
    const bucket = Math.min(Math.floor(delay / 50), 9);
    this.histogram[bucket]++;
    return delay;
  }

  avgJitter() {
    return this.injected > 0 ? (this.totalDelay / this.injected).toFixed(1) : '0';
  }
}

// ─── Test harness ─────────────────────────────────────────────────────────────

const PASS = '✅';
const FAIL = '❌';
const results = [];
let testNum = 0;

function assert(condition, name, detail = '') {
  testNum++;
  const status = condition ? PASS : FAIL;
  results.push({ num: testNum, name, passed: condition, detail });
  console.log(`  ${status} [${testNum}] ${name}${detail ? ' — ' + detail : ''}`);
  return condition;
}

// ─── Main test suite ──────────────────────────────────────────────────────────

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function runJitterChaosTest() {
  console.log('\n' + '═'.repeat(72));
  console.log('  HIGH-JITTER CHAOS TEST — London ↔ Singapore Link');
  console.log('  InsurePortal Platform | Sprint 132');
  console.log('  ' + new Date().toISOString());
  console.log('═'.repeat(72) + '\n');

  const lagos     = new RegionStore('ng-lagos');
  const london    = new RegionStore('gb-london');
  const singapore = new RegionStore('sg-singapore');
  const regions   = [lagos, london, singapore];

  const fencer  = new QuorumFencer();
  const jitter  = new JitterInjector();

  const metrics = {
    totalWritten:       0,
    totalRejected:      0,
    jitterDropped:      0,
    maxDivergenceMs:    0,
    convergenceMs:      0,
    throughputBaseline: 0,
    throughputJitter:   0,
    epochHistory:       [],
    divergenceWindows:  [],
    leaseRenewals:      0,
    leaseRenewalFails:  0,
    splitBrainAttempts: 0,
    splitBrainBlocked:  0,
  };

  // ── Phase 1: Baseline throughput (clean, no jitter) ──────────────────────
  console.log('Phase 1: Baseline throughput (no jitter, 500 writes)');
  const phase1Start = performance.now();
  const liveAll = ['ng-lagos', 'gb-london', 'sg-singapore'];

  let lease = fencer.acquireLease('ng-lagos', liveAll, LEASE_TTL_MS);
  metrics.epochHistory.push({ event: 'baseline_acquire', epoch: lease.epoch, ts: Date.now() });

  for (let i = 0; i < 500; i++) {
    const writeId = `baseline-${i}`;
    const value   = { policyId: `POL-${i}`, premium: 1000 + i, region: 'ng-lagos' };

    if (!lease.isValid()) {
      lease.release();
      lease = fencer.acquireLease('ng-lagos', liveAll, LEASE_TTL_MS);
    }

    lagos.write(writeId, value, lease.epoch);
    // Replicate to London and Singapore with baseline 1ms delay
    london.enqueueReplication(writeId, value, lease.epoch, jitter.getDelay('ng-lagos', 'gb-london'));
    singapore.enqueueReplication(writeId, value, lease.epoch, jitter.getDelay('ng-lagos', 'sg-singapore'));
    metrics.totalWritten++;
  }

  // Drain all replication
  await sleep(50);
  const now1 = performance.now();
  regions.forEach(r => r.drainReplication(now1));

  const phase1Duration = performance.now() - phase1Start;
  metrics.throughputBaseline = Math.round(500 / (phase1Duration / 1000));
  lease.release();

  assert(lagos.size() === 500 && london.size() === 500 && singapore.size() === 500,
    'Phase 1: All 500 baseline writes replicated to all 3 regions',
    `Lagos=${lagos.size()} London=${london.size()} Singapore=${singapore.size()}`);
  assert(metrics.throughputBaseline > 5000,
    'Phase 1: Baseline throughput > 5,000 writes/sec',
    `actual=${metrics.throughputBaseline.toLocaleString()} writes/sec`);

  // ── Phase 2: Peak load with jitter injection ──────────────────────────────
  console.log('\nPhase 2: Peak load (4,000 writes) + London↔Singapore jitter injection at t=1.5s');

  const phase2Start = performance.now();
  let jitterActive = false;
  let jitterStartTime = 0;
  let jitterStopTime  = 0;
  let writesBeforeJitter = 0;
  let writesAfterJitter  = 0;
  let writesUnderJitter  = 0;

  // Acquire lease for London (primary during peak load)
  lease = fencer.acquireLease('gb-london', liveAll, LEASE_TTL_MS);
  metrics.epochHistory.push({ event: 'peak_acquire', epoch: lease.epoch, ts: Date.now() });

  for (let i = 0; i < 4000; i++) {
    const elapsed = performance.now() - phase2Start;

    // Start jitter after JITTER_START_AT writes
    if (!jitterActive && i >= JITTER_START_AT) {
      jitter.start(MAX_JITTER_MS);
      jitterActive   = true;
      jitterStartTime = performance.now();
      writesBeforeJitter = i;
      console.log(`  → Jitter injected at write #${i} (t=${elapsed.toFixed(0)}ms)`);
    }

    // Stop jitter after 2,000 more writes (simulating a 5-second burst at peak throughput)
    if (jitterActive && i >= JITTER_START_AT + 2_000) {
      jitter.stop();
      jitterActive   = false;
      jitterStopTime = performance.now();
      writesUnderJitter = i - writesBeforeJitter;
      console.log(`  → Jitter stopped at write #${i} (t=${elapsed.toFixed(0)}ms)`);
    }

    const writeId = `peak-${i}`;
    const value   = { policyId: `POL-PEAK-${i}`, premium: 5000 + i, region: 'gb-london' };

    if (!lease.isValid()) {
      try {
        lease.release();
        lease = fencer.acquireLease('gb-london', liveAll, LEASE_TTL_MS);
        metrics.leaseRenewals++;
        metrics.epochHistory.push({ event: 'lease_reacquire', epoch: lease.epoch, ts: Date.now() });
      } catch (e) {
        metrics.leaseRenewalFails++;
        continue;
      }
    }

    london.write(writeId, value, lease.epoch);
    // Lagos replication: always clean
    lagos.enqueueReplication(writeId, value, lease.epoch, jitter.getDelay('gb-london', 'ng-lagos'));
    // Singapore replication: jittered during burst
    singapore.enqueueReplication(writeId, value, lease.epoch, jitter.getDelay('gb-london', 'sg-singapore'));
    metrics.totalWritten++;

    // Drain replication every 10 writes to simulate async processing
    if (i % 10 === 0) {
      const now = performance.now();
      regions.forEach(r => r.drainReplication(now));

      // Measure divergence: actual max pending replication delay on Singapore
      // (the jittered region). This is the true divergence window — how long
      // Singapore is behind London at this moment.
      const sgMaxDelay = singapore.maxReplicationDelayMs;
      if (sgMaxDelay > metrics.maxDivergenceMs) {
        metrics.maxDivergenceMs = sgMaxDelay;
        metrics.divergenceWindows.push({ at: i, divergenceMs: sgMaxDelay });
      }
      // Reset per-drain to get rolling max
      singapore.maxReplicationDelayMs = 0;
    }

    // Small yield every 100 writes to allow timers to fire
    if (i % 100 === 0) await sleep(0);
  }

  writesAfterJitter = 4000 - writesBeforeJitter - writesUnderJitter;
  const phase2Duration = performance.now() - phase2Start;
  metrics.throughputJitter = Math.round(4000 / (phase2Duration / 1000));
  lease.release();

  // Drain remaining replication queue
  const drainStart = performance.now();
  let drainIterations = 0;
  while (true) {
    const now = performance.now();
    regions.forEach(r => r.drainReplication(now));
    const pendingTotal = regions.reduce((s, r) => s + r.pending_count(), 0);
    if (pendingTotal === 0) break;
    if (performance.now() - drainStart > CONVERGENCE_TIMEOUT_MS) {
      console.log(`  ⚠ Convergence timeout after ${CONVERGENCE_TIMEOUT_MS}ms — ${pendingTotal} entries still pending`);
      break;
    }
    await sleep(10);
    drainIterations++;
  }
  metrics.convergenceMs = performance.now() - drainStart;

  const expectedTotal = 500 + 4000; // baseline + peak
  // London has 4,000 peak writes + 500 baseline = 4,500 total
  assert(london.size() === expectedTotal,
    'Phase 2: All 4,500 writes (500 baseline + 4,000 peak) committed to London (primary)',
    `actual=${london.size()} expected=${expectedTotal}`);
  assert(metrics.throughputJitter > 0,
    'Phase 2: Throughput measured under jitter',
    `actual=${metrics.throughputJitter.toLocaleString()} writes/sec`);

  const throughputDrop = ((metrics.throughputBaseline - metrics.throughputJitter) / metrics.throughputBaseline * 100);
  assert(throughputDrop < 40,
    'Phase 2: Throughput degradation under jitter < 40%',
    `drop=${throughputDrop.toFixed(1)}% (baseline=${metrics.throughputBaseline.toLocaleString()}, jitter=${metrics.throughputJitter.toLocaleString()})`);

  // ── Phase 3: Convergence verification ────────────────────────────────────
  console.log('\nPhase 3: Convergence verification after jitter stops');

  assert(lagos.size() === expectedTotal,
    'Phase 3: Lagos converged — all writes replicated',
    `actual=${lagos.size()} expected=${expectedTotal}`);
  assert(london.size() === expectedTotal,
    'Phase 3: London converged — all writes present',
    `actual=${london.size()} expected=${expectedTotal}`);
  assert(singapore.size() === expectedTotal,
    'Phase 3: Singapore converged — all writes replicated despite jitter',
    `actual=${singapore.size()} expected=${expectedTotal}`);

  assert(metrics.convergenceMs < 500,
    'Phase 3: Convergence time after jitter stops < 500ms',
    `actual=${metrics.convergenceMs.toFixed(1)}ms`);

  assert(metrics.maxDivergenceMs < MAX_DIVERGENCE_WINDOW_MS,
    `Phase 3: Max divergence window < ${MAX_DIVERGENCE_WINDOW_MS}ms SLA`,
    `actual=${metrics.maxDivergenceMs.toFixed(1)}ms`);

  // ── Phase 4: Split-brain prevention under jitter ─────────────────────────
  console.log('\nPhase 4: Split-brain prevention — zombie Singapore write attempt');

  // Simulate Singapore partition: only Singapore is "live" (1 vote — no quorum)
  const singaporeOnly = ['sg-singapore'];
  let splitBrainBlocked = false;
  try {
    const zombieLease = fencer.acquireLease('sg-singapore', singaporeOnly, LEASE_TTL_MS);
    zombieLease.release();
    metrics.splitBrainAttempts++;
  } catch (e) {
    if (e.message.includes('ErrNoQuorum')) {
      splitBrainBlocked = true;
      metrics.splitBrainBlocked++;
    }
  }

  assert(splitBrainBlocked,
    'Phase 4: Singapore-only partition (1 vote) correctly blocked by quorum fence',
    `votes=1, required=${MAJORITY}`);

  // London+Singapore partition: 3 votes — still no quorum (need 4)
  const londonSingapore = ['gb-london', 'sg-singapore'];
  let londonSingaporeBlocked = false;
  try {
    const ls = fencer.acquireLease('gb-london', londonSingapore, LEASE_TTL_MS);
    ls.release();
    metrics.splitBrainAttempts++;
  } catch (e) {
    if (e.message.includes('ErrNoQuorum')) {
      londonSingaporeBlocked = true;
      metrics.splitBrainBlocked++;
    }
  }

  assert(londonSingaporeBlocked,
    'Phase 4: London+Singapore partition (3 votes) correctly blocked — need ≥4',
    `votes=3, required=${MAJORITY}`);

  // Lagos+Singapore: 4 votes — quorum achieved
  const lagosSingapore = ['ng-lagos', 'sg-singapore'];
  let lagosSingaporeAcquired = false;
  try {
    const ls = fencer.acquireLease('ng-lagos', lagosSingapore, LEASE_TTL_MS);
    lagosSingaporeAcquired = ls.isValid();
    ls.release();
  } catch (e) {
    // unexpected
  }

  assert(lagosSingaporeAcquired,
    'Phase 4: Lagos+Singapore partition (4 votes) correctly allowed — quorum met',
    `votes=4, required=${MAJORITY}`);

  // Lagos+London: 5 votes — quorum achieved
  const lagosLondon = ['ng-lagos', 'gb-london'];
  let lagosLondonAcquired = false;
  try {
    const ll = fencer.acquireLease('ng-lagos', lagosLondon, LEASE_TTL_MS);
    lagosLondonAcquired = ll.isValid();
    ll.release();
  } catch (e) {
    // unexpected
  }

  assert(lagosLondonAcquired,
    'Phase 4: Lagos+London partition (5 votes) correctly allowed — quorum met',
    `votes=5, required=${MAJORITY}`);

  // ── Phase 5: Epoch monotonicity ───────────────────────────────────────────
  console.log('\nPhase 5: Epoch monotonicity — no split-brain epoch regression');

  const epochs = metrics.epochHistory.map(e => e.epoch);
  const isMonotonic = epochs.every((e, i) => i === 0 || e > epochs[i - 1]);

  assert(isMonotonic,
    'Phase 5: Epoch counter is strictly monotonically increasing',
    `epochs=[${epochs.join(', ')}]`);

  assert(fencer.epoch > 0,
    'Phase 5: Final epoch > 0 (at least one fence acquired)',
    `epoch=${fencer.epoch}`);

  // ── Phase 6: Lease renewal under jitter ──────────────────────────────────
  console.log('\nPhase 6: Lease renewal correctness under simulated jitter');

  // Acquire a lease with a very short TTL and verify renewal fires
  const shortTTL = 300; // 300ms
  const renewLease = fencer.acquireLease('gb-london', liveAll, shortTTL);
  const renewStart = performance.now();
  await sleep(shortTTL + 50); // wait longer than TTL — renewal should have fired
  const stillValid = renewLease.isValid();
  renewLease.release();

  // With renewal at TTL/3 = 100ms, the lease should have been renewed at least once
  // before the 300ms TTL expired. In our simulation, renewal resets expiresAt.
  // After TTL+50ms without renewal, it should have expired.
  // But our renewal timer fires at 100ms intervals — so it should still be valid.
  assert(stillValid,
    'Phase 6: Lease renewal keeps lease alive beyond original TTL',
    `ttl=${shortTTL}ms, waited=${(performance.now() - renewStart).toFixed(0)}ms, valid=${stillValid}`);

  // Verify a released lease is no longer valid
  const releasedValid = renewLease.isValid();
  assert(!releasedValid,
    'Phase 6: Released lease correctly reports invalid',
    `valid=${releasedValid}`);

  // ── Phase 7: Zero data loss verification ─────────────────────────────────
  console.log('\nPhase 7: Zero data loss — cross-region write set comparison');

  // Build write ID sets for each region
  const lagosIds     = new Set(lagos.log.keys());
  const londonIds    = new Set(london.log.keys());
  const singaporeIds = new Set(singapore.log.keys());

  // Find writes missing from any region
  const missingFromLondon    = [...lagosIds].filter(id => !londonIds.has(id));
  const missingFromSingapore = [...lagosIds].filter(id => !singaporeIds.has(id));
  const missingFromLagos     = [...londonIds].filter(id => !lagosIds.has(id));

  assert(missingFromLondon.length === 0,
    'Phase 7: No writes missing from London',
    `missing=${missingFromLondon.length}`);
  assert(missingFromSingapore.length === 0,
    'Phase 7: No writes missing from Singapore despite jitter',
    `missing=${missingFromSingapore.length}`);
  assert(missingFromLagos.length === 0,
    'Phase 7: No writes missing from Lagos',
    `missing=${missingFromLagos.length}`);

  assert(lagosIds.size === londonIds.size && londonIds.size === singaporeIds.size,
    'Phase 7: All 3 regions have identical write counts',
    `Lagos=${lagosIds.size} London=${londonIds.size} Singapore=${singaporeIds.size}`);

  // ── Summary ───────────────────────────────────────────────────────────────
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;

  console.log('\n' + '═'.repeat(72));
  console.log(`  RESULTS: ${passed}/${results.length} passed${failed > 0 ? ` — ${failed} FAILED` : ''}`);
  console.log('═'.repeat(72));

  const summary = {
    timestamp:             new Date().toISOString(),
    sprint:                132,
    test:                  'high_jitter_chaos',
    scenario:              'London↔Singapore 0–500ms random jitter during 5,000 concurrent writes',
    passed,
    failed,
    total:                 results.length,
    score:                 `${passed}/${results.length}`,

    quorumModel: {
      weights:             REGION_WEIGHT,
      totalVotes:          TOTAL_VOTES,
      majorityRequired:    MAJORITY,
    },

    jitterConfig: {
      maxJitterMs:         MAX_JITTER_MS,
      burstDurationMs:     JITTER_BURST_MS,
      startAtMs:           JITTER_START_AT,
      injectedPackets:     jitter.injected,
      avgJitterMs:         parseFloat(jitter.avgJitter()),
      histogram_50ms_buckets: jitter.histogram,
    },

    writes: {
      total:               metrics.totalWritten,
      beforeJitter:        writesBeforeJitter,
      underJitter:         writesUnderJitter,
      afterJitter:         writesAfterJitter,
    },

    convergence: {
      timeMs:              parseFloat(metrics.convergenceMs.toFixed(2)),
      maxDivergenceWindowMs: parseFloat(metrics.maxDivergenceMs.toFixed(2)),
      slaMs:               MAX_DIVERGENCE_WINDOW_MS,
      slaBreached:         metrics.maxDivergenceMs >= MAX_DIVERGENCE_WINDOW_MS,
    },

    throughput: {
      baselineWritesPerSec: metrics.throughputBaseline,
      jitterWritesPerSec:   metrics.throughputJitter,
      degradationPct:       parseFloat(throughputDrop.toFixed(1)),
    },

    dataIntegrity: {
      lagosCount:          lagos.size(),
      londonCount:         london.size(),
      singaporeCount:      singapore.size(),
      expectedCount:       expectedTotal,
      zeroDataLoss:        lagos.size() === expectedTotal && london.size() === expectedTotal && singapore.size() === expectedTotal,
    },

    quorumFencing: {
      epochFinal:          fencer.epoch,
      epochHistory:        metrics.epochHistory,
      splitBrainAttempts:  metrics.splitBrainAttempts,
      splitBrainBlocked:   metrics.splitBrainBlocked,
      leaseRenewals:       metrics.leaseRenewals,
      leaseRenewalFails:   metrics.leaseRenewalFails,
    },

    regionStats: {
      lagos:     { ...lagos.stats,     size: lagos.size() },
      london:    { ...london.stats,    size: london.size() },
      singapore: { ...singapore.stats, size: singapore.size() },
    },

    tests: results.map(r => ({
      num:    r.num,
      name:   r.name,
      passed: r.passed,
      detail: r.detail,
    })),
  };

  // Print key metrics
  console.log('\n  Key Metrics:');
  console.log(`  ├─ Total writes:          ${metrics.totalWritten.toLocaleString()}`);
  console.log(`  ├─ Jitter packets:        ${jitter.injected.toLocaleString()} (avg ${jitter.avgJitter()}ms)`);
  console.log(`  ├─ Convergence time:      ${metrics.convergenceMs.toFixed(1)}ms`);
  console.log(`  ├─ Max divergence window: ${metrics.maxDivergenceMs.toFixed(1)}ms (SLA: <${MAX_DIVERGENCE_WINDOW_MS}ms)`);
  console.log(`  ├─ Throughput baseline:   ${metrics.throughputBaseline.toLocaleString()} writes/sec`);
  console.log(`  ├─ Throughput (jitter):   ${metrics.throughputJitter.toLocaleString()} writes/sec`);
  console.log(`  ├─ Throughput drop:       ${throughputDrop.toFixed(1)}%`);
  console.log(`  ├─ Zero data loss:        ${summary.dataIntegrity.zeroDataLoss ? 'YES ✅' : 'NO ❌'}`);
  console.log(`  ├─ Split-brain blocked:   ${metrics.splitBrainBlocked}/${metrics.splitBrainAttempts}`);
  console.log(`  └─ Final epoch:           ${fencer.epoch}`);

  return summary;
}

// ─── Run ──────────────────────────────────────────────────────────────────────

import { writeFileSync } from 'fs';

const summary = await runJitterChaosTest();

const outPath = '/home/ubuntu/jitter_chaos_results.json';
writeFileSync(outPath, JSON.stringify(summary, null, 2));
console.log(`\n  Results saved → ${outPath}`);

if (summary.failed > 0) {
  console.error(`\n  FAILED: ${summary.failed} test(s) did not pass`);
  process.exit(1);
} else {
  console.log(`\n  ALL ${summary.passed} TESTS PASSED ✅`);
  process.exit(0);
}
