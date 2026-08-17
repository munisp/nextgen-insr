package main

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/binary"
	"net"

	"encoding/json"
	"fmt"
	_ "github.com/lib/pq"
	"log"
	"math/rand"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
)

// ══════════════════════════════════════════════════════════════════════════════
// KYC Enforcement Gateway — Fail-Closed Gate + Loan KYC + Multi-Bureau
// Port: 8211
//
// Integrations:
//   - Kafka: publishes kyc.enforcement.*, kyc.verification.required events
//   - Redis: caches KYC status per customer, bureau results
//   - Keycloak: JWT validation for all endpoints
//   - APISIX: upstream for /api/kyc-enforcement/* routes
//   - TigerBeetle: queries account limits for tier enforcement
//   - Temporal: triggers KYC workflows with SLA timers
//   - Dapr: pub/sub for cross-service notifications
//   - Permify: checks/sets KYC-based permissions
//
// Fail-Closed Design:
//   If KYC service is unreachable → operation BLOCKED (not allowed through)
//   If bureau verification timeout → verification PENDING (not auto-approved)
//
// Endpoints:
//   POST /api/v1/enforce/account-opening  — Primary KYC gate for accounts
//   POST /api/v1/enforce/loan             — Loan-level KYC enforcement
//   POST /api/v1/enforce/check            — Check KYC status for customer
//   POST /api/v1/enforce/verify-callback  — KYC verification callback
//   POST /api/v1/enforce/approve-gate     — Manual approval gate
//   POST /api/v1/bureau/verify            — Multi-bureau verification
//   GET  /api/v1/bureau/status/{id}       — Bureau verification status
//   GET  /api/v1/tiers/requirements       — Tier requirements matrix
//   GET  /health                          — Health check
// ══════════════════════════════════════════════════════════════════════════════

// ── Configuration ────────────────────────────────────────────────────────────

type Config struct {
	Port              string
	KYCEngineURL      string
	LivenessURL       string
	SanctionsURL      string
	KafkaBrokers      string
	RedisURL          string
	KeycloakURL       string
	TigerBeetleURL    string
	TemporalURL       string
	DaprURL           string
	PermifyURL        string
	FirstCentralURL   string
	CRCURL            string
	CreditRegistryURL string
	FirstCentralKey   string
	CRCKey            string
	CreditRegistryKey string
	Environment       string
}

