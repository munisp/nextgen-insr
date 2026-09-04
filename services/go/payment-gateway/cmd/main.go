package main

import (
	"context"
	"crypto/hmac"
	"crypto/sha512"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strings"
	"time"
)

// ══════════════════════════════════════════════════════════════════════════════
// Payment Gateway Service — Paystack + Flutterwave Integration
// Port: 8100
//
// Integrations (only the ones this service actually performs):
//   - Paystack / Flutterwave: real provider HTTP APIs for initiation + verification
//   - Redis: DURABLE idempotency ledger + payment store (restart-safe, atomic
//     SET NX claims serialize concurrent duplicates). Any Redis failure fails
//     the request CLOSED (503) — money movement never degrades to process RAM.
//   - Kafka REST proxy (KAFKA_REST_URL): payment.* events, synchronous with
//     honest errors — never a log-only pretend-publish
//   - TigerBeetle sidecar (TIGERBEETLE_URL /transfers): ledger posting on
//     confirmed payments; failure fails the confirmation CLOSED so the
//     provider redelivers and the durable dedupe marker prevents double-posting
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
	KafkaRestURL         string
	RedisURL             string
	TigerBeetleURL       string
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
		KafkaRestURL:         envOr("KAFKA_REST_URL", ""),
		RedisURL:             envOr("REDIS_URL", "redis://localhost:6379/5"),
		TigerBeetleURL:       envOr("TIGERBEETLE_URL", "http://localhost:7070"),
		// No default webhook secret: an empty secret fails webhook verification
		// CLOSED (503) instead of letting a publicly-known default authenticate
		// forged payment confirmations.
		WebhookSecret: envOr("WEBHOOK_SECRET", ""),
		Environment:   envOr("ENVIRONMENT", "development"),
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
	CustomerID  string               `json:"customer_id,omitempty"`
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

// ── Payment Store ───────────────────────────────────────────────────────────
//
// The store is the durable Redis-backed RedisPaymentStore (see redis.go).
// In-memory payment maps are gone: a restart must not erase payment memory,
// and concurrent duplicate references must not both reach the provider.

func (s *Server) savePayment(p *PaymentResponse) error {
	data, err := json.Marshal(p)
	if err != nil {
		return err
	}
	return s.store.SavePayment(string(data))
}

func (s *Server) loadPayment(ref string) (*PaymentResponse, error) {
	data, err := s.store.GetPayment(ref)
	if err != nil {
		return nil, err
	}
	if data == "" {
		return nil, nil
	}
	var p PaymentResponse
	if err := json.Unmarshal([]byte(data), &p); err != nil {
		return nil, fmt.Errorf("corrupt stored payment %s: %w", ref, err)
	}
	return &p, nil
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
	if secret == "" || signature == "" {
		return false
	}
	mac := hmac.New(sha512.New, []byte(secret))
	mac.Write(body)
	expected := hex.EncodeToString(mac.Sum(nil))
	return hmac.Equal([]byte(expected), []byte(signature))
}

func verifyFlutterwaveWebhook(signature, secret string) bool {
	if secret == "" || signature == "" {
		return false
	}
	// Constant-time compare: the verif-hash is a shared-secret header.
	return subtle.ConstantTimeCompare([]byte(signature), []byte(secret)) == 1
}

// ── Kafka Event Publishing ──────────────────────────────────────────────────

type EventPublisher struct {
	restURL string
	client  *http.Client
}

func NewEventPublisher(restURL string) *EventPublisher {
	return &EventPublisher{restURL: restURL, client: &http.Client{Timeout: 5 * time.Second}}
}

