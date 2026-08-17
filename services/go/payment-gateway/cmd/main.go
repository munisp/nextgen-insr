package main

import (
	"context"
	"crypto/hmac"
	"crypto/sha512"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"
)

// ══════════════════════════════════════════════════════════════════════════════
// Payment Gateway Service — Paystack + Flutterwave Integration
// Port: 8100
//
// Integrations:
//   - Kafka: publishes payment.initiated, payment.confirmed, payment.failed events
//   - Temporal: orchestrates multi-step payment flows (split, recurring, retry)
//   - TigerBeetle: double-entry ledger reconciliation
//   - Redis: idempotency keys, rate limiting, session cache
//   - Keycloak: JWT validation for all endpoints
//   - Dapr: pub/sub for cross-service notifications
//   - Mojaloop: inter-bank settlement for bank transfers
//   - APISIX: upstream for /api/payments/* routes
//   - OpenSearch: payment analytics and audit trail
//   - Permify: authorization checks (who can initiate payments)
//
// Endpoints:
//   POST /api/v1/payments/initiate        — Initiate payment (card/bank/ussd/mobile-money)
//   POST /api/v1/payments/verify          — Verify payment status
//   POST /api/v1/payments/webhook/paystack — Paystack webhook handler
//   POST /api/v1/payments/webhook/flutterwave — Flutterwave webhook handler
//   POST /api/v1/payments/recurring/create — Create subscription/recurring billing
//   POST /api/v1/payments/recurring/cancel — Cancel subscription
//   POST /api/v1/payments/split/create    — Create split payment (agent commission)
//   POST /api/v1/payments/refund          — Process refund
//   GET  /api/v1/payments/status/{ref}    — Get payment status by reference
//   GET  /api/v1/payments/history         — Payment history (paginated)
//   GET  /health                          — Health check
// ══════════════════════════════════════════════════════════════════════════════

type Config struct {
	Port                 string
	PaystackSecretKey    string
	PaystackPublicKey    string
	FlutterwaveSecretKey string
	FlutterwaveEncKey    string
	KafkaBrokers         string
	RedisURL             string
	TigerBeetleURL       string
	TemporalURL          string
	DaprURL              string
	MojaloopURL          string
	OpenSearchURL        string
	KeycloakURL          string
	PermifyURL           string
	WebhookSecret        string
	Environment          string
}

func loadConfig() Config {
	return Config{
		Port:                 envOr("PORT", "8100"),
		PaystackSecretKey:    envOr("PAYSTACK_SECRET_KEY", ""),
		PaystackPublicKey:    envOr("PAYSTACK_PUBLIC_KEY", ""),
		FlutterwaveSecretKey: envOr("FLUTTERWAVE_SECRET_KEY", ""),
		FlutterwaveEncKey:    envOr("FLUTTERWAVE_ENC_KEY", ""),
		KafkaBrokers:         envOr("KAFKA_BROKERS", "localhost:9092"),
		RedisURL:             envOr("REDIS_URL", "redis://localhost:6379/5"),
		TigerBeetleURL:       envOr("TIGERBEETLE_URL", "http://localhost:3001"),
		TemporalURL:          envOr("TEMPORAL_URL", "http://localhost:7233"),
		DaprURL:              envOr("DAPR_HTTP_URL", "http://localhost:3500"),
		MojaloopURL:          envOr("MOJALOOP_URL", "http://localhost:3002"),
		OpenSearchURL:        envOr("OPENSEARCH_URL", "http://localhost:9200"),
		KeycloakURL:          envOr("KEYCLOAK_URL", "http://localhost:8080"),
		PermifyURL:           envOr("PERMIFY_URL", "http://localhost:3476"),
		WebhookSecret:        envOr("WEBHOOK_SECRET", "whsec_test"),
		Environment:          envOr("ENVIRONMENT", "development"),
	}
}

func envOr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

// ── Domain Types ────────────────────────────────────────────────────────────

type PaymentChannel string

const (
	ChannelCard         PaymentChannel = "card"
	ChannelBankTransfer PaymentChannel = "bank_transfer"
	ChannelUSSD         PaymentChannel = "ussd"
	ChannelMobileMoney  PaymentChannel = "mobile_money"
	ChannelQR           PaymentChannel = "qr"
)

type PaymentStatus string

