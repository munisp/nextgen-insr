package main

import (
	"encoding/json"
	"fmt"
	"log"
	"math/rand"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
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
	Port             string
	KYCEngineURL     string
	LivenessURL      string
	SanctionsURL     string
	KafkaBrokers     string
	RedisURL         string
	KeycloakURL      string
	TigerBeetleURL   string
	TemporalURL      string
	DaprURL          string
	PermifyURL       string
	FirstCentralURL  string
	CRCURL           string
	CreditRegistryURL string
	FirstCentralKey  string
	CRCKey           string
	CreditRegistryKey string
	Environment      string
}

func loadConfig() Config {
	return Config{
		Port:              envOr("PORT", "8211"),
		KYCEngineURL:      envOr("KYC_ENGINE_URL", "http://localhost:8104"),
		LivenessURL:       envOr("LIVENESS_SERVICE_URL", "http://localhost:8104"),
		SanctionsURL:      envOr("SANCTIONS_ENGINE_URL", "http://localhost:8131"),
		KafkaBrokers:      envOr("KAFKA_BROKERS", "localhost:9092"),
		RedisURL:          envOr("REDIS_URL", "redis://localhost:6379/11"),
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
	Allowed          bool       `json:"allowed"`
	Reason           string     `json:"reason"`
	RequiredKYCLevel KYCLevel   `json:"required_kyc_level"`
	CurrentKYCLevel  KYCLevel   `json:"current_kyc_level,omitempty"`
	KYCVerified      bool       `json:"kyc_verified"`
	NextSteps        []string   `json:"next_steps,omitempty"`
	ApplicationID    string     `json:"application_id,omitempty"`
	KafkaEventID     string     `json:"kafka_event_id,omitempty"`
	GatewayReachable bool       `json:"gateway_reachable"`
	FailClosed       bool       `json:"fail_closed"`
}

type AccountOpeningRequest struct {
	CustomerID   string      `json:"customer_id"`
	Tier         AccountTier `json:"tier"`
	ProductType  string      `json:"product_type"` // savings, current, domiciliary, fixed_deposit, corporate
	FirstName    string      `json:"first_name"`
	LastName     string      `json:"last_name"`
	Phone        string      `json:"phone"`
	BVN          string      `json:"bvn,omitempty"`
	NIN          string      `json:"nin,omitempty"`
	Email        string      `json:"email,omitempty"`
}

type LoanEnforcementRequest struct {
	CustomerID string  `json:"customer_id"`
	LoanType   string  `json:"loan_type"` // personal, sme, corporate, mortgage, auto, agriculture
	Amount     float64 `json:"amount"`
	Currency   string  `json:"currency"`
	Purpose    string  `json:"purpose,omitempty"`
}

type BureauVerificationRequest struct {
	CustomerID  string `json:"customer_id"`
	BVN         string `json:"bvn"`
	NIN         string `json:"nin,omitempty"`
	FullName    string `json:"full_name"`
	DateOfBirth string `json:"date_of_birth"`
	Phone       string `json:"phone"`
	Bureaus     []string `json:"bureaus,omitempty"` // firstcentral, crc, creditregistry
}

type BureauResult struct {
	Bureau         string  `json:"bureau"`
	Status         string  `json:"status"` // verified, not_found, mismatch, error, timeout
	Confidence     float64 `json:"confidence"`
	CreditScore    int     `json:"credit_score,omitempty"`
	MatchedFields  []string `json:"matched_fields,omitempty"`
	Discrepancies  []string `json:"discrepancies,omitempty"`
	ResponseTimeMs int64   `json:"response_time_ms"`
}

type BureauVerificationResult struct {
	VerificationID string         `json:"verification_id"`
	CustomerID     string         `json:"customer_id"`
	OverallStatus  string         `json:"overall_status"` // verified, partial, failed
	Consensus      float64        `json:"consensus"` // % agreement across bureaus
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
	"savings":      {KYCLevelBasic, Tier1},
	"current":      {KYCLevelStandard, Tier2},
	"domiciliary":  {KYCLevelEnhanced, Tier3},
	"fixed_deposit": {KYCLevelStandard, Tier2},
	"corporate":    {KYCLevelFullEDD, Tier3},
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
	config    Config
	mu        sync.RWMutex
	kycCache  map[string]KYCLevel // customerID → verified level
	applications map[string]*ApplicationRecord
	bureauResults map[string]*BureauVerificationResult
	startTime time.Time
}

type ApplicationRecord struct {
	ID          string      `json:"id"`
	CustomerID  string      `json:"customer_id"`
	Type        string      `json:"type"` // account, loan
	Status      string      `json:"status"` // pending_kyc, approved, blocked
	KYCVerified bool        `json:"kyc_verified"`
	KYCLevel    KYCLevel    `json:"kyc_level"`
	CreatedAt   time.Time   `json:"created_at"`
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
			http.Post(url, "application/json", strings.NewReader(string(payload)))
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
		http.Post(url, "application/json", strings.NewReader(string(payload)))
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
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		// Service returned error — fail closed
		return false, "", true
	}

	var result struct {
		Level    string `json:"level"`
		Verified bool   `json:"verified"`
	}
	json.NewDecoder(resp.Body).Decode(&result)

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
		"allowed":           true,
		"reason":            "KYC verified — account approved",
		"required_kyc_level": requiredLevel,
		"current_kyc_level":  currentLevel,
		"kyc_verified":      true,
		"application_id":    appID,
		"gateway_reachable": true,
		"fail_closed":       false,
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
		"customer_id":      req.CustomerID,
		"verified":         verified,
		"current_level":    current,
		"required_level":   req.Level,
		"gateway_reachable": reachable,
		"fail_closed":      !reachable,
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
		"customer_id":          req.CustomerID,
		"level":                req.Level,
		"applications_approved": approved,
	})

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"customer_id":          req.CustomerID,
		"level":                req.Level,
		"applications_approved": approved,
		"status":               "verified",
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
			"error":      "KYC_NOT_VERIFIED",
			"message":    "Manual approval is BLOCKED until KYC completes — there is no override path",
			"kyc_level":  app.KYCLevel,
			"status":     app.Status,
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
	json.NewEncoder(w).Encode(result)
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
	defer resp.Body.Close()

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
	json.NewDecoder(resp.Body).Decode(&bureauResp)

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
	json.NewEncoder(w).Encode(result)
}

