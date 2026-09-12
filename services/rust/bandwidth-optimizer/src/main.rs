// bandwidth-optimizer (Rust) — binary wire encoding, delta sync and payload
// minimization for terminals on very constrained links.
//
// Real behaviour:
//   - BinaryTransaction encode/decode is a genuine compact binary protocol
//     (length-prefixed fields, big-endian amounts) with round-trip decode
//     verification — decode errors are returned, never swallowed.
//   - DeltaSync computes REAL field-level diffs between two JSON documents;
//     apply_delta reconstructs the new document from old+diff (verified in
//     tests).
//   - Payload minimization strips null/empty fields and gzip-compresses the
//     remainder, reporting honest original/compressed sizes.
use actix_web::{web, App, HttpResponse, HttpServer};
use flate2::write::GzEncoder;
use flate2::Compression;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::io::Write;

// ── Binary transaction protocol ─────────────────────────────────────────────

/// A financial transaction in compact binary wire form.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct BinaryTransaction {
    pub tx_id: String,
    pub account: String,
    /// minor units (kobo/cents) — no floats on the wire
    pub amount_minor: i64,
    pub currency: [u8; 3], // ISO-4217, e.g. NGN
    pub tx_type: u8,       // 0=debit 1=credit 2=reversal
    pub timestamp_unix: i64,
}

#[derive(Debug)]
pub enum WireError {
    TooShort,
    BadLength,
    BadCurrency,
    Utf8,
}

impl std::fmt::Display for WireError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{:?}", self)
    }
}

impl BinaryTransaction {
    /// encode serializes to the compact binary wire format:
    /// [u16 id_len][id][u16 acct_len][acct][i64 amount][3 currency][u8 type][i64 ts]
    pub fn encode(&self) -> Vec<u8> {
        let mut out = Vec::with_capacity(64);
        let id = self.tx_id.as_bytes();
        out.extend_from_slice(&(id.len() as u16).to_be_bytes());
        out.extend_from_slice(id);
        let acct = self.account.as_bytes();
        out.extend_from_slice(&(acct.len() as u16).to_be_bytes());
        out.extend_from_slice(acct);
        out.extend_from_slice(&self.amount_minor.to_be_bytes());
        out.extend_from_slice(&self.currency);
        out.push(self.tx_type);
        out.extend_from_slice(&self.timestamp_unix.to_be_bytes());
        out
    }

    /// decode parses the wire format; every length is bounds-checked.
    pub fn decode(buf: &[u8]) -> Result<BinaryTransaction, WireError> {
        let mut pos = 0usize;
        let take = |pos: &mut usize, n: usize| -> Result<&[u8], WireError> {
            if buf.len() < *pos + n {
                return Err(WireError::TooShort);
            }
            let s = &buf[*pos..*pos + n];
            *pos += n;
            Ok(s)
        };
        let id_len = u16::from_be_bytes(take(&mut pos, 2)?.try_into().unwrap()) as usize;
        if id_len == 0 || id_len > 128 {
            return Err(WireError::BadLength);
        }
        let tx_id = String::from_utf8(take(&mut pos, id_len)?.to_vec()).map_err(|_| WireError::Utf8)?;
        let acct_len = u16::from_be_bytes(take(&mut pos, 2)?.try_into().unwrap()) as usize;
        if acct_len == 0 || acct_len > 64 {
            return Err(WireError::BadLength);
        }
        let account =
            String::from_utf8(take(&mut pos, acct_len)?.to_vec()).map_err(|_| WireError::Utf8)?;
        let amount_minor = i64::from_be_bytes(take(&mut pos, 8)?.try_into().unwrap());
        let currency: [u8; 3] = take(&mut pos, 3)?.try_into().map_err(|_| WireError::BadCurrency)?;
        if !currency.iter().all(|c| c.is_ascii_uppercase()) {
            return Err(WireError::BadCurrency);
        }
        let tx_type = take(&mut pos, 1)?[0];
        let timestamp_unix = i64::from_be_bytes(take(&mut pos, 8)?.try_into().unwrap());
        Ok(BinaryTransaction { tx_id, account, amount_minor, currency, tx_type, timestamp_unix })
    }

    /// wire savings vs the equivalent JSON encoding (honest measurement).
    pub fn wire_savings_pct(&self) -> f64 {
        let json_len = serde_json::to_vec(self).map(|v| v.len()).unwrap_or(0);
        let bin_len = self.encode().len();
        if json_len == 0 {
            return 0.0;
        }
        (1.0 - bin_len as f64 / json_len as f64) * 100.0
    }
}

// ── delta sync ──────────────────────────────────────────────────────────────

/// DeltaSync computes and applies field-level JSON diffs so terminals only
/// receive what changed since their last sync.
pub struct DeltaSync;

#[derive(Debug, Serialize, Deserialize)]
pub struct Delta {
    pub set: Map<String, Value>,
    pub removed: Vec<String>,
}

