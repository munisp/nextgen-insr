// offline-ledger — CRDT-based offline-first ledger for agent float accounts.
//
// Terminals record Credit / Debit / Reversal operations while disconnected;
// replicas merge deterministically when connectivity returns. Conflict
// resolution is a genuine CRDT design:
//   - Every operation carries a vector_clock plus a unique op id, so merge is
//     idempotent (re-merging the same op is a no-op) and commutative.
//   - Concurrent conflicting balances resolve by deterministic rules:
//     applied operations are UNIONED (grow-only op set), so no real money
//     movement is ever lost; an account overdrawn by concurrent debits is
//     flagged in `conflicts` for human review — never silently netted.
//   - Persistence (P-wave, 2026-09-19): append-only WAL (one compact JSON
//     line per op) with a periodic compacted snapshot, replacing the old
//     full-ledger pretty-printed rewrite on EVERY op (O(n) serialize + O(n)
//     bytes written per request). All file IO runs in spawn_blocking so the
//     async worker threads are never stalled by fsync. Load failures remain
//     loud at startup (process refuses to serve a fabricated empty ledger).
use actix_web::{web, App, HttpResponse, HttpServer};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::io::Write;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;

// ── CRDT core ───────────────────────────────────────────────────────────────

pub type VectorClock = BTreeMap<String, u64>;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum OpKind {
    Credit,
    Debit,
    Reversal { reverses_op_id: String },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct LedgerOp {
    pub op_id: String,
    pub account: String,
    pub kind: OpKind,
    /// minor units, always positive; sign comes from OpKind
    pub amount_minor: i64,
    pub node_id: String,
    pub vector_clock: VectorClock,
    pub memo: Option<String>,
    pub client_ts: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct AccountState {
    pub account: String,
    /// applied op ids (grow-only set)
    pub applied_ops: u64,
    pub balance_minor: i64,
    /// concurrent ops that overdrew the account — surfaced for review
    pub conflicts: Vec<String>,
}

/// CRDT Ledger: a grow-only set of operations with deterministic merge.
#[derive(Default)]
pub struct Ledger {
    ops: HashMap<String, LedgerOp>,    // op_id -> op (grow-only)
    reversed: HashMap<String, String>, // reversal_op_id -> reversed op_id
    /// 2026-09-19 (P-wave): set of op_ids that have been reversed, so
    /// is_reversed is O(1) instead of a linear scan of `reversed` per op.
    reversed_targets: HashSet<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct MergeReport {
    pub merged: usize,
    pub duplicates: usize,
    pub conflicts: Vec<String>,
}

impl Ledger {
    /// merge a batch of ops from a replica. Idempotent and commutative.
    pub fn merge(&mut self, incoming: Vec<LedgerOp>) -> MergeReport {
        let mut merged = 0usize;
        let mut duplicates = 0usize;
        let mut conflicts: Vec<String> = Vec::new();
        // deterministic application order: (clock sum, op_id)
        let mut ops = incoming;
        ops.sort_by(|a, b| {
            let sa: u64 = a.vector_clock.values().sum();
            let sb: u64 = b.vector_clock.values().sum();
            (sa, &a.op_id).cmp(&(sb, &b.op_id))
        });
        for op in ops {
            if self.ops.contains_key(&op.op_id) {
                duplicates += 1;
                continue; // CRDT idempotency
            }
            if let OpKind::Reversal { reverses_op_id } = &op.kind {
                if !self.ops.contains_key(reverses_op_id) {
                    // reversal of an op we have never seen is a genuine conflict
                    conflicts.push(format!(
                        "reversal {} references unknown op {}",
                        op.op_id, reverses_op_id
                    ));
                }
                self.reversed
                    .insert(op.op_id.clone(), reverses_op_id.clone());
                self.reversed_targets.insert(reverses_op_id.clone());
            }
            self.ops.insert(op.op_id.clone(), op);
            merged += 1;
        }
        // conflict detection: accounts overdriven below zero
        for (account, state) in self.account_states() {
            if state.balance_minor < 0 {
                conflicts.push(format!(
                    "account {} overdrawn to {} minor units by concurrent offline ops",
                    account, state.balance_minor
                ));
            }
        }
        MergeReport {
            merged,
            duplicates,
            conflicts,
        }
    }

    fn is_reversed(&self, op_id: &str) -> bool {
        self.reversed_targets.contains(op_id)
    }

    /// resolve the current account states by replaying the op set.
    pub fn account_states(&self) -> Vec<(String, AccountState)> {
        let mut by_account: BTreeMap<String, AccountState> = BTreeMap::new();
        let mut ops: Vec<&LedgerOp> = self.ops.values().collect();
        ops.sort_by(|a, b| {
            let sa: u64 = a.vector_clock.values().sum();
            let sb: u64 = b.vector_clock.values().sum();
            (sa, &a.op_id).cmp(&(sb, &b.op_id))
        });
        for op in ops {
            if self.is_reversed(&op.op_id) {
                continue; // reversed ops contribute nothing
            }
            let st = by_account
                .entry(op.account.clone())
                .or_insert_with(|| AccountState {
                    account: op.account.clone(),
                    applied_ops: 0,
                    balance_minor: 0,
                    conflicts: Vec::new(),
                });
            st.applied_ops += 1;
            match &op.kind {
                OpKind::Credit => st.balance_minor += op.amount_minor,
                OpKind::Debit => st.balance_minor -= op.amount_minor,
                OpKind::Reversal { .. } => {}
            }
        }
        for st in by_account.values_mut() {
            if st.balance_minor < 0 {
                st.conflicts.push("overdrawn".to_string());
            }
        }
        by_account.into_iter().collect()
    }
}

// ── Persistence: append-only WAL + periodic compacted snapshot ──────────────
//
// Layout: `file` holds a compact JSON array of all ops (snapshot); `wal`
// (`<file>.wal`) holds one compact JSON LedgerOp per line, appended on every
// record/merge. On boot: load snapshot, then replay WAL (merge dedups any
// overlap). Every SNAPSHOT_EVERY appended ops the snapshot is rewritten
// (atomic tmp+rename) and the WAL truncated. Durability is unchanged from
// the previous design: a batch fsync per request, not per op.

const SNAPSHOT_EVERY: usize = 1000;

fn wal_append_sync(wal_path: &str, ops: &[LedgerOp]) -> std::io::Result<()> {
    let mut buf = Vec::with_capacity(ops.len() * 128);
    for op in ops {
        serde_json::to_writer(&mut buf, op)?;
        buf.push(b'\n');
    }
    let mut f = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(wal_path)?;
    f.write_all(&buf)?;
    f.sync_data()?; // one fsync per request batch, not per op
    Ok(())
}

fn snapshot_sync(file: &str, ledger: &Ledger) -> std::io::Result<()> {
    let ops: Vec<&LedgerOp> = ledger.ops.values().collect();
    // 2026-09-19 (P-wave): compact serialization for a machine-read snapshot
    // (was to_vec_pretty — ~2x bytes + CPU for zero benefit).
    let data = serde_json::to_vec(&ops)?;
    let tmp = format!("{}.tmp", file);
    {
        let mut f = std::fs::File::create(&tmp)?;
        f.write_all(&data)?;
        f.sync_data()?; // fsync BEFORE the rename so the new snapshot is durable
    }
    std::fs::rename(&tmp, file)?;
    Ok(())
}

/// Read snapshot + WAL into a single op vec. Corrupt snapshot or WAL line is
/// a hard error — startup refuses to serve a fabricated empty ledger.
fn load_persisted(file: &str, wal: &str) -> std::io::Result<Vec<LedgerOp>> {
    let mut out: Vec<LedgerOp> = Vec::new();
    if let Ok(data) = std::fs::read(file) {
        if !data.is_empty() {
            let ops: Vec<LedgerOp> = serde_json::from_slice(&data).map_err(|e| {
                std::io::Error::new(
                    std::io::ErrorKind::InvalidData,
                    format!("ledger snapshot {file} is corrupt: {e}"),
                )
            })?;
            out.extend(ops);
        }
    }
    if let Ok(data) = std::fs::read(wal) {
        for line in data.split(|&b| b == b'\n') {
            if line.is_empty() {
                continue;
            }
            let op: LedgerOp = serde_json::from_slice(line).map_err(|e| {
                std::io::Error::new(
                    std::io::ErrorKind::InvalidData,
                    format!("ledger WAL {wal} has a corrupt entry: {e}"),
                )
            })?;
            out.push(op);
        }
    }
    Ok(out)
}

// ── HTTP API ────────────────────────────────────────────────────────────────

struct AppState {
    ledger: Mutex<Ledger>,
    file: String,
    wal: String,
    node_id: String,
    ops_since_snapshot: AtomicUsize,
    /// 2026-09-19 (verifier fix): serializes WAL-append → snapshot →
    /// WAL-truncate so concurrent requests cannot interleave destructively.
    persist_lock: Mutex<()>,
}

/// Persist newly-merged ops: append them to the WAL, and compact into a
/// snapshot every SNAPSHOT_EVERY ops.
///
/// DURABILITY (2026-09-19, verifier finding): the whole
/// append → counter → snapshot → truncate sequence runs under
/// `persist_lock`. Without it, two concurrent requests could interleave as
/// snapshot(A) → WAL-append(B, acked 200) → WAL-truncate(A), silently losing
/// the acknowledged op B: it is in neither the snapshot (taken before B
/// merged) nor the WAL (truncated after B appended). Holding the lock across
/// the entire section makes that interleave impossible: a truncate only ever
/// runs when every WAL-appended op is covered by the snapshot just written.
/// Lock ordering is persist_lock → ledger (never the reverse), so no
/// deadlock. merge() semantics are untouched.
/// Test instrumentation for persist_sync_inner: no-ops in production, used
/// by tests to deterministically place a concurrent request inside the
/// snapshot→truncate crash window the verifier identified.
struct PersistHooks<'a> {
    /// runs inside the persistence lock after the WAL append, before the
    /// snapshot-boundary counter check
    post_append_pre_count: &'a mut dyn FnMut(),
    /// runs inside the persistence lock after the snapshot is written,
    /// before the WAL is truncated
    post_snapshot_pre_truncate: &'a mut dyn FnMut(),
}

#[allow(clippy::too_many_arguments)]
fn persist_sync(
    ledger: &Mutex<Ledger>,
    persist_lock: &Mutex<()>,
    file: &str,
    wal: &str,
    ops_since_snapshot: &AtomicUsize,
    new_ops: &[LedgerOp],
) -> std::io::Result<()> {
    let mut noop_append = || {};
    let mut noop_truncate = || {};
    persist_sync_inner(
        ledger,
        persist_lock,
        file,
        wal,
        ops_since_snapshot,
        new_ops,
        &mut PersistHooks {
            post_append_pre_count: &mut noop_append,
            post_snapshot_pre_truncate: &mut noop_truncate,
        },
    )
}

#[allow(clippy::too_many_arguments)]
fn persist_sync_inner(
    ledger: &Mutex<Ledger>,
    persist_lock: &Mutex<()>,
    file: &str,
    wal: &str,
    ops_since_snapshot: &AtomicUsize,
    new_ops: &[LedgerOp],
    hooks: &mut PersistHooks,
) -> std::io::Result<()> {
    if new_ops.is_empty() {
        return Ok(());
    }
    let _guard = persist_lock.lock().unwrap();
    wal_append_sync(wal, new_ops)?;
    (hooks.post_append_pre_count)();
    let seen = ops_since_snapshot.fetch_add(new_ops.len(), Ordering::SeqCst) + new_ops.len();
    if seen >= SNAPSHOT_EVERY {
        {
            let ledger = ledger.lock().unwrap();
            snapshot_sync(file, &ledger)?;
        }
        (hooks.post_snapshot_pre_truncate)();
        // snapshot now covers every op in the WAL; truncate it.
        std::fs::write(wal, b"")?;
        ops_since_snapshot.store(0, Ordering::SeqCst);
    }
    Ok(())
}

/// Async wrapper: blocking file IO runs off the async worker threads
/// (2026-09-19, P-wave).
async fn persist(state: &web::Data<AppState>, new_ops: Vec<LedgerOp>) -> std::io::Result<()> {
    if new_ops.is_empty() {
        return Ok(());
    }
    let st = state.clone();
    tokio::task::spawn_blocking(move || -> std::io::Result<()> {
        persist_sync(
            &st.ledger,
            &st.persist_lock,
            &st.file,
            &st.wal,
            &st.ops_since_snapshot,
            &new_ops,
        )
    })
    .await
    .map_err(std::io::Error::other)?
}

async fn health(state: web::Data<AppState>) -> HttpResponse {
    let ops = state.ledger.lock().unwrap().ops.len();
    HttpResponse::Ok().json(serde_json::json!({
        "status": "ok", "service": "offline-ledger", "node_id": state.node_id, "ops": ops,
    }))
}

#[derive(Deserialize)]
struct RecordRequest {
    account: String,
    kind: String, // credit | debit | reversal
    amount_minor: i64,
    reverses_op_id: Option<String>,
    memo: Option<String>,
}

async fn record(state: web::Data<AppState>, req: web::Json<RecordRequest>) -> HttpResponse {
    if req.amount_minor <= 0 {
        return HttpResponse::BadRequest()
            .json(serde_json::json!({"error": "amount_minor must be positive"}));
    }
    let kind = match req.kind.as_str() {
        "credit" => OpKind::Credit,
        "debit" => OpKind::Debit,
        "reversal" => match &req.reverses_op_id {
            Some(id) => OpKind::Reversal { reverses_op_id: id.clone() },
            None => {
                return HttpResponse::BadRequest()
                    .json(serde_json::json!({"error": "reversal requires reverses_op_id"}))
            }
        },
        other => {
            return HttpResponse::BadRequest()
                .json(serde_json::json!({"error": format!("unknown kind {other}; use credit|debit|reversal")}))
        }
    };
    let mut clock: VectorClock = BTreeMap::new();
    let seq = state.ledger.lock().unwrap().ops.len() as u64 + 1;
    clock.insert(state.node_id.clone(), seq);
    let op = LedgerOp {
        op_id: uuid::Uuid::new_v4().to_string(),
        account: req.account.clone(),
        kind,
        amount_minor: req.amount_minor,
        node_id: state.node_id.clone(),
        vector_clock: clock,
        memo: req.memo.clone(),
        client_ts: chrono::Utc::now().to_rfc3339(),
    };
    let op_id = op.op_id.clone();
    let report = state.ledger.lock().unwrap().merge(vec![op.clone()]);
    if let Err(e) = persist(&state, vec![op]).await {
        return HttpResponse::ServiceUnavailable()
            .json(serde_json::json!({"error": format!("ledger persist failed: {e}")}));
    }
    HttpResponse::Ok().json(serde_json::json!({"op_id": op_id, "merge": report}))
}

async fn merge_replica(state: web::Data<AppState>, ops: web::Json<Vec<LedgerOp>>) -> HttpResponse {
    if ops.is_empty() {
        return HttpResponse::BadRequest().json(serde_json::json!({"error": "ops[] required"}));
    }
    let incoming = ops.into_inner();
    let for_wal = incoming.clone();
    let report = state.ledger.lock().unwrap().merge(incoming);
    if let Err(e) = persist(&state, for_wal).await {
        return HttpResponse::ServiceUnavailable()
            .json(serde_json::json!({"error": format!("ledger persist failed: {e}")}));
    }
    HttpResponse::Ok().json(report)
}

async fn accounts(state: web::Data<AppState>) -> HttpResponse {
    let states = state.ledger.lock().unwrap().account_states();
    let out: Vec<&AccountState> = states.iter().map(|(_, s)| s).collect();
    HttpResponse::Ok().json(out)
}

async fn export_ops(state: web::Data<AppState>) -> HttpResponse {
    let ops: Vec<LedgerOp> = state.ledger.lock().unwrap().ops.values().cloned().collect();
    HttpResponse::Ok().json(ops)
}

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    env_logger::init();
    let port: u16 = std::env::var("PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(8108);
    let file =
        std::env::var("LEDGER_FILE").unwrap_or_else(|_| "/tmp/offline-ledger.json".to_string());
    let wal = format!("{}.wal", file);
    let node_id = std::env::var("NODE_ID").unwrap_or_else(|_| "node-local".to_string());

    let mut ledger = Ledger::default();
    match load_persisted(&file, &wal) {
        Ok(ops) => {
            let n = ops.len();
            ledger.merge(ops);
            log::info!("restored {n} ops from {file} + {wal}");
        }
        Err(e) => {
            // fail loud: serving an empty ledger when real ops exist on
            // disk would fabricate balances
            log::error!("FATAL: {e} — refusing to start");
            std::process::exit(1);
        }
    }
    // ops already in the WAL count toward the next snapshot trigger.
    let wal_ops = std::fs::read(&wal)
        .map(|d| d.split(|&b| b == b'\n').filter(|l| !l.is_empty()).count())
        .unwrap_or(0);

    let state = web::Data::new(AppState {
        ledger: Mutex::new(ledger),
        file,
        wal,
        node_id,
        ops_since_snapshot: AtomicUsize::new(wal_ops),
        persist_lock: Mutex::new(()),
    });
    log::info!("offline-ledger listening on :{port}");
    HttpServer::new(move || {
        App::new()
            .app_data(state.clone())
            .route("/health", web::get().to(health))
            .route("/api/v1/record", web::post().to(record))
            .route("/api/v1/merge", web::post().to(merge_replica))
            .route("/api/v1/accounts", web::get().to(accounts))
            .route("/api/v1/ops", web::get().to(export_ops))
    })
    .bind(("0.0.0.0", port))?
    .run()
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn op(id: &str, account: &str, kind: OpKind, amount: i64, node: &str, seq: u64) -> LedgerOp {
        let mut vc = BTreeMap::new();
        vc.insert(node.to_string(), seq);
        LedgerOp {
            op_id: id.into(),
            account: account.into(),
            kind,
            amount_minor: amount,
            node_id: node.into(),
            vector_clock: vc,
            memo: None,
            client_ts: "2026-01-01T00:00:00Z".into(),
        }
    }

    #[test]
    fn merge_is_idempotent_and_commutative() {
        let a = op("1", "acct", OpKind::Credit, 1000, "n1", 1);
        let b = op("2", "acct", OpKind::Debit, 400, "n2", 1);
        let mut l1 = Ledger::default();
        l1.merge(vec![a.clone(), b.clone()]);
        l1.merge(vec![a.clone(), b.clone()]); // re-merge: duplicates ignored
        let mut l2 = Ledger::default();
        l2.merge(vec![b, a]); // opposite order: same result (commutative)
        let s1 = l1.account_states();
        let s2 = l2.account_states();
        assert_eq!(s1[0].1.balance_minor, 600);
        assert_eq!(s1[0].1.balance_minor, s2[0].1.balance_minor);
        assert_eq!(s1[0].1.applied_ops, 2);
    }

    #[test]
    fn reversal_voids_original() {
        let credit = op("1", "acct", OpKind::Credit, 1000, "n1", 1);
        let reversal = op(
            "2",
            "acct",
            OpKind::Reversal {
                reverses_op_id: "1".into(),
            },
            1000,
            "n1",
            2,
        );
        let mut l = Ledger::default();
        let report = l.merge(vec![credit, reversal]);
        assert!(report.conflicts.is_empty());
        assert_eq!(l.account_states()[0].1.balance_minor, 0);
    }

    #[test]
    fn concurrent_debits_overdraw_is_flagged() {
        let c = op("1", "acct", OpKind::Credit, 500, "n1", 1);
        let d1 = op("2", "acct", OpKind::Debit, 400, "n1", 2);
        let d2 = op("3", "acct", OpKind::Debit, 400, "n2", 1); // concurrent
        let mut l = Ledger::default();
        let report = l.merge(vec![c, d1, d2]);
        assert_eq!(l.account_states()[0].1.balance_minor, -300);
        assert!(!report.conflicts.is_empty()); // honestly flagged, not netted
    }

    #[test]
    fn unknown_reversal_reference_is_conflict() {
        let r = op(
            "9",
            "acct",
            OpKind::Reversal {
                reverses_op_id: "ghost".into(),
            },
            100,
            "n1",
            1,
        );
        let mut l = Ledger::default();
        let report = l.merge(vec![r]);
        assert!(report.conflicts.iter().any(|c| c.contains("unknown op")));
    }

    // ── P-wave (2026-09-19) persistence / is_reversed tests ─────────────────

    fn tmpdir_path(name: &str) -> String {
        let dir =
            std::env::temp_dir().join(format!("offline-ledger-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        dir.join(name).to_string_lossy().into_owned()
    }

    #[test]
    fn is_reversed_tracks_exactly_the_reversed_targets() {
        let c1 = op("1", "acct", OpKind::Credit, 1000, "n1", 1);
        let c2 = op("2", "acct", OpKind::Credit, 500, "n1", 2);
        let rev = op(
            "3",
            "acct",
            OpKind::Reversal {
                reverses_op_id: "1".into(),
            },
            1000,
            "n1",
            3,
        );
        let mut l = Ledger::default();
        l.merge(vec![c1, c2, rev]);
        assert!(l.is_reversed("1"), "reversed op must be reported reversed");
        assert!(
            !l.is_reversed("2"),
            "unrelated op must NOT be reported reversed"
        );
        assert!(
            !l.is_reversed("3"),
            "the reversal op itself is not reversed"
        );
        assert!(!l.is_reversed("nope"), "unknown id is not reversed");
        // balance: only op 2 counts
        assert_eq!(l.account_states()[0].1.balance_minor, 500);
    }

    #[test]
    fn wal_round_trip() {
        let wal = tmpdir_path("ledger.wal");
        let ops = vec![
            op("1", "a", OpKind::Credit, 1000, "n1", 1),
            op("2", "a", OpKind::Debit, 250, "n1", 2),
            op(
                "3",
                "b",
                OpKind::Reversal {
                    reverses_op_id: "1".into(),
                },
                1000,
                "n2",
                1,
            ),
        ];
        wal_append_sync(&wal, &ops[..2]).unwrap();
        wal_append_sync(&wal, &ops[2..]).unwrap(); // appends, not overwrite
        let loaded = load_persisted(&tmpdir_path("absent-snapshot.json"), &wal).unwrap();
        assert_eq!(
            loaded, ops,
            "WAL replay must reproduce every appended op exactly"
        );
    }

    #[test]
    fn corrupt_wal_fails_loud() {
        let wal = tmpdir_path("ledger.wal");
        std::fs::write(&wal, b"{not json}\n").unwrap();
        assert!(load_persisted(&tmpdir_path("absent.json"), &wal).is_err());
    }

    #[test]
    fn snapshot_plus_wal_replay_equals_original_merge() {
        // Build a ledger, snapshot it, then WAL-append more ops; a fresh
        // ledger loaded from disk must reach identical account states —
        // merge() semantics are unchanged by the persistence format.
        let file = tmpdir_path("ledger.json");
        let wal = format!("{}.wal", file);
        let batch1 = vec![
            op("1", "acct", OpKind::Credit, 1000, "n1", 1),
            op("2", "acct", OpKind::Debit, 400, "n2", 1),
        ];
        let batch2 = vec![
            op("3", "acct", OpKind::Credit, 700, "n1", 2),
            op(
                "4",
                "acct",
                OpKind::Reversal {
                    reverses_op_id: "2".into(),
                },
                400,
                "n2",
                2,
            ),
            op("5", "other", OpKind::Debit, 50, "n3", 1),
        ];
        let mut original = Ledger::default();
        original.merge(batch1.clone());
        original.merge(batch2.clone());

        {
            let mut snap_ledger = Ledger::default();
            snap_ledger.merge(batch1);
            snapshot_sync(&file, &snap_ledger).unwrap();
        }
        wal_append_sync(&wal, &batch2).unwrap();

        let mut restored = Ledger::default();
        restored.merge(load_persisted(&file, &wal).unwrap());
        let a = original.account_states();
        let b = restored.account_states();
        assert_eq!(a, b, "snapshot+WAL replay must equal the in-memory merge");
    }

    #[test]
    fn wal_overlap_with_snapshot_is_idempotent_on_load() {
        // Crash between snapshot write and WAL truncate leaves ops in both;
        // merge dedups them on load.
        let file = tmpdir_path("ledger.json");
        let wal = format!("{}.wal", file);
        let ops = vec![op("1", "acct", OpKind::Credit, 1000, "n1", 1)];
        let mut l = Ledger::default();
        l.merge(ops.clone());
        snapshot_sync(&file, &l).unwrap();
        wal_append_sync(&wal, &ops).unwrap();
        let mut restored = Ledger::default();
        let report = restored.merge(load_persisted(&file, &wal).unwrap());
        assert_eq!(report.merged, 1);
        assert_eq!(report.duplicates, 1);
        assert_eq!(restored.account_states()[0].1.balance_minor, 1000);
    }

    #[test]
    fn append_during_snapshot_truncate_window_is_not_lost() {
        // Deterministic reproduction of the verifier's falsification (WAL
        // durability race, 2026-09-19). Request A hits the snapshot boundary;
        // request B WAL-appends and is descheduled BEFORE its counter check;
        // A then truncates the WAL and resets the counter; B resumes, sees a
        // counter below SNAPSHOT_EVERY, takes no snapshot, and returns Ok —
        // its acknowledged op is in NEITHER the snapshot (taken before B
        // merged) NOR the WAL (truncated after B appended). Silent loss.
        // persist_sync holds the persistence lock across the entire
        // append → count → snapshot → truncate section, so B's whole persist
        // is deferred until after A's truncate and B's op survives.
        //
        // The choreography is exact in the unlocked case (every rendezvous
        // spins on a flag); in the fixed (locked) case B simply cannot enter
        // the window, A's hook times out after 3s, and B persists after A's
        // truncate.
        use std::sync::atomic::AtomicBool;
        let file = tmpdir_path("ledger.json");
        let wal = format!("{}.wal", file);
        let ledger = Mutex::new(Ledger::default());
        let persist_lock = Mutex::new(());
        let counter = AtomicUsize::new(SNAPSHOT_EVERY - 1); // A's op triggers the snapshot

        let op_a = op("A", "acct", OpKind::Credit, 100, "n1", 1);
        let op_b = op("B", "acct", OpKind::Credit, 50, "n1", 2);

        let window_open = AtomicBool::new(false); // A is between snapshot and truncate+reset
        let b_appended = AtomicBool::new(false); // B's WAL append done, count pending
        let spin = |flag: &AtomicBool, want: bool, ms: u64| {
            let deadline = std::time::Instant::now() + std::time::Duration::from_millis(ms);
            while flag.load(Ordering::SeqCst) != want && std::time::Instant::now() < deadline {
                std::thread::yield_now();
            }
            flag.load(Ordering::SeqCst) == want
        };

        std::thread::scope(|s| {
            let (ledger_r, lock_r, file_r, wal_r, counter_r) =
                (&ledger, &persist_lock, &file, &wal, &counter);
            let spin_r = &spin;
            let (window_open_r, b_appended_r) = (&window_open, &b_appended);
            let b = s.spawn(move || {
                assert!(
                    spin_r(window_open_r, true, 10_000),
                    "A must reach the snapshot/truncate window"
                );
                // request-path order: merge into the ledger, THEN persist.
                // B merges AFTER A's snapshot was taken, so A's snapshot does
                // NOT contain B's op.
                ledger_r.lock().unwrap().merge(vec![op_b.clone()]);
                let mut b_hooks = PersistHooks {
                    post_append_pre_count: &mut || {
                        // B is descheduled here: WAL append done, counter
                        // check not yet performed. In the unlocked build A
                        // truncates + resets while B waits; in the locked
                        // build B never gets here until A has finished.
                        b_appended_r.store(true, Ordering::SeqCst);
                        spin_r(window_open_r, false, 10_000);
                    },
                    post_snapshot_pre_truncate: &mut || {},
                };
                persist_sync_inner(
                    ledger_r,
                    lock_r,
                    file_r,
                    wal_r,
                    counter_r,
                    &[op_b],
                    &mut b_hooks,
                )
                .unwrap();
            });

            ledger.lock().unwrap().merge(vec![op_a.clone()]);
            let mut a_hooks = PersistHooks {
                post_append_pre_count: &mut || {},
                post_snapshot_pre_truncate: &mut || {
                    // A's snapshot is now written (B is NOT in it: B merges
                    // only after this point). Open the crash window and give
                    // B the chance to WAL-append; in the locked build B is
                    // blocked on persist_lock, so this simply times out and
                    // the truncate proceeds.
                    window_open.store(true, Ordering::SeqCst);
                    spin(&b_appended, true, 3_000);
                },
            };
            persist_sync_inner(
                &ledger,
                &persist_lock,
                &file,
                &wal,
                &counter,
                std::slice::from_ref(&op_a),
                &mut a_hooks,
            )
            .unwrap();
            // truncate + counter reset are done; release B.
            window_open.store(false, Ordering::SeqCst);
            b.join().unwrap();
        });

        // Simulated crash + restart: rebuild ONLY from disk.
        let mut restored = Ledger::default();
        restored.merge(load_persisted(&file, &wal).unwrap());
        assert!(
            restored.ops.contains_key("A"),
            "op A (snapshotted) must survive"
        );
        assert!(
            restored.ops.contains_key("B"),
            "op B (WAL-appended, acked, then descheduled across A's              truncate+counter-reset) must survive the crash — this is the              verifier's lost-op scenario"
        );
        assert_eq!(restored.account_states()[0].1.balance_minor, 150);
    }

    #[test]
    fn concurrent_persist_across_snapshot_boundary_loses_no_acked_ops() {
        // Regression test (2026-09-19, verifier finding — WAL durability
        // race): persist() previously had no mutual exclusion, so the
        // interleave
        //   snapshot(A, without B) → WAL-append(B) + ack 200 → WAL-truncate(A)
        // silently lost the acknowledged op B. persist_sync now serializes
        // append → snapshot → truncate under a persistence mutex.
        //
        // This test reproduces the verifier's falsification setup: many
        // threads merge + persist (the request path's exact call order:
        // merge first, then persist — so the snapshot in one thread may or
        // may not include another thread's already-merged op) while crossing
        // the SNAPSHOT_EVERY boundary repeatedly, then a simulated crash
        // (load_persisted only — no in-memory state) must recover EVERY op.
        let file = tmpdir_path("ledger.json");
        let wal = format!("{}.wal", file);
        let ledger = Mutex::new(Ledger::default());
        let persist_lock = Mutex::new(());
        let counter = AtomicUsize::new(0);

        const THREADS: usize = 8;
        const PER_THREAD: usize = SNAPSHOT_EVERY / 2; // forces 4 snapshot+truncate cycles
                                                      // padded memo so each snapshot is a multi-MB serialize+write+fsync,
                                                      // widening the window in which an unlocked implementation would
                                                      // interleave a concurrent append+truncate destructively
        let pad = "x".repeat(2048);
        std::thread::scope(|s| {
            for t in 0..THREADS {
                let ledger = &ledger;
                let persist_lock = &persist_lock;
                let counter = &counter;
                let file = &file;
                let wal = &wal;
                let pad = &pad;
                s.spawn(move || {
                    for i in 0..PER_THREAD {
                        let seq = (t * PER_THREAD + i + 1) as u64;
                        let mut o =
                            op(&format!("t{t}-op{i}"), "acct", OpKind::Credit, 1, "n1", seq);
                        o.memo = Some(pad.clone());
                        // request-path order: merge into the ledger, THEN persist
                        ledger.lock().unwrap().merge(vec![o.clone()]);
                        persist_sync(ledger, persist_lock, file, wal, counter, &[o])
                            .expect("persist must not fail");
                    }
                });
            }
        });

        // Simulated crash + restart: rebuild ONLY from snapshot + WAL on disk.
        let persisted = load_persisted(&file, &wal).unwrap();
        let mut restored = Ledger::default();
        restored.merge(persisted);
        let mem = ledger.lock().unwrap();
        assert_eq!(mem.ops.len(), THREADS * PER_THREAD);
        assert_eq!(
            restored.ops.len(),
            mem.ops.len(),
            "every acknowledged op must survive a crash — none may be lost to \
             a snapshot/truncate race"
        );
        assert_eq!(
            restored.account_states(),
            mem.account_states(),
            "restored balances must equal the in-memory ledger"
        );
        // a second load is idempotent (snapshot/WAL overlap dedups)
        let mut again = Ledger::default();
        again.merge(load_persisted(&file, &wal).unwrap());
        assert_eq!(again.account_states(), mem.account_states());
    }
}