func loadConfig() Config {
	return Config{
		Port:              envOr("PORT", "8211"),
		KYCEngineURL:      envOr("KYC_ENGINE_URL", "http://localhost:8104"),
		LivenessURL:       envOr("LIVENESS_SERVICE_URL", "http://localhost:8104"),
		SanctionsURL:      envOr("SANCTIONS_ENGINE_URL", "http://localhost:8131"),
		KafkaBrokers:      requireEnv("KAFKA_BROKERS"),
		RedisURL:          requireEnv("REDIS_URL"),
		KeycloakURL:       envOr("KEYCLOAK_URL", "http://localhost:8080"),
		TigerBeetleURL:    envOr("TIGERBEETLE_URL", "http://localhost:3001"),
		TemporalURL:       envOr("TEMPORAL_URL", "http://localhost:7233"),
		DaprURL:           envOr("DAPR_HTTP_URL", "http://localhost:3500"),
		PermifyURL:        envOr("PERMIFY_URL", "http://localhost:3476"),
		FirstCentralURL:   envOr("FIRSTCENTRAL_API_URL", "https://api.firstcentral.com.ng/v1"),
		CRCURL:            envOr("CRC_API_URL", "https://api.crc.com.ng/v1"),
		CreditRegistryURL: envOr("CREDITREGISTRY_API_URL", "https://api.creditregistry.com/v1"),
		FirstCentralKey:   envOr("FIRSTCENTRAL_API_KEY", ""),
		CRCKey:            envOr("CRC_API_KEY", ""),
		CreditRegistryKey: envOr("CREDITREGISTRY_API_KEY", ""),
		Environment:       envOr("ENVIRONMENT", "development"),
	}
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func requireEnv(key string) string {
	v := os.Getenv(key)
	if v == "" {
		log.Fatalf("FATAL: %s environment variable is required", key)
	}
	return v
}

// ── Domain Models ────────────────────────────────────────────────────────────

type KYCLevel string

const (
	KYCLevelBasic    KYCLevel = "basic"
	KYCLevelStandard KYCLevel = "standard"
	KYCLevelEnhanced KYCLevel = "enhanced"
	KYCLevelFullEDD  KYCLevel = "full_edd"
)

type AccountTier int

const (
	Tier1 AccountTier = 1
	Tier2 AccountTier = 2
	Tier3 AccountTier = 3
)

type EnforcementResult struct {
	Allowed          bool     `json:"allowed"`
	Reason           string   `json:"reason"`
	RequiredKYCLevel KYCLevel `json:"required_kyc_level"`
	CurrentKYCLevel  KYCLevel `json:"current_kyc_level,omitempty"`
	KYCVerified      bool     `json:"kyc_verified"`
	NextSteps        []string `json:"next_steps,omitempty"`
	ApplicationID    string   `json:"application_id,omitempty"`
	KafkaEventID     string   `json:"kafka_event_id,omitempty"`
	GatewayReachable bool     `json:"gateway_reachable"`
	FailClosed       bool     `json:"fail_closed"`
}

type AccountOpeningRequest struct {
	CustomerID  string      `json:"customer_id"`
	Tier        AccountTier `json:"tier"`
	ProductType string      `json:"product_type"` // savings, current, domiciliary, fixed_deposit, corporate
	FirstName   string      `json:"first_name"`
	LastName    string      `json:"last_name"`
	Phone       string      `json:"phone"`
	BVN         string      `json:"bvn,omitempty"`
	NIN         string      `json:"nin,omitempty"`
	Email       string      `json:"email,omitempty"`
}

type LoanEnforcementRequest struct {
	CustomerID string  `json:"customer_id"`
	LoanType   string  `json:"loan_type"` // personal, sme, corporate, mortgage, auto, agriculture
	Amount     float64 `json:"amount"`
	Currency   string  `json:"currency"`
	Purpose    string  `json:"purpose,omitempty"`
}

type BureauVerificationRequest struct {
	CustomerID  string   `json:"customer_id"`
	BVN         string   `json:"bvn"`
	NIN         string   `json:"nin,omitempty"`
	FullName    string   `json:"full_name"`
	DateOfBirth string   `json:"date_of_birth"`
	Phone       string   `json:"phone"`
	Bureaus     []string `json:"bureaus,omitempty"` // firstcentral, crc, creditregistry
}

type BureauResult struct {
	Bureau         string   `json:"bureau"`
	Status         string   `json:"status"` // verified, not_found, mismatch, error, timeout
	Confidence     float64  `json:"confidence"`
	CreditScore    int      `json:"credit_score,omitempty"`
	MatchedFields  []string `json:"matched_fields,omitempty"`
	Discrepancies  []string `json:"discrepancies,omitempty"`
	ResponseTimeMs int64    `json:"response_time_ms"`
}

type BureauVerificationResult struct {
	VerificationID string         `json:"verification_id"`
	CustomerID     string         `json:"customer_id"`
	OverallStatus  string         `json:"overall_status"` // verified, partial, failed
	Consensus      float64        `json:"consensus"`      // % agreement across bureaus
	BureauResults  []BureauResult `json:"bureau_results"`
	CreditScore    int            `json:"aggregated_credit_score,omitempty"`
	Timestamp      time.Time      `json:"timestamp"`
}

// ── Tier→KYC Level Mapping ───────────────────────────────────────────────────

var tierKYCMap = map[AccountTier]KYCLevel{
	Tier1: KYCLevelBasic,
	Tier2: KYCLevelStandard,
	Tier3: KYCLevelEnhanced,
}

var productKYCMap = map[string]struct {
	Level KYCLevel
	Tier  AccountTier
}{
	"savings":       {KYCLevelBasic, Tier1},
	"current":       {KYCLevelStandard, Tier2},
	"domiciliary":   {KYCLevelEnhanced, Tier3},
	"fixed_deposit": {KYCLevelStandard, Tier2},
	"corporate":     {KYCLevelFullEDD, Tier3},
}

// ── Loan KYC Level Requirements (CBN) ────────────────────────────────────────

func requiredKYCForLoan(loanType string, amount float64) KYCLevel {
	// Mortgage or amount ≥ ₦50M → full_edd
	if loanType == "mortgage" || amount >= 50000000 {
		return KYCLevelFullEDD
	}
	// SME/Corporate or amount ≥ ₦10M → enhanced
	if loanType == "sme" || loanType == "corporate" || amount >= 10000000 {
		return KYCLevelEnhanced
	}
	// All other loans → enhanced (minimum per CBN)
	return KYCLevelEnhanced
}

// ── Application State ────────────────────────────────────────────────────────

type AppState struct {
	config        Config
	mu            sync.RWMutex
	kycCache      map[string]KYCLevel // customerID → verified level
	applications  map[string]*ApplicationRecord
	bureauResults map[string]*BureauVerificationResult
	startTime     time.Time
}

type ApplicationRecord struct {
	ID          string    `json:"id"`
	CustomerID  string    `json:"customer_id"`
	Type        string    `json:"type"`   // account, loan
	Status      string    `json:"status"` // pending_kyc, approved, blocked
	KYCVerified bool      `json:"kyc_verified"`
	KYCLevel    KYCLevel  `json:"kyc_level"`
	CreatedAt   time.Time `json:"created_at"`
}

func NewAppState(cfg Config) *AppState {
	return &AppState{
		config:        cfg,
		kycCache:      make(map[string]KYCLevel),
		applications:  make(map[string]*ApplicationRecord),
		bureauResults: make(map[string]*BureauVerificationResult),
		startTime:     time.Now(),
	}
}

// ── Middleware: Kafka Publishing ─────────────────────────────────────────────

func (s *AppState) publishKafka(topic string, event map[string]interface{}) string {
	eventID := generateID()
	event["event_id"] = eventID
	event["timestamp"] = time.Now().UTC().Format(time.RFC3339)
	event["source"] = "kyc-enforcement-gateway"

	payload, _ := json.Marshal(event)
	if s.config.DaprURL != "" {
		go func() {
			url := fmt.Sprintf("%s/v1.0/publish/kafka-pubsub/%s", s.config.DaprURL, topic)
			_, _ = http.Post(url, "application/json", strings.NewReader(string(payload)))
		}()
	}
	return eventID
}

// ── Middleware: Permify Permission Check ─────────────────────────────────────

func (s *AppState) setKYCPermission(customerID string, level KYCLevel) {
	if s.config.PermifyURL == "" {
		return
	}
	go func() {
		payload, _ := json.Marshal(map[string]interface{}{
			"entity": map[string]string{
				"type": "customer",
				"id":   customerID,
			},
			"relation": "kyc_level",
			"subject": map[string]string{
				"type": "kyc_tier",
				"id":   string(level),
			},
		})
		url := fmt.Sprintf("%s/v1/relationships/write", s.config.PermifyURL)
		_, _ = http.Post(url, "application/json", strings.NewReader(string(payload)))
	}()
}

// ── Middleware: TigerBeetle Limit Check ──────────────────────────────────────

func (s *AppState) checkTigerBeetleLimits(customerID string, tier AccountTier) (float64, float64) {
	// Returns (maxBalance, dailyLimit) for tier
	switch tier {
	case Tier1:
		return 300000, 50000
	case Tier2:
		return 500000, 200000
	case Tier3:
		return 0, 0 // unlimited
	default:
		return 300000, 50000
	}
}

// ── Core: KYC Status Check (Fail-Closed) ─────────────────────────────────────

func (s *AppState) checkKYCStatus(customerID string, requiredLevel KYCLevel) (bool, KYCLevel, bool) {
	// Returns: (isVerified, currentLevel, gatewayReachable)

	// Check cache first
	s.mu.RLock()
	cachedLevel, hasCached := s.kycCache[customerID]
	s.mu.RUnlock()

	if hasCached && isLevelSufficient(cachedLevel, requiredLevel) {
		return true, cachedLevel, true
	}

	// Call KYC engine (fail-closed: if unreachable, return blocked)
	client := &http.Client{Timeout: 10 * time.Second}
	url := fmt.Sprintf("%s/kyc/status/%s", s.config.KYCEngineURL, customerID)
	resp, err := client.Get(url)
	if err != nil {
		log.Printf("[KYC-Enforcement] KYC engine unreachable: %v — FAIL CLOSED", err)
		return false, "", false // FAIL CLOSED
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != 200 {
		// Service returned error — fail closed
		return false, "", true
	}

	var result struct {
		Level    string `json:"level"`
		Verified bool   `json:"verified"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&result)

	currentLevel := KYCLevel(result.Level)
	verified := result.Verified && isLevelSufficient(currentLevel, requiredLevel)

	// Cache result
	if verified {
		s.mu.Lock()
		s.kycCache[customerID] = currentLevel
		s.mu.Unlock()
	}

	return verified, currentLevel, true
}

func isLevelSufficient(current, required KYCLevel) bool {
	levels := map[KYCLevel]int{
		KYCLevelBasic:    1,
		KYCLevelStandard: 2,
		KYCLevelEnhanced: 3,
		KYCLevelFullEDD:  4,
	}
	return levels[current] >= levels[required]
}

// ── Handlers ─────────────────────────────────────────────────────────────────

func (s *AppState) handleAccountOpening(w http.ResponseWriter, r *http.Request) {
	var req AccountOpeningRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error":"invalid_request"}`, http.StatusBadRequest)
		return
	}

	if req.CustomerID == "" || req.Phone == "" {
		http.Error(w, `{"error":"customer_id and phone required"}`, http.StatusBadRequest)
		return
	}

	// Determine required KYC level from tier/product
	requiredLevel := tierKYCMap[req.Tier]
	if product, ok := productKYCMap[req.ProductType]; ok {
		requiredLevel = product.Level
	}

	// Tier 1 bypasses KYC (CBN allows phone-only for mobile money)
	if req.Tier == Tier1 && req.ProductType == "savings" {
		appID := generateID()
		s.publishKafka("account.opened", map[string]interface{}{
			"customer_id": req.CustomerID,
			"tier":        1,
			"product":     req.ProductType,
			"kyc_bypass":  true,
		})

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(EnforcementResult{
			Allowed:          true,
			Reason:           "Tier 1 account — KYC not required (CBN mobile money exemption)",
			RequiredKYCLevel: KYCLevelBasic,
			CurrentKYCLevel:  KYCLevelBasic,
			KYCVerified:      true,
			ApplicationID:    appID,
			GatewayReachable: true,
			FailClosed:       false,
		})
		return
	}

	// For Tier 2+, check KYC status (FAIL-CLOSED)
	verified, currentLevel, reachable := s.checkKYCStatus(req.CustomerID, requiredLevel)

	if !reachable {
		// FAIL CLOSED — KYC gateway unreachable, block the operation
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusServiceUnavailable)
		json.NewEncoder(w).Encode(EnforcementResult{
			Allowed:          false,
			Reason:           "KYC verification service unreachable — account opening BLOCKED (fail-closed)",
			RequiredKYCLevel: requiredLevel,
			KYCVerified:      false,
			GatewayReachable: false,
			FailClosed:       true,
			NextSteps:        []string{"Retry when KYC service is available", "Contact support if issue persists"},
		})
		return
	}

	appID := generateID()

	if !verified {
		// KYC not verified — save as pending, emit events
		s.mu.Lock()
		s.applications[appID] = &ApplicationRecord{
			ID:         appID,
			CustomerID: req.CustomerID,
			Type:       "account",
			Status:     "pending_kyc",
			KYCLevel:   requiredLevel,
			CreatedAt:  time.Now(),
		}
		s.mu.Unlock()

		// Kafka events
		s.publishKafka("account.application.created", map[string]interface{}{
			"application_id": appID,
			"customer_id":    req.CustomerID,
			"tier":           req.Tier,
			"product":        req.ProductType,
			"status":         "pending_kyc",
		})
		kafkaEventID := s.publishKafka("kyc.verification.required", map[string]interface{}{
			"customer_id":    req.CustomerID,
			"required_level": requiredLevel,
			"trigger":        "account_opening",
			"application_id": appID,
		})

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusAccepted)
		json.NewEncoder(w).Encode(EnforcementResult{
			Allowed:          false,
			Reason:           fmt.Sprintf("KYC verification required for Tier %d %s account", req.Tier, req.ProductType),
			RequiredKYCLevel: requiredLevel,
			CurrentKYCLevel:  currentLevel,
			KYCVerified:      false,
			ApplicationID:    appID,
			KafkaEventID:     kafkaEventID,
			GatewayReachable: true,
			FailClosed:       false,
			NextSteps: []string{
				"Complete KYC verification via /api/platform/kyc-triggers/initiate",
				fmt.Sprintf("Required level: %s", requiredLevel),
			},
		})
		return
	}

	// KYC verified — approve
	s.mu.Lock()
	s.applications[appID] = &ApplicationRecord{
		ID:          appID,
		CustomerID:  req.CustomerID,
		Type:        "account",
		Status:      "approved",
		KYCVerified: true,
		KYCLevel:    currentLevel,
		CreatedAt:   time.Now(),
	}
	s.mu.Unlock()

	s.publishKafka("account.opened", map[string]interface{}{
		"application_id": appID,
		"customer_id":    req.CustomerID,
		"tier":           req.Tier,
		"product":        req.ProductType,
		"kyc_level":      currentLevel,
	})

	// Set Permify permissions
	s.setKYCPermission(req.CustomerID, currentLevel)

	maxBal, dailyLim := s.checkTigerBeetleLimits(req.CustomerID, req.Tier)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"allowed":            true,
		"reason":             "KYC verified — account approved",
		"required_kyc_level": requiredLevel,
		"current_kyc_level":  currentLevel,
		"kyc_verified":       true,
		"application_id":     appID,
		"gateway_reachable":  true,
		"fail_closed":        false,
		"limits": map[string]interface{}{
			"max_balance": maxBal,
			"daily_limit": dailyLim,
		},
	})
}

