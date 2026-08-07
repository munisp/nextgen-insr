/**
 * InsurePortal — Sprint 129
 * Multi-Region DR Link-Sever State Synchronisation Test
 *
 * Simulates a hard link sever between Lagos and London with:
 * - Split-brain prevention
 * - State divergence detection
 * - Conflict resolution on reconnection
 * - SAR compliance state consistency verification
 */

import { performance } from 'perf_hooks';
import { writeFileSync } from 'fs';

let passed = 0, failed = 0;
function assert(name, condition, detail = '') {
  if (condition) { passed++; console.log(`  ✅ ${name}${detail ? ' — ' + detail : ''}`); }
  else { failed++; console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); }
}

console.log('╔══════════════════════════════════════════════════════════════════════════╗');
console.log('║  Sprint 129: Multi-Region Link-Sever State Synchronisation              ║');
console.log('╚══════════════════════════════════════════════════════════════════════════╝');

// ── Region State Store ────────────────────────────────────────────────────────

class RegionStore {
  constructor(id, name) {
    this.id = id;
    this.name = name;
    this.records = new Map();     // sarId → record
    this.writeLog = [];           // Ordered write log (WAL)
    this.vectorClock = {};        // { regionId: sequenceNumber }
    this.vectorClock[id] = 0;
    this.partitioned = false;
    this.stats = { writes: 0, reads: 0, conflicts: 0, synced: 0 };
  }

  write(sarId, data, sourceRegion = this.id) {
    this.vectorClock[this.id] = (this.vectorClock[this.id] || 0) + 1;
    const entry = {
      sarId,
      data: { ...data },
      vectorClock: { ...this.vectorClock },
      writtenAt: performance.now(),
      writtenBy: sourceRegion,
      version: (this.records.get(sarId)?.version ?? 0) + 1,
    };
    this.records.set(sarId, { ...entry.data, version: entry.version, vectorClock: entry.vectorClock });
    this.writeLog.push(entry);
    this.stats.writes++;
    return entry;
  }

  read(sarId) {
    this.stats.reads++;
    return this.records.get(sarId) ?? null;
  }

  // Merge incoming entries from another region (conflict resolution: last-write-wins by vector clock)
  merge(incomingEntries) {
    let merged = 0, conflicts = 0;
    for (const entry of incomingEntries) {
      const existing = this.records.get(entry.sarId);
      if (!existing) {
        this.records.set(entry.sarId, { ...entry.data, version: entry.version, vectorClock: entry.vectorClock });
        merged++;
      } else {
        // Conflict: both regions wrote to the same record during partition
        // Resolution: higher version wins; tie-break by Lagos (primary) preference
        if (entry.version > existing.version) {
          this.records.set(entry.sarId, { ...entry.data, version: entry.version, vectorClock: entry.vectorClock });
          conflicts++;
        } else if (entry.version === existing.version && entry.writtenBy === 'ng-lagos') {
          // Lagos primary wins on tie
          this.records.set(entry.sarId, { ...entry.data, version: entry.version, vectorClock: entry.vectorClock });
          conflicts++;
        }
      }
      // Merge vector clocks
      for (const [region, seq] of Object.entries(entry.vectorClock)) {
        this.vectorClock[region] = Math.max(this.vectorClock[region] || 0, seq);
      }
    }
    this.stats.synced += merged;
    this.stats.conflicts += conflicts;
    return { merged, conflicts };
  }

  getDivergenceFrom(other) {
    const myIds = new Set(this.records.keys());
    const otherIds = new Set(other.records.keys());
    const onlyInMe = [...myIds].filter(id => !otherIds.has(id));
    const onlyInOther = [...otherIds].filter(id => !myIds.has(id));
    const inBoth = [...myIds].filter(id => otherIds.has(id));
    const stateConflicts = inBoth.filter(id => {
      const mine = this.records.get(id);
      const theirs = other.records.get(id);
      return mine.version !== theirs.version || mine.status !== theirs.status;
    });
    return { onlyInMe, onlyInOther, stateConflicts };
  }
}

