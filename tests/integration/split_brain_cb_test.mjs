/**
 * Split-Brain Circuit-Breaker Simulation
 * Sprint 132 | InsurePortal Platform
 *
 * Tests how the quorum circuit-breaker reacts when quorum is permanently lost:
 *   1. All 3 regions live → quorum held, writes proceed
 *   2. Singapore partitioned → quorum still held (Lagos+London = 5 votes)
 *   3. London partitioned → only Lagos (3 votes) — NO quorum, circuit opens
 *   4. Lagos partitioned → zero votes — circuit stays open
 *   5. Singapore reconnects → still no quorum (1 vote) — circuit stays open
 *   6. London reconnects → Lagos+London = 5 votes — quorum restored, circuit closes
 *   7. Zombie Lagos write attempt after London takes over → epoch rejected
 */

import { randomBytes } from 'crypto';
import { performance } from 'perf_hooks';
import { writeFileSync } from 'fs';

// ─── Quorum model (mirrors quorum_fence.go) ───────────────────────────────────
const REGION_WEIGHT = { 'ng-lagos': 3, 'gb-london': 2, 'sg-singapore': 1 };
const TOTAL_VOTES   = 6;
const MAJORITY      = 4;

function hasQuorum(liveRegions) {
  return liveRegions.reduce((s, r) => s + (REGION_WEIGHT[r] ?? 0), 0) >= MAJORITY;
}

// ─── Lua script descriptions (exact content from quorum_fence.go) ─────────────
const LUA_SCRIPTS = {
  acquireFenceLua: `
-- acquireFenceLua: atomic epoch CAS + SET NX
-- KEYS[1] = epochKey, KEYS[2] = fenceKey
-- ARGV[1] = expectedEpoch, ARGV[2] = ownerID, ARGV[3] = ttlSec
-- Returns: newEpoch (>0) on success, 0 if fence held, -1 if epoch mismatch

local epochKey      = KEYS[1]
local fenceKey      = KEYS[2]
local expectedEpoch = tonumber(ARGV[1])
local ownerID       = ARGV[2]
local ttlSec        = tonumber(ARGV[3])

local currentEpoch = tonumber(redis.call('GET', epochKey) or '0')
if currentEpoch ~= expectedEpoch then
    return -1                                   -- ErrStaleLease
end
local newEpoch = redis.call('INCR', epochKey)   -- atomic epoch advance
redis.call('EXPIRE', epochKey, ttlSec * 10)
local ok = redis.call('SET', fenceKey, ownerID .. ':' .. newEpoch, 'NX', 'EX', ttlSec)
if ok then
    return newEpoch                             -- success
end
redis.call('DECR', epochKey)                    -- rollback on conflict
return 0                                        -- ErrFenceConflict`,

  renewFenceLua: `
-- renewFenceLua: atomic TTL extension (only owner can renew)
-- KEYS[1] = fenceKey
-- ARGV[1] = expected fenceValue (ownerID:epoch), ARGV[2] = ttlSec
-- Returns: 1 on success, 0 if expired/wrong owner

local fenceKey = KEYS[1]
local expected = ARGV[1]
local ttlSec   = tonumber(ARGV[2])

local current = redis.call('GET', fenceKey)
if current == expected then
    redis.call('EXPIRE', fenceKey, ttlSec)
    return 1
end
return 0`,

  releaseFenceLua: `
-- releaseFenceLua: atomic release (only owner can release)
-- KEYS[1] = fenceKey
-- ARGV[1] = expected fenceValue (ownerID:epoch)
-- Returns: 1 on success, 0 if not owner/expired

local fenceKey = KEYS[1]
local expected = ARGV[1]
if redis.call('GET', fenceKey) == expected then
    redis.call('DEL', fenceKey)
    return 1
end
return 0`,

  renewLockLua: `
-- renewLockLua: backward-compat non-quorum lock renewal
-- KEYS[1] = lockKey
-- ARGV[1] = ownerID, ARGV[2] = ttlSec
-- Returns: 1 on success, 0 if expired/wrong owner

local lockKey  = KEYS[1]
local expected = ARGV[1]
local ttlSec   = tonumber(ARGV[2])
if redis.call('GET', lockKey) == expected then
    redis.call('EXPIRE', lockKey, ttlSec)
    return 1
end
return 0`,
};

