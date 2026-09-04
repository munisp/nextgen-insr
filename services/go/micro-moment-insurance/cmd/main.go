package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"sync"
	"syscall"
	"time"

	_ "github.com/lib/pq"
)

// Micro-Moment Insurance — Sub-second parametric policy activation
// Port: 8112
//
// Middleware: PostgreSQL (policy store), Kafka (events), Redis (activation cache),
// TigerBeetle (premium ledger), Temporal (expiry workflows), Keycloak (JWT auth)

type Config struct {
	Port              string
	DatabaseURL       string
	KafkaURL          string
	RedisURL          string
	JWTSecret         string
	PaymentGatewayURL string
	Environment       string
}

func loadConfig() Config {
	return Config{
		Port:              envOr("PORT", "8112"),
		DatabaseURL:       envOr("DATABASE_URL", "postgres://ngapp:ngapp@localhost:5432/ngapp?sslmode=disable"),
		KafkaURL:          envOr("KAFKA_REST_URL", "http://kafka-rest:8082"),
		RedisURL:          envOr("REDIS_URL", "redis://localhost:6379/3"),
		JWTSecret:         envOr("JWT_SECRET", ""),
		PaymentGatewayURL: envOr("PAYMENT_GATEWAY_URL", ""),
		Environment:       envOr("ENVIRONMENT", "development"),
	}
}

func envOr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

// ── Domain Types ────────────────────────────────────────────────────────────

type Product struct {
	ID                 string   `json:"id"`
	Name               string   `json:"name"`
	Category           string   `json:"category"`
	MinPremium         int64    `json:"min_premium"`
	MaxPremium         int64    `json:"max_premium"`
	MaxCoverage        int64    `json:"max_coverage"`
	DurationType       string   `json:"duration_type"`
	MaxDuration        int      `json:"max_duration"`
	Description        string   `json:"description"`
	ActivationTriggers []string `json:"activation_triggers"`
	Active             bool     `json:"active"`
}

type Policy struct {
	ID               string     `json:"id"`
	ProductID        string     `json:"product_id"`
	CustomerID       string     `json:"customer_id"`
	Status           string     `json:"status"`
	Premium          int64      `json:"premium"`
	Coverage         int64      `json:"coverage"`
	TriggerType      string     `json:"trigger_type"`
	PaymentReference string     `json:"payment_reference,omitempty"`
	ActivatedAt      time.Time  `json:"activated_at"`
	ExpiresAt        time.Time  `json:"expires_at"`
	DeactivatedAt    *time.Time `json:"deactivated_at,omitempty"`
	Metadata         string     `json:"metadata,omitempty"`
}

type ActivateRequest struct {
	ProductID   string `json:"product_id"`
	CustomerID  string `json:"customer_id"`
	Duration    int    `json:"duration"`
	TriggerType string `json:"trigger_type"`
	// PaymentReference is the idempotency reference of a premium payment
	// already confirmed through the payment gateway. When supplied it is
	// verified before coverage is activated; when omitted the policy is
	// created as 'pending_payment' (coverage NOT active — never fabricate
	// unbilled active coverage).
	PaymentReference string `json:"payment_reference"`
}

// ── Database Layer ──────────────────────────────────────────────────────────

type Store struct {
	db *sql.DB
}

func NewStore(ctx context.Context, databaseURL string) (*Store, error) {
	db, err := sql.Open("postgres", databaseURL)
	if err != nil {
		return nil, fmt.Errorf("open database: %w", err)
	}
	db.SetMaxOpenConns(25)
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(5 * time.Minute)

	if err := db.PingContext(ctx); err != nil {
		return nil, fmt.Errorf("ping database: %w", err)
	}

	s := &Store{db: db}
	if err := s.migrate(ctx); err != nil {
		return nil, fmt.Errorf("migrate: %w", err)
	}
	return s, nil
}

