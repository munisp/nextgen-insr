/// Metrics Registry — Prometheus metrics for InsurePortal.
use anyhow::Result;
use prometheus::{
    register_counter_vec, register_gauge_vec, register_histogram_vec,
    CounterVec, Encoder, GaugeVec, HistogramVec, TextEncoder,
};

pub struct MetricsRegistry {
    pub request_total: CounterVec,
    pub request_duration: HistogramVec,
    pub audit_entries_total: CounterVec,
    pub rate_limit_hits: CounterVec,
    pub waf_threats_total: CounterVec,
    pub active_connections: GaugeVec,
}

impl MetricsRegistry {
    pub fn new() -> Self {
        let request_total = register_counter_vec!(
            "insureportal_requests_total",
            "Total HTTP requests",
            &["method", "path", "status", "tenant"]
        ).unwrap_or_else(|_| prometheus::CounterVec::new(
            prometheus::Opts::new("insureportal_requests_total_fallback", "fallback"),
            &["method", "path", "status", "tenant"]
        ).unwrap());

        let request_duration = register_histogram_vec!(
            "insureportal_request_duration_seconds",
            "HTTP request duration in seconds",
            &["method", "path"],
            vec![0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1.0, 5.0]
        ).unwrap_or_else(|_| prometheus::HistogramVec::new(
            prometheus::HistogramOpts::new("insureportal_request_duration_seconds_fallback", "fallback"),
            &["method", "path"]
        ).unwrap());

        let audit_entries_total = register_counter_vec!(
            "insureportal_audit_entries_total",
            "Total audit log entries",
            &["tenant", "action", "resource_type"]
        ).unwrap_or_else(|_| prometheus::CounterVec::new(
            prometheus::Opts::new("insureportal_audit_entries_total_fallback", "fallback"),
            &["tenant", "action", "resource_type"]
        ).unwrap());

        let rate_limit_hits = register_counter_vec!(
            "insureportal_rate_limit_hits_total",
            "Total rate limit hits",
            &["key", "allowed"]
        ).unwrap_or_else(|_| prometheus::CounterVec::new(
            prometheus::Opts::new("insureportal_rate_limit_hits_total_fallback", "fallback"),
            &["key", "allowed"]
        ).unwrap());

        let waf_threats_total = register_counter_vec!(
            "insureportal_waf_threats_total",
            "Total WAF threat detections",
            &["threat_type", "action"]
        ).unwrap_or_else(|_| prometheus::CounterVec::new(
            prometheus::Opts::new("insureportal_waf_threats_total_fallback", "fallback"),
            &["threat_type", "action"]
        ).unwrap());

        let active_connections = register_gauge_vec!(
            "insureportal_active_connections",
            "Current active connections",
            &["service"]
        ).unwrap_or_else(|_| prometheus::GaugeVec::new(
            prometheus::Opts::new("insureportal_active_connections_fallback", "fallback"),
            &["service"]
        ).unwrap());

        Self {
            request_total,
            request_duration,
            audit_entries_total,
            rate_limit_hits,
            waf_threats_total,
            active_connections,
        }
    }

    pub fn render(&self) -> Result<String> {
        let encoder = TextEncoder::new();
        let metric_families = prometheus::gather();
        let mut buffer = Vec::new();
        encoder.encode(&metric_families, &mut buffer)?;
        Ok(String::from_utf8(buffer)?)
    }
}
