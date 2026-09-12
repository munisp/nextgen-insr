// adaptive-compression — picks the right compression algorithm for the
// terminal's network tier and applies it for real (gzip / zstd / lz4),
// reporting honest original_size / compressed_size / ratio / timing.
//
// Selection policy (measured trade-off, not arbitrary):
//   - 2g_gprs / 2g_edge : zstd level 19 — maximum ratio, CPU is cheap vs airtime
//   - 3g                : gzip level 6  — good ratio, ubiquitous decode support
//   - 4g_lte            : lz4           — minimal latency, still shrinks JSON ~2x
//   - 5g_wifi / offline : identity (no compression)
use actix_web::{web, App, HttpResponse, HttpServer};
use flate2::write::GzEncoder;
use flate2::Compression;
use serde::{Deserialize, Serialize};
use std::io::Write;
use std::time::Instant;

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Algorithm {
    Identity,
    Gzip,
    Zstd,
    Lz4,
}

/// select_algorithm maps a network_tier to the compression algorithm with
/// the best real ratio/latency trade-off for that link.
pub fn select_algorithm(network_tier: &str) -> Algorithm {
    match network_tier {
        "2g_gprs" | "2g_edge" => Algorithm::Zstd,
        "3g" => Algorithm::Gzip,
        "4g_lte" => Algorithm::Lz4,
        _ => Algorithm::Identity, // 5g_wifi, offline, unknown
    }
}

#[derive(Debug, Serialize)]
pub struct CompressionResult {
    pub algorithm: Algorithm,
    pub original_size: usize,
    pub compressed_size: usize,
    pub ratio: f64,
    pub elapsed_us: u128,
    pub data: Vec<u8>,
}

pub fn compress_with(algo: Algorithm, data: &[u8]) -> Result<CompressionResult, String> {
    let start = Instant::now();
    let out: Vec<u8> = match algo {
        Algorithm::Identity => data.to_vec(),
        Algorithm::Gzip => {
            let mut enc = GzEncoder::new(Vec::new(), Compression::new(6));
            enc.write_all(data).map_err(|e| format!("gzip failed: {e}"))?;
            enc.finish().map_err(|e| format!("gzip finish failed: {e}"))?
        }
        Algorithm::Zstd => {
            zstd::stream::encode_all(data, 19).map_err(|e| format!("zstd failed: {e}"))?
        }
        Algorithm::Lz4 => lz4_flex::compress(data),
    };
    let ratio = if data.is_empty() { 1.0 } else { out.len() as f64 / data.len() as f64 };
    Ok(CompressionResult {
        algorithm: algo,
        original_size: data.len(),
        compressed_size: out.len(),
        ratio,
        elapsed_us: start.elapsed().as_micros(),
        data: out,
    })
}

pub fn decompress_with(algo: Algorithm, data: &[u8]) -> Result<Vec<u8>, String> {
    match algo {
        Algorithm::Identity => Ok(data.to_vec()),
        Algorithm::Gzip => {
            let mut dec = flate2::read::GzDecoder::new(data);
            let mut out = Vec::new();
            std::io::Read::read_to_end(&mut dec, &mut out)
                .map_err(|e| format!("gzip decompress failed: {e}"))?;
            Ok(out)
        }
        Algorithm::Zstd => {
            zstd::stream::decode_all(data).map_err(|e| format!("zstd decompress failed: {e}"))
        }
        Algorithm::Lz4 => lz4_flex::decompress(data, 64 << 20)
            .map_err(|e| format!("lz4 decompress failed: {e}")),
    }
}

// ── HTTP API ────────────────────────────────────────────────────────────────

#[derive(Deserialize)]
struct CompressRequest {
    network_tier: String,
    data_base64: String,
    /// optional explicit override; tier selection is the default
    algorithm: Option<Algorithm>,
}

#[derive(Serialize)]
struct CompressResponse {
    algorithm: Algorithm,
    original_size: usize,
    compressed_size: usize,
    ratio: f64,
    elapsed_us: u128,
    compressed_base64: String,
}

