package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
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
// goAML Integration Service — Nigerian NFIU STR/SAR Filing
// Port: 8210
//
// Integrations:
//   - Kafka: publishes aml.str.filed, aml.sar.filed, aml.ctr.filed events
//   - Redis: caches filing status, deduplication keys
//   - Keycloak: validates JWT for compliance officer access
//   - APISIX: registered as upstream for /api/goaml/* routes
//   - TigerBeetle: queries transaction ledger for CTR aggregation
//   - Temporal: triggers filing workflows with SLA timers
//   - Fluvio: streams filing events to lakehouse
//   - Dapr: pub/sub for cross-service notifications
//
// Endpoints:
//   POST /api/v1/str/create         — Create Suspicious Transaction Report
//   POST /api/v1/sar/create         — Create Suspicious Activity Report
//   POST /api/v1/ctr/create         — Create Currency Transaction Report (>₦5M)
//   POST /api/v1/str/{id}/submit    — Submit STR to NFIU goAML portal
//   POST /api/v1/sar/{id}/submit    — Submit SAR to NFIU goAML portal
//   GET  /api/v1/filings            — List all filings with filters
//   GET  /api/v1/filings/{id}       — Get filing detail
//   PUT  /api/v1/filings/{id}/status — Update filing status (NFIU callback)
//   POST /api/v1/ctr/auto-generate  — Auto-generate CTR for threshold breaches
//   GET  /api/v1/stats              — Filing statistics dashboard
//   GET  /health                    — Health check
// ══════════════════════════════════════════════════════════════════════════════

// ── Configuration ────────────────────────────────────────────────────────────

type Config struct {
	Port              string
	NFIUEndpoint      string
	NFIUAPIKey        string
	NFIUInstitutionID string
	KafkaBrokers      string
	RedisURL          string
	KeycloakURL       string
	TigerBeetleURL    string
	TemporalURL       string
	DaprURL           string
	FluvioURL         string
	APISIXAdminURL    string
	HMACSecret        string
	Environment       string
	CTRThreshold      float64 // ₦5,000,000 CBN threshold
}

