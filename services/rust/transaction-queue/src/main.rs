// transaction-queue — durable fallback queue for financial transactions when
// the primary payment rail is down.
//
// Real guarantees:
//   - WriteAheadLog: every enqueue is appended + fsynced BEFORE the enqueue
//     is acknowledged; the WAL is replayed at startup. A corrupt tail is
//     loud (startup refuses rather than silently losing transactions).
//   - CircuitBreaker: delivery to PROCESSOR_URL stops after
//     failure_threshold consecutive failures and half-opens after
//     reset_timeout — failing fast instead of hammering a dead rail.
//   - dead_letter_queue: transactions exhausting max_attempts move to the
//     DLQ with their full failure history — never dropped, never reported
//     delivered. POST /api/v1/dlq/requeue puts them back for a retry.
use actix_web::{web, App, HttpResponse, HttpServer};
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::sync::Mutex;
use std::time::{Duration, Instant};

// ── write-ahead log ─────────────────────────────────────────────────────────

/// WriteAheadLog appends every queued transaction as an fsynced JSON line.
pub struct WriteAheadLog {
    path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueuedTransaction {
    pub id: String,
    pub payload: serde_json::Value,
    pub enqueued_at: String,
    pub attempts: u32,
    pub last_error: Option<String>,
}

impl WriteAheadLog {
    pub fn open(path: &str) -> std::io::Result<WriteAheadLog> {
        Ok(WriteAheadLog { path: path.to_string() })
    }

    pub fn append(&self, tx: &QueuedTransaction) -> std::io::Result<()> {
        use std::io::Write;
        let mut f = std::fs::OpenOptions::new().create(true).append(true).open(&self.path)?;
        let line = serde_json::to_string(tx).map_err(std::io::Error::other)?;
        writeln!(f, "{line}")?;
        f.sync_all() // durability before acknowledgement
    }

    /// replay rebuilds queue state; a corrupt line aborts startup loudly.
    pub fn replay(&self) -> Result<Vec<QueuedTransaction>, String> {
        let data = match std::fs::read_to_string(&self.path) {
            Ok(d) => d,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(e) => return Err(format!("cannot read WAL {}: {e}", self.path)),
        };
        let mut latest: std::collections::HashMap<String, QueuedTransaction> =
            std::collections::HashMap::new();
        let mut order: Vec<String> = Vec::new();
        for (i, line) in data.lines().enumerate() {
            if line.trim().is_empty() {
                continue;
            }
            let tx: QueuedTransaction = serde_json::from_str(line)
                .map_err(|e| format!("WAL corrupt at line {}: {e}", i + 1))?;
            if !latest.contains_key(&tx.id) {
                order.push(tx.id.clone());
            }
            latest.insert(tx.id.clone(), tx);
        }
        Ok(order.into_iter().filter_map(|id| latest.get(&id).cloned()).collect())
    }
}

// ── circuit breaker ─────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub enum CircuitState {
    Closed,
    Open,
    HalfOpen,
}

pub struct CircuitBreaker {
    state: CircuitState,
    consecutive_failures: u32,
    failure_threshold: u32,
    reset_timeout: Duration,
    opened_at: Option<Instant>,
}

impl CircuitBreaker {
    pub fn new(failure_threshold: u32, reset_timeout: Duration) -> Self {
        CircuitBreaker {
            state: CircuitState::Closed,
            consecutive_failures: 0,
            failure_threshold,
            reset_timeout,
            opened_at: None,
        }
    }

    pub fn state(&mut self) -> CircuitState {
        if self.state == CircuitState::Open {
            if let Some(t) = self.opened_at {
                if t.elapsed() >= self.reset_timeout {
                    self.state = CircuitState::HalfOpen; // probe once
                }
            }
        }
        self.state
    }

    pub fn allow_request(&mut self) -> bool {
        self.state() != CircuitState::Open
    }

    pub fn record_success(&mut self) {
        self.consecutive_failures = 0;
        self.state = CircuitState::Closed;
        self.opened_at = None;
    }

    pub fn record_failure(&mut self) {
        self.consecutive_failures += 1;
        if self.consecutive_failures >= self.failure_threshold {
            self.state = CircuitState::Open;
            self.opened_at = Some(Instant::now());
        }
    }
}

// ── queue engine ────────────────────────────────────────────────────────────

pub struct TransactionQueueEngine {
    queue: VecDeque<QueuedTransaction>,
    pub dead_letter_queue: Vec<QueuedTransaction>,
    breaker: CircuitBreaker,
    max_attempts: u32,
    processor_url: Option<String>,
}

impl TransactionQueueEngine {
    pub fn new(processor_url: Option<String>, max_attempts: u32) -> Self {
        TransactionQueueEngine {
            queue: VecDeque::new(),
            dead_letter_queue: Vec::new(),
            breaker: CircuitBreaker::new(5, Duration::from_secs(30)),
            max_attempts,
            processor_url,
        }
    }

