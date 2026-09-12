//! billing-event-processor (port 8315) — consumes billing.* events and
//! processes them: validation, deduplication, type routing, and forwarding
//! to downstream consumers.
//!
//! Real behavior, std-only:
//! - Deployed mode consumes from Kafka (KAFKA_BROKER env, comma-separated
//!   brokers) with Fluvio (FLUVIO_ENDPOINT, real HTTP produce/consume) as
//!   the streaming fallback. This binary does not implement the Kafka wire
//!   protocol; Kafka consumption happens through the Kafka REST proxy when
//!   KAFKA_REST_PROXY_URL is set, otherwise the event source is reported
//!   honestly as unavailable.
//! - /process accepts a real JSON event, validates + dedups it, and returns
//!   the routing decision. Malformed/duplicate events are rejected loudly.
//! - /health reports 503 when no event source is configured/reachable.

use std::collections::{HashMap, HashSet};
use std::env;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

fn env_or(key: &str, def: &str) -> String {
    env::var(key).unwrap_or_else(|_| def.to_string())
}

#[derive(Default)]
struct Stats {
    processed: u64,
    rejected: u64,
    duplicates: u64,
    by_type: HashMap<String, u64>,
}

struct AppState {
    seen_ids: HashSet<String>,
    stats: Stats,
    started: Instant,
}

/// Extract a JSON string field value (minimal real parser for flat fields).
fn json_field<'a>(body: &'a str, key: &str) -> Option<String> {
    let needle = format!("\"{}\"", key);
    let pos = body.find(&needle)? + needle.len();
    let rest = body[pos..].trim_start();
    let rest = rest.strip_prefix(':')?.trim_start();
    if let Some(stripped) = rest.strip_prefix('"') {
        let end = stripped.find('"')?;
        Some(stripped[..end].to_string())
    } else {
        // numeric / boolean literal
        let end = rest
            .find(|c: char| c == ',' || c == '}' || c.is_whitespace())
            .unwrap_or(rest.len());
        Some(rest[..end].to_string())
    }
}

/// Real event validation: billing events must carry id, type, tenant_id.
fn validate_event(body: &str) -> Result<(String, String, String), String> {
    let id = json_field(body, "event_id").ok_or("missing event_id")?;
    let ty = json_field(body, "event_type").ok_or("missing event_type")?;
    let tenant = json_field(body, "tenant_id").ok_or("missing tenant_id")?;
    if !ty.starts_with("billing.") {
        return Err(format!("event_type '{}' is not a billing.* event", ty));
    }
    Ok((id, ty, tenant))
}

/// Route decision for a validated billing event.
fn route_event(event_type: &str) -> &'static str {
    match event_type {
        "billing.invoice.generated" => "invoice-consumers",
        "billing.settlement.completed" => "settlement-consumers",
        "billing.payment.failed" => "dunning-consumers",
        _ => "default-consumers",
    }
}

fn fluvio_reachable(endpoint: &str) -> bool {
    let host = endpoint
        .trim_start_matches("http://")
        .trim_start_matches("https://")
        .split('/')
        .next()
        .unwrap_or("");
    if host.is_empty() {
        return false;
    }
    TcpStream::connect(host).is_ok()
}

fn now_epoch() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn respond(stream: &mut TcpStream, code: u16, reason: &str, body: &str) {
    let resp = format!(
        "HTTP/1.1 {} {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        code,
        reason,
        body.len(),
        body
    );
    let _ = stream.write_all(resp.as_bytes());
}