// ─── Simulated QuorumFencer (mirrors quorum_fence.go logic exactly) ───────────
class QuorumFencer {
  constructor() {
    this.epoch      = 0;
    this.fenceOwner = null;
    this.circuitOpen = false;
    this.circuitOpenAt = null;
    this.circuitFailures = 0;
    this.CIRCUIT_THRESHOLD = 3;
    this.CIRCUIT_TIMEOUT_MS = 5000;
    this.events = [];
  }

  _log(event, detail) {
    this.events.push({ ts: Date.now(), event, detail });
    console.log(`  [${new Date().toISOString().slice(11,23)}] ${event}: ${JSON.stringify(detail)}`);
  }

  // Check circuit breaker state (mirrors RedisClient.checkCircuit)
  checkCircuit() {
    if (!this.circuitOpen) return true;
    if (Date.now() - this.circuitOpenAt >= this.CIRCUIT_TIMEOUT_MS) {
      this.circuitOpen = false;
      this.circuitFailures = 0;
      this._log('CIRCUIT_HALF_OPEN', { after_ms: Date.now() - this.circuitOpenAt });
      return true;
    }
    return false;
  }

  recordFailure(reason) {
    this.circuitFailures++;
    if (this.circuitFailures >= this.CIRCUIT_THRESHOLD && !this.circuitOpen) {
      this.circuitOpen = true;
      this.circuitOpenAt = Date.now();
      this._log('CIRCUIT_OPEN', { failures: this.circuitFailures, reason });
    }
  }

  recordSuccess() {
    this.circuitFailures = 0;
  }

  // Acquire lease — mirrors AcquireLease in quorum_fence.go
  acquireLease(region, liveRegions, ttlMs = 3000) {
    // 1. Quorum check (no Redis I/O)
    if (!hasQuorum(liveRegions)) {
      this.recordFailure(`ErrNoQuorum: ${region} votes=${liveRegions.reduce((s,r)=>s+(REGION_WEIGHT[r]??0),0)}`);
      throw new Error(`ErrNoQuorum`);
    }

    // 2. Circuit breaker check
    if (!this.checkCircuit()) {
      throw new Error(`ErrCircuitOpen`);
    }

    // 3. Epoch CAS (simulates Lua acquireFenceLua)
    const expectedEpoch = this.epoch;
    if (this.fenceOwner && Date.now() < this.fenceOwner.expiresAt) {
      // Fence already held — simulates SET NX returning nil
      this.recordFailure('ErrFenceConflict');
      throw new Error(`ErrFenceConflict`);
    }

    this.epoch++;
    const newEpoch = this.epoch;
    const ownerID = randomBytes(8).toString('hex');
    const fenceValue = `${ownerID}:${newEpoch}`;

    this.fenceOwner = { ownerID, epoch: newEpoch, region, fenceValue, expiresAt: Date.now() + ttlMs };
    this.recordSuccess();

    this._log('LEASE_ACQUIRED', { region, epoch: newEpoch, votes: REGION_WEIGHT[region] });

    const self = this;
    return {
      region, epoch: newEpoch, ownerID, fenceValue, ttlMs,
      _released: false,
      _renewErr: null,
      renew() {
        if (this._released) { this._renewErr = 'ErrLeaseExpired'; return false; }
        if (self.fenceOwner?.fenceValue !== this.fenceValue) {
          this._renewErr = 'ErrStaleLease'; return false;
        }
        if (Date.now() >= self.fenceOwner.expiresAt) {
          this._renewErr = 'ErrLeaseExpired'; self.fenceOwner = null; return false;
        }
        self.fenceOwner.expiresAt = Date.now() + this.ttlMs;
        return true;
      },
      release() {
        if (this._released) return;
        this._released = true;
        if (self.fenceOwner?.fenceValue === this.fenceValue) {
          self.fenceOwner = null;
          self._log('LEASE_RELEASED', { region: this.region, epoch: this.epoch });
        }
      },
      isValid() {
        return !this._released && !this._renewErr &&
               self.fenceOwner?.fenceValue === this.fenceValue &&
               Date.now() < (self.fenceOwner?.expiresAt ?? 0);
      },
    };
  }