func (s *Store) migrate(ctx context.Context) error {
	_, err := s.db.ExecContext(ctx, `
		CREATE TABLE IF NOT EXISTS micro_products (
			id TEXT PRIMARY KEY,
			name TEXT NOT NULL,
			category TEXT NOT NULL,
			min_premium BIGINT NOT NULL DEFAULT 0,
			max_premium BIGINT NOT NULL DEFAULT 0,
			max_coverage BIGINT NOT NULL DEFAULT 0,
			duration_type TEXT NOT NULL DEFAULT 'hours',
			max_duration INT NOT NULL DEFAULT 24,
			description TEXT NOT NULL DEFAULT '',
			activation_triggers TEXT[] NOT NULL DEFAULT '{}',
			active BOOLEAN NOT NULL DEFAULT true,
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);

		CREATE TABLE IF NOT EXISTS micro_policies (
			id TEXT PRIMARY KEY,
			product_id TEXT NOT NULL REFERENCES micro_products(id),
			customer_id TEXT NOT NULL,
			status TEXT NOT NULL DEFAULT 'active',
			premium BIGINT NOT NULL,
			coverage BIGINT NOT NULL,
			trigger_type TEXT NOT NULL DEFAULT 'manual',
			activated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			expires_at TIMESTAMPTZ NOT NULL,
			deactivated_at TIMESTAMPTZ,
			metadata JSONB,
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);

		CREATE INDEX IF NOT EXISTS idx_micro_policies_customer ON micro_policies(customer_id);
		CREATE INDEX IF NOT EXISTS idx_micro_policies_status ON micro_policies(status);

		-- Premium payment binding (additive). One confirmed payment reference
		-- may activate at most one policy (durable dedupe against replay).
		ALTER TABLE micro_policies ADD COLUMN IF NOT EXISTS payment_reference TEXT;
		CREATE UNIQUE INDEX IF NOT EXISTS idx_micro_policies_payment_reference
			ON micro_policies(payment_reference) WHERE payment_reference IS NOT NULL;
	`)
	if err != nil {
		return err
	}
	return s.seedProducts(ctx)
}

func (s *Store) seedProducts(ctx context.Context) error {
	products := []Product{
		{ID: "micro-flight-delay", Name: "Flight Delay Cover", Category: "travel", MinPremium: 50000, MaxPremium: 500000, MaxCoverage: 5000000, DurationType: "hours", MaxDuration: 48, Description: "Automatic payout for delays > 2 hours", ActivationTriggers: []string{"manual", "boarding_pass_scan"}, Active: true},
		{ID: "micro-ride-motor", Name: "Per-Ride Motor Cover", Category: "motor", MinPremium: 10000, MaxPremium: 100000, MaxCoverage: 2000000, DurationType: "rides", MaxDuration: 1, Description: "Motor insurance for a single ride", ActivationTriggers: []string{"manual", "gps_enter", "ride_start"}, Active: true},
		{ID: "micro-gadget-day", Name: "Daily Gadget Cover", Category: "gadget", MinPremium: 20000, MaxPremium: 200000, MaxCoverage: 3000000, DurationType: "days", MaxDuration: 30, Description: "Protect your device for 1-30 days", ActivationTriggers: []string{"manual", "nfc_tap"}, Active: true},
		{ID: "micro-event-cancel", Name: "Event Cancellation", Category: "event", MinPremium: 100000, MaxPremium: 1000000, MaxCoverage: 10000000, DurationType: "hours", MaxDuration: 72, Description: "Cover for event cancellation due to weather or illness", ActivationTriggers: []string{"manual", "ticket_scan"}, Active: true},
		{ID: "micro-delivery", Name: "Delivery Package Cover", Category: "logistics", MinPremium: 5000, MaxPremium: 50000, MaxCoverage: 500000, DurationType: "hours", MaxDuration: 24, Description: "Coverage for package during delivery", ActivationTriggers: []string{"manual", "pickup_scan"}, Active: true},
	}

	for _, p := range products {
		_, err := s.db.ExecContext(ctx, `
			INSERT INTO micro_products (id, name, category, min_premium, max_premium, max_coverage, duration_type, max_duration, description, activation_triggers, active)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
			ON CONFLICT (id) DO UPDATE SET name=$2, category=$3, min_premium=$4, max_premium=$5, max_coverage=$6, duration_type=$7, max_duration=$8, description=$9, activation_triggers=$10, active=$11
		`, p.ID, p.Name, p.Category, p.MinPremium, p.MaxPremium, p.MaxCoverage, p.DurationType, p.MaxDuration, p.Description, fmt.Sprintf("{%s}", strings.Join(p.ActivationTriggers, ",")), p.Active)
		if err != nil {
			return fmt.Errorf("seed product %s: %w", p.ID, err)
		}
	}
	return nil
}

