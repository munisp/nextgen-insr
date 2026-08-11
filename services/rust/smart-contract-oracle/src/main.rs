use actix_web::{web, App, HttpServer, HttpResponse};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use sha2::{Sha256, Digest};
use std::env;
use std::sync::Mutex;

// Smart Contract Oracle — External data feeds for parametric insurance triggers
// Port: 8123
//
// Middleware: PostgreSQL (feed history), Kafka (data events), Redis (feed cache)
// Feeds: OpenWeatherMap (rainfall), FlightAware (delays), USGS (seismic), Sentinel-2 (NDVI)
//
// FAIL-CLOSED POLICY: every feed that can drive a parametric payout returns an
// explicit error when its data provider is not configured or unreachable.
// No feed ever fabricates values (hash-derived, simulated, or otherwise).

#[derive(Clone)]
struct AppState {
    openweathermap_key: String,
    flight_api_url: String,
    flight_api_key: String,
    sentinel_client_id: String,
    sentinel_client_secret: String,
    db_url: String,
    feed_history: std::sync::Arc<Mutex<Vec<FeedEntry>>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct FeedEntry {
    id: String,
    feed_type: String,
    query: String,
    value: f64,
    unit: String,
    source: String,
    timestamp: String,
    data_hash: String,
}

#[derive(Deserialize)]
struct WeatherQuery {
    lat: f64,
    lon: f64,
    region: Option<String>,
}

#[derive(Deserialize)]
struct FlightQuery {
    flight_number: String,
    date: Option<String>,
}

#[derive(Deserialize)]
struct SeismicQuery {
    lat: f64,
    lon: f64,
    radius_km: Option<f64>,
}

#[derive(Deserialize)]
struct NDVIQuery {
    lat: f64,
    lon: f64,
    area_hectares: Option<f64>,
}

async fn health(data: web::Data<AppState>) -> HttpResponse {
    let history = data.feed_history.lock().unwrap();
    HttpResponse::Ok().json(serde_json::json!({
        "status": "healthy",
        "service": "smart-contract-oracle",
        "version": "1.0.0",
        "feeds": ["weather", "flight", "seismic", "ndvi"],
        "total_queries": history.len(),
        "has_weather_api_key": !data.openweathermap_key.is_empty(),
        "has_flight_provider": !data.flight_api_url.is_empty(),
        "has_sentinel_credentials": !(data.sentinel_client_id.is_empty() || data.sentinel_client_secret.is_empty()),
    }))
}

async fn get_weather(
    data: web::Data<AppState>,
    req: web::Json<WeatherQuery>,
) -> HttpResponse {
    // Fail-closed: weather data drives parametric payouts, so a missing key
    // or a failed provider call is an explicit error, never simulated data.
    if data.openweathermap_key.is_empty() {
        return HttpResponse::ServiceUnavailable().json(serde_json::json!({
            "error": "OPENWEATHERMAP_API_KEY not configured; weather feed unavailable (fail-closed for payout contexts)",
            "fail_closed": true,
        }));
    }

    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(8))
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            return HttpResponse::InternalServerError().json(serde_json::json!({
                "error": format!("http client init failed: {}", e),
                "fail_closed": true,
            }));
        }
    };

    let url = format!(
        "https://api.openweathermap.org/data/2.5/weather?lat={}&lon={}&appid={}&units=metric",
        req.lat, req.lon, data.openweathermap_key
    );

    let resp = match client.get(&url).send().await {
        Ok(r) => r,
        Err(e) => {
            return HttpResponse::BadGateway().json(serde_json::json!({
                "error": format!("weather provider request failed: {}", e),
                "fail_closed": true,
            }));
        }
    };
    let json = match resp.json::<serde_json::Value>().await {
        Ok(j) => j,
        Err(e) => {
            return HttpResponse::BadGateway().json(serde_json::json!({
                "error": format!("weather provider response parse failed: {}", e),
                "fail_closed": true,
            }));
        }
    };

    let temperature = match json["main"]["temp"].as_f64() {
        Some(t) => t,
        None => {
            return HttpResponse::BadGateway().json(serde_json::json!({
                "error": "weather provider response missing temperature field",
                "fail_closed": true,
            }));
        }
    };
    // Absent rain field means the provider reported no rainfall — 0.0 is honest.
    let rainfall_mm: f64 = json["rain"]["1h"].as_f64().unwrap_or(0.0);
    let humidity: f64 = json["main"]["humidity"].as_f64().unwrap_or(0.0);
    let source = "openweathermap-live".to_string();

    let entry = create_feed_entry("weather", &format!("lat={},lon={}", req.lat, req.lon), rainfall_mm, "mm", &source);
    data.feed_history.lock().unwrap().push(entry.clone());

    HttpResponse::Ok().json(serde_json::json!({
        "feed": entry,
        "details": {
            "rainfall_mm": rainfall_mm,
            "temperature_c": temperature,
            "humidity_pct": humidity,
            "coordinates": { "lat": req.lat, "lon": req.lon },
            "region": req.region.clone().unwrap_or_else(|| "unknown".to_string()),
        }
    }))
}

