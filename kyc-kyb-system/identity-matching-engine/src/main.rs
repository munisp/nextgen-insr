use actix_cors::Cors;
use actix_web::{web, App, HttpServer, HttpResponse, middleware};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use std::time::Instant;
use chrono::Utc;

mod matching;
mod fraud;
mod models;

use models::*;

struct AppState {
    start_time: Instant,
    embeddings_store: Mutex<std::collections::HashMap<String, Vec<f64>>>,
}

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    tracing_subscriber::fmt::init();
    tracing::info!("Starting Identity Matching Engine on port 8112");

    let port = std::env::var("PORT").unwrap_or_else(|_| "8112".to_string());
    let data = web::Data::new(AppState {
        start_time: Instant::now(),
        embeddings_store: Mutex::new(std::collections::HashMap::new()),
    });

    HttpServer::new(move || {
        let cors = Cors::default()
            .allow_any_origin()
            .allow_any_method()
            .allow_any_header();

        App::new()
            .wrap(cors)
            .app_data(data.clone())
            .route("/health", web::get().to(health))
            .route("/ready", web::get().to(ready))
            .service(
                web::scope("/api/v1")
                    .route("/match", web::post().to(match_faces))
                    .route("/match/batch", web::post().to(batch_match))
                    .route("/embedding/store", web::post().to(store_embedding))
                    .route("/embedding/search", web::post().to(search_embedding))
                    .route("/fraud/check", web::post().to(fraud_check))
                    .route("/fraud/cross-reference", web::post().to(cross_reference))
                    .route("/duplicate/check", web::post().to(duplicate_check))
            )
    })
    .bind(format!("0.0.0.0:{}", port))?
    .run()
    .await
}

async fn health(data: web::Data<AppState>) -> HttpResponse {
    HttpResponse::Ok().json(serde_json::json!({
        "status": "healthy",
        "version": "1.0.0",
        "service": "identity-matching-engine",
        "uptime_seconds": data.start_time.elapsed().as_secs_f64(),
    }))
}

async fn ready(_data: web::Data<AppState>) -> HttpResponse {
    HttpResponse::Ok().json(serde_json::json!({"ready": true}))
}

async fn match_faces(
    data: web::Data<AppState>,
    req: web::Json<FaceMatchRequest>,
) -> HttpResponse {
    let start = Instant::now();
    let result = matching::compare_embeddings(
        &req.source_embedding,
        &req.target_embedding,
        req.threshold.unwrap_or(0.6),
    );

    HttpResponse::Ok().json(FaceMatchResponse {
        session_id: req.session_id.clone(),
        verified: result.similarity >= req.threshold.unwrap_or(0.6),
        similarity_pct: (result.similarity * 100.0).min(100.0).max(0.0),
        distance: result.distance,
        threshold: req.threshold.unwrap_or(0.6),
        method: "cosine".to_string(),
        processing_time_ms: start.elapsed().as_secs_f64() * 1000.0,
        timestamp: Utc::now(),
    })
}

async fn batch_match(
    data: web::Data<AppState>,
    req: web::Json<BatchMatchRequest>,
) -> HttpResponse {
    let start = Instant::now();
    let results: Vec<BatchMatchResult> = req.candidates.iter().map(|candidate| {
        let result = matching::compare_embeddings(
            &req.probe_embedding,
            &candidate.embedding,
            req.threshold.unwrap_or(0.6),
        );
        BatchMatchResult {
            candidate_id: candidate.id.clone(),
            similarity_pct: (result.similarity * 100.0).min(100.0).max(0.0),
            matched: result.similarity >= req.threshold.unwrap_or(0.6),
        }
    }).collect();

    let matched_count = results.iter().filter(|r| r.matched).count();

    HttpResponse::Ok().json(serde_json::json!({
        "session_id": req.session_id,
        "total_candidates": req.candidates.len(),
        "matched_count": matched_count,
        "results": results,
        "processing_time_ms": start.elapsed().as_secs_f64() * 1000.0,
    }))
}

async fn store_embedding(
    data: web::Data<AppState>,
    req: web::Json<StoreEmbeddingRequest>,
) -> HttpResponse {
    let mut store = match data.embeddings_store.lock() {
        Ok(s) => s,
        Err(_) => return HttpResponse::InternalServerError().json(serde_json::json!({"error": "Internal state error"})),
    };
    store.insert(req.identity_id.clone(), req.embedding.clone());
    HttpResponse::Ok().json(serde_json::json!({
        "stored": true,
        "identity_id": req.identity_id,
        "embedding_dim": req.embedding.len(),
        "total_stored": store.len(),
    }))
}

