package main

import (
	"bytes"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"context"
	"fmt"
	"math"
	"os/signal"
	"sync"
	"sync/atomic"
	"syscall"
)

// Policy Renewal Automation — automated policy renewal with dynamic pricing
// Business Rules:
// - Auto-renew: Customer opt-in required, 30-day advance notice
// - Pricing: Base premium × claims factor × loyalty discount × inflation adjustment
// - Loyalty discount: 5% after 1 year, 10% after 3 years, 15% after 5 years
// - Claims loading: 0 claims = -5%, 1 claim = 0%, 2+ claims = +15% per claim
// - Grace period: 30 days after expiry (coverage reduced to 50%)
// - Lapse: After grace period → policy terminated, new application required
// - Communication: SMS at -30d, -14d, -7d, -3d, -1d, 0d, +7d, +14d, +30d

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
		log.Printf("[TRACE] %s %s %d %s request_id=%s", r.Method, r.URL.Path, wrapped.statusCode, time.Since(start), reqID)
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

func main() {
	initKafka()
	r := chi.NewRouter()
	r.Use(middleware.Logger, middleware.Recoverer)
	r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]string{"status": "healthy", "service": "policy-renewal-automation"})
	})
	r.Get("/api/v1/renewals/upcoming", upcomingRenewals)
	r.Post("/api/v1/renewals/calculate", calculateRenewalPremium)
	r.Post("/api/v1/renewals/process", processRenewal)
	r.Get("/metrics", prodMetricsHandler)

	port := os.Getenv("PORT")
	if port == "" { port = "8105" }
	log.Printf("Policy Renewal Automation starting on :%s", port)
	handler := prodMetricsMiddleware(prodTracingMiddleware(prodCorsMiddleware(prodRateLimitMiddleware(r))))
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
	log.Println("Shutting down gracefully...")
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		log.Fatalf("Server forced to shutdown: %v", err)
	}
	log.Println("Server stopped")
}

func upcomingRenewals(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]interface{}{
		"renewals": []map[string]interface{}{
			{"policy_id": "POL-2025-001", "customer": "Chioma Nwosu", "expiry": time.Now().AddDate(0, 0, 14).Format("2006-01-02"), "premium": 180000, "status": "notice_sent", "auto_renew": true},
			{"policy_id": "POL-2025-002", "customer": "Ibrahim Musa", "expiry": time.Now().AddDate(0, 0, 7).Format("2006-01-02"), "premium": 350000, "status": "pending_payment", "auto_renew": false},
			{"policy_id": "POL-2025-003", "customer": "Funke Adeyemi", "expiry": time.Now().AddDate(0, 0, -5).Format("2006-01-02"), "premium": 120000, "status": "grace_period", "auto_renew": true},
		},
		"total": 3, "auto_renew_count": 2, "grace_period_count": 1,
	})
}

func calculateRenewalPremium(w http.ResponseWriter, r *http.Request) {
	var body struct {
		BasePremium  float64 `json:"base_premium"`
		YearsActive  int     `json:"years_active"`
		ClaimsCount  int     `json:"claims_count"`
	}
	json.NewDecoder(r.Body).Decode(&body)
	loyaltyDiscount := 0.0
	if body.YearsActive >= 5 { loyaltyDiscount = 0.15 } else if body.YearsActive >= 3 { loyaltyDiscount = 0.10 } else if body.YearsActive >= 1 { loyaltyDiscount = 0.05 }
	claimsFactor := 1.0
	if body.ClaimsCount == 0 { claimsFactor = 0.95 } else if body.ClaimsCount >= 2 { claimsFactor = 1.0 + float64(body.ClaimsCount)*0.15 }
	inflationAdj := 1.05
	newPremium := body.BasePremium * claimsFactor * (1 - loyaltyDiscount) * inflationAdj
	json.NewEncoder(w).Encode(map[string]interface{}{
		"base_premium": body.BasePremium, "new_premium": int(newPremium),
		"loyalty_discount": loyaltyDiscount, "claims_factor": claimsFactor, "inflation": inflationAdj,
		"savings": int(body.BasePremium - newPremium),
	})
}

func processRenewal(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status": "renewed", "new_expiry": time.Now().AddDate(1, 0, 0).Format("2006-01-02"),
		"payment_method": "auto_debit", "confirmation_sent": true,
	})
}