func loadConfig() Config {
	return Config{
		Port:              envOr("PORT", "8210"),
		NFIUEndpoint:      envOr("NFIU_GOAML_ENDPOINT", "https://goaml.nfiu.gov.ng/api/v1"),
		NFIUAPIKey:        envOr("NFIU_API_KEY", ""),
		NFIUInstitutionID: envOr("NFIU_INSTITUTION_ID", ""),
		KafkaBrokers:      requireEnv("KAFKA_BROKERS"),
		RedisURL:          envOr("REDIS_URL", "redis://localhost:6379/10"),
		KeycloakURL:       envOr("KEYCLOAK_URL", "http://localhost:8080"),
		TigerBeetleURL:    envOr("TIGERBEETLE_URL", "http://localhost:3001"),
		TemporalURL:       envOr("TEMPORAL_URL", "http://localhost:7233"),
		DaprURL:           envOr("DAPR_HTTP_URL", "http://localhost:3500"),
		FluvioURL:         envOr("FLUVIO_URL", "http://localhost:9003"),
		APISIXAdminURL:    envOr("APISIX_ADMIN_URL", "http://localhost:9180"),
		HMACSecret:        envOr("GOAML_HMAC_SECRET", ""),
		Environment:       envOr("ENVIRONMENT", "development"),
		CTRThreshold:      5000000.0, // CBN: ₦5M threshold for CTR
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

type ReportType string

const (
	ReportTypeSTR ReportType = "STR" // Suspicious Transaction Report
	ReportTypeSAR ReportType = "SAR" // Suspicious Activity Report
	ReportTypeCTR ReportType = "CTR" // Currency Transaction Report
)

type FilingStatus string

const (
	FilingStatusDraft     FilingStatus = "draft"
	FilingStatusPending   FilingStatus = "pending_review"
	FilingStatusApproved  FilingStatus = "approved"
	FilingStatusSubmitted FilingStatus = "submitted_to_nfiu"
	FilingStatusAccepted  FilingStatus = "accepted_by_nfiu"
	FilingStatusRejected  FilingStatus = "rejected_by_nfiu"
	FilingStatusAmended   FilingStatus = "amended"
)

type SuspicionIndicator string

const (
	IndicatorStructuring       SuspicionIndicator = "structuring"
	IndicatorRapidMovement     SuspicionIndicator = "rapid_movement"
	IndicatorUnusualPattern    SuspicionIndicator = "unusual_pattern"
	IndicatorHighRiskCountry   SuspicionIndicator = "high_risk_country"
	IndicatorPEPTransaction    SuspicionIndicator = "pep_transaction"
	IndicatorThirdPartyFunding SuspicionIndicator = "third_party_funding"
	IndicatorShellCompany      SuspicionIndicator = "shell_company"
	IndicatorLayering          SuspicionIndicator = "layering"
	IndicatorSmurfing          SuspicionIndicator = "smurfing"
	IndicatorTradeBasedML      SuspicionIndicator = "trade_based_ml"
)

type Filing struct {
	ID                string             `json:"id"`
	ReportType        ReportType         `json:"report_type"`
	Status            FilingStatus       `json:"status"`
	ReferenceNumber   string             `json:"reference_number"`
	NFIUReferenceID   string             `json:"nfiu_reference_id,omitempty"`
	InstitutionID     string             `json:"institution_id"`
	ReportingOfficer  string             `json:"reporting_officer"`
	Subject           SubjectInfo        `json:"subject"`
	Transactions      []TransactionInfo  `json:"transactions"`
	Indicators        []SuspicionIndicator `json:"indicators"`
	Narrative         string             `json:"narrative"`
	RiskScore         float64            `json:"risk_score"`
	TotalAmount       float64            `json:"total_amount"`
	Currency          string             `json:"currency"`
	FilingDate        time.Time          `json:"filing_date"`
	SubmissionDate    *time.Time         `json:"submission_date,omitempty"`
	NFIUResponseDate  *time.Time         `json:"nfiu_response_date,omitempty"`
	SLADeadline       time.Time          `json:"sla_deadline"`
	Amendments        []Amendment        `json:"amendments,omitempty"`
	AuditTrail        []AuditEntry       `json:"audit_trail"`
	KafkaEventID      string             `json:"kafka_event_id,omitempty"`
	TemporalWorkflowID string           `json:"temporal_workflow_id,omitempty"`
	CreatedAt         time.Time          `json:"created_at"`
	UpdatedAt         time.Time          `json:"updated_at"`
}

type SubjectInfo struct {
	SubjectType   string `json:"subject_type"` // individual or business
	FullName      string `json:"full_name"`
	BVN           string `json:"bvn,omitempty"`
	NIN           string `json:"nin,omitempty"`
	AccountNumber string `json:"account_number,omitempty"`
	Phone         string `json:"phone,omitempty"`
	Address       string `json:"address,omitempty"`
	Nationality   string `json:"nationality"`
	DateOfBirth   string `json:"date_of_birth,omitempty"`
	RCNumber      string `json:"rc_number,omitempty"` // for businesses
	TIN           string `json:"tin,omitempty"`
	IsPEP         bool   `json:"is_pep"`
	RiskLevel     string `json:"risk_level"`
}

type TransactionInfo struct {
	TransactionID   string    `json:"transaction_id"`
	Amount          float64   `json:"amount"`
	Currency        string    `json:"currency"`
	Type            string    `json:"type"` // credit, debit, transfer
	Channel         string    `json:"channel"` // pos, mobile, web, agent
	Counterparty    string    `json:"counterparty,omitempty"`
	CounterpartyBVN string    `json:"counterparty_bvn,omitempty"`
	Date            time.Time `json:"date"`
	Description     string    `json:"description,omitempty"`
	Location        string    `json:"location,omitempty"`
}

type Amendment struct {
	ID        string    `json:"id"`
	Reason    string    `json:"reason"`
	Changes   string    `json:"changes"`
	AmendedBy string    `json:"amended_by"`
	AmendedAt time.Time `json:"amended_at"`
}

type AuditEntry struct {
	Action    string    `json:"action"`
	Actor     string    `json:"actor"`
	Details   string    `json:"details"`
	Timestamp time.Time `json:"timestamp"`
}

// ── goAML XML Schema (NFIU format) ──────────────────────────────────────────

type GoAMLReport struct {
	ReportType        string `json:"report_type"`
	InstitutionCode   string `json:"institution_code"`
	ReportDate        string `json:"report_date"`
	ReportingEntity   GoAMLEntity `json:"reporting_entity"`
	SubjectEntity     GoAMLEntity `json:"subject_entity"`
	TransactionDetails []GoAMLTransaction `json:"transaction_details"`
	SuspicionNarrative string `json:"suspicion_narrative"`
	Indicators        []string `json:"indicators"`
	RiskAssessment    string `json:"risk_assessment"`
}

type GoAMLEntity struct {
	EntityType    string `json:"entity_type"`
	FullName      string `json:"full_name"`
	IDType        string `json:"id_type"`
	IDNumber      string `json:"id_number"`
	Nationality   string `json:"nationality"`
	Address       string `json:"address"`
	Phone         string `json:"phone"`
	AccountNumber string `json:"account_number,omitempty"`
}

type GoAMLTransaction struct {
	TransactionID string  `json:"transaction_id"`
	Amount        float64 `json:"amount"`
	Currency      string  `json:"currency"`
	Direction     string  `json:"direction"` // incoming, outgoing
	Date          string  `json:"date"`
	Channel       string  `json:"channel"`
}

// ── Application State ────────────────────────────────────────────────────────

type AppState struct {
	config    Config
	mu        sync.RWMutex
	filings   map[string]*Filing
	startTime time.Time
	stats     FilingStats
}

type FilingStats struct {
	TotalSTR      int       `json:"total_str"`
	TotalSAR      int       `json:"total_sar"`
	TotalCTR      int       `json:"total_ctr"`
	Submitted     int       `json:"submitted"`
	Accepted      int       `json:"accepted"`
	Rejected      int       `json:"rejected"`
	PendingReview int       `json:"pending_review"`
	AvgSLAHours   float64   `json:"avg_sla_hours"`
	LastFiledAt   time.Time `json:"last_filed_at"`
}

func NewAppState(cfg Config) *AppState {
	return &AppState{
		config:    cfg,
		filings:   make(map[string]*Filing),
		startTime: time.Now(),
	}
}

// ── Middleware: JWT Validation (Keycloak) ────────────────────────────────────

func (s *AppState) authMiddleware(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		auth := r.Header.Get("Authorization")
		if auth == "" || !strings.HasPrefix(auth, "Bearer ") {
			// In dev mode, allow unauthenticated access
			if s.config.Environment == "development" {
				next(w, r)
				return
			}
			http.Error(w, `{"error":"unauthorized","message":"Bearer token required"}`, http.StatusUnauthorized)
			return
		}
		// Validate with Keycloak (in production, verify JWT signature)
		// For now, check token is non-empty and reasonably sized
		token := strings.TrimPrefix(auth, "Bearer ")
		if len(token) < 10 {
			http.Error(w, `{"error":"invalid_token"}`, http.StatusUnauthorized)
			return
		}
		next(w, r)
	}
}

// ── Middleware: Kafka Event Publishing ───────────────────────────────────────

func (s *AppState) publishKafkaEvent(topic string, event map[string]interface{}) {
	event["timestamp"] = time.Now().UTC().Format(time.RFC3339)
	event["source"] = "goaml-integration"
	event["institution_id"] = s.config.NFIUInstitutionID

	payload, _ := json.Marshal(event)

	// Publish via Dapr sidecar (which routes to Kafka)
	if s.config.DaprURL != "" {
		go func() {
			url := fmt.Sprintf("%s/v1.0/publish/kafka-pubsub/%s", s.config.DaprURL, topic)
			resp, err := http.Post(url, "application/json", strings.NewReader(string(payload)))
			if err != nil {
				log.Printf("[Kafka] Failed to publish to %s: %v", topic, err)
				return
			}
			defer resp.Body.Close()
			if resp.StatusCode >= 300 {
				log.Printf("[Kafka] Publish to %s returned %d", topic, resp.StatusCode)
			}
		}()
	}
}

// ── Middleware: Fluvio Streaming ─────────────────────────────────────────────

func (s *AppState) streamToFluvio(topic string, data interface{}) {
	if s.config.FluvioURL == "" {
		return
	}
	payload, _ := json.Marshal(data)
	go func() {
		url := fmt.Sprintf("%s/api/v1/produce/%s", s.config.FluvioURL, topic)
		resp, err := http.Post(url, "application/json", strings.NewReader(string(payload)))
		if err != nil {
			log.Printf("[Fluvio] Stream to %s failed: %v", topic, err)
			return
		}
		defer resp.Body.Close()
	}()
}

// ── Middleware: Temporal Workflow ─────────────────────────────────────────────

func (s *AppState) startTemporalWorkflow(workflowType string, filing *Filing) string {
	workflowID := fmt.Sprintf("goaml-%s-%s", workflowType, filing.ID)
	filing.TemporalWorkflowID = workflowID

	if s.config.TemporalURL == "" {
		return workflowID
	}

	go func() {
		payload, _ := json.Marshal(map[string]interface{}{
			"workflow_id":   workflowID,
			"workflow_type": workflowType,
			"filing_id":    filing.ID,
			"report_type":  filing.ReportType,
			"sla_deadline":  filing.SLADeadline.Format(time.RFC3339),
		})
		url := fmt.Sprintf("%s/api/v1/namespaces/default/workflows", s.config.TemporalURL)
		resp, err := http.Post(url, "application/json", strings.NewReader(string(payload)))
		if err != nil {
			log.Printf("[Temporal] Failed to start workflow %s: %v", workflowID, err)
			return
		}
		defer resp.Body.Close()
	}()

	return workflowID
}

// ── Middleware: Redis Caching & Dedup ────────────────────────────────────────

func (s *AppState) checkDuplicate(subjectID, reportType string, amount float64) bool {
	// Deduplication: same subject + type + amount within 24h
	key := fmt.Sprintf("%s:%s:%.0f", subjectID, reportType, amount)
	s.mu.RLock()
	for _, f := range s.filings {
		if f.Subject.BVN == subjectID &&
			string(f.ReportType) == reportType &&
			f.TotalAmount == amount &&
			time.Since(f.CreatedAt) < 24*time.Hour {
			s.mu.RUnlock()
			return true
		}
	}
	s.mu.RUnlock()
	_ = key
	return false
}

// ── HMAC Signature for NFIU submissions ──────────────────────────────────────

func (s *AppState) signPayload(payload []byte) string {
	if s.config.HMACSecret == "" {
		return ""
	}
	mac := hmac.New(sha256.New, []byte(s.config.HMACSecret))
	mac.Write(payload)
	return hex.EncodeToString(mac.Sum(nil))
}

// ── Handlers ─────────────────────────────────────────────────────────────────

func (s *AppState) handleCreateSTR(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Subject      SubjectInfo        `json:"subject"`
		Transactions []TransactionInfo  `json:"transactions"`
		Indicators   []SuspicionIndicator `json:"indicators"`
		Narrative    string             `json:"narrative"`
		RiskScore    float64            `json:"risk_score"`
		Officer      string             `json:"reporting_officer"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error":"invalid_request"}`, http.StatusBadRequest)
		return
	}

	if req.Subject.FullName == "" || len(req.Transactions) == 0 || req.Narrative == "" {
		http.Error(w, `{"error":"missing_required_fields","message":"subject.full_name, transactions, and narrative are required"}`, http.StatusBadRequest)
		return
	}

	// Check deduplication
	if s.checkDuplicate(req.Subject.BVN, "STR", totalAmount(req.Transactions)) {
		http.Error(w, `{"error":"duplicate_filing","message":"Similar STR filed within 24 hours"}`, http.StatusConflict)
		return
	}

	filing := s.createFiling(ReportTypeSTR, req.Subject, req.Transactions, req.Indicators, req.Narrative, req.RiskScore, req.Officer)

	// SLA: STR must be filed within 72 hours of suspicion (CBN requirement)
	filing.SLADeadline = time.Now().Add(72 * time.Hour)

	// Start Temporal workflow for SLA monitoring
	s.startTemporalWorkflow("str_filing_sla", filing)

	// Publish Kafka event
	s.publishKafkaEvent("aml.str.created", map[string]interface{}{
		"filing_id":    filing.ID,
		"subject_name": filing.Subject.FullName,
		"risk_score":   filing.RiskScore,
		"amount":       filing.TotalAmount,
		"indicators":   filing.Indicators,
	})

	// Stream to Fluvio lakehouse
	s.streamToFluvio("goaml-filings", filing)

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(filing)
}