// ── Link Sever Simulator ──────────────────────────────────────────────────────

class NetworkLink {
  constructor(regionA, regionB) {
    this.regionA = regionA;
    this.regionB = regionB;
    this.severed = false;
    this.severedAt = null;
    this.restoredAt = null;
    this.droppedMessages = 0;
    this.deliveredMessages = 0;
  }

  sever() {
    this.severed = true;
    this.severedAt = performance.now();
  }

  restore() {
    this.severed = false;
    this.restoredAt = performance.now();
    return { outageDurationMs: this.restoredAt - this.severedAt };
  }

  async replicate(sourceId, targetId, entries) {
    if (this.severed) {
      this.droppedMessages += entries.length;
      return { delivered: false, dropped: entries.length };
    }
    const target = targetId === this.regionA.id ? this.regionA : this.regionB;
    target.merge(entries);
    this.deliveredMessages += entries.length;
    return { delivered: true, count: entries.length };
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// TEST EXECUTION
// ══════════════════════════════════════════════════════════════════════════════

const lagos = new RegionStore('ng-lagos', 'Nigeria (Lagos)');
const london = new RegionStore('eu-london', 'Europe (London)');
const singapore = new RegionStore('ap-singapore', 'Asia-Pacific (Singapore)');

const lagosLondonLink = new NetworkLink(lagos, london);
const lagosSingaporeLink = new NetworkLink(lagos, singapore);
const londonSingaporeLink = new NetworkLink(london, singapore);

// Helper: replicate Lagos write to all regions
async function replicateFromLagos(sarId, data) {
  const entry = lagos.write(sarId, data);
  await lagosLondonLink.replicate('ng-lagos', 'eu-london', [entry]);
  await lagosSingaporeLink.replicate('ng-lagos', 'ap-singapore', [entry]);
  return entry;
}

// ── Phase 1: Normal operation — 200 SARs ─────────────────────────────────────
console.log('\n  Phase 1: Normal operation — 200 SARs created and replicated...');
const phase1Start = performance.now();
for (let i = 1; i <= 200; i++) {
  await replicateFromLagos(`SAR-${String(i).padStart(4, '0')}`, {
    entityName: `Entity ${i}`,
    amount: 5000000 + i * 10000,
    status: 'pending',
    riskScore: 45 + (i % 50),
    naicomRef: `NAICOM-2026-${i}`,
  });
}
const phase1Duration = performance.now() - phase1Start;
console.log(`  Phase 1 complete: 200 SARs in ${phase1Duration.toFixed(1)}ms`);

assert('Phase 1: Lagos has 200 records', lagos.records.size === 200, `${lagos.records.size}`);
assert('Phase 1: London has 200 records', london.records.size === 200, `${london.records.size}`);
assert('Phase 1: Singapore has 200 records', singapore.records.size === 200, `${singapore.records.size}`);
assert('Phase 1: zero divergence before partition', lagos.getDivergenceFrom(london).stateConflicts.length === 0);

// ── Phase 2: Sever Lagos-London link ─────────────────────────────────────────
console.log('\n  Phase 2: Severing Lagos-London network link...');
lagosLondonLink.sever();
console.log('  ⚡ Lagos ↔ London link SEVERED');

// Lagos continues writing (50 new SARs, 30 updates to existing)
for (let i = 201; i <= 250; i++) {
  const entry = lagos.write(`SAR-${String(i).padStart(4, '0')}`, {
    entityName: `Entity ${i}`, amount: 7000000 + i * 5000,
    status: 'pending', riskScore: 60, naicomRef: `NAICOM-2026-${i}`,
  });
  // Replicate to Singapore (link still up)
  await lagosSingaporeLink.replicate('ng-lagos', 'ap-singapore', [entry]);
}

// Lagos updates 30 existing SARs to 'submitted'
for (let i = 1; i <= 30; i++) {
  const sarId = `SAR-${String(i).padStart(4, '0')}`;
  const entry = lagos.write(sarId, { ...lagos.read(sarId), status: 'submitted', nfiuRef: `NFIU-${i}` });
  await lagosSingaporeLink.replicate('ng-lagos', 'ap-singapore', [entry]);
}

// London also writes during partition (10 local updates — these will conflict)
for (let i = 1; i <= 10; i++) {
  const sarId = `SAR-${String(i).padStart(4, '0')}`;
  const existing = london.read(sarId);
  london.write(sarId, { ...existing, status: 'under_review', reviewedBy: 'london-team' }, 'eu-london');
}

// London creates 5 new SARs (only in London during partition)
for (let i = 251; i <= 255; i++) {
  london.write(`SAR-${String(i).padStart(4, '0')}`, {
    entityName: `London Entity ${i}`, amount: 3000000,
    status: 'pending', riskScore: 35, createdDuringPartition: true,
  }, 'eu-london');
}

console.log(`  During partition: Lagos wrote ${50 + 30} records, London wrote ${10 + 5} records`);

// Measure divergence during partition
const divergence = lagos.getDivergenceFrom(london);
console.log(`  Divergence: ${divergence.onlyInMe.length} only in Lagos, ${divergence.onlyInOther.length} only in London, ${divergence.stateConflicts.length} conflicts`);

assert('Phase 2: Lagos has 250 records (200 + 50 new)', lagos.records.size === 250, `${lagos.records.size}`);
assert('Phase 2: London has 205 records (200 + 5 new)', london.records.size === 205, `${london.records.size}`);
assert('Phase 2: Singapore has 250 records (synced from Lagos)', singapore.records.size === 250, `${singapore.records.size}`);
assert('Phase 2: divergence detected (50 only in Lagos)', divergence.onlyInMe.length === 50, `${divergence.onlyInMe.length}`);
assert('Phase 2: London-only records detected (5)', divergence.onlyInOther.length === 5, `${divergence.onlyInOther.length}`);
assert('Phase 2: state conflicts detected (30 submitted vs under_review)', divergence.stateConflicts.length === 30, `${divergence.stateConflicts.length}`);

// ── Phase 3: Restore link and reconcile ──────────────────────────────────────
console.log('\n  Phase 3: Restoring Lagos-London link and reconciling...');
const restoration = lagosLondonLink.restore();
console.log(`  Link restored after ${restoration.outageDurationMs.toFixed(2)}ms`);

// Bidirectional sync on reconnection
// Lagos → London: send all entries written during partition
const lagosEntriesDuringPartition = lagos.writeLog.filter(e => e.writtenAt > lagosLondonLink.severedAt);
const londonEntriesDuringPartition = london.writeLog.filter(e => e.writtenAt > lagosLondonLink.severedAt);

const lagosToLondon = await lagosLondonLink.replicate('ng-lagos', 'eu-london', lagosEntriesDuringPartition);
const londonToLagos = await lagosLondonLink.replicate('eu-london', 'ng-lagos', londonEntriesDuringPartition);

console.log(`  Sync: Lagos→London: ${lagosEntriesDuringPartition.length} entries, London→Lagos: ${londonEntriesDuringPartition.length} entries`);
console.log(`  Conflicts resolved: ${london.stats.conflicts} (Lagos primary wins on tie)`);

// ── Phase 4: Verify final consistency ────────────────────────────────────────
console.log('\n  Phase 4: Verifying final state consistency...');

const finalDivergence = lagos.getDivergenceFrom(london);
const lagosSingaporeDivergence = lagos.getDivergenceFrom(singapore);

// Check SAR compliance states
let complianceInconsistencies = 0;
for (const [sarId] of lagos.records) {
  const lagosState = lagos.read(sarId);
  const londonState = london.read(sarId);
  if (!londonState) { complianceInconsistencies++; continue; }
  // After sync, submitted SARs in Lagos should be submitted in London too
  if (lagosState.status === 'submitted' && londonState.status !== 'submitted') {
    complianceInconsistencies++;
  }
}

console.log(`  Final state: Lagos=${lagos.records.size}, London=${london.records.size}, Singapore=${singapore.records.size}`);
console.log(`  Remaining divergence: ${finalDivergence.stateConflicts.length} conflicts`);
console.log(`  Compliance inconsistencies: ${complianceInconsistencies}`);
console.log(`  Dropped messages during partition: ${lagosLondonLink.droppedMessages}`);
console.log(`  Messages delivered after restoration: ${lagosLondonLink.deliveredMessages}`);

assert('Phase 4: Lagos and London have same record count', lagos.records.size === london.records.size, `${lagos.records.size} vs ${london.records.size}`);
assert('Phase 4: zero remaining state conflicts after sync', finalDivergence.stateConflicts.length === 0, `${finalDivergence.stateConflicts.length}`);
assert('Phase 4: zero compliance inconsistencies', complianceInconsistencies === 0, `${complianceInconsistencies}`);
assert('Phase 4: Singapore consistent with Lagos', lagosSingaporeDivergence.stateConflicts.length === 0, `${lagosSingaporeDivergence.stateConflicts.length}`);
assert('Phase 4: all messages delivered on restoration (295 entries synced)', lagosLondonLink.deliveredMessages === 295, `dropped=${lagosLondonLink.droppedMessages}, recovered=${lagosLondonLink.deliveredMessages}`);
assert('Phase 4: vector clocks merged correctly', Object.keys(lagos.vectorClock).length >= 2, `${JSON.stringify(lagos.vectorClock)}`);

// ── Phase 5: Verify conflict resolution correctness ──────────────────────────
console.log('\n  Phase 5: Verifying conflict resolution correctness...');

// SAR-0001 through SAR-0010 were written by both Lagos (submitted) and London (under_review)
// Lagos primary should win → status should be 'submitted'
let correctResolutions = 0;
for (let i = 1; i <= 10; i++) {
  const sarId = `SAR-${String(i).padStart(4, '0')}`;
  const lagosState = lagos.read(sarId);
  const londonState = london.read(sarId);
  if (lagosState?.status === 'submitted' && londonState?.status === 'submitted') {
    correctResolutions++;
  }
}

assert('Phase 5: conflict resolution correct (Lagos primary wins)', correctResolutions === 10, `${correctResolutions}/10 correctly resolved`);
assert('Phase 5: London-created SARs preserved in Lagos', lagos.read('SAR-0251') !== null, 'SAR-0251 exists in Lagos');
assert('Phase 5: all 255 SARs in both regions', lagos.records.size === 255 && london.records.size === 255, `Lagos=${lagos.records.size}, London=${london.records.size}`);

// ══════════════════════════════════════════════════════════════════════════════
// RESULTS
// ══════════════════════════════════════════════════════════════════════════════

console.log('\n════════════════════════════════════════════════════════════════════════════');
console.log('  FINAL RESULTS');
console.log('════════════════════════════════════════════════════════════════════════════\n');
console.log(`  Total: ${passed}/${passed + failed} assertions passed`);
console.log(`  Score: ${Math.round((passed / (passed + failed)) * 100)}%`);
if (failed === 0) {
  console.log('\n  ✅ ALL TESTS PASSED — multi-region link-sever state synchronisation verified');
} else {
  console.log(`\n  ❌ ${failed} TESTS FAILED`);
}

writeFileSync('/home/ubuntu/dr_link_sever_results.json', JSON.stringify({
  passed, failed,
  regions: { lagos: lagos.records.size, london: london.records.size, singapore: singapore.records.size },
  conflicts: london.stats.conflicts,
  droppedMessages: lagosLondonLink.droppedMessages,
  recoveredMessages: lagosLondonLink.deliveredMessages,
}, null, 2));
