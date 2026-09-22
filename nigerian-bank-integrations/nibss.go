package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"sync"
	"time"

	"github.com/insureportal/nigerian-bank-integrations/config"
)

// ── P-wave perf (2026-09-19): bounded retry + circuit breaker ────────────────
// The NIBSS client previously had a timeout (good) but NO retry policy and NO
// circuit breaker: a slow/degraded NIBSS extended user-facing transfer
// latency up to the full timeout on every request, and retry storms were
// unbounded. Now:
//   - a lightweight circuit breaker (closed/open/half-open) wraps every NIBSS
//     call and FAILS LOUD (ErrNIBSSCircuitOpen) while open;
//   - idempotent calls (name enquiry, requery) get ONE bounded retry with
//     jitter on transport errors / 5xx;
//   - NIPTransfer itself is NEVER blind-retried: a timeout is ambiguous (the
//     funds may have moved) and the existing requery-after-timeout path in
//     main.go is the only safe resolution. The per-call timeout is unchanged.
var ErrNIBSSCircuitOpen = errors.New("nibss circuit breaker open — NIBSS marked unavailable, failing loud")

type nibssCircuitState int

const (
	nibssCircuitClosed nibssCircuitState = iota
	nibssCircuitOpen
	nibssCircuitHalfOpen
)

type nibssCircuitBreaker struct {
	mu           sync.Mutex
	state        nibssCircuitState
	failures     int
	maxFailures  int
	openUntil    time.Time
	openDuration time.Duration
}

func newNIBSSCircuitBreaker() *nibssCircuitBreaker {
	return &nibssCircuitBreaker{
		maxFailures:  5,
		openDuration: 30 * time.Second,
	}
}

// allow reports whether a request may proceed (fail-loud when open).
func (cb *nibssCircuitBreaker) allow() error {
	cb.mu.Lock()
	defer cb.mu.Unlock()
	switch cb.state {
	case nibssCircuitOpen:
		if time.Now().Before(cb.openUntil) {
			return ErrNIBSSCircuitOpen
		}
		// Window elapsed → half-open: let ONE probe through.
		cb.state = nibssCircuitHalfOpen
		return nil
	default:
		return nil
	}
}

func (cb *nibssCircuitBreaker) onSuccess() {
	cb.mu.Lock()
	defer cb.mu.Unlock()
	cb.failures = 0
	cb.state = nibssCircuitClosed
}

func (cb *nibssCircuitBreaker) onFailure() {
	cb.mu.Lock()
	defer cb.mu.Unlock()
	cb.failures++
	if cb.state == nibssCircuitHalfOpen || cb.failures >= cb.maxFailures {
		cb.state = nibssCircuitOpen
		cb.openUntil = time.Now().Add(cb.openDuration)
	}
}

// nibssClient is a real HTTP adapter for NIBSS NIP operations (NG-7).
// It performs genuine name-enquiry and funds-transfer calls; callers must
// fail CLOSED on any error — a transfer is never marked "success" locally.
type nibssClient struct {
	baseURL string
	apiKey  string
	http    *http.Client
	cb      *nibssCircuitBreaker
	cbMu    sync.Mutex
}

// breaker returns the client's circuit breaker, lazily initializing it so
// clients constructed as struct literals (tests, legacy wiring) are safe.
func (c *nibssClient) breaker() *nibssCircuitBreaker {
	c.cbMu.Lock()
	defer c.cbMu.Unlock()
	if c.cb == nil {
		c.cb = newNIBSSCircuitBreaker()
	}
	return c.cb
}

func newNIBSSClient(cfg config.BankConfig) *nibssClient {
	return &nibssClient{
		baseURL: cfg.NIBSSBaseURL,
		apiKey:  cfg.NIBSSAPIKey,
		http:    &http.Client{Timeout: cfg.NIBSSTimeout},
		cb:      newNIBSSCircuitBreaker(),
	}
}

func (c *nibssClient) configured() bool { return c != nil && c.baseURL != "" }

// nibssHTTPError marks an HTTP-level (>=300) failure so the retry policy can
// distinguish retriable 5xx from permanent 4xx.
type nibssHTTPError struct {
	method string
	path   string
	status int
	body   string
}

func (e *nibssHTTPError) Error() string {
	return fmt.Sprintf("nibss %s %s: HTTP %d: %s", e.method, e.path, e.status, e.body)
}

