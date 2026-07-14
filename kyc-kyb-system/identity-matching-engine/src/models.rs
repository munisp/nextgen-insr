use serde::{Deserialize, Serialize};
use chrono::{DateTime, Utc};

#[derive(Debug, Deserialize)]
pub struct FaceMatchRequest {
    pub session_id: String,
    pub source_embedding: Vec<f64>,
    pub target_embedding: Vec<f64>,
    pub threshold: Option<f64>,
}

#[derive(Debug, Serialize)]
pub struct FaceMatchResponse {
    pub session_id: String,
    pub verified: bool,
    pub similarity_pct: f64,
    pub distance: f64,
    pub threshold: f64,
    pub method: String,
    pub processing_time_ms: f64,
    pub timestamp: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct BatchMatchRequest {
    pub session_id: String,
    pub probe_embedding: Vec<f64>,
    pub candidates: Vec<CandidateEmbedding>,
    pub threshold: Option<f64>,
}

#[derive(Debug, Deserialize)]
pub struct CandidateEmbedding {
    pub id: String,
    pub embedding: Vec<f64>,
}

#[derive(Debug, Serialize)]
pub struct BatchMatchResult {
    pub candidate_id: String,
    pub similarity_pct: f64,
    pub matched: bool,
}

#[derive(Debug, Deserialize)]
pub struct StoreEmbeddingRequest {
    pub identity_id: String,
    pub embedding: Vec<f64>,
}

#[derive(Debug, Deserialize)]
pub struct SearchEmbeddingRequest {
    pub session_id: String,
    pub probe_embedding: Vec<f64>,
    pub threshold: Option<f64>,
    pub top_k: Option<usize>,
}

#[derive(Debug, Deserialize)]
pub struct FraudCheckRequest {
    pub session_id: String,
    pub identity_id: String,
    pub embedding: Option<Vec<f64>>,
    pub ip_address: Option<String>,
    pub device_fingerprint: Option<String>,
    pub submission_count_24h: Option<u32>,
    pub country: Option<String>,
    pub document_type: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct CrossReferenceRequest {
    pub session_id: String,
    pub identity_id: String,
    pub embedding: Vec<f64>,
}

#[derive(Debug, Deserialize)]
pub struct DuplicateCheckRequest {
    pub session_id: String,
    pub embedding: Vec<f64>,
}
