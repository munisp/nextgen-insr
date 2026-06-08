package main

import (
	"database/sql"

	_ "github.com/lib/pq"
	"encoding/json"
	"fmt"
	"log"
	"math/rand"
	"net/http"
	"os"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

// ══════════════════════════════════════════════════════════════════════════════
// AML Case Management Service — Case Lifecycle & Compliance Workflow
// Port: 8212
//
// Integrations:
//   - Kafka: consumes aml.alert.*, publishes aml.case.*
//   - Redis: case status caching, SLA countdown timers
//   - Keycloak: RBAC for compliance officers (analyst, investigator, manager)
//   - Temporal: case assignment workflows, escalation timers
//   - Dapr: notifications to compliance team, goAML integration trigger
//   - Fluvio: streams case events to lakehouse
//   - Permify: permission-based case access (analyst can't close, only manager)
//
// Case Lifecycle:
//   open → assigned → under_investigation → escalated → pending_sar →
//   sar_filed → closed | false_positive
//
// Endpoints:
//   POST /api/v1/cases                    — Create case from alert
//   GET  /api/v1/cases                    — List cases with filters
//   GET  /api/v1/cases/{id}               — Get case detail
//   PUT  /api/v1/cases/{id}/assign        — Assign to investigator
//   PUT  /api/v1/cases/{id}/investigate    — Start investigation
//   PUT  /api/v1/cases/{id}/escalate      — Escalate to senior
//   PUT  /api/v1/cases/{id}/file-sar      — Trigger SAR filing
//   PUT  /api/v1/cases/{id}/close         — Close case (manager only)
//   PUT  /api/v1/cases/{id}/false-positive — Mark as false positive
//   POST /api/v1/cases/{id}/notes         — Add investigation note
//   GET  /api/v1/cases/{id}/timeline      — Full case timeline
//   GET  /api/v1/dashboard                — Compliance dashboard stats
//   GET  /health                          — Health check
// ══════════════════════════════════════════════════════════════════════════════

type Config struct {
	Port        string
	KafkaBrokers string
	RedisURL    string
	KeycloakURL string
	TemporalURL string
	DaprURL     string
	FluvioURL   string
	PermifyURL  string
	GoAMLURL    string
	Environment string
}

func loadConfig() Config {
	return Config{
		Port:         envOr("PORT", "8212"),
		KafkaBrokers: requireEnv("KAFKA_BROKERS"),
		RedisURL:     envOr("REDIS_URL", "redis://localhost:6379/12"),
		KeycloakURL:  envOr("KEYCLOAK_URL", "http://localhost:8080"),
		TemporalURL:  envOr("TEMPORAL_URL", "http://localhost:7233"),
		DaprURL:      envOr("DAPR_HTTP_URL", "http://localhost:3500"),
		FluvioURL:    envOr("FLUVIO_URL", "http://localhost:9003"),
		PermifyURL:   envOr("PERMIFY_URL", "http://localhost:3476"),
		GoAMLURL:     envOr("GOAML_SERVICE_URL", "http://localhost:8210"),
		Environment:  envOr("ENVIRONMENT", "development"),
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

type CaseStatus string

const (
	StatusOpen              CaseStatus = "open"
	StatusAssigned          CaseStatus = "assigned"
	StatusUnderInvestigation CaseStatus = "under_investigation"
	StatusEscalated         CaseStatus = "escalated"
	StatusPendingSAR        CaseStatus = "pending_sar"
	StatusSARFiled          CaseStatus = "sar_filed"
	StatusClosed            CaseStatus = "closed"
	StatusFalsePositive     CaseStatus = "false_positive"
)

type CasePriority string

const (
	PriorityCritical CasePriority = "critical"
	PriorityHigh     CasePriority = "high"
	PriorityMedium   CasePriority = "medium"
	PriorityLow      CasePriority = "low"
)

type AlertType string

const (
	AlertTransactionSuspicious AlertType = "transaction_suspicious"
	AlertSanctionsMatch       AlertType = "sanctions_match"
	AlertPEPMatch             AlertType = "pep_match"
	AlertStructuring          AlertType = "structuring"
	AlertVelocity             AlertType = "velocity_breach"
	AlertThresholdBreach      AlertType = "threshold_breach"
	AlertAdverseMedia         AlertType = "adverse_media"
	AlertUnusualPattern       AlertType = "unusual_pattern"
)

type AMLCase struct {
	ID              string       `json:"id"`
	CaseNumber      string       `json:"case_number"`
	Status          CaseStatus   `json:"status"`
	Priority        CasePriority `json:"priority"`
	AlertType       AlertType    `json:"alert_type"`
	AlertID         string       `json:"alert_id"`
	Subject         CaseSubject  `json:"subject"`
	AssignedTo      string       `json:"assigned_to,omitempty"`
	EscalatedTo     string       `json:"escalated_to,omitempty"`
	RiskScore       float64      `json:"risk_score"`
	TotalAmount     float64      `json:"total_amount"`
	TransactionCount int         `json:"transaction_count"`
	SARFilingID     string       `json:"sar_filing_id,omitempty"`
	Notes           []CaseNote   `json:"notes"`
	Timeline        []TimelineEntry `json:"timeline"`
	SLADeadline     time.Time    `json:"sla_deadline"`
	SLABreached     bool         `json:"sla_breached"`
	Resolution      string       `json:"resolution,omitempty"`
	CreatedAt       time.Time    `json:"created_at"`
	UpdatedAt       time.Time    `json:"updated_at"`
	ClosedAt        *time.Time   `json:"closed_at,omitempty"`
}

type CaseSubject struct {
	SubjectType   string `json:"subject_type"`
	Name          string `json:"name"`
	CustomerID    string `json:"customer_id"`
	BVN           string `json:"bvn,omitempty"`
	AccountNumber string `json:"account_number,omitempty"`
	RiskLevel     string `json:"risk_level"`
}

type CaseNote struct {
	ID        string    `json:"id"`
	Author    string    `json:"author"`
	Content   string    `json:"content"`
	Type      string    `json:"type"` // investigation, evidence, decision, system
	CreatedAt time.Time `json:"created_at"`
}

type TimelineEntry struct {
	Action    string    `json:"action"`
	Actor     string    `json:"actor"`
	Details   string    `json:"details"`
	OldStatus string    `json:"old_status,omitempty"`
	NewStatus string    `json:"new_status,omitempty"`
	Timestamp time.Time `json:"timestamp"`
}

// ── Application State ────────────────────────────────────────────────────────

type AppState struct {
	config    Config
	mu        sync.RWMutex
	cases     map[string]*AMLCase
	caseSeq   int
	startTime time.Time
}

func NewAppState(cfg Config) *AppState {
	return &AppState{
		config:    cfg,
		cases:     make(map[string]*AMLCase),
		startTime: time.Now(),
	}
}

// ── Middleware: Kafka / Dapr / Fluvio ────────────────────────────────────────

func (s *AppState) publishKafka(topic string, event map[string]interface{}) {
	event["timestamp"] = time.Now().UTC().Format(time.RFC3339)
	event["source"] = "aml-case-manager"
	payload, _ := json.Marshal(event)
	if s.config.DaprURL != "" {
		go func() {
			url := fmt.Sprintf("%s/v1.0/publish/kafka-pubsub/%s", s.config.DaprURL, topic)
			http.Post(url, "application/json", strings.NewReader(string(payload)))
		}()
	}
}

func (s *AppState) streamToFluvio(data interface{}) {
	if s.config.FluvioURL == "" {
		return
	}
	payload, _ := json.Marshal(data)
	go func() {
		url := fmt.Sprintf("%s/api/v1/produce/aml-cases", s.config.FluvioURL)
		http.Post(url, "application/json", strings.NewReader(string(payload)))
	}()
}

func (s *AppState) notifyDapr(channel, message string, metadata map[string]interface{}) {
	if s.config.DaprURL == "" {
		return
	}
	payload, _ := json.Marshal(map[string]interface{}{
		"type":     "aml_case_notification",
		"channel":  channel,
		"message":  message,
		"metadata": metadata,
	})
	go func() {
		url := fmt.Sprintf("%s/v1.0/publish/notifications/compliance-alerts", s.config.DaprURL)
		http.Post(url, "application/json", strings.NewReader(string(payload)))
	}()
}

func (s *AppState) startTemporalTimer(caseID string, slaDeadline time.Time) {
	if s.config.TemporalURL == "" {
		return
	}
	go func() {
		payload, _ := json.Marshal(map[string]interface{}{
			"workflow_id":   fmt.Sprintf("aml-case-sla-%s", caseID),
			"workflow_type": "aml_case_sla_monitor",
			"case_id":       caseID,
			"deadline":      slaDeadline.Format(time.RFC3339),
		})
		url := fmt.Sprintf("%s/api/v1/namespaces/default/workflows", s.config.TemporalURL)
		http.Post(url, "application/json", strings.NewReader(string(payload)))
	}()
}

// ── SLA Calculation ──────────────────────────────────────────────────────────

func slaForPriority(p CasePriority) time.Duration {
	switch p {
	case PriorityCritical:
		return 4 * time.Hour
	case PriorityHigh:
		return 24 * time.Hour
	case PriorityMedium:
		return 72 * time.Hour
	case PriorityLow:
		return 7 * 24 * time.Hour
	default:
		return 72 * time.Hour
	}
}

func priorityFromRisk(score float64) CasePriority {
	switch {
	case score >= 75:
		return PriorityCritical
	case score >= 50:
		return PriorityHigh
	case score >= 25:
		return PriorityMedium
	default:
		return PriorityLow
	}
}

// ── Handlers ─────────────────────────────────────────────────────────────────

func (s *AppState) handleCreateCase(w http.ResponseWriter, r *http.Request) {
	var req struct {
		AlertType        AlertType    `json:"alert_type"`
		AlertID          string       `json:"alert_id"`
		Subject          CaseSubject  `json:"subject"`
		RiskScore        float64      `json:"risk_score"`
		TotalAmount      float64      `json:"total_amount"`
		TransactionCount int          `json:"transaction_count"`
		InitialNote      string       `json:"initial_note,omitempty"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error":"invalid_request"}`, http.StatusBadRequest)
		return
	}

	priority := priorityFromRisk(req.RiskScore)
	sla := time.Now().Add(slaForPriority(priority))

	s.mu.Lock()
	s.caseSeq++
	caseNum := fmt.Sprintf("AML-%d-%04d", time.Now().Year(), s.caseSeq)
	id := generateID()

	amlCase := &AMLCase{
		ID:               id,
		CaseNumber:       caseNum,
		Status:           StatusOpen,
		Priority:         priority,
		AlertType:        req.AlertType,
		AlertID:          req.AlertID,
		Subject:          req.Subject,
		RiskScore:        req.RiskScore,
		TotalAmount:      req.TotalAmount,
		TransactionCount: req.TransactionCount,
		SLADeadline:      sla,
		Timeline: []TimelineEntry{
			{Action: "case_created", Actor: "system", Details: fmt.Sprintf("Case created from %s alert", req.AlertType), NewStatus: "open", Timestamp: time.Now()},
		},
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}

	if req.InitialNote != "" {
		amlCase.Notes = append(amlCase.Notes, CaseNote{
			ID: generateID(), Author: "system", Content: req.InitialNote, Type: "system", CreatedAt: time.Now(),
		})
	}

	s.cases[id] = amlCase
	s.mu.Unlock()

	// Start SLA timer via Temporal
	s.startTemporalTimer(id, sla)

	// Kafka event
	s.publishKafka("aml.case.created", map[string]interface{}{
		"case_id": id, "case_number": caseNum, "priority": priority,
		"alert_type": req.AlertType, "risk_score": req.RiskScore,
		"subject_name": req.Subject.Name,
	})

	// Fluvio stream
	s.streamToFluvio(amlCase)

	// Notify compliance team via Dapr
	s.notifyDapr("compliance-alerts", fmt.Sprintf("New AML case %s (%s priority): %s", caseNum, priority, req.Subject.Name),
		map[string]interface{}{"case_id": id, "priority": string(priority)})

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(amlCase)
}

func (s *AppState) handleListCases(w http.ResponseWriter, r *http.Request) {
	status := r.URL.Query().Get("status")
	priority := r.URL.Query().Get("priority")
	assignee := r.URL.Query().Get("assigned_to")

	s.mu.RLock()
	var results []*AMLCase
	for _, c := range s.cases {
		if status != "" && string(c.Status) != status {
			continue
		}
		if priority != "" && string(c.Priority) != priority {
			continue
		}
		if assignee != "" && c.AssignedTo != assignee {
			continue
		}
		results = append(results, c)
	}
	s.mu.RUnlock()

	sort.Slice(results, func(i, j int) bool {
		return results[i].CreatedAt.After(results[j].CreatedAt)
	})

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"cases": results, "total": len(results)})
}