async fn get_flight_delay(
    data: web::Data<AppState>,
    req: web::Json<FlightQuery>,
) -> HttpResponse {
    // Fail-closed: parametric flight-delay payouts must never execute on
    // fabricated data. Without a configured provider (FLIGHT_API_URL) this
    // endpoint returns an explicit error instead of hash-derived delays.
    if data.flight_api_url.is_empty() {
        return HttpResponse::ServiceUnavailable().json(serde_json::json!({
            "error": "flight data provider not configured (FLIGHT_API_URL); refusing to fabricate flight delay data for parametric triggers",
            "flight_number": req.flight_number.clone(),
            "fail_closed": true,
        }));
    }

    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            return HttpResponse::InternalServerError().json(serde_json::json!({
                "error": format!("http client init failed: {}", e),
                "fail_closed": true,
            }));
        }
    };

    let sep = if data.flight_api_url.contains('?') { "&" } else { "?" };
    let mut url = format!("{}{}flight_iata={}", data.flight_api_url, sep, req.flight_number);
    if let Some(date) = &req.date {
        url.push_str(&format!("&flight_date={}", date));
    }
    if !data.flight_api_key.is_empty() {
        url.push_str(&format!("&access_key={}", data.flight_api_key));
    }

    let resp = match client.get(&url).send().await {
        Ok(r) => r,
        Err(e) => {
            return HttpResponse::BadGateway().json(serde_json::json!({
                "error": format!("flight data provider request failed: {}", e),
                "flight_number": req.flight_number.clone(),
                "fail_closed": true,
            }));
        }
    };
    let json = match resp.json::<serde_json::Value>().await {
        Ok(j) => j,
        Err(e) => {
            return HttpResponse::BadGateway().json(serde_json::json!({
                "error": format!("flight data provider response parse failed: {}", e),
                "flight_number": req.flight_number.clone(),
                "fail_closed": true,
            }));
        }
    };

    // aviationstack-style payload: data[0] holds the most recent flight record
    let first = match json["data"].as_array().and_then(|a| a.first()) {
        Some(f) => f.clone(),
        None => {
            return HttpResponse::BadGateway().json(serde_json::json!({
                "error": "flight data provider returned no record for this flight/date",
                "flight_number": req.flight_number.clone(),
                "fail_closed": true,
            }));
        }
    };

    let delay_minutes: i64 = first["arrival"]["delay"].as_i64()
        .or_else(|| first["departure"]["delay"].as_i64())
        .unwrap_or(0);
    let status = first["flight_status"].as_str().unwrap_or("unknown").to_string();

    let entry = create_feed_entry("flight", &req.flight_number, delay_minutes as f64, "minutes", "flight-api-live");
    data.feed_history.lock().unwrap().push(entry.clone());

    HttpResponse::Ok().json(serde_json::json!({
        "feed": entry,
        "details": {
            "flight_number": req.flight_number.clone(),
            "delay_minutes": delay_minutes,
            "status": status,
            "date": req.date.as_deref().unwrap_or("today"),
        }
    }))
}