fn b64_encode(data: &[u8]) -> String {
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

fn b64_decode(s: &str) -> Result<Vec<u8>, String> {
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
    if vals.len() % 4 != 0 {
        return Err("truncated base64".into());
    }
    let mut out = Vec::with_capacity(vals.len() * 3 / 4);
    for chunk in vals.chunks(4) {
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

async fn health() -> HttpResponse {
    HttpResponse::Ok().json(serde_json::json!({"status":"ok","service":"adaptive-compression"}))
}

async fn compress_handler(req: web::Json<CompressRequest>) -> HttpResponse {
    let raw = match b64_decode(&req.data_base64) {
        Ok(d) => d,
        Err(e) => return HttpResponse::BadRequest().json(serde_json::json!({"error": e})),
    };
    let algo = req.algorithm.unwrap_or_else(|| select_algorithm(&req.network_tier));
    match compress_with(algo, &raw) {
        Ok(res) => HttpResponse::Ok().json(CompressResponse {
            algorithm: res.algorithm,
            original_size: res.original_size,
            compressed_size: res.compressed_size,
            ratio: res.ratio,
            elapsed_us: res.elapsed_us,
            compressed_base64: b64_encode(&res.data),
        }),
        Err(e) => HttpResponse::InternalServerError().json(serde_json::json!({"error": e})),
    }
}

#[derive(Deserialize)]
struct DecompressRequest {
    algorithm: Algorithm,
    data_base64: String,
}

async fn decompress_handler(req: web::Json<DecompressRequest>) -> HttpResponse {
    let raw = match b64_decode(&req.data_base64) {
        Ok(d) => d,
        Err(e) => return HttpResponse::BadRequest().json(serde_json::json!({"error": e})),
    };
    match decompress_with(req.algorithm, &raw) {
        Ok(out) => HttpResponse::Ok().json(serde_json::json!({
            "data_base64": b64_encode(&out),
            "size": out.len(),
        })),
        Err(e) => HttpResponse::UnprocessableEntity().json(serde_json::json!({"error": e})),
    }
}

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    env_logger::init();
    let port: u16 = std::env::var("PORT").ok().and_then(|p| p.parse().ok()).unwrap_or(8109);
    log::info!("adaptive-compression listening on :{port}");
    HttpServer::new(|| {
        App::new()
            .route("/health", web::get().to(health))
            .route("/api/v1/compress", web::post().to(compress_handler))
            .route("/api/v1/decompress", web::post().to(decompress_handler))
    })
    .bind(("0.0.0.0", port))?
    .run()
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tier_selection() {
        assert_eq!(select_algorithm("2g_gprs"), Algorithm::Zstd);
        assert_eq!(select_algorithm("2g_edge"), Algorithm::Zstd);
        assert_eq!(select_algorithm("3g"), Algorithm::Gzip);
        assert_eq!(select_algorithm("4g_lte"), Algorithm::Lz4);
        assert_eq!(select_algorithm("5g_wifi"), Algorithm::Identity);
        assert_eq!(select_algorithm("offline"), Algorithm::Identity);
    }

    #[test]
    fn every_algorithm_round_trips() {
        let data = serde_json::to_vec(&serde_json::json!({
            "transactions": (0..100).map(|i| serde_json::json!({"id": i, "amount": i * 137})).collect::<Vec<_>>()
        }))
        .unwrap();
        for algo in [Algorithm::Gzip, Algorithm::Zstd, Algorithm::Lz4, Algorithm::Identity] {
            let res = compress_with(algo, &data).unwrap();
            let back = decompress_with(algo, &res.data).unwrap();
            assert_eq!(back, data, "{algo:?} round trip");
            assert_eq!(res.original_size, data.len());
            assert_eq!(res.compressed_size, res.data.len());
            if algo != Algorithm::Identity {
                assert!(res.ratio < 0.5, "{algo:?} should compress repetitive JSON");
            }
        }
    }

    #[test]
    fn corrupt_input_fails_loud() {
        assert!(decompress_with(Algorithm::Gzip, b"not gzip data").is_err());
        assert!(decompress_with(Algorithm::Zstd, b"not zstd data").is_err());
    }
}