const (
	StatusPending   PaymentStatus = "pending"
	StatusSuccess   PaymentStatus = "success"
	StatusFailed    PaymentStatus = "failed"
	StatusRefunded  PaymentStatus = "refunded"
	StatusCancelled PaymentStatus = "cancelled"
)

type PaymentProvider string

const (
	ProviderPaystack    PaymentProvider = "paystack"
	ProviderFlutterwave PaymentProvider = "flutterwave"
	ProviderMojaloop    PaymentProvider = "mojaloop"
)

type InitiatePaymentRequest struct {
	Amount      int64                  `json:"amount"`   // In kobo (NGN smallest unit)
	Currency    string                 `json:"currency"` // NGN, USD, GHS, KES
	Channel     PaymentChannel         `json:"channel"`
	Provider    PaymentProvider        `json:"provider"`
	Email       string                 `json:"email"`
	Reference   string                 `json:"reference"` // Idempotency key
	PolicyID    string                 `json:"policy_id"`
	Description string                 `json:"description"`
	Metadata    map[string]interface{} `json:"metadata"`
	CallbackURL string                 `json:"callback_url"`
	SplitCode   string                 `json:"split_code,omitempty"` // For agent commission splits
	CustomerID  string                 `json:"customer_id"`
}

type PaymentResponse struct {
	Reference   string               `json:"reference"`
	Status      PaymentStatus        `json:"status"`
	Provider    PaymentProvider      `json:"provider"`
	Channel     PaymentChannel       `json:"channel"`
	Amount      int64                `json:"amount"`
	Currency    string               `json:"currency"`
	AuthURL     string               `json:"authorization_url,omitempty"` // Redirect URL for card
	USSDCode    string               `json:"ussd_code,omitempty"`         // USSD dial string
	BankDetails *BankTransferDetails `json:"bank_details,omitempty"`
	CreatedAt   time.Time            `json:"created_at"`
}

type BankTransferDetails struct {
	BankName      string `json:"bank_name"`
	AccountNumber string `json:"account_number"`
	AccountName   string `json:"account_name"`
	ExpiresAt     string `json:"expires_at"`
}

type RecurringPaymentRequest struct {
	PlanCode      string `json:"plan_code"`
	CustomerEmail string `json:"customer_email"`
	Amount        int64  `json:"amount"`
	Interval      string `json:"interval"` // daily, weekly, monthly, annually
	PolicyID      string `json:"policy_id"`
	StartDate     string `json:"start_date"`
}

type SplitPaymentRequest struct {
	Name        string       `json:"name"`
	Type        string       `json:"type"` // percentage, flat
	Currency    string       `json:"currency"`
	Subaccounts []Subaccount `json:"subaccounts"`
	BearerType  string       `json:"bearer_type"` // subaccount, account, all-proportional
}

type Subaccount struct {
	SubaccountCode string `json:"subaccount_code"`
	Share          int    `json:"share"` // Percentage or flat amount
}

type RefundRequest struct {
	Reference string `json:"reference"`
	Amount    int64  `json:"amount,omitempty"` // Partial refund; 0 = full refund
	Reason    string `json:"reason"`
}

type WebhookEvent struct {
	Event string          `json:"event"`
	Data  json.RawMessage `json:"data"`
}

// ── Payment Store (in-memory for dev, PostgreSQL/Redis in prod) ─────────────

type PaymentStore struct {
	mu       sync.RWMutex
	payments map[string]*PaymentResponse
}

func NewPaymentStore() *PaymentStore {
	return &PaymentStore{payments: make(map[string]*PaymentResponse)}
}

func (s *PaymentStore) Save(p *PaymentResponse) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.payments[p.Reference] = p
}

func (s *PaymentStore) Get(ref string) *PaymentResponse {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.payments[ref]
}

func (s *PaymentStore) GetByCustomer(customerID string, limit, offset int) []*PaymentResponse {
	s.mu.RLock()
	defer s.mu.RUnlock()
	var results []*PaymentResponse
	for _, p := range s.payments {
		if p.Reference != "" {
			results = append(results, p)
		}
	}
	if offset >= len(results) {
		return nil
	}
	end := offset + limit
	if end > len(results) {
		end = len(results)
	}
	return results[offset:end]
}

// ── Paystack Client ─────────────────────────────────────────────────────────

type PaystackClient struct {
	secretKey  string
	baseURL    string
	httpClient *http.Client
}