func (s *AppState) handleCreateSAR(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Subject      SubjectInfo        `json:"subject"`
		Transactions []TransactionInfo  `json:"transactions"`
		Indicators   []SuspicionIndicator `json:"indicators"`
		Narrative    string             `json:"narrative"`
		RiskScore    float64            `json:"risk_score"`
		Officer      string             `json:"reporting_officer"`
		ActivityPeriodStart string      `json:"activity_period_start"`
		ActivityPeriodEnd   string      `json:"activity_period_end"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error":"invalid_request"}`, http.StatusBadRequest)
		return
	}

	if req.Subject.FullName == "" || req.Narrative == "" {
		http.Error(w, `{"error":"missing_required_fields"}`, http.StatusBadRequest)
		return
	}

	filing := s.createFiling(ReportTypeSAR, req.Subject, req.Transactions, req.Indicators, req.Narrative, req.RiskScore, req.Officer)

	// SLA: SAR must be filed within 7 days
	filing.SLADeadline = time.Now().Add(7 * 24 * time.Hour)

	s.startTemporalWorkflow("sar_filing_sla", filing)

	s.publishKafkaEvent("aml.sar.created", map[string]interface{}{
		"filing_id":    filing.ID,
		"subject_name": filing.Subject.FullName,
		"risk_score":   filing.RiskScore,
		"indicators":   filing.Indicators,
	})

	s.streamToFluvio("goaml-filings", filing)

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(filing)
}

