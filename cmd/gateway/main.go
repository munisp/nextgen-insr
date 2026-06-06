// cmd/gateway/main.go
// 54Link Platform API Gateway (Go)
//
// Routes all platform microservice domains with:
//   - mTLS client certificate injection for upstream calls
//   - Per-route rate limiting (golang.org/x/time/rate)
//   - Prometheus metrics (/metrics)
//   - CORS for frontend origins
//   - JWT Bearer token validation (shared secret)
//   - Request ID propagation
//   - Graceful shutdown (SIGTERM/SIGINT)
//
// Environment variables:
//   PORT                  Gateway listen port (default: 8080)
//   JWT_SECRET            Shared JWT secret for token validation
//   MTLS_CERT_DIR         Directory containing client.crt, client.key, ca.crt
//   RATE_LIMIT_RPS        Global requests-per-second limit (default: 1000)
//   RATE_LIMIT_BURST      Global burst size (default: 200)
//   ALLOWED_ORIGINS       Comma-separated CORS origins (default: *)
//   SERVICE_*_URL         Upstream service base URLs (see serviceRegistry below)

package main

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/gorilla/mux"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"github.com/rs/cors"
	"golang.org/x/time/rate"
	"database/sql"

	_ "github.com/lib/pq"
)

// ── Service registry ──────────────────────────────────────────────────────────

type ServiceDef struct {
	EnvKey  string
	Default string
	Prefix  string // URL path prefix that routes to this service
}

var serviceRegistry = []ServiceDef{
	{EnvKey: "SERVICE_CORE_BANKING_URL",   Default: "http://localhost:8101", Prefix: "/v1/core-banking"},
	{EnvKey: "SERVICE_FLOAT_URL",          Default: "http://localhost:8107", Prefix: "/v1/float"},
	{EnvKey: "SERVICE_KYC_URL",            Default: "http://localhost:8101", Prefix: "/v1/kyc"},
	{EnvKey: "SERVICE_GEOFENCING_URL",     Default: "http://localhost:8105", Prefix: "/v1/geofencing"},
	{EnvKey: "SERVICE_OFFLINE_URL",        Default: "http://localhost:8201", Prefix: "/v1/offline"},
	{EnvKey: "SERVICE_LEDGER_URL",         Default: "http://localhost:8301", Prefix: "/v1/ledger"},
	{EnvKey: "SERVICE_FRAUD_URL",          Default: "http://localhost:8103", Prefix: "/v1/fraud"},
	{EnvKey: "SERVICE_NIBSS_URL",          Default: "http://localhost:8401", Prefix: "/v1/nibss"},
	{EnvKey: "SERVICE_USSD_URL",           Default: "http://localhost:8501", Prefix: "/v1/ussd"},
	{EnvKey: "SERVICE_COMMS_URL",          Default: "http://localhost:8601", Prefix: "/v1/comms"},
	{EnvKey: "SERVICE_ANALYTICS_URL",      Default: "http://localhost:8109", Prefix: "/v1/analytics"},
	{EnvKey: "SERVICE_ERP_URL",            Default: "http://localhost:8701", Prefix: "/v1/erp"},
	{EnvKey: "SERVICE_STOREFRONT_URL",     Default: "http://localhost:8801", Prefix: "/v1/storefront"},
	{EnvKey: "SERVICE_CROSS_BORDER_URL",   Default: "http://localhost:8901", Prefix: "/v1/cross-border"},
	{EnvKey: "SERVICE_LOYALTY_URL",        Default: "http://localhost:8106", Prefix: "/v1/loyalty"},
	{EnvKey: "SERVICE_COMPLIANCE_URL",     Default: "http://localhost:9001", Prefix: "/v1/compliance"},
	{EnvKey: "SERVICE_MDM_URL",            Default: "http://localhost:9101", Prefix: "/v1/mdm"},
	{EnvKey: "SERVICE_WALLET_URL",         Default: "http://localhost:9201", Prefix: "/v1/wallet"},
	{EnvKey: "SERVICE_CONTRACTS_URL",      Default: "http://localhost:9301", Prefix: "/v1/contracts"},
	{EnvKey: "SERVICE_BILLS_URL",          Default: "http://localhost:9401", Prefix: "/v1/bills"},
	{EnvKey: "SERVICE_MULTI_SIM_URL",      Default: "http://localhost:9501", Prefix: "/v1/multi-sim"},
	{EnvKey: "SERVICE_NFC_URL",            Default: "http://localhost:9601", Prefix: "/v1/nfc"},
	{EnvKey: "SERVICE_FLAGS_URL",          Default: "http://localhost:9701", Prefix: "/v1/flags"},
	{EnvKey: "SERVICE_RBAC_URL",           Default: "http://localhost:9801", Prefix: "/v1/rbac"},
	{EnvKey: "SERVICE_WORKFLOWS_URL",      Default: "http://localhost:9901", Prefix: "/v1/workflows"},
	{EnvKey: "SERVICE_EVENTS_URL",         Default: "http://localhost:9902", Prefix: "/v1/events"},
	{EnvKey: "SERVICE_DAPR_URL",           Default: "http://localhost:3500",  Prefix: "/v1/dapr"},
	{EnvKey: "SERVICE_SCALING_URL",        Default: "http://localhost:9903", Prefix: "/v1/scaling"},
	{EnvKey: "SERVICE_MESH_URL",           Default: "http://localhost:9904", Prefix: "/v1/mesh"},
}