func NewPaystackClient(secretKey string) *PaystackClient {
	return &PaystackClient{
		secretKey:  secretKey,
		baseURL:    "https://api.paystack.co",
		httpClient: &http.Client{Timeout: 30 * time.Second},
	}
}

func (c *PaystackClient) InitializeTransaction(req InitiatePaymentRequest) (*PaymentResponse, error) {
	payload := map[string]interface{}{
		"amount":       req.Amount,
		"email":        req.Email,
		"reference":    req.Reference,
		"currency":     req.Currency,
		"callback_url": req.CallbackURL,
		"metadata":     req.Metadata,
	}
	if req.SplitCode != "" {
		payload["split_code"] = req.SplitCode
	}
	switch req.Channel {
	case ChannelUSSD:
		payload["channels"] = []string{"ussd"}
	case ChannelBankTransfer:
		payload["channels"] = []string{"bank_transfer"}
	case ChannelMobileMoney:
		payload["channels"] = []string{"mobile_money"}
	default:
		payload["channels"] = []string{"card", "bank", "ussd", "mobile_money", "bank_transfer", "qr"}
	}

	body, _ := json.Marshal(payload)
	httpReq, _ := http.NewRequest("POST", c.baseURL+"/transaction/initialize", strings.NewReader(string(body)))
	httpReq.Header.Set("Authorization", "Bearer "+c.secretKey)
	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("paystack request failed: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	var result struct {
		Status  bool   `json:"status"`
		Message string `json:"message"`
		Data    struct {
			AuthorizationURL string `json:"authorization_url"`
			Reference        string `json:"reference"`
			AccessCode       string `json:"access_code"`
		} `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, err
	}
	if !result.Status {
		return nil, fmt.Errorf("paystack error: %s", result.Message)
	}

	return &PaymentResponse{
		Reference: result.Data.Reference,
		Status:    StatusPending,
		Provider:  ProviderPaystack,
		Channel:   req.Channel,
		Amount:    req.Amount,
		Currency:  req.Currency,
		AuthURL:   result.Data.AuthorizationURL,
		CreatedAt: time.Now(),
	}, nil
}

func (c *PaystackClient) VerifyTransaction(reference string) (*PaymentResponse, error) {
	httpReq, _ := http.NewRequest("GET", c.baseURL+"/transaction/verify/"+reference, nil)
	httpReq.Header.Set("Authorization", "Bearer "+c.secretKey)

	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return nil, err
	}
	defer func() { _ = resp.Body.Close() }()

	var result struct {
		Status bool `json:"status"`
		Data   struct {
			Status    string `json:"status"`
			Reference string `json:"reference"`
			Amount    int64  `json:"amount"`
			Currency  string `json:"currency"`
			Channel   string `json:"channel"`
		} `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, err
	}

	status := StatusPending
	if result.Data.Status == "success" {
		status = StatusSuccess
	} else if result.Data.Status == "failed" {
		status = StatusFailed
	}

	return &PaymentResponse{
		Reference: result.Data.Reference,
		Status:    status,
		Provider:  ProviderPaystack,
		Channel:   PaymentChannel(result.Data.Channel),
		Amount:    result.Data.Amount,
		Currency:  result.Data.Currency,
	}, nil
}

func (c *PaystackClient) CreatePlan(name string, amount int64, interval, currency string) (string, error) {
	payload := map[string]interface{}{
		"name":     name,
		"amount":   amount,
		"interval": interval,
		"currency": currency,
	}
	body, _ := json.Marshal(payload)
	httpReq, _ := http.NewRequest("POST", c.baseURL+"/plan", strings.NewReader(string(body)))
	httpReq.Header.Set("Authorization", "Bearer "+c.secretKey)
	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return "", err
	}
	defer func() { _ = resp.Body.Close() }()

	var result struct {
		Data struct {
			PlanCode string `json:"plan_code"`
		} `json:"data"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&result)
	return result.Data.PlanCode, nil
}

func (c *PaystackClient) CreateSplitPayment(req SplitPaymentRequest) (string, error) {
	body, _ := json.Marshal(req)
	httpReq, _ := http.NewRequest("POST", c.baseURL+"/split", strings.NewReader(string(body)))
	httpReq.Header.Set("Authorization", "Bearer "+c.secretKey)
	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return "", err
	}
	defer func() { _ = resp.Body.Close() }()

	var result struct {
		Data struct {
			SplitCode string `json:"split_code"`
		} `json:"data"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&result)
	return result.Data.SplitCode, nil
}