// retryable reports whether a NIBSS call failure is safe to retry ONCE:
// transport errors (request possibly never delivered) and upstream 5xx.
// 4xx and decode errors are permanent. Callers decide whether the OPERATION
// is idempotent — NIPTransfer is never retried through this path.
func nibssRetryable(err error) bool {
	var he *nibssHTTPError
	if errors.As(err, &he) {
		return he.status >= 500
	}
	return true // transport error (dial/timeout/refused)
}

// jitterSleep sleeps 50–150ms (crypto-random jitter) between bounded retries.
func jitterSleep(ctx context.Context) {
	n, _ := rand.Int(rand.Reader, big.NewInt(100))
	d := time.Duration(50+n.Int64()) * time.Millisecond
	select {
	case <-ctx.Done():
	case <-time.After(d):
	}
}

func (c *nibssClient) do(ctx context.Context, method, path string, body interface{}, out interface{}) error {
	if err := c.breaker().allow(); err != nil {
		return err
	}
	var rdr io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return err
		}
		rdr = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.baseURL+path, rdr)
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	if c.apiKey != "" {
		req.Header.Set("Authorization", "Bearer "+c.apiKey)
	}
	resp, err := c.http.Do(req)
	if err != nil {
		c.breaker().onFailure()
		return fmt.Errorf("nibss %s %s: %w", method, path, err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode >= 300 {
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		// 5xx degrades the breaker; 4xx is a caller bug, not NIBSS health.
		if resp.StatusCode >= 500 {
			c.breaker().onFailure()
		} else {
			c.breaker().onSuccess()
		}
		return &nibssHTTPError{method: method, path: path, status: resp.StatusCode, body: string(b)}
	}
	if out != nil {
		if err := json.NewDecoder(resp.Body).Decode(out); err != nil {
			return err
		}
	}
	c.breaker().onSuccess()
	return nil
}

// doWithRetry performs an IDEMPOTENT NIBSS call with one bounded retry
// (jittered) on retriable failures. Never used for the funds transfer itself.
func (c *nibssClient) doWithRetry(ctx context.Context, method, path string, body interface{}, out interface{}) error {
	err := c.do(ctx, method, path, body, out)
	if err == nil || !nibssRetryable(err) || errors.Is(err, ErrNIBSSCircuitOpen) {
		return err
	}
	jitterSleep(ctx)
	return c.do(ctx, method, path, body, out)
}

// NameEnquiry resolves an account holder name at the destination bank before
// any debit happens.
func (c *nibssClient) NameEnquiry(ctx context.Context, accountNumber, bankCode string) (name, bankName string, err error) {
	var out struct {
		AccountName string `json:"account_name"`
		BankName    string `json:"bank_name"`
	}
	// Idempotent read — safe for one bounded, jittered retry.
	err = c.doWithRetry(ctx, http.MethodPost, "/api/v1/name-enquiry", map[string]string{
		"account_number": accountNumber,
		"bank_code":      bankCode,
	}, &out)
	if err != nil {
		return "", "", err
	}
	if out.AccountName == "" {
		return "", "", fmt.Errorf("nibss name enquiry returned empty account name")
	}
	return out.AccountName, out.BankName, nil
}

// NIPTransfer submits the real funds transfer. The reference is the
// idempotency key on the NIBSS side. NEVER blind-retried here (a timeout is
// ambiguous — funds may have moved); the caller resolves ambiguity via
// RequeryTransfer. The circuit breaker still applies (fail-loud when open).
func (c *nibssClient) NIPTransfer(ctx context.Context, payload map[string]interface{}) (status string, err error) {
	var out struct {
		Status string `json:"status"`
	}
	if err := c.do(ctx, http.MethodPost, "/api/v1/nip/transfer", payload, &out); err != nil {
		return "", err
	}
	if out.Status == "" {
		return "", fmt.Errorf("nibss transfer returned empty status")
	}
	return out.Status, nil
}

// RequeryTransfer re-queries a transfer's status (used after a timeout —
// timeout-ambiguity MUST be resolved before any retry).
func (c *nibssClient) RequeryTransfer(ctx context.Context, reference string) (status string, err error) {
	var out struct {
		Status string `json:"status"`
	}
	// Idempotent read — safe for one bounded, jittered retry.
	if err := c.doWithRetry(ctx, http.MethodGet, "/api/v1/nip/transfers/"+reference, nil, &out); err != nil {
		return "", err
	}
	return out.Status, nil
}

// generateTransferReference creates a collision-safe, crypto-random reference
// (NG-7: UnixNano()%1e9 was collision-prone).
func generateTransferReference() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return "NIP-" + hex.EncodeToString(b)
}