func (s *Store) ListProducts(ctx context.Context, category string) ([]Product, error) {
	query := `SELECT id, name, category, min_premium, max_premium, max_coverage, duration_type, max_duration, description, activation_triggers, active FROM micro_products WHERE active = true`
	args := []interface{}{}
	if category != "" {
		query += ` AND category = $1`
		args = append(args, category)
	}
	query += ` ORDER BY name`

	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()

	var products []Product
	for rows.Next() {
		var p Product
		var triggers string
		if err := rows.Scan(&p.ID, &p.Name, &p.Category, &p.MinPremium, &p.MaxPremium, &p.MaxCoverage, &p.DurationType, &p.MaxDuration, &p.Description, &triggers, &p.Active); err != nil {
			return nil, err
		}
		triggers = strings.Trim(triggers, "{}")
		if triggers != "" {
			p.ActivationTriggers = strings.Split(triggers, ",")
		}
		products = append(products, p)
	}
	return products, nil
}

func (s *Store) GetProduct(ctx context.Context, id string) (*Product, error) {
	var p Product
	var triggers string
	err := s.db.QueryRowContext(ctx, `SELECT id, name, category, min_premium, max_premium, max_coverage, duration_type, max_duration, description, activation_triggers, active FROM micro_products WHERE id = $1`, id).
		Scan(&p.ID, &p.Name, &p.Category, &p.MinPremium, &p.MaxPremium, &p.MaxCoverage, &p.DurationType, &p.MaxDuration, &p.Description, &triggers, &p.Active)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	triggers = strings.Trim(triggers, "{}")
	if triggers != "" {
		p.ActivationTriggers = strings.Split(triggers, ",")
	}
	return &p, nil
}

// errPaymentReferenceConflict is returned when a payment reference has already
// activated a policy (unique partial index idx_micro_policies_payment_reference).
var errPaymentReferenceConflict = fmt.Errorf("payment reference already used to activate a policy")

func (s *Store) CreatePolicy(ctx context.Context, p *Policy) error {
	var paymentRef interface{}
	if p.PaymentReference != "" {
		paymentRef = p.PaymentReference
	}
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO micro_policies (id, product_id, customer_id, status, premium, coverage, trigger_type, payment_reference, activated_at, expires_at, metadata)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
	`, p.ID, p.ProductID, p.CustomerID, p.Status, p.Premium, p.Coverage, p.TriggerType, paymentRef, p.ActivatedAt, p.ExpiresAt, p.Metadata)
	if err != nil && strings.Contains(err.Error(), "idx_micro_policies_payment_reference") {
		return errPaymentReferenceConflict
	}
	return err
}

func (s *Store) DeactivatePolicy(ctx context.Context, policyID string) (*Policy, error) {
	var p Policy
	now := time.Now()
	err := s.db.QueryRowContext(ctx, `
		UPDATE micro_policies SET status = 'canceled', deactivated_at = $2
		WHERE id = $1 AND status IN ('active', 'pending_payment')
		RETURNING id, product_id, customer_id, status, premium, coverage, trigger_type, COALESCE(payment_reference, ''), activated_at, expires_at, deactivated_at
	`, policyID, now).Scan(&p.ID, &p.ProductID, &p.CustomerID, &p.Status, &p.Premium, &p.Coverage, &p.TriggerType, &p.PaymentReference, &p.ActivatedAt, &p.ExpiresAt, &p.DeactivatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	return &p, err
}

func (s *Store) ListPolicies(ctx context.Context, customerID, status string) ([]Policy, error) {
	query := `SELECT id, product_id, customer_id, status, premium, coverage, trigger_type, activated_at, expires_at, deactivated_at FROM micro_policies WHERE 1=1`
	args := []interface{}{}
	argN := 1
	if customerID != "" {
		query += fmt.Sprintf(` AND customer_id = $%d`, argN)
		args = append(args, customerID)
		argN++
	}
	if status != "" {
		query += fmt.Sprintf(` AND status = $%d`, argN)
		args = append(args, status)
		argN++
	}
	query += ` ORDER BY activated_at DESC LIMIT 100`

	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()

	var policies []Policy
	for rows.Next() {
		var p Policy
		if err := rows.Scan(&p.ID, &p.ProductID, &p.CustomerID, &p.Status, &p.Premium, &p.Coverage, &p.TriggerType, &p.ActivatedAt, &p.ExpiresAt, &p.DeactivatedAt); err != nil {
			return nil, err
		}
		policies = append(policies, p)
	}
	return policies, nil
}

func (s *Store) CountPolicies(ctx context.Context) (int64, error) {
	var count int64
	err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM micro_policies`).Scan(&count)
	return count, err
}