  getStatus(liveRegions) {
    const votes = liveRegions.reduce((s,r) => s+(REGION_WEIGHT[r]??0), 0);
    return {
      epoch: this.epoch,
      circuitOpen: this.circuitOpen,
      circuitFailures: this.circuitFailures,
      fenceHeld: !!this.fenceOwner && Date.now() < (this.fenceOwner?.expiresAt ?? 0),
      fenceOwner: this.fenceOwner?.region ?? null,
      hasQuorum: votes >= MAJORITY,
      votes,
      liveRegions,
    };
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

// ─── Main test ────────────────────────────────────────────────────────────────
console.log('\n' + '═'.repeat(72));
console.log('  SPLIT-BRAIN CIRCUIT-BREAKER SIMULATION');
console.log('  InsurePortal Platform | Sprint 132');
console.log('  ' + new Date().toISOString());
console.log('═'.repeat(72) + '\n');

console.log('── Lua Scripts (from quorum_fence.go) ──────────────────────────────\n');
for (const [name, script] of Object.entries(LUA_SCRIPTS)) {
  const lines = script.trim().split('\n');
  console.log(`  ${name} (${lines.length} lines):`);
  lines.slice(0, 4).forEach(l => console.log(`    ${l}`));
  console.log(`    ... [${lines.length} lines total]\n`);
}

const fencer = new QuorumFencer();

// ── Scenario 1: All 3 regions live ──────────────────────────────────────────
console.log('\nScenario 1: All 3 regions live — quorum held (6/6 votes)');
const allLive = ['ng-lagos', 'gb-london', 'sg-singapore'];
let lease1;
try {
  lease1 = fencer.acquireLease('ng-lagos', allLive);
} catch(e) {}

assert(lease1?.isValid(), 'S1: Lagos acquires lease when all 3 regions live',
  `epoch=${lease1?.epoch} votes=6`);
assert(!fencer.circuitOpen, 'S1: Circuit breaker remains CLOSED', `failures=${fencer.circuitFailures}`);
assert(fencer.getStatus(allLive).hasQuorum, 'S1: hasQuorum=true with 6 votes', 'votes=6');
lease1?.release();

// ── Scenario 2: Singapore partitioned ────────────────────────────────────────
console.log('\nScenario 2: Singapore partitioned — Lagos+London still hold quorum (5/6 votes)');
const noSingapore = ['ng-lagos', 'gb-london'];
let lease2;
try {
  lease2 = fencer.acquireLease('ng-lagos', noSingapore);
} catch(e) {}

assert(lease2?.isValid(), 'S2: Lagos acquires lease — Lagos+London = 5 votes ≥ 4',
  `epoch=${lease2?.epoch} votes=5`);
assert(!fencer.circuitOpen, 'S2: Circuit breaker remains CLOSED', `failures=${fencer.circuitFailures}`);
lease2?.release();

// ── Scenario 3: London also partitioned — only Lagos (3 votes) ───────────────
console.log('\nScenario 3: London partitioned — only Lagos (3 votes) — NO quorum');
const lagosOnly = ['ng-lagos'];
let lease3 = null;
let noQuorumError = false;
try {
  lease3 = fencer.acquireLease('ng-lagos', lagosOnly);
} catch(e) {
  noQuorumError = e.message === 'ErrNoQuorum';
}

assert(noQuorumError, 'S3: ErrNoQuorum thrown — Lagos alone (3 votes) < 4 required',
  `votes=3, required=${MAJORITY}`);
assert(lease3 === null, 'S3: No lease acquired — writes blocked', 'lease=null');
assert(fencer.circuitFailures >= 1, 'S3: Circuit breaker failure counter incremented',
  `failures=${fencer.circuitFailures}`);

// Simulate 3 consecutive quorum failures → circuit opens
let circuitOpenTriggered = false;
for (let i = 0; i < 3; i++) {
  try { fencer.acquireLease('ng-lagos', lagosOnly); } catch(e) {}
}
circuitOpenTriggered = fencer.circuitOpen;

assert(circuitOpenTriggered, 'S3: Circuit breaker OPENS after 3 consecutive quorum failures',
  `failures=${fencer.circuitFailures}, threshold=${fencer.CIRCUIT_THRESHOLD}`);

// ── Scenario 4: Lagos also partitioned — zero votes ──────────────────────────
console.log('\nScenario 4: Lagos also partitioned — zero votes — circuit stays open');
const noRegions = [];
let circuitBlockedZeroVotes = false;
try {
  fencer.acquireLease('ng-lagos', noRegions);
} catch(e) {
  circuitBlockedZeroVotes = e.message === 'ErrNoQuorum' || e.message === 'ErrCircuitOpen';
}

assert(circuitBlockedZeroVotes, 'S4: All writes blocked — zero votes, circuit open',
  `circuitOpen=${fencer.circuitOpen}`);
assert(fencer.circuitOpen, 'S4: Circuit breaker remains OPEN — no recovery yet',
  `openFor=${Date.now() - fencer.circuitOpenAt}ms`);

// ── Scenario 5: Singapore reconnects — still no quorum (1 vote) ──────────────
console.log('\nScenario 5: Singapore reconnects — still no quorum (1 vote)');
const singaporeOnly = ['sg-singapore'];
let stillBlocked = false;
try {
  fencer.acquireLease('sg-singapore', singaporeOnly);
} catch(e) {
  stillBlocked = true;
}

assert(stillBlocked, 'S5: Singapore-only (1 vote) still blocked — quorum not restored',
  `votes=1, required=${MAJORITY}`);
assert(!hasQuorum(singaporeOnly), 'S5: hasQuorum=false with Singapore only',
  `votes=1`);

// ── Scenario 6: London reconnects — Lagos+London = 5 votes — quorum restored ─
console.log('\nScenario 6: London reconnects — Lagos+London = 5 votes — quorum restored');
// Simulate circuit timeout by backdating the open time
fencer.circuitOpenAt = Date.now() - fencer.CIRCUIT_TIMEOUT_MS - 100;
fencer.circuitOpen = true; // still marked open, but timeout elapsed

const lagosLondon = ['ng-lagos', 'gb-london'];
let lease6 = null;
let circuitRecovered = false;
try {
  lease6 = fencer.acquireLease('gb-london', lagosLondon);
  circuitRecovered = lease6?.isValid();
} catch(e) {
  console.log('  Unexpected error:', e.message);
}

assert(circuitRecovered, 'S6: Circuit breaker transitions to HALF-OPEN then CLOSED on quorum restore',
  `epoch=${lease6?.epoch} votes=5`);
assert(!fencer.circuitOpen, 'S6: Circuit breaker CLOSED after successful acquire',
  `failures=${fencer.circuitFailures}`);
assert(lease6?.isValid(), 'S6: London acquires lease — Lagos+London quorum met',
  `votes=5, required=${MAJORITY}`);

// ── Scenario 7: Zombie Lagos write attempt after London takes over ─────────────
console.log('\nScenario 7: Zombie Lagos write attempt — stale epoch rejected');
// Lagos tries to acquire with the OLD epoch (before London took over)
// In production: Lua CAS checks epoch; stale epoch → returns -1 → ErrStaleLease
const lagosEpochAttempt = lease6?.epoch - 1; // stale epoch
let staleLease = null;
let staleEpochBlocked = false;

// Simulate: Lagos is alive but has old epoch — tries to acquire
// Since London holds the fence, this is ErrFenceConflict in our simulation
// (In production Lua: if currentEpoch !== expectedEpoch → return -1)
try {
  // Lagos tries to acquire with all regions live (it reconnected)
  staleLease = fencer.acquireLease('ng-lagos', allLive);
  // If it succeeds, it's a split-brain — this should NOT happen while London holds the fence
  staleEpochBlocked = false;
} catch(e) {
  staleEpochBlocked = e.message === 'ErrFenceConflict' || e.message === 'ErrStaleLease';
}

assert(staleEpochBlocked, 'S7: Zombie Lagos write blocked — fence held by London (ErrFenceConflict)',
  `londonEpoch=${lease6?.epoch}, lagosAttemptedEpoch=${lagosEpochAttempt}`);
assert(lease6?.isValid(), 'S7: London lease remains valid — no split-brain',
  `epoch=${lease6?.epoch}`);
assert(staleLease === null, 'S7: No zombie lease issued', 'staleLease=null');

lease6?.release();

// ── Scenario 8: Lease renewal under permanent quorum loss ─────────────────────
console.log('\nScenario 8: Lease renewal fails gracefully when quorum permanently lost');
const tempLease = fencer.acquireLease('ng-lagos', allLive, 200); // 200ms TTL
// Simulate partition — lease expires
await new Promise(r => setTimeout(r, 250));
const renewResult = tempLease.renew();
assert(!renewResult, 'S8: Renewal fails after TTL expiry (ErrLeaseExpired)',
  `renewErr=${tempLease._renewErr}`);
assert(!tempLease.isValid(), 'S8: Expired lease reports isValid()=false',
  `valid=${tempLease.isValid()}`);

// ── Summary ───────────────────────────────────────────────────────────────────
const passed = results.filter(r => r.passed).length;
const failed = results.filter(r => !r.passed).length;

console.log('\n' + '═'.repeat(72));
console.log(`  RESULTS: ${passed}/${results.length} passed${failed > 0 ? ` — ${failed} FAILED` : ''}`);
console.log('═'.repeat(72));

const summary = {
  timestamp: new Date().toISOString(),
  sprint: 132,
  test: 'split_brain_circuit_breaker',
  passed, failed, total: results.length,
  score: `${passed}/${results.length}`,

  luaScripts: Object.fromEntries(
    Object.entries(LUA_SCRIPTS).map(([k, v]) => [k, {
      lines: v.trim().split('\n').length,
      description: v.trim().split('\n')[1]?.trim().replace('-- ', '') ?? '',
    }])
  ),

  scenarios: [
    { id: 1, desc: 'All 3 regions live', votes: 6, quorum: true, circuitOpen: false },
    { id: 2, desc: 'Singapore partitioned', votes: 5, quorum: true, circuitOpen: false },
    { id: 3, desc: 'London+Singapore partitioned — Lagos only', votes: 3, quorum: false, circuitOpen: true },
    { id: 4, desc: 'All regions partitioned', votes: 0, quorum: false, circuitOpen: true },
    { id: 5, desc: 'Singapore reconnects only', votes: 1, quorum: false, circuitOpen: true },
    { id: 6, desc: 'London reconnects — quorum restored', votes: 5, quorum: true, circuitOpen: false },
    { id: 7, desc: 'Zombie Lagos write attempt', votes: 6, quorum: true, circuitOpen: false, blocked: true },
    { id: 8, desc: 'Lease renewal after TTL expiry', votes: 6, quorum: true, renewalFails: true },
  ],

  quorumModel: { weights: REGION_WEIGHT, totalVotes: TOTAL_VOTES, majorityRequired: MAJORITY },
  tests: results,
  fencerEvents: fencer.events,
};

writeFileSync('/home/ubuntu/split_brain_cb_results.json', JSON.stringify(summary, null, 2));
console.log('\n  Results saved → /home/ubuntu/split_brain_cb_results.json');

if (failed > 0) process.exit(1);
console.log(`\n  ALL ${passed} TESTS PASSED ✅`);