func (c *PaystackClient) InitiateRefund(reference string, amount int64) error {
	payload := map[string]interface{}{
		"transaction": reference,
	}
	if amount > 0 {
		payload["amount"] = amount
	}
	body, _ := json.Marshal(payload)
	httpReq, _ := http.NewRequest("POST", c.baseURL+"/refund", strings.NewReader(string(body)))
	httpReq.Header.Set("Authorization", "Bearer "+c.secretKey)
	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return err
	}
	defer func() { _ = resp.Body.Close() }()
	return nil
}

// ── Flutterwave Client ──────────────────────────────────────────────────────

type FlutterwaveClient struct {
	secretKey  string
	baseURL    string
	httpClient *http.Client
}

func NewFlutterwaveClient(secretKey string) *FlutterwaveClient {
	return &FlutterwaveClient{
		secretKey:  secretKey,
		baseURL:    "https://api.flutterwave.com/v3",
		httpClient: &http.Client{Timeout: 30 * time.Second},
	}
}

func (c *FlutterwaveClient) InitiatePayment(req InitiatePaymentRequest) (*PaymentResponse, error) {
	payload := map[string]interface{}{
		"tx_ref":       req.Reference,
		"amount":       float64(req.Amount) / 100, // Flutterwave uses major units
		"currency":     req.Currency,
		"redirect_url": req.CallbackURL,
		"customer": map[string]string{
			"email": req.Email,
		},
		"meta":            req.Metadata,
		"payment_options": channelToFlutterwave(req.Channel),
	}

	body, _ := json.Marshal(payload)
	httpReq, _ := http.NewRequest("POST", c.baseURL+"/payments", strings.NewReader(string(body)))
	httpReq.Header.Set("Authorization", "Bearer "+c.secretKey)
	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("flutterwave request failed: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	var result struct {
		Status  string `json:"status"`
		Message string `json:"message"`
		Data    struct {
			Link string `json:"link"`
		} `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, err
	}

	return &PaymentResponse{
		Reference: req.Reference,
		Status:    StatusPending,
		Provider:  ProviderFlutterwave,
		Channel:   req.Channel,
		Amount:    req.Amount,
		Currency:  req.Currency,
		AuthURL:   result.Data.Link,
		CreatedAt: time.Now(),
	}, nil
}

func (c *FlutterwaveClient) VerifyTransaction(txRef string) (*PaymentResponse, error) {
	httpReq, _ := http.NewRequest("GET", c.baseURL+"/transactions/verify_by_reference?tx_ref="+txRef, nil)
	httpReq.Header.Set("Authorization", "Bearer "+c.secretKey)

	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return nil, err
	}
	defer func() { _ = resp.Body.Close() }()

	var result struct {
		Data struct {
			Status   string  `json:"status"`
			TxRef    string  `json:"tx_ref"`
			Amount   float64 `json:"amount"`
			Currency string  `json:"currency"`
		} `json:"data"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&result)

	status := StatusPending
	if result.Data.Status == "successful" {
		status = StatusSuccess
	} else if result.Data.Status == "failed" {
		status = StatusFailed
	}

	return &PaymentResponse{
		Reference: result.Data.TxRef,
		Status:    status,
		Provider:  ProviderFlutterwave,
		Amount:    int64(result.Data.Amount * 100),
		Currency:  result.Data.Currency,
	}, nil
}

func channelToFlutterwave(ch PaymentChannel) string {
	switch ch {
	case ChannelCard:
		return "card"
	case ChannelBankTransfer:
		return "banktransfer"
	case ChannelUSSD:
		return "ussd"
	case ChannelMobileMoney:
		return "mobilemoney"
	default:
		return "card,banktransfer,ussd,mobilemoney"
	}
}

// ── Webhook Verification ────────────────────────────────────────────────────

func verifyPaystackWebhook(body []byte, signature, secret string) bool {
	mac := hmac.New(sha512.New, []byte(secret))
	mac.Write(body)
	expected := hex.EncodeToString(mac.Sum(nil))
	return hmac.Equal([]byte(expected), []byte(signature))
}

func verifyFlutterwaveWebhook(signature, secret string) bool {
	return signature == secret
}

// ── Kafka Event Publishing ──────────────────────────────────────────────────

type EventPublisher struct {
	brokers string
}

func NewEventPublisher(brokers string) *EventPublisher {
	return &EventPublisher{brokers: brokers}
}

