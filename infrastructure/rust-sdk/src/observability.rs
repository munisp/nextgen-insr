//! Observability: metrics collection and Prometheus-compatible export for Rust services.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Instant;

/// Prometheus-compatible metrics collector.
pub struct Metrics {
    service_name: String,
    counters: Arc<Mutex<HashMap<String, i64>>>,
    gauges: Arc<Mutex<HashMap<String, f64>>>,
    histograms: Arc<Mutex<HashMap<String, HistogramData>>>,
}

struct HistogramData {
    count: i64,
    sum: f64,
    min: f64,
    max: f64,
}

impl Metrics {
    pub fn new(service_name: &str) -> Self {
        Self {
            service_name: service_name.to_string(),
            counters: Arc::new(Mutex::new(HashMap::new())),
            gauges: Arc::new(Mutex::new(HashMap::new())),
            histograms: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn incr_counter(&self, name: &str) {
        self.incr_counter_by(name, 1);
    }

    pub fn incr_counter_by(&self, name: &str, value: i64) {
        if let Ok(mut counters) = self.counters.lock() {
            *counters.entry(name.to_string()).or_insert(0) += value;
        }
    }

    pub fn set_gauge(&self, name: &str, value: f64) {
        if let Ok(mut gauges) = self.gauges.lock() {
            gauges.insert(name.to_string(), value);
        }
    }

    pub fn observe_latency(&self, name: &str, duration_ms: f64) {
        let Ok(mut histograms) = self.histograms.lock() else { return };
        let h = histograms.entry(name.to_string()).or_insert(HistogramData {
            count: 0,
            sum: 0.0,
            min: duration_ms,
            max: duration_ms,
        });
        h.count += 1;
        h.sum += duration_ms;
        if duration_ms < h.min {
            h.min = duration_ms;
        }
        if duration_ms > h.max {
            h.max = duration_ms;
        }
    }

    pub fn prometheus_text(&self) -> String {
        let mut lines = Vec::new();

        if let Ok(counters) = self.counters.lock() {
            for (name, value) in counters.iter() {
                lines.push(format!("# TYPE {}_{} counter", self.service_name, name));
                lines.push(format!("{}_{} {}", self.service_name, name, value));
            }
        }

        if let Ok(gauges) = self.gauges.lock() {
            for (name, value) in gauges.iter() {
                lines.push(format!("# TYPE {}_{} gauge", self.service_name, name));
                lines.push(format!("{}_{} {}", self.service_name, name, value));
            }
        }

        let Ok(histograms) = self.histograms.lock() else { return lines.join("\n") + "\n" };
        for (name, h) in histograms.iter() {
            lines.push(format!("# TYPE {}_{} summary", self.service_name, name));
            lines.push(format!("{}_{}_count {}", self.service_name, name, h.count));
            lines.push(format!("{}_{}_sum {:.2}", self.service_name, name, h.sum));
            if h.count > 0 {
                lines.push(format!("{}_{}_min {:.2}", self.service_name, name, h.min));
                lines.push(format!("{}_{}_max {:.2}", self.service_name, name, h.max));
                lines.push(format!(
                    "{}_{}_avg {:.2}",
                    self.service_name,
                    name,
                    h.sum / h.count as f64
                ));
            }
        }

        lines.join("\n") + "\n"
    }

    pub fn json_snapshot(&self) -> serde_json::Value {
        let Ok(counters) = self.counters.lock() else { return serde_json::json!({"error": "lock poisoned"}) };
        let Ok(gauges) = self.gauges.lock() else { return serde_json::json!({"error": "lock poisoned"}) };
        let Ok(histograms) = self.histograms.lock() else { return serde_json::json!({"error": "lock poisoned"}) };

        let mut latencies = serde_json::Map::new();
        for (name, h) in histograms.iter() {
            latencies.insert(
                name.clone(),
                serde_json::json!({
                    "count": h.count,
                    "sum": h.sum,
                    "min": h.min,
                    "max": h.max,
                    "avg": if h.count > 0 { h.sum / h.count as f64 } else { 0.0 },
                }),
            );
        }

        serde_json::json!({
            "service": self.service_name,
            "counters": counters.iter().map(|(k, v)| (k.clone(), serde_json::json!(v))).collect::<serde_json::Map<_, _>>(),
            "gauges": gauges.iter().map(|(k, v)| (k.clone(), serde_json::json!(v))).collect::<serde_json::Map<_, _>>(),
            "latencies": latencies,
        })
    }
}

/// Timer helper for measuring request durations.
pub struct RequestTimer {
    start: Instant,
    metrics: Arc<Metrics>,
    metric_name: String,
}

impl RequestTimer {
    pub fn start(metrics: Arc<Metrics>, metric_name: &str) -> Self {
        Self {
            start: Instant::now(),
            metrics,
            metric_name: metric_name.to_string(),
        }
    }

    pub fn stop(self) -> f64 {
        let duration_ms = self.start.elapsed().as_secs_f64() * 1000.0;
        self.metrics.observe_latency(&self.metric_name, duration_ms);
        duration_ms
    }
}