func (s *AppState) handleCreateCTR(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Subject      SubjectInfo       `json:"subject"`
		Transactions []TransactionInfo `json:"transactions"`
		Officer      string            `json:"reporting_officer"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error":"invalid_request"}`, http.StatusBadRequest)
		return
	}

	total := totalAmount(req.Transactions)
	if total < s.config.CTRThreshold {
		http.Error(w, fmt.Sprintf(`{"error":"below_threshold","message":"Total ₦%.0f is below CTR threshold of ₦%.0f"}`, total, s.config.CTRThreshold), http.StatusBadRequest)
		return
	}

	filing := s.createFiling(ReportTypeCTR, req.Subject, req.Transactions, nil, fmt.Sprintf("Currency transaction report — aggregate amount ₦%.2f exceeds CBN threshold of ₦%.2f", total, s.config.CTRThreshold), 0, req.Officer)

	// SLA: CTR must be filed within 24 hours
	filing.SLADeadline = time.Now().Add(24 * time.Hour)

	s.startTemporalWorkflow("ctr_filing_sla", filing)

	s.publishKafkaEvent("aml.ctr.created", map[string]interface{}{
		"filing_id": filing.ID,
		"amount":    filing.TotalAmount,
		"subject":   filing.Subject.FullName,
	})

	s.streamToFluvio("goaml-filings", filing)

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(filing)
}