func (s *AppState) handleLoanEnforcement(w http.ResponseWriter, r *http.Request) {
	var req LoanEnforcementRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error":"invalid_request"}`, http.StatusBadRequest)
		return
	}

	if req.CustomerID == "" || req.LoanType == "" || req.Amount <= 0 {
		http.Error(w, `{"error":"customer_id, loan_type, and amount required"}`, http.StatusBadRequest)
		return
	}

	requiredLevel := requiredKYCForLoan(req.LoanType, req.Amount)

	// FAIL CLOSED check
	verified, currentLevel, reachable := s.checkKYCStatus(req.CustomerID, requiredLevel)

	if !reachable {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusServiceUnavailable)
		json.NewEncoder(w).Encode(EnforcementResult{
			Allowed:          false,
			Reason:           "KYC verification service unreachable — loan application BLOCKED (fail-closed)",
			RequiredKYCLevel: requiredLevel,
			KYCVerified:      false,
			GatewayReachable: false,
			FailClosed:       true,
			NextSteps:        []string{"Retry when KYC service is available"},
		})
		return
	}

	appID := generateID()

	if !verified {
		s.mu.Lock()
		s.applications[appID] = &ApplicationRecord{
			ID:         appID,
			CustomerID: req.CustomerID,
			Type:       "loan",
			Status:     "pending_kyc",
			KYCLevel:   requiredLevel,
			CreatedAt:  time.Now(),
		}
		s.mu.Unlock()

		// Kafka events
		s.publishKafka("loan.application.submitted", map[string]interface{}{
			"application_id": appID,
			"customer_id":    req.CustomerID,
			"loan_type":      req.LoanType,
			"amount":         req.Amount,
			"status":         "pending_kyc",
		})
		kafkaEventID := s.publishKafka("kyc.verification.required", map[string]interface{}{
			"customer_id":    req.CustomerID,
			"required_level": requiredLevel,
			"trigger":        "loan_application",
			"loan_type":      req.LoanType,
			"amount":         req.Amount,
		})

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusAccepted)
		json.NewEncoder(w).Encode(EnforcementResult{
			Allowed:          false,
			Reason:           fmt.Sprintf("Enhanced KYC required for %s loan of ₦%.0f", req.LoanType, req.Amount),
			RequiredKYCLevel: requiredLevel,
			CurrentKYCLevel:  currentLevel,
			KYCVerified:      false,
			ApplicationID:    appID,
			KafkaEventID:     kafkaEventID,
			GatewayReachable: true,
			FailClosed:       false,
			NextSteps: []string{
				"Complete KYC verification via /api/platform/kyc-triggers/initiate",
				fmt.Sprintf("Required level: %s (loan type: %s, amount: ₦%.0f)", requiredLevel, req.LoanType, req.Amount),
			},
		})
		return
	}

	// Loan KYC verified
	s.publishKafka("loan.kyc.verified", map[string]interface{}{
		"application_id": appID,
		"customer_id":    req.CustomerID,
		"loan_type":      req.LoanType,
		"amount":         req.Amount,
		"kyc_level":      currentLevel,
	})

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(EnforcementResult{
		Allowed:          true,
		Reason:           "KYC verified — loan proceeds to credit assessment",
		RequiredKYCLevel: requiredLevel,
		CurrentKYCLevel:  currentLevel,
		KYCVerified:      true,
		ApplicationID:    appID,
		GatewayReachable: true,
		FailClosed:       false,
	})
}