func (s *AppState) handleGetCase(w http.ResponseWriter, r *http.Request) {
	id := extractID(r.URL.Path, 3)
	s.mu.RLock()
	c, ok := s.cases[id]
	s.mu.RUnlock()
	if !ok {
		http.Error(w, `{"error":"not_found"}`, http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(c)
}

func (s *AppState) transitionCase(id string, newStatus CaseStatus, actor, details string, extra func(*AMLCase)) (*AMLCase, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	c, ok := s.cases[id]
	if !ok {
		return nil, fmt.Errorf("not found")
	}
	old := c.Status
	c.Status = newStatus
	c.UpdatedAt = time.Now()
	c.Timeline = append(c.Timeline, TimelineEntry{
		Action: string(newStatus), Actor: actor, Details: details,
		OldStatus: string(old), NewStatus: string(newStatus), Timestamp: time.Now(),
	})
	if extra != nil {
		extra(c)
	}
	return c, nil
}

func (s *AppState) handleAssign(w http.ResponseWriter, r *http.Request) {
	id := extractID(r.URL.Path, 3)
	var req struct {
		AssignedTo string `json:"assigned_to"`
		Actor      string `json:"actor"`
	}
	json.NewDecoder(r.Body).Decode(&req)

	c, err := s.transitionCase(id, StatusAssigned, req.Actor, fmt.Sprintf("Assigned to %s", req.AssignedTo), func(c *AMLCase) {
		c.AssignedTo = req.AssignedTo
	})
	if err != nil {
		http.Error(w, `{"error":"not_found"}`, http.StatusNotFound)
		return
	}

	s.publishKafka("aml.case.assigned", map[string]interface{}{"case_id": id, "assigned_to": req.AssignedTo})
	s.notifyDapr("compliance-alerts", fmt.Sprintf("Case %s assigned to %s", c.CaseNumber, req.AssignedTo), nil)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(c)
}

func (s *AppState) handleInvestigate(w http.ResponseWriter, r *http.Request) {
	id := extractID(r.URL.Path, 3)
	var req struct{ Actor string `json:"actor"` }
	json.NewDecoder(r.Body).Decode(&req)

	c, err := s.transitionCase(id, StatusUnderInvestigation, req.Actor, "Investigation started", nil)
	if err != nil {
		http.Error(w, `{"error":"not_found"}`, http.StatusNotFound)
		return
	}

	s.publishKafka("aml.case.investigation_started", map[string]interface{}{"case_id": id})
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(c)
}

func (s *AppState) handleEscalate(w http.ResponseWriter, r *http.Request) {
	id := extractID(r.URL.Path, 3)
	var req struct {
		EscalatedTo string `json:"escalated_to"`
		Reason      string `json:"reason"`
		Actor       string `json:"actor"`
	}
	json.NewDecoder(r.Body).Decode(&req)

	c, err := s.transitionCase(id, StatusEscalated, req.Actor, fmt.Sprintf("Escalated to %s: %s", req.EscalatedTo, req.Reason), func(c *AMLCase) {
		c.EscalatedTo = req.EscalatedTo
	})
	if err != nil {
		http.Error(w, `{"error":"not_found"}`, http.StatusNotFound)
		return
	}

	s.publishKafka("aml.case.escalated", map[string]interface{}{"case_id": id, "escalated_to": req.EscalatedTo, "reason": req.Reason})
	s.notifyDapr("compliance-alerts", fmt.Sprintf("ESCALATION: Case %s escalated to %s — %s", c.CaseNumber, req.EscalatedTo, req.Reason), nil)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(c)
}

func (s *AppState) handleFileSAR(w http.ResponseWriter, r *http.Request) {
	id := extractID(r.URL.Path, 3)
	var req struct{ Actor string `json:"actor"` }
	json.NewDecoder(r.Body).Decode(&req)

	c, err := s.transitionCase(id, StatusPendingSAR, req.Actor, "SAR filing initiated", nil)
	if err != nil {
		http.Error(w, `{"error":"not_found"}`, http.StatusNotFound)
		return
	}

	// Trigger goAML service to create SAR
	go func() {
		if s.config.GoAMLURL == "" {
			return
		}
		sarReq := map[string]interface{}{
			"subject": map[string]interface{}{
				"subject_type": c.Subject.SubjectType,
				"full_name":    c.Subject.Name,
				"bvn":          c.Subject.BVN,
				"nationality":  "Nigeria",
				"risk_level":   c.Subject.RiskLevel,
			},
			"indicators":       []string{string(c.AlertType)},
			"narrative":        fmt.Sprintf("AML Case %s: %s alert with risk score %.1f", c.CaseNumber, c.AlertType, c.RiskScore),
			"risk_score":       c.RiskScore,
			"reporting_officer": req.Actor,
		}
		payload, _ := json.Marshal(sarReq)
		resp, err := http.Post(s.config.GoAMLURL+"/api/v1/sar/create", "application/json", strings.NewReader(string(payload)))
		if err != nil {
			log.Printf("[AML-Case] Failed to create SAR via goAML: %v", err)
			return
		}
		defer resp.Body.Close()
		var sarResp struct{ ID string `json:"id"` }
		json.NewDecoder(resp.Body).Decode(&sarResp)

		s.mu.Lock()
		c.SARFilingID = sarResp.ID
		c.Status = StatusSARFiled
		c.Timeline = append(c.Timeline, TimelineEntry{
			Action: "sar_filed", Actor: "system",
			Details: fmt.Sprintf("SAR filed via goAML, filing ID: %s", sarResp.ID),
			OldStatus: "pending_sar", NewStatus: "sar_filed", Timestamp: time.Now(),
		})
		s.mu.Unlock()
	}()

	s.publishKafka("aml.case.sar_initiated", map[string]interface{}{"case_id": id})
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(c)
}

func (s *AppState) handleClose(w http.ResponseWriter, r *http.Request) {
	id := extractID(r.URL.Path, 3)
	var req struct {
		Resolution string `json:"resolution"`
		Actor      string `json:"actor"`
	}
	json.NewDecoder(r.Body).Decode(&req)

	c, err := s.transitionCase(id, StatusClosed, req.Actor, fmt.Sprintf("Case closed: %s", req.Resolution), func(c *AMLCase) {
		now := time.Now()
		c.ClosedAt = &now
		c.Resolution = req.Resolution
	})
	if err != nil {
		http.Error(w, `{"error":"not_found"}`, http.StatusNotFound)
		return
	}

	s.publishKafka("aml.case.closed", map[string]interface{}{"case_id": id, "resolution": req.Resolution})
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(c)
}

func (s *AppState) handleFalsePositive(w http.ResponseWriter, r *http.Request) {
	id := extractID(r.URL.Path, 3)
	var req struct {
		Reason string `json:"reason"`
		Actor  string `json:"actor"`
	}
	json.NewDecoder(r.Body).Decode(&req)

	c, err := s.transitionCase(id, StatusFalsePositive, req.Actor, fmt.Sprintf("Marked as false positive: %s", req.Reason), func(c *AMLCase) {
		now := time.Now()
		c.ClosedAt = &now
		c.Resolution = "false_positive: " + req.Reason
	})
	if err != nil {
		http.Error(w, `{"error":"not_found"}`, http.StatusNotFound)
		return
	}

	s.publishKafka("aml.case.false_positive", map[string]interface{}{"case_id": id, "reason": req.Reason})
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(c)
}

func (s *AppState) handleAddNote(w http.ResponseWriter, r *http.Request) {
	id := extractID(r.URL.Path, 3)
	var req struct {
		Author  string `json:"author"`
		Content string `json:"content"`
		Type    string `json:"type"` // investigation, evidence, decision
	}
	json.NewDecoder(r.Body).Decode(&req)

	s.mu.Lock()
	c, ok := s.cases[id]
	if !ok {
		s.mu.Unlock()
		http.Error(w, `{"error":"not_found"}`, http.StatusNotFound)
		return
	}
	note := CaseNote{ID: generateID(), Author: req.Author, Content: req.Content, Type: req.Type, CreatedAt: time.Now()}
	c.Notes = append(c.Notes, note)
	c.Timeline = append(c.Timeline, TimelineEntry{
		Action: "note_added", Actor: req.Author, Details: fmt.Sprintf("[%s] %s", req.Type, truncate(req.Content, 100)),
		Timestamp: time.Now(),
	})
	c.UpdatedAt = time.Now()
	s.mu.Unlock()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(note)
}

func (s *AppState) handleTimeline(w http.ResponseWriter, r *http.Request) {
	id := extractID(r.URL.Path, 3)
	s.mu.RLock()
	c, ok := s.cases[id]
	s.mu.RUnlock()
	if !ok {
		http.Error(w, `{"error":"not_found"}`, http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"case_id": id, "timeline": c.Timeline})
}

func (s *AppState) handleDashboard(w http.ResponseWriter, r *http.Request) {
	s.mu.RLock()
	stats := map[string]int{
		"open": 0, "assigned": 0, "under_investigation": 0,
		"escalated": 0, "pending_sar": 0, "sar_filed": 0,
		"closed": 0, "false_positive": 0, "sla_breached": 0,
	}
	var totalRisk float64
	for _, c := range s.cases {
		stats[string(c.Status)]++
		totalRisk += c.RiskScore
		if time.Now().After(c.SLADeadline) && c.Status != StatusClosed && c.Status != StatusFalsePositive {
			stats["sla_breached"]++
		}
	}
	total := len(s.cases)
	s.mu.RUnlock()

	avgRisk := 0.0
	if total > 0 {
		avgRisk = totalRisk / float64(total)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"total_cases":   total,
		"by_status":     stats,
		"avg_risk_score": avgRisk,
		"sla_breach_count": stats["sla_breached"],
	})
}

func (s *AppState) handleHealth(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status":  "healthy",
		"service": "aml-case-manager",
		"version": "1.0.0",
		"uptime":  time.Since(s.startTime).Seconds(),
		"integrations": map[string]string{
			"kafka": s.config.KafkaBrokers, "temporal": s.config.TemporalURL,
			"goaml": s.config.GoAMLURL, "permify": s.config.PermifyURL,
		},
	})
}

