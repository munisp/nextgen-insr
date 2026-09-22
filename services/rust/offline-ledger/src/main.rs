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
    std::fs::write(&tmp, data)?;
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
}

/// Persist newly-merged ops: append them to the WAL, and compact into a
/// snapshot every SNAPSHOT_EVERY ops. Blocking file IO runs off the async
/// worker threads (2026-09-19, P-wave).
async fn persist(state: &web::Data<AppState>, new_ops: Vec<LedgerOp>) -> std::io::Result<()> {
    if new_ops.is_empty() {
        return Ok(());
    }
    let st = state.clone();
    tokio::task::spawn_blocking(move || -> std::io::Result<()> {
        wal_append_sync(&st.wal, &new_ops)?;
        let seen = st
            .ops_since_snapshot
            .fetch_add(new_ops.len(), Ordering::SeqCst)
            + new_ops.len();
        if seen >= SNAPSHOT_EVERY {
            {
                let ledger = st.ledger.lock().unwrap();
                snapshot_sync(&st.file, &ledger)?;
            }
            // snapshot now covers the WAL; truncate it.
            std::fs::write(&st.wal, b"")?;
            st.ops_since_snapshot.store(0, Ordering::SeqCst);
        }
        Ok(())
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
}