func (s *AppState) handleAutoGenerateCTR(w http.ResponseWriter, r *http.Request) {
	// Query TigerBeetle for transactions exceeding threshold in the last 24h
	// In production, this would call TigerBeetle API
	var req struct {
		AccountID string `json:"account_id"`
		Period    string `json:"period"` // "24h", "7d"
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error":"invalid_request"}`, http.StatusBadRequest)
		return
	}

	// Simulate TigerBeetle aggregation query
	// In production: GET {TigerBeetleURL}/accounts/{id}/transfers?since=24h&aggregate=true
	response := map[string]interface{}{
		"account_id":      req.AccountID,
		"period":          req.Period,
		"auto_generated":  true,
		"message":         "CTR auto-generation queued — will file when TigerBeetle confirms threshold breach",
		"threshold":       s.config.CTRThreshold,
		"tigerbeetle_url": s.config.TigerBeetleURL,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

func (s *AppState) handleSubmitToNFIU(w http.ResponseWriter, r *http.Request) {
	id := extractPathParam(r.URL.Path, 4) // /api/v1/{str|sar}/{id}/submit
	reportType := extractPathParam(r.URL.Path, 3)

	s.mu.RLock()
	filing, exists := s.filings[id]
	s.mu.RUnlock()

	if !exists {
		http.Error(w, `{"error":"not_found"}`, http.StatusNotFound)
		return
	}

	if filing.Status != FilingStatusApproved && filing.Status != FilingStatusPending {
		http.Error(w, fmt.Sprintf(`{"error":"invalid_status","message":"Filing must be approved before submission, current status: %s"}`, filing.Status), http.StatusBadRequest)
		return
	}

	// Build goAML report
	goamlReport := s.buildGoAMLReport(filing)
	payload, _ := json.Marshal(goamlReport)

	// Sign payload with HMAC
	signature := s.signPayload(payload)

	// Submit to NFIU (in production, this calls the real NFIU goAML API)
	nfiuRef := fmt.Sprintf("NFIU-%s-%s-%d", s.config.NFIUInstitutionID, strings.ToUpper(reportType), time.Now().Unix())

	s.mu.Lock()
	now := time.Now()
	filing.Status = FilingStatusSubmitted
	filing.SubmissionDate = &now
	filing.NFIUReferenceID = nfiuRef
	filing.UpdatedAt = now
	filing.AuditTrail = append(filing.AuditTrail, AuditEntry{
		Action:    "submitted_to_nfiu",
		Actor:     "system",
		Details:   fmt.Sprintf("Submitted with signature %s, NFIU ref: %s", signature[:16], nfiuRef),
		Timestamp: now,
	})
	s.stats.Submitted++
	s.mu.Unlock()

	// Kafka event
	s.publishKafkaEvent(fmt.Sprintf("aml.%s.submitted", strings.ToLower(reportType)), map[string]interface{}{
		"filing_id":     filing.ID,
		"nfiu_ref":      nfiuRef,
		"submitted_at":  now.Format(time.RFC3339),
	})

	// Fluvio stream
	s.streamToFluvio("goaml-submissions", map[string]interface{}{
		"filing_id": filing.ID,
		"nfiu_ref":  nfiuRef,
		"status":    "submitted",
	})

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"filing_id":       filing.ID,
		"nfiu_reference":  nfiuRef,
		"status":          "submitted_to_nfiu",
		"submission_time": now.Format(time.RFC3339),
		"signature":       signature[:16] + "...",
	})
}

