use actix_web::{web, App, HttpServer, HttpRequest, HttpResponse};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use dashmap::DashMap;
use tokio::sync::broadcast;

mod streams;
mod websocket;

/// Event types flowing through the real-time streaming pipeline
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "payload")]
pub enum StreamEvent {
    ClaimStatusChanged {
        claim_id: i64,
        user_id: i64,
        old_status: String,
        new_status: String,
    },
    PolicyRenewalDue {
        policy_id: i64,
        user_id: i64,
        days_remaining: i32,
        premium_amount: f64,
    },
    PaymentReceived {
        payment_id: i64,
        user_id: i64,
        amount: f64,
        currency: String,
    },
    FraudAlertTriggered {
        claim_id: i64,
        score: f64,
        risk_level: String,
    },
    ParametricTriggerActivated {
        policy_id: i64,
        trigger_type: String,
        measured_value: f64,
        threshold: f64,
        payout_amount: f64,
    },
    P2PPoolClaimVote {
        pool_id: i64,
        claim_id: i64,
        voter_id: i64,
        vote: String,
        votes_remaining: i32,
    },
    WeatherDataIngested {
        region: String,
        data_points: i32,
        anomalies_detected: i32,
    },
    TelematicsScoreUpdated {
        user_id: i64,
        new_score: f64,
        discount_change: f64,
    },
    WhatsAppMessageReceived {
        phone_number: String,
        message_type: String,
    },
    SystemAlert {
        severity: String,
        service: String,
        message: String,
    },
}

/// Fluvio stream topics configuration
pub mod fluvio_topics {
    pub const CLAIMS_EVENTS: &str = "insureportal.claims.events";
    pub const POLICY_EVENTS: &str = "insureportal.policies.events";
    pub const PAYMENT_EVENTS: &str = "insureportal.payments.events";
    pub const FRAUD_EVENTS: &str = "insureportal.fraud.events";
    pub const PARAMETRIC_EVENTS: &str = "insureportal.parametric.events";
    pub const P2P_EVENTS: &str = "insureportal.p2p.events";
    pub const WEATHER_EVENTS: &str = "insureportal.weather.events";
    pub const TELEMATICS_EVENTS: &str = "insureportal.telematics.events";
    pub const NOTIFICATIONS: &str = "insureportal.notifications";
    pub const SYSTEM_ALERTS: &str = "insureportal.system.alerts";
}

#[derive(Clone)]
pub struct AppState {
    pub broadcaster: broadcast::Sender<StreamEvent>,
    pub user_channels: Arc<DashMap<i64, Vec<broadcast::Sender<StreamEvent>>>>,
}

async fn publish_event(
    state: web::Data<AppState>,
    event: web::Json<StreamEvent>,
) -> HttpResponse {
    let event = event.into_inner();
    let _ = state.broadcaster.send(event.clone());
    HttpResponse::Ok().json(serde_json::json!({
        "status": "published",
        "subscribers": state.broadcaster.receiver_count()
    }))
}

async fn get_stream_stats(state: web::Data<AppState>) -> HttpResponse {
    HttpResponse::Ok().json(serde_json::json!({
        "active_subscribers": state.broadcaster.receiver_count(),
        "user_channels": state.user_channels.len(),
        "topics": [
            fluvio_topics::CLAIMS_EVENTS,
            fluvio_topics::POLICY_EVENTS,
            fluvio_topics::PAYMENT_EVENTS,
            fluvio_topics::FRAUD_EVENTS,
            fluvio_topics::PARAMETRIC_EVENTS,
            fluvio_topics::P2P_EVENTS,
            fluvio_topics::WEATHER_EVENTS,
            fluvio_topics::TELEMATICS_EVENTS,
            fluvio_topics::NOTIFICATIONS,
            fluvio_topics::SYSTEM_ALERTS,
        ]
    }))
}

async fn subscribe_user(
    state: web::Data<AppState>,
    path: web::Path<i64>,
) -> HttpResponse {
    let user_id = path.into_inner();
    let (tx, _rx) = broadcast::channel(100);
    state.user_channels
        .entry(user_id)
        .or_insert_with(Vec::new)
        .push(tx);

    HttpResponse::Ok().json(serde_json::json!({
        "status": "subscribed",
        "userId": user_id
    }))
}

async fn health() -> HttpResponse {
    HttpResponse::Ok().json(serde_json::json!({
        "status": "healthy",
        "service": "realtime-streaming",
        "engine": "fluvio"
    }))
}

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    tracing_subscriber::fmt::init();

    let (broadcaster, _) = broadcast::channel::<StreamEvent>(10000);
    let state = AppState {
        broadcaster,
        user_channels: Arc::new(DashMap::new()),
    };

    let port = std::env::var("PORT").unwrap_or_else(|_| "8091".to_string());
    let bind_addr = format!("0.0.0.0:{}", port);

    tracing::info!("realtime-streaming starting on {}", bind_addr);

    HttpServer::new(move || {
        App::new()
            .app_data(web::Data::new(state.clone()))
            .route("/health", web::get().to(health))
            .service(
                web::scope("/api/v1/streams")
                    .route("/publish", web::post().to(publish_event))
                    .route("/stats", web::get().to(get_stream_stats))
                    .route("/subscribe/{user_id}", web::post().to(subscribe_user))
            )
    })
    .bind(&bind_addr)?
    .run()
    .await
}