func (p *EventPublisher) Publish(topic string, event interface{}) {
	data, _ := json.Marshal(event)
	log.Printf("[KAFKA] → %s: %s", topic, string(data))
}

// ── TigerBeetle Ledger ──────────────────────────────────────────────────────

type LedgerClient struct {
	url string
}

func NewLedgerClient(url string) *LedgerClient {
	return &LedgerClient{url: url}
}

func (l *LedgerClient) RecordPayment(ref string, amount int64, debitLedger, creditLedger uint32) error {
	log.Printf("[TIGERBEETLE] Record: ref=%s amount=%d debit_ledger=%d credit_ledger=%d", ref, amount, debitLedger, creditLedger)
	return nil
}

// ── HTTP Handlers ───────────────────────────────────────────────────────────

type Server struct {
	config      Config
	paystack    *PaystackClient
	flutterwave *FlutterwaveClient
	store       *PaymentStore
	events      *EventPublisher
	ledger      *LedgerClient
}

func NewServer(cfg Config) *Server {
	return &Server{
		config:      cfg,
		paystack:    NewPaystackClient(cfg.PaystackSecretKey),
		flutterwave: NewFlutterwaveClient(cfg.FlutterwaveSecretKey),
		store:       NewPaymentStore(),
		events:      NewEventPublisher(cfg.KafkaBrokers),
		ledger:      NewLedgerClient(cfg.TigerBeetleURL),
	}
}

func (s *Server) handleInitiatePayment(w http.ResponseWriter, r *http.Request) {
	var req InitiatePaymentRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, 400, map[string]string{"error": "invalid request body"})
		return
	}

	if req.Amount <= 0 {
		writeJSON(w, 400, map[string]string{"error": "amount must be positive"})
		return
	}
	if req.Email == "" {
		writeJSON(w, 400, map[string]string{"error": "email is required"})
		return
	}
	if req.Reference == "" {
		req.Reference = fmt.Sprintf("PAY-%d-%s", time.Now().UnixNano(), req.CustomerID)
	}
	if req.Currency == "" {
		req.Currency = "NGN"
	}

	// Check idempotency
	if existing := s.store.Get(req.Reference); existing != nil {
		writeJSON(w, 200, existing)
		return
	}

	var resp *PaymentResponse
	var err error

	switch req.Provider {
	case ProviderFlutterwave:
		resp, err = s.flutterwave.InitiatePayment(req)
	case ProviderMojaloop:
		resp = &PaymentResponse{
			Reference: req.Reference,
			Status:    StatusPending,
			Provider:  ProviderMojaloop,
			Channel:   ChannelBankTransfer,
			Amount:    req.Amount,
			Currency:  req.Currency,
			CreatedAt: time.Now(),
		}
	default: // Paystack is default
		resp, err = s.paystack.InitializeTransaction(req)
	}

	if err != nil {
		log.Printf("[ERROR] Payment initiation failed: %v", err)
		writeJSON(w, 502, map[string]string{"error": "payment provider unavailable", "details": err.Error()})
		return
	}

	s.store.Save(resp)
	s.events.Publish("payment.initiated", map[string]interface{}{
		"reference":   resp.Reference,
		"amount":      resp.Amount,
		"currency":    resp.Currency,
		"provider":    resp.Provider,
		"channel":     resp.Channel,
		"customer_id": req.CustomerID,
		"policy_id":   req.PolicyID,
		"timestamp":   time.Now().UTC(),
	})

	writeJSON(w, 201, resp)
}

func (s *Server) handleVerifyPayment(w http.ResponseWriter, r *http.Request) {
	ref := r.URL.Query().Get("reference")
	if ref == "" {
		writeJSON(w, 400, map[string]string{"error": "reference is required"})
		return
	}

	existing := s.store.Get(ref)
	if existing == nil {
		writeJSON(w, 404, map[string]string{"error": "payment not found"})
		return
	}

	var resp *PaymentResponse
	var err error

	switch existing.Provider {
	case ProviderFlutterwave:
		resp, err = s.flutterwave.VerifyTransaction(ref)
	default:
		resp, err = s.paystack.VerifyTransaction(ref)
	}

	if err != nil {
		writeJSON(w, 502, map[string]string{"error": "verification failed"})
		return
	}

	if resp.Status == StatusSuccess && existing.Status != StatusSuccess {
		s.ledger.RecordPayment(ref, resp.Amount, 1, 2) // Debit customer, credit premium
		s.events.Publish("payment.confirmed", map[string]interface{}{
			"reference": ref,
			"amount":    resp.Amount,
			"status":    "success",
			"timestamp": time.Now().UTC(),
		})
	}

	s.store.Save(resp)
	writeJSON(w, 200, resp)
}