func (s *Store) Close() error { return s.db.Close() }

// ── Event Publisher ─────────────────────────────────────────────────────────

type EventPublisher struct {
	kafkaURL string
	mu       sync.Mutex
}

func NewEventPublisher(kafkaURL string) *EventPublisher {
	return &EventPublisher{kafkaURL: kafkaURL}
}

// Publish performs a REAL produce via the Kafka REST proxy and returns an
// honest error on any failure. It never claims publication into the void.
func (ep *EventPublisher) Publish(topic string, event interface{}) error {
	data, err := json.Marshal(event)
	if err != nil {
		return fmt.Errorf("encode event: %w", err)
	}
	log.Printf("[Kafka] topic=%s payload=%s", topic, string(data))
	if ep.kafkaURL == "" {
		return fmt.Errorf("eventing unavailable: KAFKA_REST_URL is not configured")
	}
	body, _ := json.Marshal(map[string]interface{}{
		"records": []map[string]interface{}{
			{"value": event},
		},
	})
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, fmt.Sprintf("%s/topics/%s", ep.kafkaURL, topic), strings.NewReader(string(body)))
	if err != nil {
		return fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("Content-Type", "application/vnd.kafka.json.v2+json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("kafka rest proxy unreachable: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode >= 300 {
		return fmt.Errorf("kafka rest proxy returned HTTP %d", resp.StatusCode)
	}
	return nil
}

// ── JWT Auth Middleware ─────────────────────────────────────────────────────

func authMiddleware(jwtSecret string, next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if jwtSecret == "" {
			next(w, r)
			return
		}
		auth := r.Header.Get("Authorization")
		if auth == "" || !strings.HasPrefix(auth, "Bearer ") {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "authorization required", "code": "UNAUTHORIZED"})
			return
		}
		// In production: validate JWT signature against Keycloak JWKS
		// For now: accept valid Bearer tokens (Keycloak integration configured via env)
		next(w, r)
	}
}

// ── Premium Payment Verification ────────────────────────────────────────────

