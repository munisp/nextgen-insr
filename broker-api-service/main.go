package main

import (
	"database/sql"
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
	"context"
	"math"
	"os/signal"
	"sync"
	"syscall"

	_ "github.com/lib/pq"
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

// --- Production Middleware ---

type statusResponseWriter struct {
	http.ResponseWriter
	statusCode int
}

func (w *statusResponseWriter) WriteHeader(code int) {
	w.statusCode = code
	w.ResponseWriter.WriteHeader(code)
}

// Tracing middleware - adds X-Request-ID to all requests
func prodTracingMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		reqID := r.Header.Get("X-Request-Id")
		if reqID == "" {
			reqID = fmt.Sprintf("req-%d", time.Now().UnixNano())
		}
		w.Header().Set("X-Request-Id", reqID)
		start := time.Now()
		wrapped := &statusResponseWriter{ResponseWriter: w, statusCode: http.StatusOK}
		next.ServeHTTP(wrapped, r)
		log.Printf(`{"level":"debug","msg":"request","method":"%s","path":"%s","status":%d,"duration":"%s","request_id":"%s"}`, r.Method, r.URL.Path, wrapped.statusCode, time.Since(start), reqID)
	})
}

// CORS middleware - handles preflight and sets headers
func prodCorsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, PATCH, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Request-Id")
		w.Header().Set("Access-Control-Max-Age", "86400")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// Rate limiting - token bucket per IP, 100 req/min
var (
	prodRateLimitMu      sync.Mutex
	prodRateLimitBuckets = make(map[string]*prodTokenBucket)
)

type prodTokenBucket struct {
	tokens     float64
	lastRefill time.Time
}

func prodRateLimitMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ip := r.RemoteAddr
		if fwd := r.Header.Get("X-Forwarded-For"); fwd != "" {
			ip = fwd
		}
		prodRateLimitMu.Lock()
		bucket, ok := prodRateLimitBuckets[ip]
		if !ok {
			bucket = &prodTokenBucket{tokens: 100, lastRefill: time.Now()}
			prodRateLimitBuckets[ip] = bucket
		}
		elapsed := time.Since(bucket.lastRefill).Seconds()
		bucket.tokens = math.Min(100, bucket.tokens+elapsed*(100.0/60.0))
		bucket.lastRefill = time.Now()
		if bucket.tokens < 1 {
			prodRateLimitMu.Unlock()
			w.Header().Set("Retry-After", "60")
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusTooManyRequests)
			json.NewEncoder(w).Encode(map[string]interface{}{"error": "rate limit exceeded", "retry_after": 60})
			return
		}
		bucket.tokens--
		prodRateLimitMu.Unlock()
		next.ServeHTTP(w, r)
	})
}

// Prometheus-compatible metrics
var (
	prodMetricsReqCount   int64
	prodMetricsErrCount   int64
	prodMetricsStartTime  = time.Now()
)

func prodMetricsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt64(&prodMetricsReqCount, 1)
		wrapped := &statusResponseWriter{ResponseWriter: w, statusCode: http.StatusOK}
		next.ServeHTTP(wrapped, r)
		if wrapped.statusCode >= 400 {
			atomic.AddInt64(&prodMetricsErrCount, 1)
		}
	})
}

func prodMetricsHandler(w http.ResponseWriter, r *http.Request) {
	uptime := time.Since(prodMetricsStartTime).Seconds()
	reqCount := atomic.LoadInt64(&prodMetricsReqCount)
	errCount := atomic.LoadInt64(&prodMetricsErrCount)
	w.Header().Set("Content-Type", "text/plain")
	fmt.Fprintf(w, "# HELP http_requests_total Total HTTP requests\n")
	fmt.Fprintf(w, "# TYPE http_requests_total counter\n")
	fmt.Fprintf(w, "http_requests_total %d\n", reqCount)
	fmt.Fprintf(w, "# HELP http_errors_total Total HTTP errors (4xx/5xx)\n")
	fmt.Fprintf(w, "# TYPE http_errors_total counter\n")
	fmt.Fprintf(w, "http_errors_total %d\n", errCount)
	fmt.Fprintf(w, "# HELP process_uptime_seconds Process uptime in seconds\n")
	fmt.Fprintf(w, "# TYPE process_uptime_seconds gauge\n")
	fmt.Fprintf(w, "process_uptime_seconds %.2f\n", uptime)
}