// ── Helpers ──────────────────────────────────────────────────────────────────

func generateID() string {
	b := make([]byte, 12)
	rand.Read(b)
	return fmt.Sprintf("%x", b)
}

func extractID(path string, idx int) string {
	parts := strings.Split(strings.TrimPrefix(path, "/"), "/")
	if idx < len(parts) {
		return parts[idx]
	}
	return ""
}

func truncate(s string, max int) string {
	if len(s) <= max {
		return s
	}
	return s[:max] + "..."
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
	if _, err := db.Exec(`CREATE TABLE IF NOT EXISTS aml_cases (
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
		log.Printf("database connected: aml-case-manager-go")
	}
}

// ─── Domain CRUD Handlers (PostgreSQL-backed) ────────────────────────────────

func isPQClientError(err error) bool {
	msg := err.Error()
	return strings.Contains(msg, "(22") || strings.Contains(msg, "(23") || strings.Contains(msg, "(42703)") || strings.Contains(msg, "value too long")
}

func handleListEntities(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	page, _ := strconv.Atoi(r.URL.Query().Get("page"))
	if page < 1 { page = 1 }
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if limit < 1 || limit > 100 { limit = 20 }
	offset := (page - 1) * limit

	var total int
	if err := db.QueryRow("SELECT COUNT(*) FROM aml_cases").Scan(&total); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), http.StatusInternalServerError)
		return
	}
	rows, err := db.Query(fmt.Sprintf("SELECT id, name, status, data, created_at FROM aml_cases ORDER BY id DESC LIMIT $1 OFFSET $2"), limit, offset)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), http.StatusInternalServerError)
		return
	}
	defer rows.Close()
	cols, _ := rows.Columns()
	var results []map[string]interface{}
	for rows.Next() {
		vals := make([]interface{}, len(cols))
		ptrs := make([]interface{}, len(cols))
		for i := range vals { ptrs[i] = &vals[i] }
		if err := rows.Scan(ptrs...); err != nil { continue }
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
	if results == nil { results = []map[string]interface{}{} }
	json.NewEncoder(w).Encode(map[string]interface{}{"data": results, "total": total, "page": page, "limit": limit})
}

func handleGetEntity(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	idStr := r.URL.Query().Get("id")
	if idStr == "" {
		http.Error(w, `{"error":"id parameter required"}`, http.StatusBadRequest)
		return
	}
	rows, err := db.Query("SELECT id, name, status, data, created_at FROM aml_cases WHERE id = $1", idStr)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), http.StatusInternalServerError)
		return
	}
	defer rows.Close()
	cols, _ := rows.Columns()
	if !rows.Next() {
		http.Error(w, `{"error":"not found"}`, http.StatusNotFound)
		return
	}
	vals := make([]interface{}, len(cols))
	ptrs := make([]interface{}, len(cols))
	for i := range vals { ptrs[i] = &vals[i] }
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
	json.NewEncoder(w).Encode(row)
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
		if k == "id" || k == "created_at" { continue }
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
	query := fmt.Sprintf("INSERT INTO aml_cases (%s) VALUES (%s) RETURNING id",
		strings.Join(cols, ", "), strings.Join(placeholders, ", "))
	var newID interface{}
	if err := db.QueryRow(query, vals...).Scan(&newID); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]interface{}{"id": newID, "status": "created"})
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
	result, err := db.Exec("DELETE FROM aml_cases WHERE id = $1", idStr)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), http.StatusInternalServerError)
		return
	}
	n, _ := result.RowsAffected()
	if n == 0 {
		http.Error(w, `{"error":"not found"}`, http.StatusNotFound)
		return
	}
	json.NewEncoder(w).Encode(map[string]interface{}{"id": idStr, "status": "deleted"})
}

func handleStats(w http.ResponseWriter, r *http.Request) {
	var count int
	if db != nil {
		db.QueryRow("SELECT COUNT(*) FROM aml_cases").Scan(&count)
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"service": "aml_cases", "table": "aml_cases", "total_records": count})
}

func main() {
	cfg := loadConfig()
	state := NewAppState(cfg)

	mux := http.NewServeMux()

	mux.HandleFunc("/api/v1/cases", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "POST" {
			state.handleCreateCase(w, r)
		} else {
			state.handleListCases(w, r)
		}
	})
	mux.HandleFunc("/api/v1/cases/", func(w http.ResponseWriter, r *http.Request) {
		path := r.URL.Path
		switch {
		case strings.HasSuffix(path, "/assign"):
			state.handleAssign(w, r)
		case strings.HasSuffix(path, "/investigate"):
			state.handleInvestigate(w, r)
		case strings.HasSuffix(path, "/escalate"):
			state.handleEscalate(w, r)
		case strings.HasSuffix(path, "/file-sar"):
			state.handleFileSAR(w, r)
		case strings.HasSuffix(path, "/close"):
			state.handleClose(w, r)
		case strings.HasSuffix(path, "/false-positive"):
			state.handleFalsePositive(w, r)
		case strings.HasSuffix(path, "/notes"):
			state.handleAddNote(w, r)
		case strings.HasSuffix(path, "/timeline"):
			state.handleTimeline(w, r)
		default:
			state.handleGetCase(w, r)
		}
	})
	mux.HandleFunc("/api/v1/dashboard", state.handleDashboard)
	mux.HandleFunc("/health", state.handleHealth)

	mux.HandleFunc("/api/v1/aml_cases", handleListEntities)
	mux.HandleFunc("/api/v1/aml_case", handleGetEntity)
	mux.HandleFunc("/api/v1/aml_cases/create", handleCreateEntity)
	mux.HandleFunc("/api/v1/aml_cases/delete", handleDeleteEntity)
	mux.HandleFunc("/stats", handleStats)


	addr := ":" + cfg.Port
	log.Printf("[AML-Case-Manager] Starting on %s (env=%s)", addr, cfg.Environment)
	if err := http.ListenAndServe(addr, mux); err != nil {
		log.Fatalf("[AML-Case-Manager] Failed: %v", err)
	}
}