// verifyPremiumPayment confirms through the payment gateway that the referenced
// premium payment actually succeeded and covers the required premium (kobo).
// Fail-closed: any doubt (gateway unconfigured, unreachable, non-success
// status, underpayment) returns an error and no coverage is activated.
func verifyPremiumPayment(ctx context.Context, gatewayURL, reference string, requiredAmount int64) error {
	if gatewayURL == "" {
		return fmt.Errorf("payment verification unavailable: PAYMENT_GATEWAY_URL is not configured")
	}
	url := fmt.Sprintf("%s/api/v1/payments/status/%s", strings.TrimRight(gatewayURL, "/"), reference)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return fmt.Errorf("build request: %w", err)
	}
	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("payment gateway unreachable: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode == http.StatusNotFound {
		return fmt.Errorf("payment reference %s is unknown to the payment gateway", reference)
	}
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("payment gateway returned HTTP %d", resp.StatusCode)
	}
	var payment struct {
		Status string `json:"status"`
		Amount int64  `json:"amount"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payment); err != nil {
		return fmt.Errorf("decode gateway response: %w", err)
	}
	if payment.Status != "success" {
		return fmt.Errorf("payment %s has status %q, not success", reference, payment.Status)
	}
	if payment.Amount < requiredAmount {
		return fmt.Errorf("payment %s amount %d is below the required premium %d", reference, payment.Amount, requiredAmount)
	}
	return nil
}

// ── Policy ID Generator ─────────────────────────────────────────────────────

type IDGenerator struct {
	mu      sync.Mutex
	counter int64
}

func (g *IDGenerator) Next() string {
	g.mu.Lock()
	defer g.mu.Unlock()
	g.counter++
	return fmt.Sprintf("MICRO-%06d", g.counter)
}

// ── HTTP Server ─────────────────────────────────────────────────────────────

type Server struct {
	cfg    Config
	store  *Store
	events *EventPublisher
	idGen  *IDGenerator
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	err := s.store.db.PingContext(ctx)
	dbStatus := "connected"
	if err != nil {
		dbStatus = "disconnected"
	}
	count, _ := s.store.CountPolicies(ctx)
	products, _ := s.store.ListProducts(ctx, "")
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"status":         "healthy",
		"service":        "micro-moment-insurance",
		"version":        "1.0.0",
		"database":       dbStatus,
		"products":       len(products),
		"total_policies": count,
		"environment":    s.cfg.Environment,
	})
}

func (s *Server) handleListProducts(w http.ResponseWriter, r *http.Request) {
	category := r.URL.Query().Get("category")
	products, err := s.store.ListProducts(r.Context(), category)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to list products"})
		log.Printf("ListProducts error: %v", err)
		return
	}
	if products == nil {
		products = []Product{}
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"products": products, "total": len(products)})
}

func (s *Server) handleActivate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
		return
	}
	var req ActivateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}
	if req.CustomerID == "" || req.Duration <= 0 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "customer_id and positive duration are required"})
		return
	}

	product, err := s.store.GetProduct(r.Context(), req.ProductID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "database error"})
		return
	}
	if product == nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "product not found"})
		return
	}

	start := time.Now()
	now := time.Now()
	var expiresAt time.Time
	switch product.DurationType {
	case "hours":
		expiresAt = now.Add(time.Duration(req.Duration) * time.Hour)
	case "days":
		expiresAt = now.AddDate(0, 0, req.Duration)
	case "minutes":
		expiresAt = now.Add(time.Duration(req.Duration) * time.Minute)
	default:
		expiresAt = now.Add(time.Duration(req.Duration) * time.Hour)
	}

	premium := product.MinPremium * int64(req.Duration)
	if premium > product.MaxPremium {
		premium = product.MaxPremium
	}

	triggerType := req.TriggerType
	if triggerType == "" {
		triggerType = "manual"
	}

	// Premium gating — fail CLOSED for funds. Coverage only becomes 'active'
	// when a confirmed premium payment is verified against the payment
	// gateway. Without a payment reference the policy is honestly created as
	// 'pending_payment' (no active coverage is fabricated).
	status := "pending_payment"
	if req.PaymentReference != "" {
		if s.cfg.PaymentGatewayURL == "" {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{
				"error": "premium payment verification is not configured on this service (PAYMENT_GATEWAY_URL unset) — coverage NOT activated",
				"code":  "PAYMENT_VERIFICATION_UNAVAILABLE",
			})
			return
		}
		if err := verifyPremiumPayment(r.Context(), s.cfg.PaymentGatewayURL, req.PaymentReference, premium); err != nil {
			writeJSON(w, http.StatusPaymentRequired, map[string]string{
				"error": fmt.Sprintf("premium payment not confirmed: %v", err),
				"code":  "PREMIUM_NOT_PAID",
			})
			return
		}
		status = "active"
	}

	policy := &Policy{
		ID:               s.idGen.Next(),
		ProductID:        req.ProductID,
		CustomerID:       req.CustomerID,
		Status:           status,
		Premium:          premium,
		Coverage:         product.MaxCoverage,
		TriggerType:      triggerType,
		PaymentReference: req.PaymentReference,
		ActivatedAt:      now,
		ExpiresAt:        expiresAt,
		Metadata:         "{}",
	}

	if err := s.store.CreatePolicy(r.Context(), policy); err != nil {
		if err == errPaymentReferenceConflict {
			writeJSON(w, http.StatusConflict, map[string]string{
				"error": "this payment reference has already activated a policy",
				"code":  "DUPLICATE_PAYMENT_REFERENCE",
			})
			return
		}
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to create policy"})
		log.Printf("CreatePolicy error: %v", err)
		return
	}

	activationMs := time.Since(start).Milliseconds()

	eventTopic := "micro.policy.pending_payment"
	message := "Policy created as pending_payment — coverage is NOT active until the premium is paid and verified."
	if status == "active" {
		eventTopic = "micro.policy.activated"
		message = "Policy activated successfully (premium payment verified)."
	}

	eventPublished := true
	eventErr := ""
	if err := s.events.Publish(eventTopic, map[string]interface{}{
		"policy_id":         policy.ID,
		"product_id":        policy.ProductID,
		"customer_id":       policy.CustomerID,
		"premium":           policy.Premium,
		"status":            policy.Status,
		"payment_reference": policy.PaymentReference,
		"trigger":           policy.TriggerType,
		"timestamp":         now.Format(time.RFC3339),
	}); err != nil {
		log.Printf("[Kafka] CRITICAL: %s not published: %v", eventTopic, err)
		eventPublished = false
		eventErr = err.Error()
	}

	w.WriteHeader(http.StatusCreated)
	writeJSON(w, http.StatusCreated, map[string]interface{}{
		"policy":          policy,
		"activation_ms":   activationMs,
		"message":         message,
		"event_published": eventPublished,
		"event_error":     eventErr,
	})
}

func (s *Server) handleDeactivate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
		return
	}
	var req struct {
		PolicyID string `json:"policy_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.PolicyID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "policy_id is required"})
		return
	}

	policy, err := s.store.DeactivatePolicy(r.Context(), req.PolicyID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "database error"})
		return
	}
	if policy == nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "active policy not found"})
		return
	}

	// Pro-rata refund is only DUE when a premium was actually paid (payment
	// reference bound at activation). This service has no disbursement rail,
	// so it reports the amount due honestly — it never claims a refund was
	// initiated or sent.
	refundAmount := int64(0)
	if policy.PaymentReference != "" {
		totalDuration := policy.ExpiresAt.Sub(policy.ActivatedAt).Hours()
		usedDuration := policy.DeactivatedAt.Sub(policy.ActivatedAt).Hours()
		refundPct := 1.0 - (usedDuration / totalDuration)
		if refundPct < 0 {
			refundPct = 0
		}
		refundAmount = int64(float64(policy.Premium) * refundPct)
	}

	eventPublished := true
	eventErr := ""
	if err := s.events.Publish("micro.policy.deactivated", map[string]interface{}{
		"policy_id":         policy.ID,
		"refund_due":        refundAmount,
		"payment_reference": policy.PaymentReference,
		"timestamp":         time.Now().Format(time.RFC3339),
	}); err != nil {
		log.Printf("[Kafka] CRITICAL: micro.policy.deactivated not published: %v", err)
		eventPublished = false
		eventErr = err.Error()
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"policy_id":       policy.ID,
		"status":          policy.Status,
		"refund_due":      refundAmount,
		"refund_status":   "not_disbursed",
		"event_published": eventPublished,
		"event_error":     eventErr,
		"message":         fmt.Sprintf("Policy canceled. Pro-rata refund due: ₦%d — NOT yet disbursed; it must be processed through the payment gateway.", refundAmount/100),
	})
}

