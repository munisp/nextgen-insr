package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"time"
		"os/signal"
	"syscall"
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

func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Request-ID")
		w.Header().Set("Access-Control-Max-Age", "86400")
		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func main() {
	service := NewNMIDService()
	
	http.HandleFunc("/api/nmid/verify", service.HandleVerify)
	http.HandleFunc("/api/nmid/register", service.HandleRegister)
	http.HandleFunc("/health", service.HandleHealth)
	
	port := getEnv("PORT", "8080")
	log.Printf("NMID Integration Service starting on port %s", port)
	
	srv := &http.Server{Addr: ":"+port, Handler: corsMiddleware(http.DefaultServeMux), ReadTimeout: 15 * time.Second, WriteTimeout: 15 * time.Second, IdleTimeout: 60 * time.Second}
	go func() { if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed { log.Fatalf("Server failed: %v", err) } }()
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit
	log.Println("Shutting down gracefully...")
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil { log.Fatalf("Forced shutdown: %v", err) }
	log.Println("Server stopped")
}