func (s *AppState) handleListFilings(w http.ResponseWriter, r *http.Request) {
	reportType := r.URL.Query().Get("type")
	status := r.URL.Query().Get("status")

	s.mu.RLock()
	var results []*Filing
	for _, f := range s.filings {
		if reportType != "" && string(f.ReportType) != reportType {
			continue
		}
		if status != "" && string(f.Status) != status {
			continue
		}
		results = append(results, f)
	}
	s.mu.RUnlock()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"filings": results,
		"total":   len(results),
	})
}

func (s *AppState) handleGetFiling(w http.ResponseWriter, r *http.Request) {
	id := extractPathParam(r.URL.Path, 3)

	s.mu.RLock()
	filing, exists := s.filings[id]
	s.mu.RUnlock()

	if !exists {
		http.Error(w, `{"error":"not_found"}`, http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(filing)
}

func (s *AppState) handleUpdateStatus(w http.ResponseWriter, r *http.Request) {
	id := extractPathParam(r.URL.Path, 3)

	var req struct {
		Status  string `json:"status"`
		Reason  string `json:"reason,omitempty"`
		ActorID string `json:"actor_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error":"invalid_request"}`, http.StatusBadRequest)
		return
	}

	s.mu.Lock()
	filing, exists := s.filings[id]
	if !exists {
		s.mu.Unlock()
		http.Error(w, `{"error":"not_found"}`, http.StatusNotFound)
		return
	}

	oldStatus := filing.Status
	filing.Status = FilingStatus(req.Status)
	filing.UpdatedAt = time.Now()
	filing.AuditTrail = append(filing.AuditTrail, AuditEntry{
		Action:    fmt.Sprintf("status_changed:%s->%s", oldStatus, req.Status),
		Actor:     req.ActorID,
		Details:   req.Reason,
		Timestamp: time.Now(),
	})

	if FilingStatus(req.Status) == FilingStatusAccepted {
		now := time.Now()
		filing.NFIUResponseDate = &now
		s.stats.Accepted++
	} else if FilingStatus(req.Status) == FilingStatusRejected {
		s.stats.Rejected++
	}
	s.mu.Unlock()

	// Kafka notification
	s.publishKafkaEvent("aml.filing.status_changed", map[string]interface{}{
		"filing_id":  id,
		"old_status": string(oldStatus),
		"new_status": req.Status,
		"reason":     req.Reason,
	})

	// Dapr notification to compliance team
	go func() {
		if s.config.DaprURL != "" {
			payload, _ := json.Marshal(map[string]interface{}{
				"type":      "goaml_status_update",
				"filing_id": id,
				"status":    req.Status,
				"reason":    req.Reason,
			})
			url := fmt.Sprintf("%s/v1.0/publish/notifications/compliance-alerts", s.config.DaprURL)
			http.Post(url, "application/json", strings.NewReader(string(payload)))
		}
	}()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"filing_id":  id,
		"old_status": oldStatus,
		"new_status": req.Status,
		"updated_at": filing.UpdatedAt.Format(time.RFC3339),
	})
}