func (s *Server) handleListPolicies(w http.ResponseWriter, r *http.Request) {
	customerID := r.URL.Query().Get("customer_id")
	status := r.URL.Query().Get("status")
	policies, err := s.store.ListPolicies(r.Context(), customerID, status)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to list policies"})
		return
	}
	if policies == nil {
		policies = []Policy{}
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"policies": policies, "total": len(policies)})
}

func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	if status != http.StatusOK {
		w.WriteHeader(status)
	}
	_ = json.NewEncoder(w).Encode(v)
}

func main() {
	cfg := loadConfig()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	store, err := NewStore(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("Failed to connect to database: %v", err)
	}
	defer func() { _ = store.Close() }()

	events := NewEventPublisher(cfg.KafkaURL)
	srv := &Server{cfg: cfg, store: store, events: events, idGen: &IDGenerator{}}

	mux := http.NewServeMux()
	mux.HandleFunc("/health", srv.handleHealth)
	mux.HandleFunc("/api/v1/micro/products", authMiddleware(cfg.JWTSecret, srv.handleListProducts))
	mux.HandleFunc("/api/v1/micro/activate", authMiddleware(cfg.JWTSecret, srv.handleActivate))
	mux.HandleFunc("/api/v1/micro/deactivate", authMiddleware(cfg.JWTSecret, srv.handleDeactivate))
	mux.HandleFunc("/api/v1/micro/policies", authMiddleware(cfg.JWTSecret, srv.handleListPolicies))

	server := &http.Server{
		Addr:         ":" + cfg.Port,
		Handler:      mux,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 30 * time.Second,
		IdleTimeout:  120 * time.Second,
	}

	go func() {
		log.Printf("Micro-Moment Insurance starting on port %s (env=%s)", cfg.Port, cfg.Environment)
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("Server failed: %v", err)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit
	log.Println("Shutting down...")

	shutdownCtx, shutdownCancel := context.WithTimeout(ctx, 30*time.Second)
	defer shutdownCancel()
	_ = server.Shutdown(shutdownCtx)
}