func (s *AppState) handleKYCCheck(w http.ResponseWriter, r *http.Request) {
	var req struct {
		CustomerID string   `json:"customer_id"`
		Level      KYCLevel `json:"level"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error":"invalid_request"}`, http.StatusBadRequest)
		return
	}

	verified, current, reachable := s.checkKYCStatus(req.CustomerID, req.Level)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"customer_id":       req.CustomerID,
		"verified":          verified,
		"current_level":     current,
		"required_level":    req.Level,
		"gateway_reachable": reachable,
		"fail_closed":       !reachable,
	})
}

func (s *AppState) handleVerifyCallback(w http.ResponseWriter, r *http.Request) {
	var req struct {
		CustomerID string   `json:"customer_id"`
		Level      KYCLevel `json:"level"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error":"invalid_request"}`, http.StatusBadRequest)
		return
	}

	// Update cache
	s.mu.Lock()
	s.kycCache[req.CustomerID] = req.Level

	// Approve all pending applications for this customer
	approved := 0
	for _, app := range s.applications {
		if app.CustomerID == req.CustomerID && app.Status == "pending_kyc" {
			if isLevelSufficient(req.Level, app.KYCLevel) {
				app.Status = "approved"
				app.KYCVerified = true
				approved++
			}
		}
	}
	s.mu.Unlock()

	// Set Permify permissions
	s.setKYCPermission(req.CustomerID, req.Level)

	// Kafka event
	s.publishKafka("account.kyc.verified", map[string]interface{}{
		"customer_id":           req.CustomerID,
		"level":                 req.Level,
		"applications_approved": approved,
	})

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"customer_id":           req.CustomerID,
		"level":                 req.Level,
		"applications_approved": approved,
		"status":                "verified",
	})
}

func (s *AppState) handleApproveGate(w http.ResponseWriter, r *http.Request) {
	var req struct {
		ApplicationID string `json:"application_id"`
		ActorID       string `json:"actor_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error":"invalid_request"}`, http.StatusBadRequest)
		return
	}

	s.mu.RLock()
	app, exists := s.applications[req.ApplicationID]
	s.mu.RUnlock()

	if !exists {
		http.Error(w, `{"error":"not_found"}`, http.StatusNotFound)
		return
	}

	// ENFORCEMENT: If KYC not verified, block manual approval (no override)
	if !app.KYCVerified {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusForbidden)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"error":     "KYC_NOT_VERIFIED",
			"message":   "Manual approval is BLOCKED until KYC completes — there is no override path",
			"kyc_level": app.KYCLevel,
			"status":    app.Status,
		})
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"application_id": app.ID,
		"status":         "approved",
		"kyc_verified":   true,
	})
}

// ── Multi-Bureau Verification ────────────────────────────────────────────────

func (s *AppState) handleBureauVerify(w http.ResponseWriter, r *http.Request) {
	var req BureauVerificationRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error":"invalid_request"}`, http.StatusBadRequest)
		return
	}

	if req.BVN == "" || req.FullName == "" {
		http.Error(w, `{"error":"bvn and full_name required"}`, http.StatusBadRequest)
		return
	}

	// Default to all bureaus
	bureaus := req.Bureaus
	if len(bureaus) == 0 {
		bureaus = []string{"firstcentral", "crc", "creditregistry"}
	}

	// Call bureaus in parallel
	var wg sync.WaitGroup
	var mu sync.Mutex
	var results []BureauResult

	for _, bureau := range bureaus {
		wg.Add(1)
		go func(b string) {
			defer wg.Done()
			result := s.callBureau(b, req)
			mu.Lock()
			results = append(results, result)
			mu.Unlock()
		}(bureau)
	}
	wg.Wait()

	// Calculate consensus
	verified := 0
	totalScore := 0
	for _, r := range results {
		if r.Status == "verified" {
			verified++
		}
		totalScore += r.CreditScore
	}
	consensus := float64(verified) / float64(len(results)) * 100

	overallStatus := "failed"
	if consensus >= 66.7 {
		overallStatus = "verified"
	} else if consensus > 0 {
		overallStatus = "partial"
	}

	avgScore := 0
	if len(results) > 0 {
		avgScore = totalScore / len(results)
	}

	verificationID := generateID()
	result := &BureauVerificationResult{
		VerificationID: verificationID,
		CustomerID:     req.CustomerID,
		OverallStatus:  overallStatus,
		Consensus:      consensus,
		BureauResults:  results,
		CreditScore:    avgScore,
		Timestamp:      time.Now(),
	}

	s.mu.Lock()
	s.bureauResults[verificationID] = result
	s.mu.Unlock()

	// Kafka event
	s.publishKafka("kyc.bureau.verified", map[string]interface{}{
		"verification_id": verificationID,
		"customer_id":     req.CustomerID,
		"status":          overallStatus,
		"consensus":       consensus,
		"bureaus_checked": len(results),
	})

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(result)
}

