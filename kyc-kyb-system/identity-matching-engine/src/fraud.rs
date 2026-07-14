/// Fraud detection signals analysis for identity verification.

use crate::models::FraudCheckRequest;

pub struct FraudAnalysisResult {
    pub fraud_score: f64,
    pub risk_level: String,
    pub signals: Vec<FraudSignal>,
    pub recommendation: String,
}

pub struct FraudSignal {
    pub name: String,
    pub score: f64,
    pub weight: f64,
    pub detail: String,
}

impl serde::Serialize for FraudSignal {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut state = serializer.serialize_struct("FraudSignal", 4)?;
        state.serialize_field("name", &self.name)?;
        state.serialize_field("score", &self.score)?;
        state.serialize_field("weight", &self.weight)?;
        state.serialize_field("detail", &self.detail)?;
        state.end()
    }
}

impl serde::Serialize for FraudAnalysisResult {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut state = serializer.serialize_struct("FraudAnalysisResult", 4)?;
        state.serialize_field("fraud_score", &self.fraud_score)?;
        state.serialize_field("risk_level", &self.risk_level)?;
        state.serialize_field("signals", &self.signals)?;
        state.serialize_field("recommendation", &self.recommendation)?;
        state.end()
    }
}

pub fn analyze_fraud_signals(req: &FraudCheckRequest) -> FraudAnalysisResult {
    let mut signals = Vec::new();
    let mut total_score = 0.0_f64;
    let mut total_weight = 0.0_f64;

    // Signal 1: Velocity check (too many submissions in 24h)
    let submission_count = req.submission_count_24h.unwrap_or(0);
    let velocity_score = if submission_count > 10 {
        1.0
    } else if submission_count > 5 {
        0.6
    } else if submission_count > 3 {
        0.3
    } else {
        0.0
    };
    signals.push(FraudSignal {
        name: "velocity_check".to_string(),
        score: velocity_score,
        weight: 0.2,
        detail: format!("{} submissions in 24h", submission_count),
    });
    total_score += velocity_score * 0.2;
    total_weight += 0.2;

    // Signal 2: Device fingerprint (missing = suspicious)
    let device_score = if req.device_fingerprint.is_none() { 0.4 } else { 0.0 };
    signals.push(FraudSignal {
        name: "device_fingerprint".to_string(),
        score: device_score,
        weight: 0.15,
        detail: if req.device_fingerprint.is_some() {
            "Device fingerprint present".to_string()
        } else {
            "No device fingerprint provided".to_string()
        },
    });
    total_score += device_score * 0.15;
    total_weight += 0.15;

    // Signal 3: IP reputation (basic check)
    let ip_score = match &req.ip_address {
        Some(ip) if ip.starts_with("10.") || ip.starts_with("192.168.") => 0.1,
        Some(_) => 0.0,
        None => 0.3,
    };
    signals.push(FraudSignal {
        name: "ip_reputation".to_string(),
        score: ip_score,
        weight: 0.15,
        detail: format!("IP: {}", req.ip_address.as_deref().unwrap_or("unknown")),
    });
    total_score += ip_score * 0.15;
    total_weight += 0.15;

    // Signal 4: Country risk
    let country_score = match req.country.as_deref() {
        Some("NG") => 0.1, // Nigeria: standard
        Some(_) => 0.2,     // Other: slightly elevated
        None => 0.3,        // Missing: suspicious
    };
    signals.push(FraudSignal {
        name: "country_risk".to_string(),
        score: country_score,
        weight: 0.1,
        detail: format!("Country: {}", req.country.as_deref().unwrap_or("unknown")),
    });
    total_score += country_score * 0.1;
    total_weight += 0.1;

    // Signal 5: Document type risk
    let doc_score = match req.document_type.as_deref() {
        Some("national_id") | Some("passport") => 0.0,
        Some("drivers_license") => 0.1,
        Some("voters_card") => 0.15,
        Some(_) => 0.2,
        None => 0.3,
    };
    signals.push(FraudSignal {
        name: "document_type_risk".to_string(),
        score: doc_score,
        weight: 0.1,
        detail: format!("Document: {}", req.document_type.as_deref().unwrap_or("unknown")),
    });
    total_score += doc_score * 0.1;
    total_weight += 0.1;

    // Signal 6: Embedding quality (if provided)
    let embedding_score = match &req.embedding {
        Some(emb) if emb.len() >= 128 => {
            let variance: f64 = {
                let mean: f64 = emb.iter().sum::<f64>() / emb.len() as f64;
                emb.iter().map(|x| (x - mean).powi(2)).sum::<f64>() / emb.len() as f64
            };
            if variance < 0.001 { 0.8 } else if variance < 0.01 { 0.3 } else { 0.0 }
        }
        Some(_) => 0.5, // Short embedding = suspicious
        None => 0.2,
    };
    signals.push(FraudSignal {
        name: "embedding_quality".to_string(),
        score: embedding_score,
        weight: 0.3,
        detail: format!(
            "Embedding dim: {}",
            req.embedding.as_ref().map_or(0, |e| e.len())
        ),
    });
    total_score += embedding_score * 0.3;
    total_weight += 0.3;

    let fraud_score = if total_weight > 0.0 {
        (total_score / total_weight).min(1.0).max(0.0)
    } else {
        0.0
    };

    let (risk_level, recommendation) = if fraud_score > 0.7 {
        ("critical", "block_and_review")
    } else if fraud_score > 0.5 {
        ("high", "manual_review_required")
    } else if fraud_score > 0.3 {
        ("medium", "enhanced_monitoring")
    } else {
        ("low", "auto_approve")
    };

    FraudAnalysisResult {
        fraud_score,
        risk_level: risk_level.to_string(),
        signals,
        recommendation: recommendation.to_string(),
    }
}