async fn search_embedding(
    data: web::Data<AppState>,
    req: web::Json<SearchEmbeddingRequest>,
) -> HttpResponse {
    let start = Instant::now();
    let store = match data.embeddings_store.lock() {
        Ok(s) => s,
        Err(_) => return HttpResponse::InternalServerError().json(serde_json::json!({"error": "Internal state error"})),
    };
    let threshold = req.threshold.unwrap_or(0.6);
    let top_k = req.top_k.unwrap_or(5);

    let mut matches: Vec<(String, f64)> = store.iter()
        .map(|(id, emb)| {
            let result = matching::compare_embeddings(&req.probe_embedding, emb, threshold);
            (id.clone(), result.similarity)
        })
        .filter(|(_, sim)| *sim >= threshold)
        .collect();

    matches.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    matches.truncate(top_k);

    HttpResponse::Ok().json(serde_json::json!({
        "session_id": req.session_id,
        "matches": matches.iter().map(|(id, sim)| serde_json::json!({
            "identity_id": id,
            "similarity_pct": (sim * 100.0).min(100.0),
        })).collect::<Vec<_>>(),
        "total_searched": store.len(),
        "processing_time_ms": start.elapsed().as_secs_f64() * 1000.0,
    }))
}

async fn fraud_check(
    data: web::Data<AppState>,
    req: web::Json<FraudCheckRequest>,
) -> HttpResponse {
    let start = Instant::now();
    let result = fraud::analyze_fraud_signals(&req);

    HttpResponse::Ok().json(serde_json::json!({
        "session_id": req.session_id,
        "fraud_score": result.fraud_score,
        "risk_level": result.risk_level,
        "signals": result.signals,
        "recommendation": result.recommendation,
        "processing_time_ms": start.elapsed().as_secs_f64() * 1000.0,
    }))
}

async fn cross_reference(
    data: web::Data<AppState>,
    req: web::Json<CrossReferenceRequest>,
) -> HttpResponse {
    let start = Instant::now();
    let store = match data.embeddings_store.lock() {
        Ok(s) => s,
        Err(_) => return HttpResponse::InternalServerError().json(serde_json::json!({"error": "Internal state error"})),
    };

    let duplicates: Vec<serde_json::Value> = store.iter()
        .filter(|(id, _)| **id != req.identity_id)
        .filter_map(|(id, emb)| {
            let result = matching::compare_embeddings(&req.embedding, emb, 0.85);
            if result.similarity >= 0.85 {
                Some(serde_json::json!({
                    "identity_id": id,
                    "similarity_pct": (result.similarity * 100.0).min(100.0),
                }))
            } else {
                None
            }
        })
        .collect();

    HttpResponse::Ok().json(serde_json::json!({
        "session_id": req.session_id,
        "identity_id": req.identity_id,
        "potential_duplicates": duplicates,
        "duplicate_found": !duplicates.is_empty(),
        "processing_time_ms": start.elapsed().as_secs_f64() * 1000.0,
    }))
}

async fn duplicate_check(
    data: web::Data<AppState>,
    req: web::Json<DuplicateCheckRequest>,
) -> HttpResponse {
    let start = Instant::now();
    let store = match data.embeddings_store.lock() {
        Ok(s) => s,
        Err(_) => return HttpResponse::InternalServerError().json(serde_json::json!({"error": "Internal state error"})),
    };

    let mut highest_match = 0.0_f64;
    let mut matched_id: Option<String> = None;

    for (id, emb) in store.iter() {
        let result = matching::compare_embeddings(&req.embedding, emb, 0.9);
        if result.similarity > highest_match {
            highest_match = result.similarity;
            matched_id = Some(id.clone());
        }
    }

    let is_duplicate = highest_match >= 0.9;

    HttpResponse::Ok().json(serde_json::json!({
        "session_id": req.session_id,
        "is_duplicate": is_duplicate,
        "highest_similarity_pct": (highest_match * 100.0).min(100.0),
        "matched_identity_id": matched_id,
        "total_compared": store.len(),
        "processing_time_ms": start.elapsed().as_secs_f64() * 1000.0,
    }))
}