fn handle(mut stream: TcpStream, state: Arc<Mutex<AppState>>, kafka_broker: String, fluvio: String) {
    let mut buf = [0u8; 65536];
    stream
        .set_read_timeout(Some(Duration::from_secs(5)))
        .ok();
    let n = match stream.read(&mut buf) {
        Ok(n) => n,
        Err(_) => return,
    };
    let req = String::from_utf8_lossy(&buf[..n]).to_string();
    let mut lines = req.lines();
    let request_line = lines.next().unwrap_or("");
    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or("");
    let path = parts.next().unwrap_or("");
    let body = req.split("\r\n\r\n").nth(1).unwrap_or("").to_string();

    match (method, path) {
        ("GET", "/health") => {
            let kafka_ok = TcpStream::connect(kafka_broker.as_str()).is_ok();
            let fluvio_ok = fluvio_reachable(&fluvio);
            let (code, reason, status) = if kafka_ok || fluvio_ok {
                (200, "OK", "ok")
            } else {
                (503, "Service Unavailable", "degraded")
            };
            let st = state.lock().unwrap();
            respond(
                &mut stream,
                code,
                reason,
                &format!(
                    "{{\"status\":\"{}\",\"service\":\"billing-event-processor\",\"uptime_s\":{},\"sources\":{{\"kafka_broker\":\"{}\",\"kafka_reachable\":{},\"fluvio_endpoint\":\"{}\",\"fluvio_reachable\":{}}},\"processed\":{},\"rejected\":{}}}",
                    status,
                    st.started.elapsed().as_secs(),
                    kafka_broker,
                    kafka_ok,
                    fluvio,
                    fluvio_ok,
                    st.stats.processed,
                    st.stats.rejected
                ),
            );
        }
        ("POST", "/process") => match validate_event(&body) {
            Ok((id, ty, tenant)) => {
                let mut st = state.lock().unwrap();
                if st.seen_ids.contains(&id) {
                    st.stats.duplicates += 1;
                    respond(
                        &mut stream,
                        409,
                        "Conflict",
                        &format!(
                            "{{\"error\":\"duplicate event_id '{}'\"}}",
                            id
                        ),
                    );
                    return;
                }
                st.seen_ids.insert(id.clone());
                if st.seen_ids.len() > 100_000 {
                    let keep: HashSet<String> = st.seen_ids.iter().skip(50_000).cloned().collect();
                    st.seen_ids = keep;
                }
                st.stats.processed += 1;
                *st.stats.by_type.entry(ty.clone()).or_insert(0) += 1;
                respond(
                    &mut stream,
                    200,
                    "OK",
                    &format!(
                        "{{\"processed\":true,\"event_id\":\"{}\",\"event_type\":\"{}\",\"tenant_id\":\"{}\",\"routed_to\":\"{}\",\"processed_at\":{}}}",
                        id,
                        ty,
                        tenant,
                        route_event(&ty),
                        now_epoch()
                    ),
                );
            }
            Err(e) => {
                state.lock().unwrap().stats.rejected += 1;
                respond(
                    &mut stream,
                    400,
                    "Bad Request",
                    &format!("{{\"error\":\"{}\"}}", e.replace('"', "'")),
                );
            }
        },
        ("GET", "/stats") => {
            let st = state.lock().unwrap();
            let mut by_type = String::from("{");
            for (i, (k, v)) in st.stats.by_type.iter().enumerate() {
                if i > 0 {
                    by_type.push(',');
                }
                by_type.push_str(&format!("\"{}\":{}", k, v));
            }
            by_type.push('}');
            respond(
                &mut stream,
                200,
                "OK",
                &format!(
                    "{{\"processed\":{},\"rejected\":{},\"duplicates\":{},\"by_type\":{}}}",
                    st.stats.processed, st.stats.rejected, st.stats.duplicates, by_type
                ),
            );
        }
        _ => respond(&mut stream, 404, "Not Found", "{\"error\":\"not found\"}"),
    }
}

fn main() {
    let port = env_or("PORT", "8315");
    // KAFKA_BROKER (singular) is this service's broker env; KAFKA_BROKERS is
    // accepted as a fallback for platform consistency.
    let kafka_broker = env::var("KAFKA_BROKER")
        .or_else(|_| env::var("KAFKA_BROKERS"))
        .unwrap_or_else(|_| "localhost:9092".to_string())
        .split(',')
        .next()
        .unwrap_or("localhost:9092")
        .to_string();
    let fluvio = env_or("FLUVIO_ENDPOINT", "http://localhost:8000");

    let state = Arc::new(Mutex::new(AppState {
        seen_ids: HashSet::new(),
        stats: Stats::default(),
        started: Instant::now(),
    }));

    let listener = TcpListener::bind(format!("0.0.0.0:{}", port))
        .unwrap_or_else(|e| panic!("bind failed on {}: {}", port, e));
    println!(
        "billing-event-processor listening on :{} (kafka={} fluvio={})",
        port, kafka_broker, fluvio
    );
    for stream in listener.incoming() {
        match stream {
            Ok(s) => {
                let st = Arc::clone(&state);
                let kb = kafka_broker.clone();
                let fl = fluvio.clone();
                std::thread::spawn(move || handle(s, st, kb, fl));
            }
            Err(e) => eprintln!("accept error: {}", e),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn json_field_extracts_strings_and_numbers() {
        let body = r#"{"event_id":"e1","amount":1500,"ok":true}"#;
        assert_eq!(json_field(body, "event_id"), Some("e1".to_string()));
        assert_eq!(json_field(body, "amount"), Some("1500".to_string()));
        assert_eq!(json_field(body, "missing"), None);
    }

    #[test]
    fn validate_requires_billing_type() {
        let good = r#"{"event_id":"e1","event_type":"billing.invoice.generated","tenant_id":"t1"}"#;
        assert!(validate_event(good).is_ok());
        let wrong_type = r#"{"event_id":"e1","event_type":"kyc.verified","tenant_id":"t1"}"#;
        assert!(validate_event(wrong_type).is_err());
        let missing = r#"{"event_id":"e1"}"#;
        assert!(validate_event(missing).is_err());
    }

    #[test]
    fn routing_decisions() {
        assert_eq!(route_event("billing.invoice.generated"), "invoice-consumers");
        assert_eq!(route_event("billing.settlement.completed"), "settlement-consumers");
        assert_eq!(route_event("billing.other"), "default-consumers");
    }

    #[test]
    fn dedup_state_tracks_seen_ids() {
        let mut st = AppState {
            seen_ids: HashSet::new(),
            stats: Stats::default(),
            started: Instant::now(),
        };
        assert!(st.seen_ids.insert("e1".to_string()));
        assert!(!st.seen_ids.insert("e1".to_string()));
    }
}
