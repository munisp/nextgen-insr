package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"log"
	"math"
	"net/http"
	"os"
	"sync/atomic"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
)

// Microinsurance Engine — affordable insurance products for low-income Nigerians
// Business Rules:
// - Premium range: ₦100 - ₦5,000/month
// - Products: Crop (₦500/season), Health (₦200/month), Life (₦100/month), Device (₦300/month)
// - Distribution: USSD, agent network, mobile money deduction
// - Claims: Simplified process, max 3 documents, settlement within 48h
// - Auto-enrollment: Via mobile money operators (opt-out)
// - Parametric triggers: Weather index for crop, hospitalization for health

type MicroProduct struct {
	ID          string  `json:"id"`
	Name        string  `json:"name"`
	Premium     float64 `json:"premium_naira"`
	Coverage    float64 `json:"coverage_naira"`
	Duration    string  `json:"duration"`
	ClaimSLA    string  `json:"claim_sla"`
}

var microProducts = []MicroProduct{
	{ID: "MIC-CROP", Name: "Crop Protection", Premium: 500, Coverage: 50000, Duration: "per_season", ClaimSLA: "48h"},
	{ID: "MIC-HEALTH", Name: "Basic Health", Premium: 200, Coverage: 100000, Duration: "monthly", ClaimSLA: "24h"},
	{ID: "MIC-LIFE", Name: "Term Life", Premium: 100, Coverage: 200000, Duration: "monthly", ClaimSLA: "72h"},
	{ID: "MIC-DEVICE", Name: "Device Protection", Premium: 300, Coverage: 75000, Duration: "monthly", ClaimSLA: "48h"},
}


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
		json.NewEncoder(w).Encode(map[string]string{"status": "healthy", "service": "microinsurance-engine"})
	})
	r.Get("/api/v1/products", listProducts)
	r.Post("/api/v1/enroll", enroll)
	r.Post("/api/v1/claim", fileClaim)
	r.Get("/api/v1/stats", getStats)

	port := os.Getenv("PORT")
	if port == "" { port = "8124" }
	log.Printf("Microinsurance Engine starting on :%s", port)
	log.Fatal(http.ListenAndServe(":"+port, r))
}

func listProducts(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]interface{}{"products": microProducts, "total": len(microProducts)})
}

func enroll(w http.ResponseWriter, r *http.Request) {
	var body struct {
		CustomerID string `json:"customer_id"`
		ProductID  string `json:"product_id"`
		Channel    string `json:"channel"`
	}
	json.NewDecoder(r.Body).Decode(&body)
	w.WriteHeader(201)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"enrollment_id": "ENR-" + time.Now().Format("20060102150405"),
		"product_id": body.ProductID, "status": "active", "channel": body.Channel,
		"next_premium_due": time.Now().AddDate(0, 1, 0).Format("2006-01-02"),
	})
}

func fileClaim(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]interface{}{
		"claim_id": "MCL-" + time.Now().Format("20060102150405"),
		"status": "approved", "settlement_amount": 50000,
		"expected_payment": time.Now().Add(48 * time.Hour).Format(time.RFC3339),
		"documents_required": 3, "simplified_process": true,
	})
}

func getStats(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]interface{}{
		"total_enrolled": 125000, "active_policies": 98000, "claims_this_month": 450,
		"avg_premium": 275, "loss_ratio": 0.45, "penetration_rate_pct": 8.5,
	})
}

func init() { _ = math.Pi }