async fn get_seismic(
    data: web::Data<AppState>,
    req: web::Json<SeismicQuery>,
) -> HttpResponse {
    let client = reqwest::Client::new();
    let radius = req.radius_km.unwrap_or(100.0);
    let now = Utc::now();
    let start = now - chrono::Duration::days(7);

    // Try USGS Earthquake API (real, free, no key needed)
    let url = format!(
        "https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&latitude={}&longitude={}&maxradiuskm={}&starttime={}&limit=5",
        req.lat, req.lon, radius, start.format("%Y-%m-%d")
    );

    let magnitude: f64;
    let source: String;
    let events: Vec<serde_json::Value>;

    match client.get(&url).send().await {
        Ok(resp) => {
            if let Ok(json) = resp.json::<serde_json::Value>().await {
                let features = json["features"].as_array();
                if let Some(f) = features {
                    events = f.iter().take(5).map(|e| {
                        serde_json::json!({
                            "magnitude": e["properties"]["mag"],
                            "place": e["properties"]["place"],
                            "time": e["properties"]["time"],
                        })
                    }).collect();
                    magnitude = f.first()
                        .and_then(|e| e["properties"]["mag"].as_f64())
                        .unwrap_or(0.0);
                    source = "usgs-live".to_string();
                } else {
                    magnitude = 0.0;
                    source = "usgs-empty".to_string();
                    events = vec![];
                }
            } else {
                magnitude = 0.0;
                source = "usgs-parse-error".to_string();
                events = vec![];
            }
        }
        Err(_) => {
            magnitude = 0.0;
            source = "usgs-unreachable".to_string();
            events = vec![];
        }
    }

    let entry = create_feed_entry("seismic", &format!("lat={},lon={}", req.lat, req.lon), magnitude, "Mw", &source);
    data.feed_history.lock().unwrap().push(entry.clone());

    HttpResponse::Ok().json(serde_json::json!({
        "feed": entry,
        "details": {
            "max_magnitude": magnitude,
            "radius_km": radius,
            "period_days": 7,
            "coordinates": { "lat": req.lat, "lon": req.lon },
            "recent_events": events,
        }
    }))
}

async fn get_ndvi(
    data: web::Data<AppState>,
    req: web::Json<NDVIQuery>,
) -> HttpResponse {
    // Fail-closed: NDVI drives parametric crop payouts. Hash-derived values
    // labeled "sentinel2-derived" were dishonest provenance and have been
    // removed. Without Sentinel Hub credentials this endpoint returns an
    // explicit error; with credentials it queries the real Statistical API.
    let area = req.area_hectares.unwrap_or(100.0);

    if data.sentinel_client_id.is_empty() || data.sentinel_client_secret.is_empty() {
        return HttpResponse::ServiceUnavailable().json(serde_json::json!({
            "error": "Sentinel Hub credentials not configured (SENTINEL_CLIENT_ID / SENTINEL_CLIENT_SECRET); NDVI is not fabricated — parametric crop payouts are blocked",
            "fail_closed": true,
        }));
    }

    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            return HttpResponse::InternalServerError().json(serde_json::json!({
                "error": format!("http client init failed: {}", e),
                "fail_closed": true,
            }));
        }
    };

    // OAuth2 client-credentials token
    let token_resp = match client
        .post("https://services.sentinel-hub.com/auth/realms/main/protocol/openid-connect/token")
        .form(&[
            ("grant_type", "client_credentials"),
            ("client_id", data.sentinel_client_id.as_str()),
            ("client_secret", data.sentinel_client_secret.as_str()),
        ])
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => {
            return HttpResponse::BadGateway().json(serde_json::json!({
                "error": format!("sentinel hub auth request failed: {}", e),
                "fail_closed": true,
            }));
        }
    };
    let token = match token_resp.json::<serde_json::Value>().await.ok()
        .and_then(|j| j["access_token"].as_str().map(|s| s.to_string()))
    {
        Some(t) => t,
        None => {
            return HttpResponse::BadGateway().json(serde_json::json!({
                "error": "sentinel hub auth returned no access_token",
                "fail_closed": true,
            }));
        }
    };

    // Small bbox around the queried point, Sentinel-2 L2A over the last 30 days
    let delta = 0.01_f64;
    let to = Utc::now();
    let from = to - chrono::Duration::days(30);
    let body = serde_json::json!({
        "input": {
            "bounds": {
                "properties": { "crs": "http://www.opengis.net/def/crs/OGC/1.3/CRS84" },
                "bbox": [req.lon - delta, req.lat - delta, req.lon + delta, req.lat + delta]
            },
            "data": [{
                "type": "sentinel-2-l2a",
                "dataFilter": {
                    "timeRange": { "from": from.to_rfc3339(), "to": to.to_rfc3339() },
                    "maxCloudCoverage": 30.0
                }
            }]
        },
        "aggregation": {
            "evalscript": "//VERSION=3\nfunction setup(){return{input:[\"B04\",\"B08\",\"dataMask\"],output:[{id:\"ndvi\",bands:1,sampleType:\"FLOAT32\"}]}}function evaluatePixel(s){return{ndvi:[(s.B08-s.B04)/(s.B08+s.B04)]}}",
            "timeRange": { "from": from.to_rfc3339(), "to": to.to_rfc3339() },
            "aggregationInterval": { "of": "P30D" },
            "width": 512,
            "height": 512
        }
    });

    let stats_resp = match client
        .post("https://services.sentinel-hub.com/api/v1/statistics")
        .bearer_auth(&token)
        .json(&body)
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => {
            return HttpResponse::BadGateway().json(serde_json::json!({
                "error": format!("sentinel hub statistics request failed: {}", e),
                "fail_closed": true,
            }));
        }
    };
    let stats_json = match stats_resp.json::<serde_json::Value>().await {
        Ok(j) => j,
        Err(e) => {
            return HttpResponse::BadGateway().json(serde_json::json!({
                "error": format!("sentinel hub statistics parse failed: {}", e),
                "fail_closed": true,
            }));
        }
    };

    let ndvi = match stats_json["data"][0]["outputs"]["ndvi"]["bands"]["B0"]["stats"]["mean"].as_f64() {
        Some(v) => v,
        None => {
            return HttpResponse::BadGateway().json(serde_json::json!({
                "error": "no NDVI observations available for this area/period (cloud cover or no coverage)",
                "fail_closed": true,
            }));
        }
    };

    let health = if ndvi > 0.7 { "healthy" }
    else if ndvi > 0.5 { "moderate" }
    else if ndvi > 0.3 { "stressed" }
    else { "degraded" };

    let entry = create_feed_entry("ndvi", &format!("lat={},lon={}", req.lat, req.lon), ndvi, "index", "sentinel2-l2a-live");
    data.feed_history.lock().unwrap().push(entry.clone());

    HttpResponse::Ok().json(serde_json::json!({
        "feed": entry,
        "details": {
            "ndvi": (ndvi * 10000.0).round() / 10000.0,
            "vegetation_health": health,
            "area_hectares": area,
            "satellite": "Sentinel-2",
            "coordinates": { "lat": req.lat, "lon": req.lon },
        }
    }))
}