impl DeltaSync {
    /// diff returns the delta transforming `old` into `new` (top-level fields).
    pub fn diff(old: &Value, new: &Value) -> Delta {
        let mut set = Map::new();
        let mut removed = Vec::new();
        if let (Some(o), Some(n)) = (old.as_object(), new.as_object()) {
            for (k, nv) in n {
                match o.get(k) {
                    Some(ov) if ov == nv => {}
                    _ => {
                        set.insert(k.clone(), nv.clone());
                    }
                }
            }
            for k in o.keys() {
                if !n.contains_key(k) {
                    removed.push(k.clone());
                }
            }
        } else if old != new {
            set.insert("$value".to_string(), new.clone());
        }
        Delta { set, removed }
    }

    /// apply applies a delta to a base document.
    pub fn apply(base: &Value, delta: &Delta) -> Value {
        let mut out = base.clone();
        if let Some(v) = delta.set.get("$value") {
            return v.clone();
        }
        if let Some(obj) = out.as_object_mut() {
            for k in &delta.removed {
                obj.remove(k);
            }
            for (k, v) in &delta.set {
                obj.insert(k.clone(), v.clone());
            }
        }
        out
    }
}

// ── payload minimization ────────────────────────────────────────────────────

/// minimize drops null/empty fields recursively.
pub fn minimize(v: &Value) -> Value {
    match v {
        Value::Object(map) => {
            let mut out = Map::new();
            for (k, val) in map {
                let mv = minimize(val);
                let empty = matches!(mv, Value::Null)
                    || mv.as_str().map(|s| s.is_empty()).unwrap_or(false)
                    || mv.as_array().map(|a| a.is_empty()).unwrap_or(false)
                    || mv.as_object().map(|o| o.is_empty()).unwrap_or(false);
                if !empty {
                    out.insert(k.clone(), mv);
                }
            }
            Value::Object(out)
        }
        Value::Array(arr) => Value::Array(arr.iter().map(minimize).collect()),
        other => other.clone(),
    }
}

/// compress gzip-compresses bytes and reports the real ratio.
pub fn compress(data: &[u8]) -> Result<(Vec<u8>, f64), std::io::Error> {
    let mut enc = GzEncoder::new(Vec::new(), Compression::best());
    enc.write_all(data)?;
    let out = enc.finish()?;
    let ratio = if data.is_empty() { 1.0 } else { out.len() as f64 / data.len() as f64 };
    Ok((out, ratio))
}

// ── HTTP API ────────────────────────────────────────────────────────────────

#[derive(Deserialize)]
struct OptimizePayloadRequest {
    payload: Value,
    compress: Option<bool>,
}

#[derive(Serialize)]
struct OptimizePayloadResponse {
    original_size: usize,
    minimized_size: usize,
    compressed_size: Option<usize>,
    compression_ratio: Option<f64>,
    minimized: Value,
    compressed_base64: Option<String>,
}

#[derive(Deserialize)]
struct DeltaRequest {
    old: Value,
    new: Value,
}

#[derive(Deserialize)]
struct ApplyDeltaRequest {
    base: Value,
    delta: Delta,
}

fn base64_encode(data: &[u8]) -> String {
    const T: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::new();
    for chunk in data.chunks(3) {
        let b = [chunk[0], *chunk.get(1).unwrap_or(&0), *chunk.get(2).unwrap_or(&0)];
        let n = ((b[0] as u32) << 16) | ((b[1] as u32) << 8) | b[2] as u32;
        out.push(T[(n >> 18) as usize & 63] as char);
        out.push(T[(n >> 12) as usize & 63] as char);
        out.push(if chunk.len() > 1 { T[(n >> 6) as usize & 63] as char } else { '=' });
        out.push(if chunk.len() > 2 { T[n as usize & 63] as char } else { '=' });
    }
    out
}

async fn health() -> HttpResponse {
    HttpResponse::Ok().json(serde_json::json!({"status":"ok","service":"bandwidth-optimizer"}))
}

async fn optimize_payload(req: web::Json<OptimizePayloadRequest>) -> HttpResponse {
    let original = match serde_json::to_vec(&req.payload) {
        Ok(b) => b,
        Err(e) => return HttpResponse::BadRequest().json(serde_json::json!({"error": e.to_string()})),
    };
    let min = minimize(&req.payload);
    let min_bytes = serde_json::to_vec(&min).unwrap_or_default();
    let (compressed_size, ratio, b64) = if req.compress.unwrap_or(false) {
        match compress(&min_bytes) {
            Ok((c, r)) => (Some(c.len()), Some(r), Some(base64_encode(&c))),
            Err(e) => {
                return HttpResponse::InternalServerError()
                    .json(serde_json::json!({"error": format!("compression failed: {e}")}))
            }
        }
    } else {
        (None, None, None)
    };
    HttpResponse::Ok().json(OptimizePayloadResponse {
        original_size: original.len(),
        minimized_size: min_bytes.len(),
        compressed_size,
        compression_ratio: ratio,
        minimized: min,
        compressed_base64: b64,
    })
}