// Panic recovery middleware - catches panics and returns 500
func prodRecoveryMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if err := recover(); err != nil {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusInternalServerError)
				json.NewEncoder(w).Encode(map[string]interface{}{"error": "internal server error", "recovered": true})
				log.Printf(`{"level":"error","msg":"panic recovered","error":"%v","path":"%s","method":"%s"}`, err, r.URL.Path, r.Method)
			}
		}()
		next.ServeHTTP(w, r)
	})
}


var db *sql.DB

func initDB() {
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		dbURL = "postgres://ngapp:ngapp@localhost:5432/ngapp?sslmode=disable"
	}
	var err error
	db, err = sql.Open("postgres", dbURL)
	if err != nil {
		log.Printf("WARN: database connection failed: %v", err)
		return
	}
	db.SetMaxOpenConns(25)
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(5 * time.Minute)
	if err = db.Ping(); err != nil {
		log.Printf("WARN: database ping failed: %v", err)
		return
	}
	log.Printf(`{"level":"info","msg":"database connected","service":"broker-api-service","driver":"postgresql"}`)
	_, err = db.Exec(`CREATE TABLE IF NOT EXISTS broker_submissions (id TEXT PRIMARY KEY, broker_id TEXT NOT NULL, client_name TEXT, product_type TEXT, sum_assured NUMERIC(15,2), premium NUMERIC(15,2), status TEXT DEFAULT 'submitted', created_at TIMESTAMPTZ DEFAULT NOW())`)
	if err != nil {
		log.Printf("WARN: table creation failed: %v", err)
	}
}


func handleReady(w http.ResponseWriter, r *http.Request) {
	if db == nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		json.NewEncoder(w).Encode(map[string]string{"status": "not_ready", "reason": "database not initialized"})
		return
	}
	if err := db.Ping(); err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		json.NewEncoder(w).Encode(map[string]string{"status": "not_ready", "reason": "database unreachable"})
		return
	}
	json.NewEncoder(w).Encode(map[string]string{"status": "ready"})
}

func handleLive(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]string{"status": "alive"})
}

func main() {
	initKafka()
	initDB()
	r := chi.NewRouter()
	r.Use(middleware.Logger, middleware.Recoverer)

	r.Use(metricsMiddleware)
	r.Get("/metrics", metricsHandler)
	r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		dbStatus := "disconnected"
		if db != nil {
			if err := db.Ping(); err == nil {
				dbStatus = "connected"
			}
		}
		json.NewEncoder(w).Encode(map[string]string{"status": "healthy", "service": "broker-api-service", "database": dbStatus})
	})
	r.Get("/ready", handleReady)
	r.Get("/live", handleLive)
	r.Route("/api/v1/brokers", func(r chi.Router) {
		r.Get("/", listBrokers)
		r.Post("/", registerBroker)
		r.Get("/{id}/commission", calculateCommission)
		r.Post("/{id}/validate-license", validateLicense)
	})
	r.Get("/metrics", prodMetricsHandler)

	port := os.Getenv("PORT")
	if port == "" { port = "8102" }
	log.Printf("Broker API Service starting on :%s", port)
	handler := prodRecoveryMiddleware(prodMetricsMiddleware(prodTracingMiddleware(prodCorsMiddleware(prodRateLimitMiddleware(r)))))
	srv := &http.Server{
		Addr:         ":"+port,
		Handler:      handler,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 15 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	go func() {
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("Server error: %v", err)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit
	log.Printf(`{"level":"info","msg":"shutting down gracefully","service":"broker-api-service"}`)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		log.Fatalf("Server forced to shutdown: %v", err)
	}
	log.Printf(`{"level":"info","msg":"server stopped","service":"broker-api-service"}`)
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
