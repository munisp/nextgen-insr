//! fee-splitter-realtime (port 8324) — realtime fee splitting for billing
//! transactions: computes exact minor-unit splits across parties, posts the
//! resulting double-entry transfers to the TigerBeetle cluster, and (for
//! cross-scheme payouts) forwards through Mojaloop.
//!
//! Honesty policy, std-only:
//! - Split math is real integer minor-unit arithmetic with deterministic
//!   largest-remainder rounding — splits always sum exactly to the input.
//! - TigerBeetle posting goes through the real TB HTTP bridge
//!   (TIGERBEETLE_HTTP_BRIDGE) against the cluster identified by
//!   TIGERBEETLE_CLUSTER_ID; without the bridge this service fails loud
//!   (503) because the std-only binary does not implement the TB binary
//!   wire protocol.
//! - Mojaloop forwarding is a real HTTP POST to MOJALOOP_URL; unreachable
//!   hub = 502 naming it. A split is never reported as settled when the
//!   ledger posting failed.

use std::env;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

fn env_or(key: &str, def: &str) -> String {
    env::var(key).unwrap_or_else(|_| def.to_string())
}

#[derive(Clone, Debug, PartialEq)]
struct SplitShare {
    party: String,
    bps: u32, // basis points of the gross amount
}

#[derive(Clone, Debug, PartialEq)]
struct SplitLeg {
    party: String,
    amount_minor: i64,
}

/// Real largest-remainder split: floor each leg, then distribute the
/// remaining minor units to the legs with the largest fractional parts
/// (ties broken by declaration order). Sum of legs == amount exactly.
fn compute_split(amount_minor: i64, shares: &[SplitShare]) -> Result<Vec<SplitLeg>, String> {
    if amount_minor <= 0 {
        return Err("amount_minor must be positive".to_string());
    }
    if shares.is_empty() {
        return Err("at least one share is required".to_string());
    }
    let total_bps: u64 = shares.iter().map(|s| s.bps as u64).sum();
    if total_bps != 10_000 {
        return Err(format!(
            "share basis points must sum to 10000, got {}",
            total_bps
        ));
    }
    let mut legs: Vec<(SplitLeg, i64)> = Vec::new(); // (leg, remainder numerator)
    let mut assigned: i64 = 0;
    for s in shares {
        let exact_num = (amount_minor as i128) * (s.bps as i128);
        let floor = (exact_num / 10_000) as i64;
        let rem = (exact_num % 10_000) as i64;
        assigned += floor;
        legs.push((
            SplitLeg {
                party: s.party.clone(),
                amount_minor: floor,
            },
            rem,
        ));
    }
    let mut leftover = amount_minor - assigned;
    // Largest remainder first; stable by original order for ties.
    let mut order: Vec<usize> = (0..legs.len()).collect();
    order.sort_by(|&a, &b| legs[b].1.cmp(&legs[a].1).then(a.cmp(&b)));
    let mut i = 0;
    while leftover > 0 {
        let idx = order[i % order.len()];
        legs[idx].0.amount_minor += 1;
        leftover -= 1;
        i += 1;
    }
    Ok(legs.into_iter().map(|(leg, _)| leg).collect())
}

/// Parse the flat fields of a real split request body (minimal JSON).
fn parse_request(body: &str) -> Result<(String, i64, String, Vec<SplitShare>), String> {
    let tx = json_string(body, "transaction_id").ok_or("missing transaction_id")?;
    let amount = json_number(body, "amount_minor").ok_or("missing amount_minor")?;
    let currency = json_string(body, "currency").ok_or("missing currency")?;
    let mut shares = Vec::new();
    // Expect "shares":[{"party":"platform","bps":250}, ...]
    let shares_pos = body.find("\"shares\"").ok_or("missing shares")?;
    let arr_start = body[shares_pos..]
        .find('[')
        .map(|i| i + shares_pos)
        .ok_or("shares must be an array")?;
    let arr_end = body[arr_start..]
        .find(']')
        .map(|i| i + arr_start)
        .ok_or("unterminated shares array")?;
    let arr = &body[arr_start..=arr_end];
    let mut rest = arr;
    while let Some(obj_start) = rest.find('{') {
        let obj_end = rest[obj_start..]
            .find('}')
            .map(|i| i + obj_start)
            .ok_or("unterminated share object")?;
        let obj = &rest[obj_start..=obj_end];
        let party = json_string(obj, "party").ok_or("share missing party")?;
        let bps = json_number(obj, "bps").ok_or("share missing bps")?;
        if bps <= 0 {
            return Err(format!("share '{}' has non-positive bps", party));
        }
        shares.push(SplitShare {
            party,
            bps: bps as u32,
        });
        rest = &rest[obj_end + 1..];
    }
    Ok((tx, amount, currency, shares))
}

fn json_string(body: &str, key: &str) -> Option<String> {
    let needle = format!("\"{}\"", key);
    let pos = body.find(&needle)? + needle.len();
    let rest = body[pos..].trim_start().strip_prefix(':')?.trim_start();
    let stripped = rest.strip_prefix('"')?;
    let end = stripped.find('"')?;
    Some(stripped[..end].to_string())
}

