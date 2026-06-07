package main

import (
	"database/sql"
	"context"
	"bytes"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"time"
	"math"
	"os/signal"
	"sync"
	"sync/atomic"
	"syscall"

	_ "github.com/lib/pq"
)

// NMIDClient handles integration with Nigerian Motor Insurance Database
type NMIDClient struct {
	baseURL    string
	apiKey     string
	httpClient *http.Client
}

// VehicleInfo represents vehicle information from NMID
type VehicleInfo struct {
	RegistrationNumber string    `json:"registration_number"`
	ChassisNumber      string    `json:"chassis_number"`
	EngineNumber       string    `json:"engine_number"`
	Make               string    `json:"make"`
	Model              string    `json:"model"`
	Year               int       `json:"year"`
	Color              string    `json:"color"`
	VehicleType        string    `json:"vehicle_type"`
	OwnerName          string    `json:"owner_name"`
	OwnerAddress       string    `json:"owner_address"`
	StateOfRegistration string   `json:"state_of_registration"`
	DateOfRegistration time.Time `json:"date_of_registration"`
}

// InsuranceRecord represents an insurance record in NMID
type InsuranceRecord struct {
	PolicyNumber       string    `json:"policy_number"`
	InsuranceCompany   string    `json:"insurance_company"`
	InsuranceType      string    `json:"insurance_type"`
	StartDate          time.Time `json:"start_date"`
	EndDate            time.Time `json:"end_date"`
	PremiumAmount      float64   `json:"premium_amount"`
	SumInsured         float64   `json:"sum_insured"`
	Status             string    `json:"status"`
	CertificateNumber  string    `json:"certificate_number"`
	RegistrationNumber string    `json:"registration_number"`
}

// ClaimHistory represents claim history from NMID
type ClaimHistory struct {
	ClaimID            string    `json:"claim_id"`
	PolicyNumber       string    `json:"policy_number"`
	ClaimDate          time.Time `json:"claim_date"`
	ClaimType          string    `json:"claim_type"`
	ClaimAmount        float64   `json:"claim_amount"`
	SettlementAmount   float64   `json:"settlement_amount"`
	Status             string    `json:"status"`
	InsuranceCompany   string    `json:"insurance_company"`
}

// VerificationRequest represents a verification request
type VerificationRequest struct {
	RegistrationNumber string `json:"registration_number"`
	ChassisNumber      string `json:"chassis_number,omitempty"`
	PolicyNumber       string `json:"policy_number,omitempty"`
}

// VerificationResponse represents verification result
type VerificationResponse struct {
	Valid              bool            `json:"valid"`
	Vehicle            *VehicleInfo    `json:"vehicle,omitempty"`
	CurrentInsurance   *InsuranceRecord `json:"current_insurance,omitempty"`
	InsuranceHistory   []InsuranceRecord `json:"insurance_history,omitempty"`
	ClaimHistory       []ClaimHistory  `json:"claim_history,omitempty"`
	RiskScore          float64         `json:"risk_score"`
	Flags              []string        `json:"flags,omitempty"`
	VerificationTime   time.Time       `json:"verification_time"`
}

// PolicyRegistrationRequest represents request to register policy with NMID
type PolicyRegistrationRequest struct {
	PolicyNumber       string    `json:"policy_number"`
	RegistrationNumber string    `json:"registration_number"`
	ChassisNumber      string    `json:"chassis_number"`
	EngineNumber       string    `json:"engine_number"`
	InsuranceType      string    `json:"insurance_type"`
	StartDate          time.Time `json:"start_date"`
	EndDate            time.Time `json:"end_date"`
	PremiumAmount      float64   `json:"premium_amount"`
	SumInsured         float64   `json:"sum_insured"`
	PolicyholderName   string    `json:"policyholder_name"`
	PolicyholderPhone  string    `json:"policyholder_phone"`
	PolicyholderEmail  string    `json:"policyholder_email"`
}

// PolicyRegistrationResponse represents NMID registration response
type PolicyRegistrationResponse struct {
	Success           bool      `json:"success"`
	CertificateNumber string    `json:"certificate_number"`
	CertificateURL    string    `json:"certificate_url"`
	QRCode            string    `json:"qr_code"`
	RegistrationTime  time.Time `json:"registration_time"`
	Message           string    `json:"message,omitempty"`
}

