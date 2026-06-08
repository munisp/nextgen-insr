package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strconv"
	"time"
	"database/sql"

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
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status":    "healthy",
		"service":   "nmid-integration",
		"timestamp": time.Now(),
	})
}

func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}


// validateQueryParam validates and sanitizes a query parameter.
func validateQueryParam(r *http.Request, key string, maxLen int) (string, error) {
	val := r.URL.Query().Get(key)
	if len(val) > maxLen {
		return "", fmt.Errorf("parameter %q exceeds max length %d", key, maxLen)
	}
	return val, nil
}

// validateRequiredParam validates a required query parameter.
func validateRequiredParam(r *http.Request, key string, maxLen int) (string, error) {
	val, err := validateQueryParam(r, key, maxLen)
	if err != nil {
		return "", err
	}
	if val == "" {
		return "", fmt.Errorf("parameter %q is required", key)
	}
	return val, nil
}

// validateIntParam validates and converts an integer query parameter.
func validateIntParam(r *http.Request, key string) (int, error) {
	val := r.URL.Query().Get(key)
	if val == "" {
		return 0, nil
	}
	n, err := strconv.Atoi(val)
	if err != nil {
		return 0, fmt.Errorf("parameter %q must be a valid integer", key)
	}
	return n, nil
}


var db *sql.DB

func initDB() {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		dsn = "postgres://ngapp:ngapp@localhost:5432/ngapp?sslmode=disable"
	}
	var err error
	db, err = sql.Open("postgres", dsn)
	if err != nil {
		jsonLog("warn", "database connection failed", "error", err.Error())
		return
	}
	db.SetMaxOpenConns(25)
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(5 * time.Minute)
	db.SetConnMaxIdleTime(2 * time.Minute)
	if err := db.Ping(); err != nil {
		jsonLog("warn", "database ping failed", "error", err.Error())
	} else {
		jsonLog("info", "database connected", "service", "nmid-integration", "driver", "postgresql")
	}
	// Create domain table
	if _, err := db.Exec(`CREATE TABLE IF NOT EXISTS nmid_records (
            id TEXT PRIMARY KEY,
            policy_id TEXT NOT NULL,
            nmid_ref TEXT,
            sync_status TEXT DEFAULT 'pending',
            created_at TIMESTAMP DEFAULT NOW()
        )`); err != nil {
		jsonLog("warn", "create table failed", "error", err.Error())
	} else {
		jsonLog("info", "table ready", "table", "nmid_records")
	}
}

// execInTransaction wraps a function in a database transaction.
func execInTransaction(fn func(tx *sql.Tx) error) error {
	tx, err := db.Begin()
	if err != nil {
		return fmt.Errorf("begin transaction: %w", err)
	}
	defer func() {
		if p := recover(); p != nil {
			_ = tx.Rollback()
			panic(p)
		}
	}()
	if err := fn(tx); err != nil {
		_ = tx.Rollback()
		return err
	}
	return tx.Commit()
}



// otelMiddleware adds trace context propagation to requests.
func otelMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		traceID := r.Header.Get("X-Trace-ID")
		if traceID == "" {
			traceID = r.Header.Get("X-Request-Id")
		}
		spanID := fmt.Sprintf("span-%d", time.Now().UnixNano())
		w.Header().Set("X-Trace-ID", traceID)
		w.Header().Set("X-Span-ID", spanID)
		start := time.Now()
		next.ServeHTTP(w, r)
		duration := time.Since(start)
		if duration > 500*time.Millisecond {
			jsonLog("warn", "slow request", "path", r.URL.Path, "duration_ms", fmt.Sprintf("%.0f", float64(duration.Milliseconds())), "trace_id", traceID)
		}
	})
}



func jsonLog(level, msg string, kvs ...string) {
	entry := fmt.Sprintf(`{"level":"%s","msg":"%s"`, level, msg)
	for i := 0; i+1 < len(kvs); i += 2 {
		entry += fmt.Sprintf(`,"%s":"%s"`, kvs[i], kvs[i+1])
	}
	entry += `,"ts":"` + time.Now().Format(time.RFC3339) + `"}`
	log.Println(entry)
}

func handleReady(w http.ResponseWriter, r *http.Request) {
	status := map[string]string{"status": "ready"}
	code := http.StatusOK
	if db != nil {
		if err := db.Ping(); err != nil {
			status["status"] = "not_ready"
			status["reason"] = "database unreachable"
			code = http.StatusServiceUnavailable
		}
	}
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(status)
}

func handleLive(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]string{"status": "alive"})
}

func main() {
	initDB()
	service := NewNMIDService()
	
	http.HandleFunc("/api/nmid/verify", service.HandleVerify)
	http.HandleFunc("/api/nmid/register", service.HandleRegister)
	http.HandleFunc("/health", service.HandleHealth)
	http.HandleFunc("/ready", handleReady)
	http.HandleFunc("/live", handleLive)
	
	port := getEnv("PORT", "8080")
	log.Printf("NMID Integration Service starting on port %s", port)
	
	if err := http.ListenAndServe(":"+port, nil); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}