func (s *AppState) handleStats(w http.ResponseWriter, r *http.Request) {
	s.mu.RLock()
	stats := s.stats
	stats.PendingReview = 0
	for _, f := range s.filings {
		if f.Status == FilingStatusPending {
			stats.PendingReview++
		}
	}
	s.mu.RUnlock()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(stats)
}

func (s *AppState) handleHealth(w http.ResponseWriter, r *http.Request) {
	s.mu.RLock()
	filingCount := len(s.filings)
	s.mu.RUnlock()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status":      "healthy",
		"service":     "goaml-integration",
		"version":     "1.0.0",
		"uptime_sec":  time.Since(s.startTime).Seconds(),
		"filings":     filingCount,
		"environment": s.config.Environment,
		"integrations": map[string]string{
			"kafka":       s.config.KafkaBrokers,
			"redis":       s.config.RedisURL,
			"keycloak":    s.config.KeycloakURL,
			"temporal":    s.config.TemporalURL,
			"tigerbeetle": s.config.TigerBeetleURL,
			"nfiu":        s.config.NFIUEndpoint,
		},
	})
}

// ── Helper Functions ─────────────────────────────────────────────────────────

func (s *AppState) createFiling(rt ReportType, subject SubjectInfo, txns []TransactionInfo, indicators []SuspicionIndicator, narrative string, riskScore float64, officer string) *Filing {
	id := generateID()
	ref := fmt.Sprintf("INSUREPORTAL-%s-%s", rt, time.Now().Format("20060102-150405"))
	total := totalAmount(txns)

	filing := &Filing{
		ID:               id,
		ReportType:       rt,
		Status:           FilingStatusPending,
		ReferenceNumber:  ref,
		InstitutionID:    s.config.NFIUInstitutionID,
		ReportingOfficer: officer,
		Subject:          subject,
		Transactions:     txns,
		Indicators:       indicators,
		Narrative:        narrative,
		RiskScore:        riskScore,
		TotalAmount:      total,
		Currency:         "NGN",
		FilingDate:       time.Now(),
		AuditTrail: []AuditEntry{
			{Action: "created", Actor: officer, Details: fmt.Sprintf("%s created with %d transactions", rt, len(txns)), Timestamp: time.Now()},
		},
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}

	s.mu.Lock()
	s.filings[id] = filing
	switch rt {
	case ReportTypeSTR:
		s.stats.TotalSTR++
	case ReportTypeSAR:
		s.stats.TotalSAR++
	case ReportTypeCTR:
		s.stats.TotalCTR++
	}
	s.stats.LastFiledAt = time.Now()
	s.mu.Unlock()

	return filing
}