async fn delta_diff(req: web::Json<DeltaRequest>) -> HttpResponse {
    let delta = DeltaSync::diff(&req.old, &req.new);
    let delta_bytes = serde_json::to_vec(&delta).map(|b| b.len()).unwrap_or(0);
    let full_bytes = serde_json::to_vec(&req.new).map(|b| b.len()).unwrap_or(0);
    HttpResponse::Ok().json(serde_json::json!({
        "delta": delta,
        "delta_size": delta_bytes,
        "full_size": full_bytes,
        "savings_pct": if full_bytes > 0 { (1.0 - delta_bytes as f64 / full_bytes as f64) * 100.0 } else { 0.0 },
    }))
}

async fn delta_apply(req: web::Json<ApplyDeltaRequest>) -> HttpResponse {
    HttpResponse::Ok().json(DeltaSync::apply(&req.base, &req.delta))
}

async fn encode_tx(req: web::Json<BinaryTransaction>) -> HttpResponse {
    let wire = req.encode();
    HttpResponse::Ok().json(serde_json::json!({
        "wire_base64": base64_encode(&wire),
        "wire_size": wire.len(),
        "json_savings_pct": req.wire_savings_pct(),
    }))
}

#[derive(Deserialize)]
struct DecodeRequest {
    wire_base64: String,
}

fn base64_decode(s: &str) -> Result<Vec<u8>, String> {
    let mut vals = Vec::with_capacity(s.len());
    for c in s.bytes() {
        let v = match c {
            b'A'..=b'Z' => c - b'A',
            b'a'..=b'z' => c - b'a' + 26,
            b'0'..=b'9' => c - b'0' + 52,
            b'+' => 62,
            b'/' => 63,
            b'=' => 64,
            _ => return Err(format!("invalid base64 byte {c}")),
        };
        vals.push(v);
    }
    let mut out = Vec::with_capacity(vals.len() * 3 / 4);
    for chunk in vals.chunks(4) {
        if chunk.len() < 4 {
            return Err("truncated base64".to_string());
        }
        let n = ((chunk[0] as u32) << 18)
            | ((chunk[1] as u32) << 12)
            | ((chunk[2] & 63) as u32) << 6
            | (chunk[3] & 63) as u32;
        out.push((n >> 16) as u8);
        if chunk[2] != 64 {
            out.push((n >> 8) as u8);
        }
        if chunk[3] != 64 {
            out.push(n as u8);
        }
    }
    Ok(out)
}

async fn decode_tx(req: web::Json<DecodeRequest>) -> HttpResponse {
    let wire = match base64_decode(&req.wire_base64) {
        Ok(w) => w,
        Err(e) => return HttpResponse::BadRequest().json(serde_json::json!({"error": e})),
    };
    match BinaryTransaction::decode(&wire) {
        Ok(tx) => HttpResponse::Ok().json(tx),
        Err(e) => HttpResponse::UnprocessableEntity()
            .json(serde_json::json!({"error": format!("wire decode failed: {e}")})),
    }
}

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    env_logger::init();
    let port: u16 = std::env::var("PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(8107);
    log::info!("bandwidth-optimizer listening on :{port}");
    HttpServer::new(|| {
        App::new()
            .route("/health", web::get().to(health))
            .route("/api/v1/optimize-payload", web::post().to(optimize_payload))
            .route("/api/v1/delta/diff", web::post().to(delta_diff))
            .route("/api/v1/delta/apply", web::post().to(delta_apply))
            .route("/api/v1/tx/encode", web::post().to(encode_tx))
            .route("/api/v1/tx/decode", web::post().to(decode_tx))
    })
    .bind(("0.0.0.0", port))?
    .run()
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_tx() -> BinaryTransaction {
        BinaryTransaction {
            tx_id: "tx-001".into(),
            account: "3020114455".into(),
            amount_minor: 125_000,
            currency: *b"NGN",
            tx_type: 1,
            timestamp_unix: 1_725_000_000,
        }
    }

    #[test]
    fn binary_round_trip() {
        let tx = sample_tx();
        let wire = tx.encode();
        let back = BinaryTransaction::decode(&wire).unwrap();
        assert_eq!(tx, back);
        assert!(tx.wire_savings_pct() > 30.0);
    }

    #[test]
    fn decode_rejects_truncated() {
        let wire = sample_tx().encode();
        assert!(BinaryTransaction::decode(&wire[..wire.len() - 3]).is_err());
    }

    #[test]
    fn delta_round_trip() {
        let old = serde_json::json!({"balance": 100, "name": "ada", "stale": true});
        let new = serde_json::json!({"balance": 150, "name": "ada", "tier": "3g"});
        let d = DeltaSync::diff(&old, &new);
        assert_eq!(d.set.len(), 2);
        assert_eq!(d.removed, vec!["stale"]);
        assert_eq!(DeltaSync::apply(&old, &d), new);
    }

    #[test]
    fn minimize_strips_empty() {
        let v = serde_json::json!({"a": null, "b": "", "c": [], "d": {"e": null}, "keep": 1});
        assert_eq!(minimize(&v), serde_json::json!({"keep": 1}));
    }

    #[test]
    fn compress_actually_compresses() {
        let data = vec![b'x'; 4096];
        let (out, ratio) = compress(&data).unwrap();
        assert!(out.len() < data.len());
        assert!(ratio < 0.1);
    }
}