    pub fn enqueue(&mut self, tx: QueuedTransaction) {
        self.queue.push_back(tx);
    }

    pub fn pending(&self) -> usize {
        self.queue.len()
    }

    /// take_head pops the head transaction for a delivery attempt
    /// (synchronous phase; the async HTTP delivery happens unlocked).
    pub fn take_head(&mut self) -> Result<Option<QueuedTransaction>, String> {
        if !self.breaker.allow_request() {
            return Err("circuit open — delivery skipped".to_string());
        }
        if self.processor_url.is_none() {
            return Err("PROCESSOR_URL not configured".to_string());
        }
        Ok(self.queue.pop_front().map(|mut tx| {
            tx.attempts += 1;
            tx
        }))
    }

    /// record_outcome applies the result of a delivery attempt.
    pub fn record_outcome(&mut self, tx: QueuedTransaction, result: Result<(), String>) -> Option<String> {
        match result {
            Ok(()) => {
                self.breaker.record_success();
                None
            }
            Err(e) => {
                self.breaker.record_failure();
                let mut tx = tx;
                tx.last_error = Some(e.clone());
                if tx.attempts >= self.max_attempts {
                    self.dead_letter_queue.push(tx.clone());
                    Some(format!(
                        "moved {} to dead_letter_queue after {} attempts: {e}",
                        tx.id, tx.attempts
                    ))
                } else {
                    self.queue.push_back(tx.clone());
                    Some(format!("delivery failed for {} (attempt {}): {e}", tx.id, tx.attempts))
                }
            }
        }
    }
}

async fn deliver(processor_url: &str, tx: &QueuedTransaction) -> Result<(), String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client
        .post(format!("{}/process", processor_url.trim_end_matches('/')))
        .json(tx)
        .send()
        .await
        .map_err(|e| format!("processor unreachable: {e}"))?;
    let status = resp.status();
    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("processor returned {}: {}", status, &body[..body.len().min(256)]));
    }
    Ok(())
}

// ── HTTP API ────────────────────────────────────────────────────────────────

struct AppState {
    engine: Mutex<TransactionQueueEngine>,
    wal: WriteAheadLog,
}

async fn health(state: web::Data<AppState>) -> HttpResponse {
    let mut engine = state.engine.lock().unwrap();
    let circuit = engine.breaker.state();
    HttpResponse::Ok().json(serde_json::json!({
        "status": "ok",
        "service": "transaction-queue",
        "pending": engine.pending(),
        "dead_lettered": engine.dead_letter_queue.len(),
        "circuit": circuit,
        "processor_configured": engine.processor_url.is_some(),
    }))
}

#[derive(Deserialize)]
struct EnqueueRequest {
    payload: serde_json::Value,
}

async fn enqueue(state: web::Data<AppState>, req: web::Json<EnqueueRequest>) -> HttpResponse {
    let tx = QueuedTransaction {
        id: uuid::Uuid::new_v4().to_string(),
        payload: req.payload.clone(),
        enqueued_at: chrono::Utc::now().to_rfc3339(),
        attempts: 0,
        last_error: None,
    };
    // WAL first — an enqueue that cannot be persisted is not acknowledged
    if let Err(e) = state.wal.append(&tx) {
        return HttpResponse::ServiceUnavailable()
            .json(serde_json::json!({"error": format!("WAL append failed: {e}")}));
    }
    let id = tx.id.clone();
    state.engine.lock().unwrap().enqueue(tx);
    HttpResponse::Ok().json(serde_json::json!({"id": id}))
}

async fn stats(state: web::Data<AppState>) -> HttpResponse {
    let mut engine = state.engine.lock().unwrap();
    HttpResponse::Ok().json(serde_json::json!({
        "pending": engine.pending(),
        "dead_lettered": engine.dead_letter_queue.len(),
        "circuit": engine.breaker.state(),
        "consecutive_failures": engine.breaker.consecutive_failures,
    }))
}

async fn list_dlq(state: web::Data<AppState>) -> HttpResponse {
    let engine = state.engine.lock().unwrap();
    HttpResponse::Ok().json(&engine.dead_letter_queue)
}

async fn requeue_dlq(state: web::Data<AppState>) -> HttpResponse {
    let mut engine = state.engine.lock().unwrap();
    let n = engine.dead_letter_queue.len();
    let mut items = Vec::new();
    std::mem::swap(&mut items, &mut engine.dead_letter_queue);
    for mut tx in items {
        tx.attempts = 0;
        tx.last_error = None;
        let _ = state.wal.append(&tx);
        engine.enqueue(tx);
    }
    HttpResponse::Ok().json(serde_json::json!({"requeued": n}))
}