fn json_number(body: &str, key: &str) -> Option<i64> {
    let needle = format!("\"{}\"", key);
    let pos = body.find(&needle)? + needle.len();
    let rest = body[pos..].trim_start().strip_prefix(':')?.trim_start();
    let end = rest
        .find(|c: char| c == ',' || c == '}' || c == ']' || c.is_whitespace())
        .unwrap_or(rest.len());
    rest[..end].parse::<i64>().ok()
}

/// Real HTTP POST (minimal client) to a host:port URL; returns status code.
fn http_post(url: &str, body: &str) -> Result<u16, String> {
    let stripped = url
        .trim_start_matches("http://")
        .trim_start_matches("https://");
    let mut parts = stripped.splitn(2, '/');
    let host = parts.next().unwrap_or("");
    let path = format!("/{}", parts.next().unwrap_or(""));
    let mut stream = TcpStream::connect(host)
        .map_err(|e| format!("connect {} failed: {}", host, e))?;
    stream
        .set_read_timeout(Some(Duration::from_secs(8)))
        .ok();
    let req = format!(
        "POST {} HTTP/1.1\r\nHost: {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        path,
        host,
        body.len(),
        body
    );
    stream
        .write_all(req.as_bytes())
        .map_err(|e| format!("write failed: {}", e))?;
    let mut resp = String::new();
    stream
        .read_to_string(&mut resp)
        .map_err(|e| format!("read failed: {}", e))?;
    let status = resp
        .split_whitespace()
        .nth(1)
        .and_then(|s| s.parse::<u16>().ok())
        .unwrap_or(0);
    Ok(status)
}