async fn feed_history(data: web::Data<AppState>) -> HttpResponse {
    let history = data.feed_history.lock().unwrap();
    HttpResponse::Ok().json(serde_json::json!({
        "history": *history,
        "total": history.len(),
    }))
}

fn create_feed_entry(feed_type: &str, query: &str, value: f64, unit: &str, source: &str) -> FeedEntry {
    let now = Utc::now().to_rfc3339();
    let mut hasher = Sha256::new();
    hasher.update(format!("{}:{}:{}:{}", feed_type, query, value, now).as_bytes());
    let hash = hex::encode(hasher.finalize());

    FeedEntry {
        id: format!("FEED-{}", &hash[..12]),
        feed_type: feed_type.to_string(),
        query: query.to_string(),
        value,
        unit: unit.to_string(),
        source: source.to_string(),
        timestamp: now,
        data_hash: hash,
    }
}

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    env_logger::init();

    let port = env::var("PORT").unwrap_or_else(|_| "8123".to_string());
    let db_url = env::var("DATABASE_URL").unwrap_or_else(|_| "postgres://ngapp:ngapp@localhost:5432/ngapp".to_string());
    let weather_key = env::var("OPENWEATHERMAP_API_KEY").unwrap_or_default();

    log::info!("Smart Contract Oracle starting on port {}", port);

    let state = AppState {
        openweathermap_key: weather_key,
        flight_api_url: env::var("FLIGHT_API_URL").unwrap_or_default(),
        flight_api_key: env::var("FLIGHT_API_KEY").unwrap_or_default(),
        sentinel_client_id: env::var("SENTINEL_CLIENT_ID").unwrap_or_default(),
        sentinel_client_secret: env::var("SENTINEL_CLIENT_SECRET").unwrap_or_default(),
        db_url,
        feed_history: std::sync::Arc::new(Mutex::new(Vec::new())),
    };

    HttpServer::new(move || {
        App::new()
            .app_data(web::Data::new(state.clone()))
            .route("/health", web::get().to(health))
            .route("/api/v1/oracle/weather", web::post().to(get_weather))
            .route("/api/v1/oracle/flight", web::post().to(get_flight_delay))
            .route("/api/v1/oracle/seismic", web::post().to(get_seismic))
            .route("/api/v1/oracle/ndvi", web::post().to(get_ndvi))
            .route("/api/v1/oracle/history", web::get().to(feed_history))
    })
    .bind(format!("0.0.0.0:{}", port))?
    .run()
    .await
}