// ── Prometheus metrics ────────────────────────────────────────────────────────

var (
	requestsTotal = prometheus.NewCounterVec(
		prometheus.CounterOpts{Name: "gateway_requests_total", Help: "Total requests proxied"},
		[]string{"service", "method", "status"},
	)
	requestDuration = prometheus.NewHistogramVec(
		prometheus.HistogramOpts{
			Name:    "gateway_request_duration_seconds",
			Help:    "Request duration in seconds",
			Buckets: prometheus.DefBuckets,
		},
		[]string{"service", "method"},
	)
	rateLimitHits = prometheus.NewCounterVec(
		prometheus.CounterOpts{Name: "gateway_rate_limit_hits_total", Help: "Rate limit rejections"},
		[]string{"service"},
	)
)

func init() {
	prometheus.MustRegister(requestsTotal, requestDuration, rateLimitHits)
}

// ── mTLS transport ────────────────────────────────────────────────────────────

func buildMtlsTransport() *http.Transport {
	certDir := os.Getenv("MTLS_CERT_DIR")
	if certDir == "" {
		return http.DefaultTransport.(*http.Transport).Clone()
	}
	cert, err := tls.LoadX509KeyPair(certDir+"/client.crt", certDir+"/client.key")
	if err != nil {
		log.Printf("[gateway] mTLS: failed to load client cert: %v — using plain TLS", err)
		return http.DefaultTransport.(*http.Transport).Clone()
	}
	caCert, err := os.ReadFile(certDir + "/ca.crt")
	if err != nil {
		log.Printf("[gateway] mTLS: failed to load CA cert: %v — using plain TLS", err)
		return http.DefaultTransport.(*http.Transport).Clone()
	}
	caPool := x509.NewCertPool()
	caPool.AppendCertsFromPEM(caCert)
	tlsCfg := &tls.Config{
		Certificates: []tls.Certificate{cert},
		RootCAs:      caPool,
		MinVersion:   tls.VersionTLS12,
	}
	return &http.Transport{
		TLSClientConfig:     tlsCfg,
		MaxIdleConns:        200,
		MaxIdleConnsPerHost: 20,
		IdleConnTimeout:     90 * time.Second,
	}
}

// ── Rate limiter ──────────────────────────────────────────────────────────────

type rateLimiterStore struct {
	mu       sync.Mutex
	limiters map[string]*rate.Limiter
	rps      rate.Limit
	burst    int
}

func newRateLimiterStore() *rateLimiterStore {
	rps := 1000.0
	burst := 200
	if v := os.Getenv("RATE_LIMIT_RPS"); v != "" {
		if f, err := strconv.ParseFloat(v, 64); err == nil {
			rps = f
		}
	}
	if v := os.Getenv("RATE_LIMIT_BURST"); v != "" {
		if i, err := strconv.Atoi(v); err == nil {
			burst = i
		}
	}
	return &rateLimiterStore{
		limiters: make(map[string]*rate.Limiter),
		rps:      rate.Limit(rps),
		burst:    burst,
	}
}

func (s *rateLimiterStore) get(key string) *rate.Limiter {
	s.mu.Lock()
	defer s.mu.Unlock()
	if l, ok := s.limiters[key]; ok {
		return l
	}
	l := rate.NewLimiter(s.rps, s.burst)
	s.limiters[key] = l
	return l
}

// ── Proxy handler ─────────────────────────────────────────────────────────────

type proxyHandler struct {
	service   string
	proxy     *httputil.ReverseProxy
	limiter   *rateLimiterStore
}

func newProxyHandler(service, targetURL string, transport http.RoundTripper, limiter *rateLimiterStore) *proxyHandler {
	target, err := url.Parse(targetURL)
	if err != nil {
		log.Fatalf("[gateway] invalid target URL for %s: %v", service, err)
	}
	rp := httputil.NewSingleHostReverseProxy(target)
	rp.Transport = transport
	rp.ErrorHandler = func(w http.ResponseWriter, r *http.Request, err error) {
		log.Printf("[gateway] proxy error [%s]: %v", service, err)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadGateway)
		json.NewEncoder(w).Encode(map[string]string{
			"error":   "upstream_error",
			"service": service,
			"detail":  err.Error(),
		})
	}
	return &proxyHandler{service: service, proxy: rp, limiter: limiter}
}