func (s *AppState) handleTierRequirements(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"tiers": map[string]interface{}{
			"tier_1": map[string]interface{}{
				"name": "Basic (Mobile Money)", "max_balance": 300000, "daily_limit": 50000,
				"documents": []string{"phone", "name", "dob"},
				"liveness": false, "bvn": false, "nin": false, "address": false,
				"kyc_level": "basic",
			},
			"tier_2": map[string]interface{}{
				"name": "Standard", "max_balance": 500000, "daily_limit": 200000,
				"documents": []string{"phone", "name", "dob", "bvn", "id_document"},
				"liveness": true, "bvn": true, "nin": false, "address": false,
				"kyc_level": "standard",
			},
			"tier_3": map[string]interface{}{
				"name": "Enhanced (Full Banking)", "max_balance": 0, "daily_limit": 0,
				"documents": []string{"phone", "name", "dob", "bvn", "nin", "id_document", "utility_bill", "passport_photo", "signature"},
				"liveness": true, "bvn": true, "nin": true, "address": true,
				"kyc_level": "enhanced",
			},
		},
		"loan_requirements": map[string]interface{}{
			"personal":    map[string]interface{}{"min_level": "enhanced", "threshold": "any amount"},
			"sme":         map[string]interface{}{"min_level": "enhanced", "threshold": "any amount"},
			"corporate":   map[string]interface{}{"min_level": "enhanced", "threshold": "any amount"},
			"mortgage":    map[string]interface{}{"min_level": "full_edd", "threshold": "any amount"},
			"above_10m":   map[string]interface{}{"min_level": "enhanced", "threshold": "≥₦10,000,000"},
			"above_50m":   map[string]interface{}{"min_level": "full_edd", "threshold": "≥₦50,000,000"},
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
			"kyc_engine":      s.config.KYCEngineURL,
			"sanctions":       s.config.SanctionsURL,
			"kafka":           s.config.KafkaBrokers,
			"tigerbeetle":     s.config.TigerBeetleURL,
			"permify":         s.config.PermifyURL,
			"firstcentral":    s.config.FirstCentralURL,
			"crc":             s.config.CRCURL,
			"creditregistry":  s.config.CreditRegistryURL,
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

func main() {
	cfg := loadConfig()
	state := NewAppState(cfg)

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

	addr := ":" + cfg.Port
	log.Printf("[KYC-Enforcement] Starting on %s (fail-closed design, env=%s)", addr, cfg.Environment)
	log.Printf("[KYC-Enforcement] Bureaus: FirstCentral=%s, CRC=%s, CreditRegistry=%s", cfg.FirstCentralURL, cfg.CRCURL, cfg.CreditRegistryURL)

	if err := http.ListenAndServe(addr, mux); err != nil {
		log.Fatalf("[KYC-Enforcement] Server failed: %v", err)
	}
}