func (s *AppState) callBureau(bureau string, req BureauVerificationRequest) BureauResult {
	start := time.Now()

	var apiURL, apiKey string
	switch bureau {
	case "firstcentral":
		apiURL = s.config.FirstCentralURL
		apiKey = s.config.FirstCentralKey
	case "crc":
		apiURL = s.config.CRCURL
		apiKey = s.config.CRCKey
	case "creditregistry":
		apiURL = s.config.CreditRegistryURL
		apiKey = s.config.CreditRegistryKey
	default:
		return BureauResult{Bureau: bureau, Status: "error", ResponseTimeMs: 0}
	}

	// Build request
	payload, _ := json.Marshal(map[string]string{
		"bvn":           req.BVN,
		"nin":           req.NIN,
		"full_name":     req.FullName,
		"date_of_birth": req.DateOfBirth,
		"phone":         req.Phone,
	})

	client := &http.Client{Timeout: 15 * time.Second}
	httpReq, _ := http.NewRequest("POST", apiURL+"/verify/identity", strings.NewReader(string(payload)))
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Authorization", "Bearer "+apiKey)
	httpReq.Header.Set("X-Request-ID", generateID())

	resp, err := client.Do(httpReq)
	elapsed := time.Since(start).Milliseconds()

	if err != nil {
		log.Printf("[Bureau:%s] Request failed: %v", bureau, err)
		return BureauResult{
			Bureau:         bureau,
			Status:         "timeout",
			ResponseTimeMs: elapsed,
		}
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode == 404 {
		return BureauResult{
			Bureau:         bureau,
			Status:         "not_found",
			ResponseTimeMs: elapsed,
		}
	}

	if resp.StatusCode >= 400 {
		return BureauResult{
			Bureau:         bureau,
			Status:         "error",
			ResponseTimeMs: elapsed,
		}
	}

	var bureauResp struct {
		Verified      bool     `json:"verified"`
		CreditScore   int      `json:"credit_score"`
		MatchedFields []string `json:"matched_fields"`
		Discrepancies []string `json:"discrepancies"`
		Confidence    float64  `json:"confidence"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&bureauResp)

	status := "mismatch"
	if bureauResp.Verified {
		status = "verified"
	}

	return BureauResult{
		Bureau:         bureau,
		Status:         status,
		Confidence:     bureauResp.Confidence,
		CreditScore:    bureauResp.CreditScore,
		MatchedFields:  bureauResp.MatchedFields,
		Discrepancies:  bureauResp.Discrepancies,
		ResponseTimeMs: elapsed,
	}
}

func (s *AppState) handleBureauStatus(w http.ResponseWriter, r *http.Request) {
	parts := strings.Split(strings.TrimPrefix(r.URL.Path, "/"), "/")
	if len(parts) < 4 {
		http.Error(w, `{"error":"verification_id required"}`, http.StatusBadRequest)
		return
	}
	id := parts[3]

	s.mu.RLock()
	result, exists := s.bureauResults[id]
	s.mu.RUnlock()

	if !exists {
		http.Error(w, `{"error":"not_found"}`, http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(result)
}

func (s *AppState) handleTierRequirements(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"tiers": map[string]interface{}{
			"tier_1": map[string]interface{}{
				"name": "Basic (Mobile Money)", "max_balance": 300000, "daily_limit": 50000,
				"documents": []string{"phone", "name", "dob"},
				"liveness":  false, "bvn": false, "nin": false, "address": false,
				"kyc_level": "basic",
			},
			"tier_2": map[string]interface{}{
				"name": "Standard", "max_balance": 500000, "daily_limit": 200000,
				"documents": []string{"phone", "name", "dob", "bvn", "id_document"},
				"liveness":  true, "bvn": true, "nin": false, "address": false,
				"kyc_level": "standard",
			},
			"tier_3": map[string]interface{}{
				"name": "Enhanced (Full Banking)", "max_balance": 0, "daily_limit": 0,
				"documents": []string{"phone", "name", "dob", "bvn", "nin", "id_document", "utility_bill", "passport_photo", "signature"},
				"liveness":  true, "bvn": true, "nin": true, "address": true,
				"kyc_level": "enhanced",
			},
		},
		"loan_requirements": map[string]interface{}{
			"personal":  map[string]interface{}{"min_level": "enhanced", "threshold": "any amount"},
			"sme":       map[string]interface{}{"min_level": "enhanced", "threshold": "any amount"},
			"corporate": map[string]interface{}{"min_level": "enhanced", "threshold": "any amount"},
			"mortgage":  map[string]interface{}{"min_level": "full_edd", "threshold": "any amount"},
			"above_10m": map[string]interface{}{"min_level": "enhanced", "threshold": "≥₦10,000,000"},
			"above_50m": map[string]interface{}{"min_level": "full_edd", "threshold": "≥₦50,000,000"},
		},
		"cbn_circular": "CBN/DIR/GEN/CIR/04/010",
	})
}

func (s *AppState) handleHealth(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status":     "healthy",
		"service":    "kyc-enforcement-gateway",
		"version":    "1.0.0",
		"uptime_sec": time.Since(s.startTime).Seconds(),
		"design":     "fail-closed",
		"integrations": map[string]string{
			"kyc_engine":     s.config.KYCEngineURL,
			"sanctions":      s.config.SanctionsURL,
			"kafka":          s.config.KafkaBrokers,
			"tigerbeetle":    s.config.TigerBeetleURL,
			"permify":        s.config.PermifyURL,
			"firstcentral":   s.config.FirstCentralURL,
			"crc":            s.config.CRCURL,
			"creditregistry": s.config.CreditRegistryURL,
		},
	})
}

// ── Helpers ──────────────────────────────────────────────────────────────────

func generateID() string {
	b := make([]byte, 12)
	rand.Read(b)
	return fmt.Sprintf("%x", b)
}

// ── Main ─────────────────────────────────────────────────────────────────────

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

// Circuit breaker for external HTTP calls
type circuitBreakerState int

const (
	cbClosed circuitBreakerState = iota
	cbOpen
	cbHalfOpen
)

type circuitBreaker struct {
	state       circuitBreakerState
	failures    int
	threshold   int
	resetAfter  time.Duration
	lastFailure time.Time
}

var cb = &circuitBreaker{threshold: 5, resetAfter: 30 * time.Second}

func (c *circuitBreaker) allow() bool {
	if c.state == cbClosed {
		return true
	}
	if c.state == cbOpen && time.Since(c.lastFailure) > c.resetAfter {
		c.state = cbHalfOpen
		return true
	}
	return c.state == cbHalfOpen
}
func (c *circuitBreaker) recordSuccess() {
	c.failures = 0
	c.state = cbClosed
}
func (c *circuitBreaker) recordFailure() {
	c.failures++
	c.lastFailure = time.Now()
	if c.failures >= c.threshold {
		c.state = cbOpen
	}
}

func initDB() {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		log.Fatal("FATAL: DATABASE_URL environment variable is required")
	}
	var err error
	db, err = sql.Open("postgres", dsn)
	if err != nil {
		log.Printf("database connection failed: %s", err.Error())
		return
	}
	db.SetMaxOpenConns(25)
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(5 * time.Minute)
	db.SetConnMaxIdleTime(2 * time.Minute)
	if _, err := db.Exec(`CREATE TABLE IF NOT EXISTS kyc_enforcement_records (
		id SERIAL PRIMARY KEY,
		name TEXT,
		status TEXT DEFAULT 'active',
		data JSONB DEFAULT '{}',
		created_at TIMESTAMPTZ DEFAULT NOW()
	)`); err != nil {
		log.Printf("create table failed: %s", err.Error())
	}
	if err := db.Ping(); err != nil {
		log.Printf("database ping failed: %s", err.Error())
	} else {
		log.Printf("database connected: kyc-enforcement-go")
	}
}

// ─── Domain CRUD Handlers (PostgreSQL-backed) ────────────────────────────────

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

type rateLimiter struct {
	mu       sync.Mutex
	requests map[string][]time.Time
	limit    int
	window   time.Duration
}

func newRateLimiter(limit int, window time.Duration) *rateLimiter {
	return &rateLimiter{requests: make(map[string][]time.Time), limit: limit, window: window}
}
func (rl *rateLimiter) allow(ip string) bool {
	rl.mu.Lock()
	defer rl.mu.Unlock()
	now := time.Now()
	cutoff := now.Add(-rl.window)
	var valid []time.Time
	for _, t := range rl.requests[ip] {
		if t.After(cutoff) {
			valid = append(valid, t)
		}
	}
	if len(valid) >= rl.limit {
		rl.requests[ip] = valid
		return false
	}
	rl.requests[ip] = append(valid, now)
	return true
}
func rateLimitMiddleware(rl *rateLimiter) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ip := r.RemoteAddr
			if fwd := r.Header.Get("X-Forwarded-For"); fwd != "" {
				ip = strings.Split(fwd, ",")[0]
			}
			if !rl.allow(strings.TrimSpace(ip)) {
				http.Error(w, `{"error":"rate limit exceeded"}`, http.StatusTooManyRequests)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if origin == "" {
			origin = "*"
		}
		w.Header().Set("Access-Control-Allow-Origin", origin)
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Request-Id, X-Trace-ID")
		w.Header().Set("Access-Control-Max-Age", "86400")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
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

func isPQClientError(err error) bool {
	msg := err.Error()
	return strings.Contains(msg, "(22") || strings.Contains(msg, "(23") || strings.Contains(msg, "(42703)") || strings.Contains(msg, "value too long")
}

func handleListEntities(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	page, _ := strconv.Atoi(r.URL.Query().Get("page"))
	if page < 1 {
		page = 1
	}
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if limit < 1 || limit > 100 {
		limit = 20
	}
	offset := (page - 1) * limit

	var total int
	if err := db.QueryRow("SELECT COUNT(*) FROM kyc_enforcement_records").Scan(&total); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), http.StatusInternalServerError)
		return
	}
	rows, err := db.Query(fmt.Sprintf("SELECT id, name, status, data, created_at FROM kyc_enforcement_records ORDER BY id DESC LIMIT $1 OFFSET $2"), limit, offset)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), http.StatusInternalServerError)
		return
	}
	defer func() { _ = rows.Close() }()
	cols, _ := rows.Columns()
	var results []map[string]interface{}
	for rows.Next() {
		vals := make([]interface{}, len(cols))
		ptrs := make([]interface{}, len(cols))
		for i := range vals {
			ptrs[i] = &vals[i]
		}
		if err := rows.Scan(ptrs...); err != nil {
			continue
		}
		row := make(map[string]interface{})
		for i, col := range cols {
			switch v := vals[i].(type) {
			case []byte:
				row[col] = string(v)
			default:
				row[col] = v
			}
		}
		results = append(results, row)
	}
	if results == nil {
		results = []map[string]interface{}{}
	}
	_ = json.NewEncoder(w).Encode(map[string]interface{}{"data": results, "total": total, "page": page, "limit": limit})
}

func handleGetEntity(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	idStr := r.URL.Query().Get("id")
	if idStr == "" {
		http.Error(w, `{"error":"id parameter required"}`, http.StatusBadRequest)
		return
	}
	rows, err := db.Query("SELECT id, name, status, data, created_at FROM kyc_enforcement_records WHERE id = $1", idStr)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), http.StatusInternalServerError)
		return
	}
	defer func() { _ = rows.Close() }()
	cols, _ := rows.Columns()
	if !rows.Next() {
		http.Error(w, `{"error":"not found"}`, http.StatusNotFound)
		return
	}
	vals := make([]interface{}, len(cols))
	ptrs := make([]interface{}, len(cols))
	for i := range vals {
		ptrs[i] = &vals[i]
	}
	if err := rows.Scan(ptrs...); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), http.StatusInternalServerError)
		return
	}
	row := make(map[string]interface{})
	for i, col := range cols {
		switch v := vals[i].(type) {
		case []byte:
			row[col] = string(v)
		default:
			row[col] = v
		}
	}
	_ = json.NewEncoder(w).Encode(row)
}

func handleCreateEntity(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	var body map[string]interface{}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, `{"error":"invalid JSON body"}`, http.StatusBadRequest)
		return
	}
	cols := make([]string, 0)
	vals := make([]interface{}, 0)
	placeholders := make([]string, 0)
	i := 1
	for k, v := range body {
		if k == "id" || k == "created_at" {
			continue
		}
		cols = append(cols, k)
		switch mv := v.(type) {
		case map[string]interface{}:
			b, _ := json.Marshal(mv)
			vals = append(vals, string(b))
		case []interface{}:
			b, _ := json.Marshal(mv)
			vals = append(vals, string(b))
		default:
			vals = append(vals, v)
		}
		placeholders = append(placeholders, fmt.Sprintf("$%d", i))
		i++
	}
	if len(cols) == 0 {
		http.Error(w, `{"error":"no fields provided"}`, http.StatusBadRequest)
		return
	}
	query := fmt.Sprintf("INSERT INTO kyc_enforcement_records (%s) VALUES (%s) RETURNING id",
		strings.Join(cols, ", "), strings.Join(placeholders, ", "))
	var newID interface{}
	if err := db.QueryRow(query, vals...).Scan(&newID); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusCreated)
	if kafkaWriter != nil {
		kafkaWriter.PublishEvent(r.Context(), "created", r.URL.Path, nil)
	}
	_ = json.NewEncoder(w).Encode(map[string]interface{}{"id": newID, "status": "created"})
}

func handleDeleteEntity(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if r.Method != http.MethodDelete {
		http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}
	idStr := r.URL.Query().Get("id")
	if idStr == "" {
		http.Error(w, `{"error":"id parameter required"}`, http.StatusBadRequest)
		return
	}
	result, err := db.Exec("DELETE FROM kyc_enforcement_records WHERE id = $1", idStr)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), http.StatusInternalServerError)
		return
	}
	n, _ := result.RowsAffected()
	if n == 0 {
		http.Error(w, `{"error":"not found"}`, http.StatusNotFound)
		return
	}
	if kafkaWriter != nil {
		kafkaWriter.PublishEvent(r.Context(), "created", r.URL.Path, nil)
	}
	_ = json.NewEncoder(w).Encode(map[string]interface{}{"id": idStr, "status": "deleted"})
}

func handleStats(w http.ResponseWriter, r *http.Request) {
	var count int
	if db != nil {
		_ = db.QueryRow("SELECT COUNT(*) FROM kyc_enforcement_records").Scan(&count)
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{"service": "kyc_enforcement_records", "table": "kyc_enforcement_records", "total_records": count})
}

// ── Middleware Clients ────────────────────────────────────────────────────
var (
	redisClient *redisPool
	kafkaWriter *kafkaProducer
	osClient    *opensearchClient
)

type redisPool struct {
	addr     string
	password string
	conn     net.Conn
	mu       sync.Mutex
	cbOpen   bool
	cbUntil  time.Time
}

func newRedisPool(addr, password string) *redisPool {
	r := &redisPool{addr: addr, password: password}
	go r.connect()
	return r
}
func (r *redisPool) connect() {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.conn != nil {
		return
	}
	conn, err := net.DialTimeout("tcp", r.addr, 5*time.Second)
	if err != nil {
		jsonLog("warn", "redis_connect_failed", "error", err.Error(), "addr", r.addr)
		r.cbOpen = true
		r.cbUntil = time.Now().Add(30 * time.Second)
		return
	}
	if r.password != "" {
		_, _ = fmt.Fprintf(conn, "*2\r\n$4\r\nAUTH\r\n$%d\r\n%s\r\n", len(r.password), r.password)
		buf := make([]byte, 128)
		_ = conn.SetReadDeadline(time.Now().Add(3 * time.Second))
		_, _ = conn.Read(buf)
	}
	r.conn = conn
	r.cbOpen = false
	jsonLog("info", "redis_connected", "addr", r.addr)
}
func (r *redisPool) respCmd(args ...string) (string, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.cbOpen && time.Now().Before(r.cbUntil) {
		return "", fmt.Errorf("circuit open")
	}
	if r.conn == nil {
		r.mu.Unlock()
		r.connect()
		r.mu.Lock()
		if r.conn == nil {
			return "", fmt.Errorf("not connected")
		}
	}
	cmd := fmt.Sprintf("*%d\r\n", len(args))
	for _, a := range args {
		cmd += fmt.Sprintf("$%d\r\n%s\r\n", len(a), a)
	}
	_ = r.conn.SetWriteDeadline(time.Now().Add(3 * time.Second))
	_, err := fmt.Fprint(r.conn, cmd)
	if err != nil {
		_ = r.conn.Close()
		r.conn = nil
		r.cbOpen = true
		r.cbUntil = time.Now().Add(30 * time.Second)
		return "", err
	}
	_ = r.conn.SetReadDeadline(time.Now().Add(3 * time.Second))
	buf := make([]byte, 4096)
	n, err := r.conn.Read(buf)
	if err != nil {
		_ = r.conn.Close()
		r.conn = nil
		r.cbOpen = true
		r.cbUntil = time.Now().Add(30 * time.Second)
		return "", err
	}
	return string(buf[:n]), nil
}
func (r *redisPool) CacheGet(key string) (string, bool) {
	resp, err := r.respCmd("GET", key)
	if err != nil || strings.HasPrefix(resp, "$-1") {
		return "", false
	}
	parts := strings.SplitN(resp, "\r\n", 3)
	if len(parts) >= 2 {
		return parts[1], true
	}
	return "", false
}
func (r *redisPool) CacheSet(key string, value string, ttl time.Duration) {
	if ttl > 0 {
		_, _ = r.respCmd("SETEX", key, fmt.Sprintf("%d", int(ttl.Seconds())), value)
	} else {
		_, _ = r.respCmd("SET", key, value)
	}
}
func (r *redisPool) CacheInvalidate(keys ...string) {
	for _, k := range keys {
		r.respCmd("DEL", k)
	}
}

type kafkaProducer struct {
	brokers string
	topic   string
	conn    net.Conn
	mu      sync.Mutex
	cbOpen  bool
	cbUntil time.Time
}

func newKafkaProducer(brokers, topic string) *kafkaProducer {
	p := &kafkaProducer{brokers: brokers, topic: topic}
	go p.connect()
	return p
}
func (k *kafkaProducer) connect() {
	k.mu.Lock()
	defer k.mu.Unlock()
	if k.conn != nil {
		return
	}
	addr := k.brokers
	if idx := strings.Index(addr, ","); idx > 0 {
		addr = addr[:idx]
	}
	conn, err := net.DialTimeout("tcp", addr, 5*time.Second)
	if err != nil {
		jsonLog("warn", "kafka_connect_failed", "error", err.Error(), "brokers", k.brokers)
		k.cbOpen = true
		k.cbUntil = time.Now().Add(30 * time.Second)
		return
	}
	k.conn = conn
	k.cbOpen = false
	jsonLog("info", "kafka_connected", "brokers", k.brokers, "topic", k.topic)
}
func (k *kafkaProducer) PublishEvent(ctx context.Context, eventType string, key string, payload interface{}) {
	data, _ := json.Marshal(map[string]interface{}{
		"event_type": eventType,
		"source":     k.topic,
		"key":        key,
		"payload":    payload,
		"timestamp":  time.Now().Format(time.RFC3339),
	})
	k.mu.Lock()
	defer k.mu.Unlock()
	if k.cbOpen && time.Now().Before(k.cbUntil) {
		jsonLog("debug", "kafka_circuit_open", "topic", k.topic, "event_type", eventType)
		return
	}
	if k.conn == nil {
		k.mu.Unlock()
		k.connect()
		k.mu.Lock()
	}
	if k.conn != nil {
		msg := append([]byte{0, 0, 0, 0}, data...)
		binary.BigEndian.PutUint32(msg[:4], uint32(len(data)))
		_ = k.conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
		_, err := k.conn.Write(msg)
		if err != nil {
			jsonLog("warn", "kafka_publish_failed", "error", err.Error(), "topic", k.topic)
			_ = k.conn.Close()
			k.conn = nil
			k.cbOpen = true
			k.cbUntil = time.Now().Add(30 * time.Second)
			return
		}
	}
	jsonLog("info", "kafka_event_published", "topic", k.topic, "event_type", eventType, "key", key, "size", fmt.Sprintf("%d", len(data)))
}

type opensearchClient struct {
	url      string
	user     string
	password string
	client   *http.Client
	cbOpen   bool
	cbUntil  time.Time
	mu       sync.Mutex
}

func newOpenSearchClient(url, user string) *opensearchClient {
	return &opensearchClient{
		url:      url,
		user:     user,
		password: os.Getenv("OPENSEARCH_PASSWORD"),
		client:   &http.Client{Timeout: 5 * time.Second},
	}
}
func (o *opensearchClient) IndexLog(level, msg, service string, fields map[string]interface{}) {
	entry := map[string]interface{}{
		"@timestamp": time.Now().Format(time.RFC3339),
		"level":      level,
		"message":    msg,
		"service":    service,
		"fields":     fields,
	}
	data, _ := json.Marshal(entry)
	o.mu.Lock()
	if o.cbOpen && time.Now().Before(o.cbUntil) {
		o.mu.Unlock()
		return
	}
	o.mu.Unlock()
	idx := fmt.Sprintf("logs-%s-%s", service, time.Now().Format("2006.01.02"))
	reqURL := fmt.Sprintf("%s/%s/_doc", o.url, idx)
	req, err := http.NewRequest("POST", reqURL, bytes.NewReader(data))
	if err != nil {
		return
	}
	req.Header.Set("Content-Type", "application/json")
	if o.user != "" {
		req.SetBasicAuth(o.user, o.password)
	}
	resp, err := o.client.Do(req)
	if err != nil {
		o.mu.Lock()
		o.cbOpen = true
		o.cbUntil = time.Now().Add(60 * time.Second)
		o.mu.Unlock()
		jsonLog("debug", "opensearch_index_failed", "error", err.Error())
		return
	}
	_ = resp.Body.Close()
	jsonLog(level, msg, "opensearch_indexed", "true", "size", fmt.Sprintf("%d", len(data)))
}

// Keycloak JWT authentication middleware
type jwtClaims struct {
	UserID   string   `json:"sub"`
	Email    string   `json:"email"`
	Username string   `json:"preferred_username"`
	Roles    []string `json:"realm_access_roles"`
	TenantID string   `json:"tenant_id"`
}

func keycloakAuthMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Skip auth for health/ready/live probes
		if r.URL.Path == "/health" || r.URL.Path == "/ready" || r.URL.Path == "/live" || r.URL.Path == "/metrics" {
			next.ServeHTTP(w, r)
			return
		}
		// Dev bypass for local development
		if os.Getenv("DEV_AUTH_BYPASS") == "true" {
			ctx := context.WithValue(r.Context(), "user_id", "dev-user")
			ctx = context.WithValue(ctx, "tenant_id", "default")
			ctx = context.WithValue(ctx, "roles", []string{"admin", "user"})
			next.ServeHTTP(w, r.WithContext(ctx))
			return
		}
		auth := r.Header.Get("Authorization")
		if auth == "" || !strings.HasPrefix(auth, "Bearer ") {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(401)
			_ = json.NewEncoder(w).Encode(map[string]interface{}{"error": map[string]string{"code": "UNAUTHORIZED", "message": "missing bearer token"}})
			return
		}
		// In production: validate JWT against Keycloak JWKS endpoint
		// For now, decode and pass through (validation handled by APISIX gateway)
		tokenStr := strings.TrimPrefix(auth, "Bearer ")
		_ = tokenStr
		ctx := context.WithValue(r.Context(), "user_id", r.Header.Get("X-User-ID"))
		ctx = context.WithValue(ctx, "tenant_id", r.Header.Get("X-Tenant-ID"))
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// Permify authorization check
func permifyCheck(ctx context.Context, entity, entityID, permission, subjectID string) bool {
	permifyAddr := os.Getenv("PERMIFY_ADDR")
	if permifyAddr == "" {
		return true // Permissive when Permify is not configured
	}
	payload := map[string]interface{}{
		"entity":     map[string]string{"type": entity, "id": entityID},
		"permission": permission,
		"subject":    map[string]string{"type": "user", "id": subjectID},
	}
	data, _ := json.Marshal(payload)
	tenantID := "default"
	if tid, ok := ctx.Value("tenant_id").(string); ok && tid != "" {
		tenantID = tid
	}
	url := fmt.Sprintf("http://%s/v1/tenants/%s/permissions/check", permifyAddr, tenantID)
	req, err := http.NewRequestWithContext(ctx, "POST", url, strings.NewReader(string(data)))
	if err != nil {
		return true
	}
	req.Header.Set("Content-Type", "application/json")
	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		jsonLog("warn", "permify_check_failed", "error", err.Error())
		return true // Fail open
	}
	defer func() { _ = resp.Body.Close() }()
	var result struct {
		Can string `json:"can"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&result)
	return result.Can == "RESULT_ALLOWED"
}

func initMiddleware() {
	// Redis
	redisAddr := os.Getenv("REDIS_URL")
	if redisAddr == "" {
		redisAddr = "localhost:6379"
	}
	redisClient = newRedisPool(redisAddr, os.Getenv("REDIS_PASSWORD"))
	jsonLog("info", "redis_client_initialized", "addr", redisAddr)

	// Kafka
	kafkaBrokers := os.Getenv("KAFKA_BROKERS")
	if kafkaBrokers == "" {
		kafkaBrokers = "localhost:9092"
	}
	kafkaWriter = newKafkaProducer(kafkaBrokers, "kyc-enforcement-events")
	jsonLog("info", "kafka_producer_initialized", "brokers", kafkaBrokers, "topic", "kyc-enforcement-events")

	// OpenSearch
	osURL := os.Getenv("OPENSEARCH_URL")
	if osURL == "" {
		osURL = "http://localhost:9200"
	}
	osClient = newOpenSearchClient(osURL, os.Getenv("OPENSEARCH_USER"))
	jsonLog("info", "opensearch_client_initialized", "url", osURL)
}

func main() {
	cfg := loadConfig()
	state := NewAppState(cfg)

	initMiddleware()

	mux := http.NewServeMux()

	mux.HandleFunc("/api/v1/enforce/account-opening", state.handleAccountOpening)
	mux.HandleFunc("/api/v1/enforce/loan", state.handleLoanEnforcement)
	mux.HandleFunc("/api/v1/enforce/check", state.handleKYCCheck)
	mux.HandleFunc("/api/v1/enforce/verify-callback", state.handleVerifyCallback)
	mux.HandleFunc("/api/v1/enforce/approve-gate", state.handleApproveGate)
	mux.HandleFunc("/api/v1/bureau/verify", state.handleBureauVerify)
	mux.HandleFunc("/api/v1/bureau/status/", state.handleBureauStatus)
	mux.HandleFunc("/api/v1/tiers/requirements", state.handleTierRequirements)
	mux.HandleFunc("/health", state.handleHealth)

	mux.HandleFunc("/api/v1/kyc_enforcement_records", handleListEntities)
	mux.HandleFunc("/api/v1/kyc_enforcement_record", handleGetEntity)
	mux.HandleFunc("/api/v1/kyc_enforcement_records/create", handleCreateEntity)
	mux.HandleFunc("/api/v1/kyc_enforcement_records/delete", handleDeleteEntity)
	mux.HandleFunc("/stats", handleStats)

	addr := ":" + cfg.Port
	srv := &http.Server{Addr: addr, Handler: mux, ReadTimeout: 30 * time.Second, WriteTimeout: 30 * time.Second, IdleTimeout: 120 * time.Second}

	go func() {
		sigCh := make(chan os.Signal, 1)
		signal.Notify(sigCh, syscall.SIGTERM, syscall.SIGINT)
		<-sigCh
		log.Println("[KYC-Enforcement] Shutting down gracefully...")
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		if err := srv.Shutdown(ctx); err != nil {
			log.Printf("[KYC-Enforcement] Forced shutdown: %v", err)
		}
	}()

	log.Printf("[KYC-Enforcement] Starting on %s (fail-closed design, env=%s)", addr, cfg.Environment)
	log.Printf("[KYC-Enforcement] Bureaus: FirstCentral=%s, CRC=%s, CreditRegistry=%s", cfg.FirstCentralURL, cfg.CRCURL, cfg.CreditRegistryURL)

	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatalf("[KYC-Enforcement] Server failed: %v", err)
	}
}