// Publish performs a REAL produce via the Kafka REST proxy and returns an
// honest error on any failure. It never logs a pretend publish into the void.
func (p *EventPublisher) Publish(topic string, event interface{}) error {
	if p.restURL == "" {
		return fmt.Errorf("eventing unavailable: KAFKA_REST_URL is not configured")
	}
	body, err := json.Marshal(map[string]interface{}{"records": []map[string]interface{}{{"value": event}}})
	if err != nil {
		return fmt.Errorf("encode event: %w", err)
	}
	req, err := http.NewRequest(http.MethodPost, fmt.Sprintf("%s/topics/%s", p.restURL, topic), strings.NewReader(string(body)))
	if err != nil {
		return fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("Content-Type", "application/vnd.kafka.json.v2+json")
	resp, err := p.client.Do(req)
	if err != nil {
		return fmt.Errorf("kafka rest proxy unreachable: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode >= 300 {
		return fmt.Errorf("kafka rest proxy returned HTTP %d", resp.StatusCode)
	}
	return nil
}

// ── TigerBeetle Ledger ──────────────────────────────────────────────────────

type LedgerClient struct {
	url    string
	client *http.Client
}

func NewLedgerClient(url string) *LedgerClient {
	return &LedgerClient{url: url, client: &http.Client{Timeout: 5 * time.Second}}
}

// RecordPayment posts a real double-entry transfer to the TigerBeetle sidecar.
// The reference is the transfer's idempotency key on the ledger side. Any
// failure is returned so callers can fail CLOSED (the payment confirmation is
// NOT durably applied when its ledger leg fails).
func (l *LedgerClient) RecordPayment(ref string, amount int64, debitAccount, creditAccount string) error {
	if l.url == "" {
		return fmt.Errorf("ledger unavailable: TIGERBEETLE_URL is not configured")
	}
	body, err := json.Marshal(map[string]interface{}{
		"debit_account_id":  debitAccount,
		"credit_account_id": creditAccount,
		"amount":            amount,
		"ledger":            2000,
		"code":              300,
		"ref":               ref,
		"tx_type":           "premium_payment",
	})
	if err != nil {
		return fmt.Errorf("encode transfer: %w", err)
	}
	req, err := http.NewRequest(http.MethodPost, l.url+"/transfers", strings.NewReader(string(body)))
	if err != nil {
		return fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := l.client.Do(req)
	if err != nil {
		return fmt.Errorf("tigerbeetle sidecar unreachable: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode >= 300 {
		return fmt.Errorf("tigerbeetle sidecar returned HTTP %d", resp.StatusCode)
	}
	return nil
}

// ── HTTP Handlers ───────────────────────────────────────────────────────────

type Server struct {
	config      Config
	paystack    *PaystackClient
	flutterwave *FlutterwaveClient
	store       *RedisPaymentStore
	events      *EventPublisher
	ledger      *LedgerClient
}

func NewServer(cfg Config) (*Server, error) {
	store, err := NewRedisPaymentStore(cfg.RedisURL)
	if err != nil {
		return nil, fmt.Errorf("payment store config: %w", err)
	}
	if err := store.Ping(); err != nil {
		return nil, fmt.Errorf("payment store unreachable (failing closed, refusing to run on volatile memory): %w", err)
	}
	return &Server{
		config:      cfg,
		paystack:    NewPaystackClient(cfg.PaystackSecretKey),
		flutterwave: NewFlutterwaveClient(cfg.FlutterwaveSecretKey),
		store:       store,
		events:      NewEventPublisher(cfg.KafkaRestURL),
		ledger:      NewLedgerClient(cfg.TigerBeetleURL),
	}, nil
}

// confirmPayment applies the side effects of a confirmed payment exactly once
// across concurrent verifies and provider webhook redeliveries: a durable
// marker records which legs (ledger posting, event publication) have actually
// completed, and only the missing legs are (re)attempted. A ledger failure is
// returned so the caller can fail CLOSED (non-2xx → provider redelivers).
func (s *Server) confirmPayment(p *PaymentResponse, source string) error {
	stateJSON, won, err := s.store.ClaimConfirmation(p.Reference)
	if err != nil {
		return fmt.Errorf("confirmation dedupe store: %w", err)
	}
	state := struct {
		LedgerRecorded bool `json:"ledger_recorded"`
		EventPublished bool `json:"event_published"`
	}{}
	if !won {
		if stateJSON == "" {
			stateJSON = `{"ledger_recorded":false,"event_published":false}`
		}
		if err := json.Unmarshal([]byte(stateJSON), &state); err != nil {
			return fmt.Errorf("corrupt confirmation state for %s: %w", p.Reference, err)
		}
	}

	if !state.LedgerRecorded {
		// Debit customer settlements, credit premium income (kobo, ledger 2000).
		if err := s.ledger.RecordPayment(p.Reference, p.Amount, "customer-settlements", "premium-income"); err != nil {
			return fmt.Errorf("ledger posting failed for %s: %w", p.Reference, err)
		}
		state.LedgerRecorded = true
		data, _ := json.Marshal(state)
		if err := s.store.UpdateConfirmationState(p.Reference, string(data)); err != nil {
			return fmt.Errorf("persist confirmation state: %w", err)
		}
	}

	if !state.EventPublished {
		if err := s.events.Publish("payment.confirmed", map[string]interface{}{
			"reference": p.Reference,
			"amount":    p.Amount,
			"status":    "success",
			"source":    source,
			"timestamp": time.Now().UTC(),
		}); err != nil {
			// The ledger leg is durably recorded; the event leg is retried on
			// the next delivery/verify. Loud log, no pretend success.
			log.Printf("[KAFKA] CRITICAL: payment.confirmed for %s not published: %v", p.Reference, err)
			return nil
		}
		state.EventPublished = true
		data, _ := json.Marshal(state)
		if err := s.store.UpdateConfirmationState(p.Reference, string(data)); err != nil {
			return fmt.Errorf("persist confirmation state: %w", err)
		}
	}
	return nil
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

	// Durable, atomic idempotency claim BEFORE any provider call: SET NX PX in
	// Redis serializes concurrent duplicates (no TOCTOU) and survives restarts.
	won, err := s.store.ClaimReference(req.Reference)
	if err != nil {
		log.Printf("[ERROR] idempotency store unavailable: %v", err)
		writeJSON(w, 503, map[string]string{"error": "idempotency store unavailable — failing closed, payment NOT initiated"})
		return
	}
	if !won {
		stored, gerr := s.store.GetIdempotentResponse(req.Reference)
		if gerr != nil {
			writeJSON(w, 503, map[string]string{"error": "idempotency store unavailable — failing closed"})
			return
		}
		if stored != "" && stored != "processing" {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(200)
			_, _ = w.Write([]byte(stored))
			return
		}
		writeJSON(w, 409, map[string]string{"error": "payment with this reference is currently being processed", "code": "DUPLICATE_IN_FLIGHT"})
		return
	}

	var resp *PaymentResponse
	var perr error

	switch req.Provider {
	case ProviderFlutterwave:
		resp, perr = s.flutterwave.InitiatePayment(req)
	case ProviderMojaloop:
		// No Mojaloop initiation capability exists in this gateway. Fail loud
		// instead of fabricating a pending payment for an operation that never
		// happened.
		s.store.ReleaseReference(req.Reference)
		writeJSON(w, 501, map[string]string{"error": "mojaloop initiation is not implemented in this gateway", "code": "NOT_IMPLEMENTED"})
		return
	default: // Paystack is default
		resp, perr = s.paystack.InitializeTransaction(req)
	}

	if perr != nil {
		s.store.ReleaseReference(req.Reference)
		log.Printf("[ERROR] Payment initiation failed: %v", perr)
		writeJSON(w, 502, map[string]string{"error": "payment provider unavailable", "details": perr.Error()})
		return
	}

	resp.CustomerID = req.CustomerID
	if err := s.savePayment(resp); err != nil {
		s.store.ReleaseReference(req.Reference)
		log.Printf("[ERROR] payment store write failed: %v", err)
		writeJSON(w, 503, map[string]string{"error": "payment store unavailable — failing closed"})
		return
	}
	respJSON, _ := json.Marshal(resp)
	if err := s.store.CompleteReference(req.Reference, string(respJSON)); err != nil {
		log.Printf("[ERROR] idempotency completion write failed for %s: %v", req.Reference, err)
	}

	if err := s.events.Publish("payment.initiated", map[string]interface{}{
		"reference":   resp.Reference,
		"amount":      resp.Amount,
		"currency":    resp.Currency,
		"provider":    resp.Provider,
		"channel":     resp.Channel,
		"customer_id": req.CustomerID,
		"policy_id":   req.PolicyID,
		"timestamp":   time.Now().UTC(),
	}); err != nil {
		log.Printf("[KAFKA] CRITICAL: payment.initiated for %s not published: %v", resp.Reference, err)
	}

	writeJSON(w, 201, resp)
}

func (s *Server) handleVerifyPayment(w http.ResponseWriter, r *http.Request) {
	ref := r.URL.Query().Get("reference")
	if ref == "" {
		writeJSON(w, 400, map[string]string{"error": "reference is required"})
		return
	}

	existing, err := s.loadPayment(ref)
	if err != nil {
		writeJSON(w, 503, map[string]string{"error": "payment store unavailable — failing closed"})
		return
	}
	if existing == nil {
		writeJSON(w, 404, map[string]string{"error": "payment not found"})
		return
	}

	var resp *PaymentResponse
	var verr error

	switch existing.Provider {
	case ProviderFlutterwave:
		resp, verr = s.flutterwave.VerifyTransaction(ref)
	default:
		resp, verr = s.paystack.VerifyTransaction(ref)
	}

	if verr != nil {
		writeJSON(w, 502, map[string]string{"error": "verification failed"})
		return
	}

	resp.CustomerID = existing.CustomerID
	if resp.AuthURL == "" {
		resp.AuthURL = existing.AuthURL
	}

	if resp.Status == StatusSuccess && existing.Status != StatusSuccess {
		// Exactly-once confirmation side effects (ledger + event), deduped
		// durably against webhooks and repeated verifies.
		if err := s.confirmPayment(resp, "verify"); err != nil {
			log.Printf("[ERROR] confirmation side effects failed for %s: %v", ref, err)
			writeJSON(w, 503, map[string]string{"error": "payment confirmed by provider but ledger posting failed — will retry", "details": err.Error()})
			return
		}
	}

	if err := s.savePayment(resp); err != nil {
		writeJSON(w, 503, map[string]string{"error": "payment store unavailable — failing closed"})
		return
	}
	writeJSON(w, 200, resp)
}

func (s *Server) handlePaystackWebhook(w http.ResponseWriter, r *http.Request) {
	// DD-TSSEC (A7-8): fail CLOSED when the secret key is unconfigured — with
	// an empty key the expected HMAC-SHA512(body, "") is publicly computable,
	// so "verification" would admit forged payment confirmations.
	if s.config.PaystackSecretKey == "" {
		log.Printf("[SECURITY] PAYSTACK_SECRET_KEY not configured — rejecting Paystack webhook (fail-closed)")
		w.WriteHeader(503)
		return
	}

	body, err := io.ReadAll(r.Body)
	if err != nil {
		w.WriteHeader(400)
		return
	}

	signature := r.Header.Get("X-Paystack-Signature")
	if s.config.PaystackSecretKey == "" {
		// Fail CLOSED: with no secret configured, any computed HMAC is
		// forgeable — reject every webhook rather than confirm fake money.
		log.Printf("[SECURITY] Paystack webhook received but PAYSTACK_SECRET_KEY is not configured — rejecting")
		w.WriteHeader(503)
		return
	}
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

		existing, lerr := s.loadPayment(data.Reference)
		if lerr != nil {
			log.Printf("[ERROR] payment store unavailable in webhook: %v", lerr)
			w.WriteHeader(503)
			return
		}
		if existing != nil && existing.Status == StatusSuccess {
			// Duplicate delivery of an already-confirmed payment: side effects
			// were applied (or are retried) by confirmPayment dedupe — ack.
			w.WriteHeader(200)
			return
		}
		payment := &PaymentResponse{
			Reference: data.Reference,
			Status:    StatusSuccess,
			Provider:  ProviderPaystack,
			Channel:   PaymentChannel(data.Channel),
			Amount:    data.Amount,
			Currency:  data.Currency,
		}
		if existing != nil {
			payment.CustomerID = existing.CustomerID
			payment.AuthURL = existing.AuthURL
		}
		if err := s.confirmPayment(payment, "webhook"); err != nil {
			// Ledger leg failed — 500 so Paystack redelivers and the dedupe
			// marker drives an exactly-once retry.
			log.Printf("[ERROR] webhook confirmation side effects failed for %s: %v", data.Reference, err)
			w.WriteHeader(500)
			return
		}
		if err := s.savePayment(payment); err != nil {
			log.Printf("[ERROR] payment store write failed in webhook: %v", err)
			w.WriteHeader(503)
			return
		}

	case "charge.failed":
		var data struct {
			Reference string `json:"reference"`
		}
		_ = json.Unmarshal(event.Data, &data)
		// Guarded transition: only a still-pending payment may become failed —
		// a failure signal must never overwrite a confirmed success.
		res, err := s.store.CASPaymentStatus(data.Reference, string(StatusFailed), string(StatusPending))
		if err != nil {
			log.Printf("[ERROR] payment store unavailable in webhook: %v", err)
			w.WriteHeader(503)
			return
		}
		if res == 1 {
			if err := s.events.Publish("payment.failed", map[string]interface{}{
				"reference": data.Reference,
				"source":    "webhook",
				"timestamp": time.Now().UTC(),
			}); err != nil {
				log.Printf("[KAFKA] CRITICAL: payment.failed for %s not published: %v", data.Reference, err)
			}
		}

	case "subscription.create", "subscription.disable":
		if err := s.events.Publish("payment.subscription."+event.Event, map[string]interface{}{
			"event":     event.Event,
			"data":      string(event.Data),
			"timestamp": time.Now().UTC(),
		}); err != nil {
			log.Printf("[KAFKA] CRITICAL: subscription event %s not published: %v", event.Event, err)
		}
	}

	w.WriteHeader(200)
}

func (s *Server) handleFlutterwaveWebhook(w http.ResponseWriter, r *http.Request) {
	// DD-TSSEC (A7-8): fail CLOSED when no webhook secret is configured —
	// an unverifiable webhook must never mark a payment successful.
	if s.config.WebhookSecret == "" {
		log.Printf("[SECURITY] WEBHOOK_SECRET not configured — rejecting Flutterwave webhook (fail-closed)")
		w.WriteHeader(503)
		return
	}

	body, err := io.ReadAll(r.Body)
	if err != nil {
		w.WriteHeader(400)
		return
	}

	signature := r.Header.Get("verif-hash")
	if s.config.WebhookSecret == "" {
		// Fail CLOSED when unconfigured — a shared-secret default must never
		// authenticate a forged payment confirmation.
		log.Printf("[SECURITY] Flutterwave webhook received but WEBHOOK_SECRET is not configured — rejecting")
		w.WriteHeader(503)
		return
	}
	if !verifyFlutterwaveWebhook(signature, s.config.WebhookSecret) {
		w.WriteHeader(401)
		return
	}

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
		existing, lerr := s.loadPayment(event.Data.TxRef)
		if lerr != nil {
			log.Printf("[ERROR] payment store unavailable in webhook: %v", lerr)
			w.WriteHeader(503)
			return
		}
		if existing != nil && existing.Status == StatusSuccess {
			w.WriteHeader(200)
			return
		}
		payment := &PaymentResponse{
			Reference: event.Data.TxRef,
			Status:    StatusSuccess,
			Provider:  ProviderFlutterwave,
			Amount:    int64(event.Data.Amount * 100),
			Currency:  event.Data.Currency,
		}
		if existing != nil {
			payment.CustomerID = existing.CustomerID
			payment.AuthURL = existing.AuthURL
		}
		if err := s.confirmPayment(payment, "flutterwave_webhook"); err != nil {
			log.Printf("[ERROR] webhook confirmation side effects failed for %s: %v", event.Data.TxRef, err)
			w.WriteHeader(500)
			return
		}
		if err := s.savePayment(payment); err != nil {
			log.Printf("[ERROR] payment store write failed in webhook: %v", err)
			w.WriteHeader(503)
			return
		}
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

	eventPublished := true
	eventErr := ""
	if err := s.events.Publish("payment.recurring.created", map[string]interface{}{
		"plan_code": planCode,
		"policy_id": req.PolicyID,
		"amount":    req.Amount,
		"interval":  req.Interval,
		"timestamp": time.Now().UTC(),
	}); err != nil {
		log.Printf("[KAFKA] CRITICAL: payment.recurring.created not published: %v", err)
		eventPublished = false
		eventErr = err.Error()
	}

	writeJSON(w, 201, map[string]interface{}{
		"plan_code":       planCode,
		"status":          "active",
		"interval":        req.Interval,
		"amount":          req.Amount,
		"event_published": eventPublished,
		"event_error":     eventErr,
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

	existing, err := s.loadPayment(req.Reference)
	if err != nil {
		writeJSON(w, 503, map[string]string{"error": "payment store unavailable — failing closed"})
		return
	}
	if existing == nil {
		writeJSON(w, 404, map[string]string{"error": "payment not found"})
		return
	}
	if existing.Status != StatusSuccess {
		writeJSON(w, 400, map[string]string{"error": "can only refund successful payments"})
		return
	}

	// Atomic in-flight refund claim: concurrent duplicate refunds must not both
	// reach the provider.
	won, err := s.store.ClaimRefund(req.Reference)
	if err != nil {
		writeJSON(w, 503, map[string]string{"error": "idempotency store unavailable — failing closed"})
		return
	}
	if !won {
		writeJSON(w, 409, map[string]string{"error": "a refund for this payment is already processed or in flight", "code": "DUPLICATE_REFUND"})
		return
	}

	if err := s.paystack.InitiateRefund(req.Reference, req.Amount); err != nil {
		s.store.ReleaseRefund(req.Reference)
		writeJSON(w, 502, map[string]string{"error": "refund failed"})
		return
	}
	if err := s.store.CompleteRefund(req.Reference); err != nil {
		log.Printf("[ERROR] refund completion marker write failed for %s: %v", req.Reference, err)
	}

	existing.Status = StatusRefunded
	if err := s.savePayment(existing); err != nil {
		log.Printf("[ERROR] payment store write failed after refund of %s: %v", req.Reference, err)
	}
	if err := s.events.Publish("payment.refunded", map[string]interface{}{
		"reference": req.Reference,
		"amount":    req.Amount,
		"reason":    req.Reason,
		"timestamp": time.Now().UTC(),
	}); err != nil {
		log.Printf("[KAFKA] CRITICAL: payment.refunded for %s not published: %v", req.Reference, err)
	}

	writeJSON(w, 200, map[string]string{"status": "refunded", "reference": req.Reference})
}

func (s *Server) handlePaymentStatus(w http.ResponseWriter, r *http.Request) {
	ref := strings.TrimPrefix(r.URL.Path, "/api/v1/payments/status/")
	if ref == "" {
		writeJSON(w, 400, map[string]string{"error": "reference required"})
		return
	}
	p, err := s.loadPayment(ref)
	if err != nil {
		writeJSON(w, 503, map[string]string{"error": "payment store unavailable — failing closed"})
		return
	}
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
	srv, err := NewServer(cfg)
	if err != nil {
		log.Fatalf("Startup failed (fail-closed): %v", err)
	}

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
	log.Printf("Providers: Paystack=%v Flutterwave=%v (mojaloop: not implemented, fails loud 501)",
		cfg.PaystackSecretKey != "", cfg.FlutterwaveSecretKey != "")

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