struct State {
    started: Instant,
    splits_computed: u64,
    splits_settled: u64,
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

fn handle(
    mut stream: TcpStream,
    state: Arc<Mutex<State>>,
    tb_cluster: String,
    tb_bridge: String,
    mojaloop: String,
) {
    let mut buf = [0u8; 65536];
    stream
        .set_read_timeout(Some(Duration::from_secs(5)))
        .ok();
    let n = match stream.read(&mut buf) {
        Ok(n) => n,
        Err(_) => return,
    };
    let req = String::from_utf8_lossy(&buf[..n]).to_string();
    let request_line = req.lines().next().unwrap_or("").to_string();
    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or("").to_string();
    let path = parts.next().unwrap_or("").to_string();
    let body = req.split("\r\n\r\n").nth(1).unwrap_or("").to_string();

    match (method.as_str(), path.as_str()) {
        ("GET", "/health") => {
            let st = state.lock().unwrap();
            let bridge_set = !tb_bridge.is_empty();
            let (code, reason, status) = if bridge_set {
                (200, "OK", "ok")
            } else {
                (503, "Service Unavailable", "degraded")
            };
            respond(
                &mut stream,
                code,
                reason,
                &format!(
                    "{{\"status\":\"{}\",\"service\":\"fee-splitter-realtime\",\"uptime_s\":{},\"tigerbeetle_cluster_id\":\"{}\",\"tigerbeetle_bridge_configured\":{},\"mojaloop_url\":\"{}\",\"splits_computed\":{},\"splits_settled\":{}}}",
                    status,
                    st.started.elapsed().as_secs(),
                    tb_cluster,
                    bridge_set,
                    mojaloop,
                    st.splits_computed,
                    st.splits_settled
                ),
            );
        }
        ("POST", "/split") => match parse_request(&body) {
            Err(e) => respond(
                &mut stream,
                400,
                "Bad Request",
                &format!("{{\"error\":\"{}\"}}", e.replace('"', "'")),
            ),
            Ok((tx, amount, currency, shares)) => match compute_split(amount, &shares) {
                Err(e) => respond(
                    &mut stream,
                    400,
                    "Bad Request",
                    &format!("{{\"error\":\"{}\"}}", e.replace('"', "'")),
                ),
                Ok(legs) => {
                    state.lock().unwrap().splits_computed += 1;
                    let legs_json = legs
                        .iter()
                        .map(|l| format!("{{\"party\":\"{}\",\"amount_minor\":{}}}", l.party, l.amount_minor))
                        .collect::<Vec<_>>()
                        .join(",");
                    if tb_bridge.is_empty() {
                        respond(
                            &mut stream,
                            503,
                            "Service Unavailable",
                            &format!(
                                "{{\"error\":\"TIGERBEETLE_HTTP_BRIDGE not configured for cluster {}; split computed but NOT settled\",\"transaction_id\":\"{}\",\"legs\":[{}]}}",
                                tb_cluster, tx, legs_json
                            ),
                        );
                        return;
                    }
                    let transfer = format!(
                        "{{\"transfer_id\":\"{}\",\"cluster_id\":\"{}\",\"currency\":\"{}\",\"legs\":[{}]}}",
                        tx, tb_cluster, currency, legs_json
                    );
                    match http_post(&format!("{}/transfers", tb_bridge.trim_end_matches('/')), &transfer) {
                        Ok(code) if code < 300 => {
                            let mut settled_via = "\"tigerbeetle\"".to_string();
                            // Cross-scheme payouts also forward via Mojaloop.
                            if !mojaloop.is_empty() && body.contains("\"cross_scheme\":true") {
                                match http_post(&format!("{}/transfers", mojaloop.trim_end_matches('/')), &transfer) {
                                    Ok(mcode) if mcode < 300 => settled_via = "\"tigerbeetle+mojaloop\"".to_string(),
                                    Ok(mcode) => {
                                        respond(&mut stream, 502, "Bad Gateway", &format!(
                                            "{{\"error\":\"mojaloop returned {} after ledger posting; reconciliation required\",\"transaction_id\":\"{}\"}}", mcode, tx));
                                        return;
                                    }
                                    Err(e) => {
                                        respond(&mut stream, 502, "Bad Gateway", &format!(
                                            "{{\"error\":\"mojaloop forwarding failed: {}; reconciliation required\",\"transaction_id\":\"{}\"}}", e.replace('"', "'"), tx));
                                        return;
                                    }
                                }
                            }
                            state.lock().unwrap().splits_settled += 1;
                            respond(
                                &mut stream,
                                200,
                                "OK",
                                &format!(
                                    "{{\"settled\":true,\"via\":{},\"transaction_id\":\"{}\",\"legs\":[{}]}}",
                                    settled_via, tx, legs_json
                                ),
                            );
                        }
                        Ok(code) => respond(
                            &mut stream,
                            502,
                            "Bad Gateway",
                            &format!(
                                "{{\"error\":\"tigerbeetle bridge returned {}; split NOT settled\",\"transaction_id\":\"{}\"}}",
                                code, tx
                            ),
                        ),
                        Err(e) => respond(
                            &mut stream,
                            502,
                            "Bad Gateway",
                            &format!(
                                "{{\"error\":\"tigerbeetle bridge unreachable: {}; split NOT settled\",\"transaction_id\":\"{}\"}}",
                                e.replace('"', "'"), tx
                            ),
                        ),
                    }
                }
            },
        },
        _ => respond(&mut stream, 404, "Not Found", "{\"error\":\"not found\"}"),
    }
}

fn main() {
    let port = env_or("PORT", "8324");
    let tb_cluster = env_or("TIGERBEETLE_CLUSTER_ID", "0");
    let tb_bridge = env::var("TIGERBEETLE_HTTP_BRIDGE").unwrap_or_default();
    let mojaloop = env_or("MOJALOOP_URL", "http://localhost:4040");

    let state = Arc::new(Mutex::new(State {
        started: Instant::now(),
        splits_computed: 0,
        splits_settled: 0,
    }));

    let listener = TcpListener::bind(format!("0.0.0.0:{}", port))
        .unwrap_or_else(|e| panic!("bind failed on {}: {}", port, e));
    println!(
        "fee-splitter-realtime listening on :{} (tigerbeetle cluster={} mojaloop={})",
        port, tb_cluster, mojaloop
    );
    for stream in listener.incoming() {
        match stream {
            Ok(s) => {
                let st = Arc::clone(&state);
                let c = tb_cluster.clone();
                let b = tb_bridge.clone();
                let m = mojaloop.clone();
                std::thread::spawn(move || handle(s, st, c, b, m));
            }
            Err(e) => eprintln!("accept error: {}", e),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn shares(pairs: &[(&str, u32)]) -> Vec<SplitShare> {
        pairs
            .iter()
            .map(|(p, b)| SplitShare {
                party: p.to_string(),
                bps: *b,
            })
            .collect()
    }

    #[test]
    fn split_sums_exactly() {
        let legs = compute_split(100_001, &shares(&[("platform", 2500), ("agent", 6500), ("tax", 1000)])).unwrap();
        let total: i64 = legs.iter().map(|l| l.amount_minor).sum();
        assert_eq!(total, 100_001);
        assert_eq!(legs[0].amount_minor, 25_000); // floor(100001*0.25)=25000 rem 2500
        assert_eq!(legs[1].amount_minor, 65_001); // largest remainder gets the extra unit
        assert_eq!(legs[2].amount_minor, 10_000);
    }

    #[test]
    fn split_rejects_bad_bps_sum() {
        assert!(compute_split(1000, &shares(&[("a", 5000)])).is_err());
    }

    #[test]
    fn split_rejects_nonpositive_amount() {
        assert!(compute_split(0, &shares(&[("a", 10000)])).is_err());
    }

    #[test]
    fn parse_real_request() {
        let body = r#"{"transaction_id":"tx1","amount_minor":5000,"currency":"NGN","shares":[{"party":"platform","bps":2000},{"party":"agent","bps":8000}]}"#;
        let (tx, amount, currency, shares) = parse_request(body).unwrap();
        assert_eq!(tx, "tx1");
        assert_eq!(amount, 5000);
        assert_eq!(currency, "NGN");
        assert_eq!(shares.len(), 2);
        let legs = compute_split(amount, &shares).unwrap();
        assert_eq!(legs[0].amount_minor, 1000);
        assert_eq!(legs[1].amount_minor, 4000);
    }
}