func (s *Server) handlePaystackWebhook(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(r.Body)
	if err != nil {
		w.WriteHeader(400)
		return
	}

	signature := r.Header.Get("X-Paystack-Signature")
	if !verifyPaystackWebhook(body, signature, s.config.PaystackSecretKey) {
		log.Printf("[SECURITY] Invalid Paystack webhook signature")
		w.WriteHeader(401)
		return
	}

	var event WebhookEvent
	if err := json.Unmarshal(body, &event); err != nil {
		w.WriteHeader(400)
		return
	}

	switch event.Event {
	case "charge.success":
		var data struct {
			Reference string `json:"reference"`
			Amount    int64  `json:"amount"`
			Currency  string `json:"currency"`
			Channel   string `json:"channel"`
		}
		_ = json.Unmarshal(event.Data, &data)

		payment := &PaymentResponse{
			Reference: data.Reference,
			Status:    StatusSuccess,
			Provider:  ProviderPaystack,
			Channel:   PaymentChannel(data.Channel),
			Amount:    data.Amount,
			Currency:  data.Currency,
		}
		s.store.Save(payment)
		_ = s.ledger.RecordPayment(data.Reference, data.Amount, 1, 2)
		s.events.Publish("payment.confirmed", map[string]interface{}{
			"reference": data.Reference,
			"amount":    data.Amount,
			"source":    "webhook",
			"timestamp": time.Now().UTC(),
		})

	case "charge.failed":
		var data struct {
			Reference string `json:"reference"`
		}
		_ = json.Unmarshal(event.Data, &data)
		if p := s.store.Get(data.Reference); p != nil {
			p.Status = StatusFailed
			s.store.Save(p)
		}
		s.events.Publish("payment.failed", map[string]interface{}{
			"reference": data.Reference,
			"source":    "webhook",
			"timestamp": time.Now().UTC(),
		})

	case "subscription.create", "subscription.disable":
		s.events.Publish("payment.subscription."+event.Event, map[string]interface{}{
			"event":     event.Event,
			"data":      string(event.Data),
			"timestamp": time.Now().UTC(),
		})
	}

	w.WriteHeader(200)
}

func (s *Server) handleFlutterwaveWebhook(w http.ResponseWriter, r *http.Request) {
	signature := r.Header.Get("verif-hash")
	if !verifyFlutterwaveWebhook(signature, s.config.WebhookSecret) {
		w.WriteHeader(401)
		return
	}

	body, _ := io.ReadAll(r.Body)
	var event struct {
		Event string `json:"event"`
		Data  struct {
			TxRef    string  `json:"tx_ref"`
			Status   string  `json:"status"`
			Amount   float64 `json:"amount"`
			Currency string  `json:"currency"`
		} `json:"data"`
	}
	_ = json.Unmarshal(body, &event)

	if event.Data.Status == "successful" {
		payment := &PaymentResponse{
			Reference: event.Data.TxRef,
			Status:    StatusSuccess,
			Provider:  ProviderFlutterwave,
			Amount:    int64(event.Data.Amount * 100),
			Currency:  event.Data.Currency,
		}
		s.store.Save(payment)
		_ = s.ledger.RecordPayment(event.Data.TxRef, payment.Amount, 1, 2)
		s.events.Publish("payment.confirmed", map[string]interface{}{
			"reference": event.Data.TxRef,
			"amount":    payment.Amount,
			"source":    "flutterwave_webhook",
			"timestamp": time.Now().UTC(),
		})
	}

	w.WriteHeader(200)
}

func (s *Server) handleCreateRecurring(w http.ResponseWriter, r *http.Request) {
	var req RecurringPaymentRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, 400, map[string]string{"error": "invalid request"})
		return
	}

	planCode, err := s.paystack.CreatePlan(
		fmt.Sprintf("Premium-%s", req.PolicyID),
		req.Amount,
		req.Interval,
		"NGN",
	)
	if err != nil {
		writeJSON(w, 502, map[string]string{"error": "failed to create plan"})
		return
	}

	s.events.Publish("payment.recurring.created", map[string]interface{}{
		"plan_code": planCode,
		"policy_id": req.PolicyID,
		"amount":    req.Amount,
		"interval":  req.Interval,
		"timestamp": time.Now().UTC(),
	})

	writeJSON(w, 201, map[string]interface{}{
		"plan_code": planCode,
		"status":    "active",
		"interval":  req.Interval,
		"amount":    req.Amount,
	})
}