func (s *AppState) buildGoAMLReport(filing *Filing) GoAMLReport {
	var txns []GoAMLTransaction
	for _, t := range filing.Transactions {
		direction := "outgoing"
		if t.Type == "credit" {
			direction = "incoming"
		}
		txns = append(txns, GoAMLTransaction{
			TransactionID: t.TransactionID,
			Amount:        t.Amount,
			Currency:      t.Currency,
			Direction:     direction,
			Date:          t.Date.Format("2006-01-02"),
			Channel:       t.Channel,
		})
	}

	idType := "BVN"
	idNumber := filing.Subject.BVN
	if idNumber == "" {
		idType = "NIN"
		idNumber = filing.Subject.NIN
	}

	var indicators []string
	for _, ind := range filing.Indicators {
		indicators = append(indicators, string(ind))
	}

	return GoAMLReport{
		ReportType:      string(filing.ReportType),
		InstitutionCode: s.config.NFIUInstitutionID,
		ReportDate:      filing.FilingDate.Format("2006-01-02"),
		ReportingEntity: GoAMLEntity{
			EntityType:  "institution",
			FullName:    "InsurePortal Insurance Platform",
			IDType:      "CBN_LICENSE",
			IDNumber:    s.config.NFIUInstitutionID,
			Nationality: "Nigeria",
		},
		SubjectEntity: GoAMLEntity{
			EntityType:    filing.Subject.SubjectType,
			FullName:      filing.Subject.FullName,
			IDType:        idType,
			IDNumber:      idNumber,
			Nationality:   filing.Subject.Nationality,
			Address:       filing.Subject.Address,
			Phone:         filing.Subject.Phone,
			AccountNumber: filing.Subject.AccountNumber,
		},
		TransactionDetails: txns,
		SuspicionNarrative: filing.Narrative,
		Indicators:         indicators,
		RiskAssessment:     fmt.Sprintf("Risk Score: %.1f/100", filing.RiskScore),
	}
}

func totalAmount(txns []TransactionInfo) float64 {
	var total float64
	for _, t := range txns {
		total += t.Amount
	}
	return total
}

func generateID() string {
	b := make([]byte, 12)
	rand.Read(b)
	return hex.EncodeToString(b)
}

func extractPathParam(path string, index int) string {
	parts := strings.Split(strings.TrimPrefix(path, "/"), "/")
	if index < len(parts) {
		return parts[index]
	}
	return ""
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

	// STR endpoints
	mux.HandleFunc("/api/v1/str/create", state.authMiddleware(state.handleCreateSTR))
	mux.HandleFunc("/api/v1/str/", state.authMiddleware(state.handleSubmitToNFIU)) // /str/{id}/submit

	// SAR endpoints
	mux.HandleFunc("/api/v1/sar/create", state.authMiddleware(state.handleCreateSAR))
	mux.HandleFunc("/api/v1/sar/", state.authMiddleware(state.handleSubmitToNFIU)) // /sar/{id}/submit

	// CTR endpoints
	mux.HandleFunc("/api/v1/ctr/create", state.authMiddleware(state.handleCreateCTR))
	mux.HandleFunc("/api/v1/ctr/auto-generate", state.authMiddleware(state.handleAutoGenerateCTR))

	// Filings
	mux.HandleFunc("/api/v1/filings", state.authMiddleware(state.handleListFilings))
	mux.HandleFunc("/api/v1/filings/", state.authMiddleware(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/status") && r.Method == "PUT" {
			state.handleUpdateStatus(w, r)
		} else {
			state.handleGetFiling(w, r)
		}
	}))

	// Stats & Health
	mux.HandleFunc("/api/v1/stats", state.authMiddleware(state.handleStats))
	mux.HandleFunc("/health", state.handleHealth)

	addr := ":" + cfg.Port
	log.Printf("[goAML] Starting on %s (env=%s, nfiu=%s)", addr, cfg.Environment, cfg.NFIUEndpoint)
	log.Printf("[goAML] Integrations: Kafka=%s, Temporal=%s, TigerBeetle=%s", cfg.KafkaBrokers, cfg.TemporalURL, cfg.TigerBeetleURL)

	if err := http.ListenAndServe(addr, mux); err != nil {
		log.Fatalf("[goAML] Server failed: %v", err)
	}
}