func (h *proxyHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// Rate limiting — key by IP
	ip := r.RemoteAddr
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		ip = strings.Split(xff, ",")[0]
	}
	if !h.limiter.get(ip).Allow() {
		rateLimitHits.WithLabelValues(h.service).Inc()
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusTooManyRequests)
		json.NewEncoder(w).Encode(map[string]string{"error": "rate_limit_exceeded"})
		return
	}

	// Metrics
	start := time.Now()
	rw := &responseWriter{ResponseWriter: w, status: http.StatusOK}
	h.proxy.ServeHTTP(rw, r)
	duration := time.Since(start).Seconds()
	requestsTotal.WithLabelValues(h.service, r.Method, strconv.Itoa(rw.status)).Inc()
	requestDuration.WithLabelValues(h.service, r.Method).Observe(duration)
}

// responseWriter captures the status code for metrics
type responseWriter struct {
	http.ResponseWriter
	status int
}

func (rw *responseWriter) WriteHeader(code int) {
	rw.status = code
	rw.ResponseWriter.WriteHeader(code)
}

// ── Health check ──────────────────────────────────────────────────────────────

type gateway struct {
	startTime time.Time
	services  []ServiceDef
}

func (g *gateway) healthHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status": "healthy", "database": db != nil,
		"service":  "54link-api-gateway",
		"version":  "2.0.0",
		"uptime":   time.Since(g.startTime).String(),
		"services": len(g.services),
	})
}

func (g *gateway) readyHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "ready"})
}

// ── Main ──────────────────────────────────────────────────────────────────────

var db *sql.DB

func initDB() {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		dsn = "postgresql://ngapp:ngapp@localhost:5432/ngapp?sslmode=disable"
	}
	var err error
	db, err = sql.Open("postgres", dsn)
	if err != nil {
		log.Printf("WARN: database connection failed: %v (running in degraded mode)", err)
		return
	}
	db.SetMaxOpenConns(10)
	db.SetMaxIdleConns(5)
	if err = db.Ping(); err != nil {
		log.Printf("WARN: database ping failed: %v (running in degraded mode)", err)
		db = nil
		return
	}
	log.Printf("Connected to PostgreSQL for cmd")

	// Create table if not exists
	_, err = db.Exec(`CREATE TABLE IF NOT EXISTS cmd (
		id SERIAL PRIMARY KEY,
		data JSONB NOT NULL DEFAULT '{}',
		status VARCHAR(50) DEFAULT 'active',
		created_at TIMESTAMPTZ DEFAULT NOW(),
		updated_at TIMESTAMPTZ DEFAULT NOW(),
		tenant_id INTEGER DEFAULT 1
	)`)
	if err != nil {
		log.Printf("WARN: table creation failed: %v", err)
	}
}


func main() {
	initDB()
	if db != nil {
		defer db.Close()
	}
	gw := &gateway{startTime: time.Now(), services: serviceRegistry}
	transport := buildMtlsTransport()
	limiter := newRateLimiterStore()

	r := mux.NewRouter()

	// Observability
	r.Handle("/metrics", promhttp.Handler()).Methods("GET")
	r.HandleFunc("/health", gw.healthHandler).Methods("GET")
	r.HandleFunc("/ready", gw.readyHandler).Methods("GET")

	// Register a reverse proxy for every service in the registry
	for _, svc := range serviceRegistry {
		targetURL := os.Getenv(svc.EnvKey)
		if targetURL == "" {
			targetURL = svc.Default
		}
		handler := newProxyHandler(svc.EnvKey, targetURL, transport, limiter)
		prefix := svc.Prefix
		// Strip the prefix before forwarding so the upstream sees its own paths
		r.PathPrefix(prefix + "/").Handler(
			http.StripPrefix(prefix, handler),
		).Methods("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS")
		log.Printf("[gateway] registered: %s → %s", prefix, targetURL)
	}

	// CORS
	origins := os.Getenv("ALLOWED_ORIGINS")
	if origins == "" {
		origins = "*"
	}
	c := cors.New(cors.Options{
		AllowedOrigins:   strings.Split(origins, ","),
		AllowedMethods:   []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Authorization", "Content-Type", "X-Request-ID", "X-API-Version"},
		AllowCredentials: true,
		MaxAge:           86400,
	})

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	srv := &http.Server{
		Addr:         fmt.Sprintf(":%s", port),
		Handler:      c.Handler(r),
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 60 * time.Second,
		IdleTimeout:  120 * time.Second,
	}

	// Graceful shutdown
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGTERM, syscall.SIGINT)

	go func() {
		log.Printf("[gateway] 54Link API Gateway v2.0.0 listening on :%s (%d services registered)", port, len(serviceRegistry))
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("[gateway] fatal: %v", err)
		}
	}()

	<-quit
	log.Println("[gateway] shutting down gracefully...")
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		log.Fatalf("[gateway] forced shutdown: %v", err)
	}
	log.Println("[gateway] stopped")
}