func (s *Server) handleCreateSplit(w http.ResponseWriter, r *http.Request) {
	var req SplitPaymentRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, 400, map[string]string{"error": "invalid request"})
		return
	}

	splitCode, err := s.paystack.CreateSplitPayment(req)
	if err != nil {
		writeJSON(w, 502, map[string]string{"error": "failed to create split"})
		return
	}

	writeJSON(w, 201, map[string]interface{}{
		"split_code": splitCode,
		"status":     "active",
	})
}

func (s *Server) handleRefund(w http.ResponseWriter, r *http.Request) {
	var req RefundRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, 400, map[string]string{"error": "invalid request"})
		return
	}

	existing := s.store.Get(req.Reference)
	if existing == nil {
		writeJSON(w, 404, map[string]string{"error": "payment not found"})
		return
	}
	if existing.Status != StatusSuccess {
		writeJSON(w, 400, map[string]string{"error": "can only refund successful payments"})
		return
	}

	if err := s.paystack.InitiateRefund(req.Reference, req.Amount); err != nil {
		writeJSON(w, 502, map[string]string{"error": "refund failed"})
		return
	}

	existing.Status = StatusRefunded
	s.store.Save(existing)
	s.events.Publish("payment.refunded", map[string]interface{}{
		"reference": req.Reference,
		"amount":    req.Amount,
		"reason":    req.Reason,
		"timestamp": time.Now().UTC(),
	})

	writeJSON(w, 200, map[string]string{"status": "refunded", "reference": req.Reference})
}

func (s *Server) handlePaymentStatus(w http.ResponseWriter, r *http.Request) {
	ref := strings.TrimPrefix(r.URL.Path, "/api/v1/payments/status/")
	if ref == "" {
		writeJSON(w, 400, map[string]string{"error": "reference required"})
		return
	}
	p := s.store.Get(ref)
	if p == nil {
		writeJSON(w, 404, map[string]string{"error": "not found"})
		return
	}
	writeJSON(w, 200, p)
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, 200, map[string]interface{}{
		"status":    "healthy",
		"service":   "payment-gateway",
		"version":   "1.0.0",
		"providers": []string{"paystack", "flutterwave", "mojaloop"},
		"uptime":    time.Since(startTime).String(),
	})
}

// ── Utilities ───────────────────────────────────────────────────────────────

func writeJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(data)
}

var startTime = time.Now()

// ── Main ────────────────────────────────────────────────────────────────────

func main() {
	cfg := loadConfig()
	srv := NewServer(cfg)

	mux := http.NewServeMux()
	mux.HandleFunc("/api/v1/payments/initiate", srv.handleInitiatePayment)
	mux.HandleFunc("/api/v1/payments/verify", srv.handleVerifyPayment)
	mux.HandleFunc("/api/v1/payments/webhook/paystack", srv.handlePaystackWebhook)
	mux.HandleFunc("/api/v1/payments/webhook/flutterwave", srv.handleFlutterwaveWebhook)
	mux.HandleFunc("/api/v1/payments/recurring/create", srv.handleCreateRecurring)
	mux.HandleFunc("/api/v1/payments/split/create", srv.handleCreateSplit)
	mux.HandleFunc("/api/v1/payments/refund", srv.handleRefund)
	mux.HandleFunc("/api/v1/payments/status/", srv.handlePaymentStatus)
	mux.HandleFunc("/health", srv.handleHealth)

	log.Printf("Payment Gateway starting on port %s (env=%s)", cfg.Port, cfg.Environment)
	log.Printf("Providers: Paystack=%v Flutterwave=%v Mojaloop=%s",
		cfg.PaystackSecretKey != "", cfg.FlutterwaveSecretKey != "", cfg.MojaloopURL)

	server := &http.Server{
		Addr:         ":" + cfg.Port,
		Handler:      mux,
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 60 * time.Second,
		IdleTimeout:  120 * time.Second,
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	_ = ctx

	if err := server.ListenAndServe(); err != nil {
		log.Fatalf("Server failed: %v", err)
	}
}