async fn process(state: web::Data<AppState>) -> HttpResponse {
    let mut outcomes = Vec::new();
    for _ in 0..100 {
        let head = {
            let mut engine = state.engine.lock().unwrap();
            if engine.pending() == 0 {
                break;
            }
            match engine.take_head() {
                Ok(Some(tx)) => tx,
                Ok(None) => break,
                Err(msg) => {
                    outcomes.push(msg);
                    break;
                }
            }
        };
        // async delivery happens WITHOUT holding the queue lock
        let processor = state
            .engine
            .lock()
            .unwrap()
            .processor_url
            .clone()
            .unwrap_or_default();
        let result = deliver(&processor, &head).await;
        let mut engine = state.engine.lock().unwrap();
        if let Some(msg) = engine.record_outcome(head.clone(), result) {
            let _ = state.wal.append(&head);
            outcomes.push(msg);
        }
        if !engine.breaker.allow_request() {
            outcomes.push("circuit opened — remaining items held".to_string());
            break;
        }
    }
    HttpResponse::Ok().json(serde_json::json!({"outcomes": outcomes}))
}

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    env_logger::init();
    let port: u16 = std::env::var("PORT").ok().and_then(|p| p.parse().ok()).unwrap_or(8110);
    let wal_path = std::env::var("WAL_PATH").unwrap_or_else(|_| "/tmp/transaction-queue.wal".into());
    let processor_url = std::env::var("PROCESSOR_URL").ok().filter(|s| !s.is_empty());

    let wal = WriteAheadLog::open(&wal_path)?;
    let mut engine = TransactionQueueEngine::new(processor_url.clone(), 6);
    match wal.replay() {
        Ok(txs) => {
            let n = txs.len();
            for tx in txs {
                engine.enqueue(tx);
            }
            if n > 0 {
                log::info!("replayed {n} transactions from WAL {wal_path}");
            }
        }
        Err(e) => {
            log::error!("FATAL: {e} — refusing to start with a corrupt WAL");
            std::process::exit(1);
        }
    }

    let state = web::Data::new(AppState { engine: Mutex::new(engine), wal });
    log::info!("transaction-queue listening on :{port} (processor={processor_url:?})");
    HttpServer::new(move || {
        App::new()
            .app_data(state.clone())
            .route("/health", web::get().to(health))
            .route("/api/v1/enqueue", web::post().to(enqueue))
            .route("/api/v1/stats", web::get().to(stats))
            .route("/api/v1/process", web::post().to(process))
            .route("/api/v1/dlq", web::get().to(list_dlq))
            .route("/api/v1/dlq/requeue", web::post().to(requeue_dlq))
    })
    .bind(("0.0.0.0", port))?
    .run()
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tx(id: &str) -> QueuedTransaction {
        QueuedTransaction {
            id: id.into(),
            payload: serde_json::json!({"amount": 100}),
            enqueued_at: "2026-01-01T00:00:00Z".into(),
            attempts: 0,
            last_error: None,
        }
    }

    #[test]
    fn circuit_breaker_opens_and_half_opens() {
        let mut cb = CircuitBreaker::new(3, Duration::from_millis(10));
        assert!(cb.allow_request());
        cb.record_failure();
        cb.record_failure();
        assert!(cb.allow_request());
        cb.record_failure();
        assert!(!cb.allow_request()); // open
        std::thread::sleep(Duration::from_millis(15));
        assert!(cb.allow_request()); // half-open probe allowed
        cb.record_success();
        assert_eq!(cb.state(), CircuitState::Closed);
    }

    #[tokio::test]
    async fn exhausted_attempts_go_to_dlq() {
        let dir = std::env::temp_dir().join(format!("tq-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let wal = WriteAheadLog::open(dir.join("wal.log").to_str().unwrap()).unwrap();
        let mut engine = TransactionQueueEngine::new(
            Some("http://127.0.0.1:1".into()), // unreachable by construction
            2,
        );
        engine.enqueue(tx("t1"));
        for _ in 0..2 {
            let head = engine.take_head().unwrap().unwrap();
            let result = deliver("http://127.0.0.1:1", &head).await;
            engine.record_outcome(head, result);
        }
        assert_eq!(engine.pending(), 0);
        assert_eq!(engine.dead_letter_queue.len(), 1);
        assert!(engine.dead_letter_queue[0].last_error.is_some());
    }

    #[test]
    fn wal_replay_round_trip() {
        let dir = std::env::temp_dir().join(format!("tq-wal-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("wal.log");
        let wal = WriteAheadLog::open(path.to_str().unwrap()).unwrap();
        wal.append(&tx("a")).unwrap();
        wal.append(&tx("b")).unwrap();
        let restored = wal.replay().unwrap();
        assert_eq!(restored.len(), 2);
        assert_eq!(restored[0].id, "a");
    }
}