// NewNMIDClient creates a new NMID client
func NewNMIDClient() *NMIDClient {
	return &NMIDClient{
		baseURL: getEnv("NMID_BASE_URL", "https://api.nigerianmotorinsurancedatabase.gov.ng"),
		apiKey:  os.Getenv("NMID_API_KEY"),
		httpClient: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

// VerifyVehicle verifies vehicle and insurance status
func (c *NMIDClient) VerifyVehicle(ctx context.Context, req VerificationRequest) (*VerificationResponse, error) {
	// In production, this would call the actual NMID API
	// For now, we simulate the response
	
	response := &VerificationResponse{
		Valid: true,
		Vehicle: &VehicleInfo{
			RegistrationNumber:  req.RegistrationNumber,
			ChassisNumber:       req.ChassisNumber,
			Make:                "Toyota",
			Model:               "Camry",
			Year:                2020,
			Color:               "Silver",
			VehicleType:         "Saloon",
			OwnerName:           "John Doe",
			StateOfRegistration: "Lagos",
			DateOfRegistration:  time.Now().AddDate(-3, 0, 0),
		},
		RiskScore:        0.25,
		VerificationTime: time.Now(),
	}
	
	return response, nil
}

// RegisterPolicy registers a new policy with NMID
func (c *NMIDClient) RegisterPolicy(ctx context.Context, req PolicyRegistrationRequest) (*PolicyRegistrationResponse, error) {
	// Generate certificate number
	certNumber := fmt.Sprintf("NMID/%s/%d", req.RegistrationNumber, time.Now().Unix())
	
	response := &PolicyRegistrationResponse{
		Success:           true,
		CertificateNumber: certNumber,
		CertificateURL:    fmt.Sprintf("https://verify.nmid.gov.ng/cert/%s", certNumber),
		QRCode:            fmt.Sprintf("data:image/png;base64,QRCODE_%s", certNumber),
		RegistrationTime:  time.Now(),
		Message:           "Policy successfully registered with NMID",
	}
	
	return response, nil
}

// GetClaimHistory retrieves claim history for a vehicle
func (c *NMIDClient) GetClaimHistory(ctx context.Context, registrationNumber string) ([]ClaimHistory, error) {
	// Simulate claim history lookup
	return []ClaimHistory{}, nil
}

// VerifyInsuranceCertificate verifies an insurance certificate
func (c *NMIDClient) VerifyInsuranceCertificate(ctx context.Context, certificateNumber string) (*InsuranceRecord, error) {
	// Simulate certificate verification
	return &InsuranceRecord{
		CertificateNumber: certificateNumber,
		Status:            "ACTIVE",
	}, nil
}

// CancelPolicy cancels a policy in NMID
func (c *NMIDClient) CancelPolicy(ctx context.Context, policyNumber string, reason string) error {
	// Simulate policy cancellation
	return nil
}

// NMIDService handles NMID integration HTTP endpoints
type NMIDService struct {
	client *NMIDClient
}

func NewNMIDService() *NMIDService {
	return &NMIDService{
		client: NewNMIDClient(),
	}
}

func (s *NMIDService) HandleVerify(w http.ResponseWriter, r *http.Request) {
	var req VerificationRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}
	
	resp, err := s.client.VerifyVehicle(r.Context(), req)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

func (s *NMIDService) HandleRegister(w http.ResponseWriter, r *http.Request) {
	var req PolicyRegistrationRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}
	
	resp, err := s.client.RegisterPolicy(r.Context(), req)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

func (s *NMIDService) HandleHealth(w http.ResponseWriter, r *http.Request) {
	dbStatus := "disconnected"
	if db != nil {
		if err := db.Ping(); err == nil {
			dbStatus = "connected"
		}
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status":    "healthy",
		"service":   "nmid-integration",
		"timestamp": time.Now(),
		"database":  dbStatus,
	})
}

func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
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
	log.Printf(`{"level":"info","msg":"database connected","service":"nmid-integration","driver":"postgresql"}`)
	_, err = db.Exec(`CREATE TABLE IF NOT EXISTS nmid_registrations (id TEXT PRIMARY KEY, agent_id TEXT NOT NULL, nmid_number TEXT, registration_status TEXT DEFAULT 'pending', verified_at TIMESTAMPTZ, expiry_date DATE, created_at TIMESTAMPTZ DEFAULT NOW())`)
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
	service := NewNMIDService()
	
	http.HandleFunc("/api/nmid/verify", service.HandleVerify)
	http.HandleFunc("/api/nmid/register", service.HandleRegister)
	http.HandleFunc("/health", service.HandleHealth)
	http.HandleFunc("/ready", handleReady)
	http.HandleFunc("/live", handleLive)
	http.HandleFunc("/metrics", prodMetricsHandler)
	
	port := getEnv("PORT", "8080")
	log.Printf("NMID Integration Service starting on port %s", port)
	
	handler := prodRecoveryMiddleware(prodMetricsMiddleware(prodTracingMiddleware(prodCorsMiddleware(prodRateLimitMiddleware(http.DefaultServeMux)))))
	srv := &http.Server{
		Addr:         ":" + port,
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
	log.Printf(`{"level":"info","msg":"shutting down gracefully","service":"nmid-integration"}`)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		log.Fatalf("Server forced to shutdown: %v", err)
	}
	log.Printf(`{"level":"info","msg":"server stopped","service":"nmid-integration"}`)
}
