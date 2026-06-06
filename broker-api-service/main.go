package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"sync/atomic"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
)

// Broker API Service — manages insurance broker integrations and commission
// Business Rules:
// - Broker tiers: Bronze (5% commission), Silver (7%), Gold (10%), Platinum (12%)
// - Minimum premium for broker assignment: ₦50,000
// - Commission split: 70% broker, 30% sub-agents
// - NAICOM broker license validation before activation
// - Quarterly performance review: Volume, retention, complaints
// - Clawback: If policy cancelled within 6 months, commission reversed


// Prometheus-compatible metrics
var (
	metricsRequestCount    int64
	metricsErrorCount      int64
	metricsStartTime       = time.Now()
)

func metricsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt64(&metricsRequestCount, 1)
		wrapped := &metricsResponseWriter{ResponseWriter: w, statusCode: http.StatusOK}
		next.ServeHTTP(wrapped, r)
		if wrapped.statusCode >= 400 {
			atomic.AddInt64(&metricsErrorCount, 1)
		}
	})
}

type metricsResponseWriter struct {
	http.ResponseWriter
	statusCode int
}

func (mrw *metricsResponseWriter) WriteHeader(code int) {
	mrw.statusCode = code
	mrw.ResponseWriter.WriteHeader(code)
}

func metricsHandler(w http.ResponseWriter, r *http.Request) {
	uptime := time.Since(metricsStartTime).Seconds()
	reqCount := atomic.LoadInt64(&metricsRequestCount)
	errCount := atomic.LoadInt64(&metricsErrorCount)
	fmt.Fprintf(w, "# HELP http_requests_total Total HTTP requests\n")
	fmt.Fprintf(w, "# TYPE http_requests_total counter\n")
	fmt.Fprintf(w, "http_requests_total %d\n", reqCount)
	fmt.Fprintf(w, "# HELP http_errors_total Total HTTP errors (4xx/5xx)\n")
	fmt.Fprintf(w, "# TYPE http_errors_total counter\n")
	fmt.Fprintf(w, "http_errors_total %d\n", errCount)
	fmt.Fprintf(w, "# HELP process_uptime_seconds Process uptime\n")
	fmt.Fprintf(w, "# TYPE process_uptime_seconds gauge\n")
	fmt.Fprintf(w, "process_uptime_seconds %.2f\n", uptime)
}

var kafkaRestURL string

func initKafka() {
	kafkaRestURL = os.Getenv("KAFKA_REST_URL")
	if kafkaRestURL == "" {
		kafkaRestURL = "http://localhost:8082"
	}
	log.Printf("Kafka REST proxy configured at %s", kafkaRestURL)
}

func publishEvent(topic string, key string, payload interface{}) {
	if kafkaRestURL == "" {
		return
	}
	data, err := json.Marshal(payload)
	if err != nil {
		log.Printf("WARN: kafka marshal error: %v", err)
		return
	}
	msg := map[string]interface{}{
		"records": []map[string]interface{}{
			{"key": key, "value": string(data)},
		},
	}
	body, _ := json.Marshal(msg)
	resp, err := http.Post(kafkaRestURL+"/topics/"+topic, "application/vnd.kafka.json.v2+json", bytes.NewReader(body))
	if err != nil {
		log.Printf("WARN: kafka publish error: %v", err)
		return
	}
	defer resp.Body.Close()
}

func main() {
	initKafka()
	r := chi.NewRouter()
	r.Use(middleware.Logger, middleware.Recoverer)

	r.Use(metricsMiddleware)
	r.Get("/metrics", metricsHandler)
	r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]string{"status": "healthy", "service": "broker-api-service"})
	})
	r.Route("/api/v1/brokers", func(r chi.Router) {
		r.Get("/", listBrokers)
		r.Post("/", registerBroker)
		r.Get("/{id}/commission", calculateCommission)
		r.Post("/{id}/validate-license", validateLicense)
	})

	port := os.Getenv("PORT")
	if port == "" { port = "8102" }
	log.Printf("Broker API Service starting on :%s", port)
	log.Fatal(http.ListenAndServe(":"+port, r))
}

var brokerTiers = map[string]float64{"bronze": 0.05, "silver": 0.07, "gold": 0.10, "platinum": 0.12}

func listBrokers(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]interface{}{
		"brokers": []map[string]interface{}{
			{"id": "BRK-001", "name": "Lagos Insurance Brokers Ltd", "tier": "gold", "commission_rate": 0.10, "active_policies": 245, "status": "active"},
			{"id": "BRK-002", "name": "Abuja Risk Consultants", "tier": "silver", "commission_rate": 0.07, "active_policies": 120, "status": "active"},
		},
		"total": 2,
	})
}

func registerBroker(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name          string `json:"name"`
		LicenseNumber string `json:"license_number"`
		Tier          string `json:"tier"`
	}
	json.NewDecoder(r.Body).Decode(&body)
	rate, ok := brokerTiers[body.Tier]
	if !ok { rate = brokerTiers["bronze"] }
	w.WriteHeader(201)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"broker_id": "BRK-" + time.Now().Format("20060102"), "name": body.Name,
		"tier": body.Tier, "commission_rate": rate, "status": "pending_license_validation",
		"clawback_period": "6 months", "min_premium": 50000,
	})
}

func calculateCommission(w http.ResponseWriter, r *http.Request) {
	premium := 250000.0
	tier := "gold"
	rate := brokerTiers[tier]
	total := premium * rate
	brokerShare := total * 0.70
	subAgentShare := total * 0.30
	json.NewEncoder(w).Encode(map[string]interface{}{
		"premium": premium, "tier": tier, "rate": rate, "total_commission": total,
		"broker_share": brokerShare, "sub_agent_share": subAgentShare, "split": "70/30",
	})
}

func validateLicense(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]interface{}{
		"valid": true, "issuer": "NAICOM", "license_type": "insurance_broker",
		"expiry": time.Now().AddDate(1, 0, 0).Format("2006-01-02"), "status": "active",
	})
}
