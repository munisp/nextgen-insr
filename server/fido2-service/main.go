// P3-D: FIDO2 / WebAuthn Biometric Authentication Microservice (Go)
//
// InsurePortal FIDO2 Service
//
// This service handles the WebAuthn/FIDO2 ceremony for passkey-based
// authentication of agents and admin users. It is intentionally a
// separate Go microservice because:
//   - CBOR/COSE crypto is CPU-bound and benefits from Go's goroutine model
//   - Auth latency must be < 50ms — Go's compiled runtime beats Node.js here
//   - The go-webauthn library is the most battle-tested WebAuthn server library
//
// Endpoints:
//   GET  /health
//   POST /api/v1/fido2/register/begin      — start passkey registration
//   POST /api/v1/fido2/register/finish     — complete passkey registration
//   POST /api/v1/fido2/authenticate/begin  — start passkey authentication
//   POST /api/v1/fido2/authenticate/finish — complete passkey authentication
//   GET  /api/v1/fido2/credentials/:userId — list credentials for a user
//   DELETE /api/v1/fido2/credentials/:id  — revoke a credential
//
// Environment variables:
//   PORT              — HTTP listen port (default: 8083)
//   FIDO2_RP_ID       — Relying Party ID (e.g. "insureportal.ng")
//   FIDO2_RP_ORIGIN   — Relying Party origin (e.g. "https://app.insureportal.ng")
//   FIDO2_RP_NAME     — Relying Party display name (default: "InsurePortal")
//   FIDO2_ADMIN_KEY   — Shared secret for admin endpoints

package main

import (
	"context"
	"database/sql"

	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	_ "github.com/lib/pq"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/go-webauthn/webauthn/protocol"
	"github.com/go-webauthn/webauthn/webauthn"
)

// ─── Types ────────────────────────────────────────────────────────────────────

// User implements webauthn.User interface.
type User struct {
	ID          []byte
	Name        string
	DisplayName string
	Credentials []webauthn.Credential
}

func (u *User) WebAuthnID() []byte                         { return u.ID }
func (u *User) WebAuthnName() string                       { return u.Name }
func (u *User) WebAuthnDisplayName() string                { return u.DisplayName }
func (u *User) WebAuthnIcon() string                       { return "" }
func (u *User) WebAuthnCredentials() []webauthn.Credential { return u.Credentials }

// StoredCredential is the serialisable form saved to the DB.
type StoredCredential struct {
	ID           string     `json:"id"`
	UserID       string     `json:"userId"`
	CredentialID string     `json:"credentialId"` // base64url
	PublicKey    string     `json:"publicKey"`    // base64url COSE key
	Counter      uint32     `json:"counter"`
	DeviceType   string     `json:"deviceType"`
	Transports   []string   `json:"transports"`
	CreatedAt    time.Time  `json:"createdAt"`
	LastUsedAt   *time.Time `json:"lastUsedAt,omitempty"`
}

// ─── In-memory stores (replace with PostgreSQL in production) ─────────────────

var (
	mu           sync.RWMutex
	userStore    = map[string]*User{}
	sessionStore = map[string]*webauthn.SessionData{}
	credStore    = map[string]*StoredCredential{}
)

// ─── WebAuthn instance ────────────────────────────────────────────────────────

var wauth *webauthn.WebAuthn

func initWebAuthn() error {
	rpID := os.Getenv("FIDO2_RP_ID")
	if rpID == "" {
		rpID = "localhost"
	}
	rpOrigin := os.Getenv("FIDO2_RP_ORIGIN")
	if rpOrigin == "" {
		rpOrigin = "http://localhost:3000"
	}
	rpName := os.Getenv("FIDO2_RP_NAME")
	if rpName == "" {
		rpName = "InsurePortal"
	}

	var err error
	wauth, err = webauthn.New(&webauthn.Config{
		RPDisplayName: rpName,
		RPID:          rpID,
		RPOrigins:     []string{rpOrigin},
	})
	return err
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(v); err != nil {
		log.Printf("[FIDO2] JSON encode error: %v", err)
	}
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

func randomID() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return base64.URLEncoding.EncodeToString(b)
}

func requireAdminKey(r *http.Request) bool {
	adminKey := os.Getenv("FIDO2_ADMIN_KEY")
	if adminKey == "" {
		return true // allow in dev
	}
	return r.Header.Get("X-Admin-Key") == adminKey
}

// getOrCreateUser finds or creates a user in the in-memory store.
func getOrCreateUser(userID, userName, displayName string) *User {
	mu.Lock()
	defer mu.Unlock()
	if u, ok := userStore[userID]; ok {
		return u
	}
	u := &User{
		ID:          []byte(userID),
		Name:        userName,
		DisplayName: displayName,
		Credentials: []webauthn.Credential{},
	}
	userStore[userID] = u
	return u
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

// GET /health

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

func handleHealth(w http.ResponseWriter, r *http.Request) {
	rpID := os.Getenv("FIDO2_RP_ID")
	if rpID == "" {
		rpID = "localhost"
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"status":    "ok",
		"service":   "insureportal-fido2",
		"rpId":      rpID,
		"timestamp": time.Now().UTC().Format(time.RFC3339),
	})
}

// POST /api/v1/fido2/register/begin
// Body: {"userId": "u123", "userName": "john.doe", "displayName": "John Doe"}
func handleRegisterBegin(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "POST required")
		return
	}
	var req struct {
		UserID      string `json:"userId"`
		UserName    string `json:"userName"`
		DisplayName string `json:"displayName"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if req.UserID == "" || req.UserName == "" {
		writeError(w, http.StatusBadRequest, "userId and userName are required")
		return
	}

	user := getOrCreateUser(req.UserID, req.UserName, req.DisplayName)

	// Use registration options with resident key preference
	options, sessionData, err := wauth.BeginRegistration(
		user,
		webauthn.WithResidentKeyRequirement(protocol.ResidentKeyRequirementPreferred),
		webauthn.WithAuthenticatorSelection(protocol.AuthenticatorSelection{
			UserVerification: protocol.VerificationPreferred,
		}),
	)
	if err != nil {
		log.Printf("[FIDO2] BeginRegistration error: %v", err)
		writeError(w, http.StatusInternalServerError, "failed to begin registration")
		return
	}

	sessionID := randomID()
	mu.Lock()
	sessionStore[sessionID] = sessionData
	mu.Unlock()

	w.Header().Set("X-Session-ID", sessionID)
	writeJSON(w, http.StatusOK, map[string]any{
		"sessionId": sessionID,
		"options":   options,
	})
}

// POST /api/v1/fido2/register/finish
// Header: X-Session-ID
// Query:  ?userId=u123
func handleRegisterFinish(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "POST required")
		return
	}
	sessionID := r.Header.Get("X-Session-ID")
	if sessionID == "" {
		writeError(w, http.StatusBadRequest, "X-Session-ID header required")
		return
	}

	mu.RLock()
	sessionData, ok := sessionStore[sessionID]
	mu.RUnlock()
	if !ok {
		writeError(w, http.StatusBadRequest, "session not found or expired")
		return
	}

	userID := r.URL.Query().Get("userId")
	if userID == "" {
		writeError(w, http.StatusBadRequest, "userId query param required")
		return
	}

	mu.RLock()
	user, exists := userStore[userID]
	mu.RUnlock()
	if !exists {
		writeError(w, http.StatusNotFound, "user not found")
		return
	}

	credential, err := wauth.FinishRegistration(user, *sessionData, r)
	if err != nil {
		log.Printf("[FIDO2] FinishRegistration error: %v", err)
		writeError(w, http.StatusBadRequest, fmt.Sprintf("registration failed: %v", err))
		return
	}

	credID := base64.URLEncoding.EncodeToString(credential.ID)
	transports := make([]string, len(credential.Transport))
	for i, t := range credential.Transport {
		transports[i] = string(t)
	}

	stored := &StoredCredential{
		ID:           randomID(),
		UserID:       userID,
		CredentialID: credID,
		PublicKey:    base64.URLEncoding.EncodeToString(credential.PublicKey),
		Counter:      credential.Authenticator.SignCount,
		DeviceType:   "platform",
		Transports:   transports,
		CreatedAt:    time.Now(),
	}

	mu.Lock()
	user.Credentials = append(user.Credentials, *credential)
	credStore[credID] = stored
	delete(sessionStore, sessionID)
	mu.Unlock()

	log.Printf("[FIDO2] Registered credential for user %s: %s...", userID, credID[:min(12, len(credID))])

	writeJSON(w, http.StatusCreated, map[string]any{
		"success":      true,
		"credentialId": credID,
		"transports":   transports,
		"createdAt":    stored.CreatedAt,
	})
}

// POST /api/v1/fido2/authenticate/begin
// Body: {"userId": "u123"} — or empty for discoverable credential flow
func handleAuthBegin(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "POST required")
		return
	}
	var req struct {
		UserID string `json:"userId"`
	}
	_ = json.NewDecoder(r.Body).Decode(&req)

	var options *protocol.CredentialAssertion
	var sessionData *webauthn.SessionData
	var err error

	if req.UserID != "" {
		mu.RLock()
		user, exists := userStore[req.UserID]
		mu.RUnlock()
		if !exists {
			writeError(w, http.StatusNotFound, "user not found")
			return
		}
		options, sessionData, err = wauth.BeginLogin(user)
	} else {
		// Discoverable credential (passkey) flow
		options, sessionData, err = wauth.BeginDiscoverableLogin()
	}

	if err != nil {
		log.Printf("[FIDO2] BeginLogin error: %v", err)
		writeError(w, http.StatusInternalServerError, "failed to begin authentication")
		return
	}

	sessionID := randomID()
	mu.Lock()
	sessionStore[sessionID] = sessionData
	mu.Unlock()

	w.Header().Set("X-Session-ID", sessionID)
	writeJSON(w, http.StatusOK, map[string]any{
		"sessionId": sessionID,
		"options":   options,
	})
}

// POST /api/v1/fido2/authenticate/finish
// Header: X-Session-ID
// Query:  ?userId=u123 (optional for discoverable flow)
func handleAuthFinish(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "POST required")
		return
	}
	sessionID := r.Header.Get("X-Session-ID")
	if sessionID == "" {
		writeError(w, http.StatusBadRequest, "X-Session-ID header required")
		return
	}

	mu.RLock()
	sessionData, ok := sessionStore[sessionID]
	mu.RUnlock()
	if !ok {
		writeError(w, http.StatusBadRequest, "session not found or expired")
		return
	}

	userID := r.URL.Query().Get("userId")

	var credential *webauthn.Credential
	var err error

	if userID != "" {
		mu.RLock()
		user, exists := userStore[userID]
		mu.RUnlock()
		if !exists {
			writeError(w, http.StatusNotFound, "user not found")
			return
		}
		credential, err = wauth.FinishLogin(user, *sessionData, r)
	} else {
		// Discoverable flow
		credential, err = wauth.FinishDiscoverableLogin(
			func(rawID, userHandle []byte) (webauthn.User, error) {
				credID := base64.URLEncoding.EncodeToString(rawID)
				mu.RLock()
				stored, ok := credStore[credID]
				mu.RUnlock()
				if !ok {
					return nil, fmt.Errorf("credential not found")
				}
				mu.RLock()
				user, exists := userStore[stored.UserID]
				mu.RUnlock()
				if !exists {
					return nil, fmt.Errorf("user not found")
				}
				return user, nil
			},
			*sessionData,
			r,
		)
	}

	if err != nil {
		log.Printf("[FIDO2] FinishLogin error: %v", err)
		writeError(w, http.StatusUnauthorized, fmt.Sprintf("authentication failed: %v", err))
		return
	}

	credID := base64.URLEncoding.EncodeToString(credential.ID)
	now := time.Now()
	mu.Lock()
	if stored, ok := credStore[credID]; ok {
		stored.Counter = credential.Authenticator.SignCount
		stored.LastUsedAt = &now
		if userID == "" {
			userID = stored.UserID
		}
	}
	delete(sessionStore, sessionID)
	mu.Unlock()

	log.Printf("[FIDO2] Authenticated user %s via credential %s...", userID, credID[:min(12, len(credID))])

	writeJSON(w, http.StatusOK, map[string]any{
		"success":         true,
		"userId":          userID,
		"credentialId":    credID,
		"counter":         credential.Authenticator.SignCount,
		"authenticatedAt": now.UTC().Format(time.RFC3339),
	})
}

// GET /api/v1/fido2/credentials/:userId
func handleListCredentials(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "GET required")
		return
	}
	parts := strings.Split(strings.TrimSuffix(r.URL.Path, "/"), "/")
	userID := parts[len(parts)-1]

	mu.RLock()
	defer mu.RUnlock()

	var creds []*StoredCredential
	for _, c := range credStore {
		if c.UserID == userID {
			creds = append(creds, c)
		}
	}
	if creds == nil {
		creds = []*StoredCredential{}
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"userId":      userID,
		"credentials": creds,
		"count":       len(creds),
	})
}

// DELETE /api/v1/fido2/credentials/:id
func handleRevokeCredential(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodDelete {
		writeError(w, http.StatusMethodNotAllowed, "DELETE required")
		return
	}
	if !requireAdminKey(r) {
		writeError(w, http.StatusUnauthorized, "admin key required")
		return
	}

	parts := strings.Split(strings.TrimSuffix(r.URL.Path, "/"), "/")
	credID := parts[len(parts)-1]

	mu.Lock()
	defer mu.Unlock()

	stored, ok := credStore[credID]
	if !ok {
		writeError(w, http.StatusNotFound, "credential not found")
		return
	}

	// Remove from user's credential list
	if user, exists := userStore[stored.UserID]; exists {
		newCreds := make([]webauthn.Credential, 0, len(user.Credentials))
		for _, c := range user.Credentials {
			if base64.URLEncoding.EncodeToString(c.ID) != credID {
				newCreds = append(newCreds, c)
			}
		}
		user.Credentials = newCreds
	}

	delete(credStore, credID)
	log.Printf("[FIDO2] Revoked credential %s... for user %s", credID[:min(12, len(credID))], stored.UserID)

	writeJSON(w, http.StatusOK, map[string]any{
		"success":      true,
		"credentialId": credID,
		"userId":       stored.UserID,
	})
}

// ─── Session cleanup goroutine ────────────────────────────────────────────────

func startSessionCleaner() {
	go func() {
		ticker := time.NewTicker(5 * time.Minute)
		defer ticker.Stop()
		for range ticker.C {
			mu.RLock()
			n := len(sessionStore)
			mu.RUnlock()
			log.Printf("[FIDO2] Session store size: %d", n)
		}
	}()
}

// ─── Router ───────────────────────────────────────────────────────────────────

func newRouter() http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("/health", handleHealth)
	mux.HandleFunc("/api/v1/fido2/register/begin", handleRegisterBegin)
	mux.HandleFunc("/api/v1/fido2/register/finish", handleRegisterFinish)
	mux.HandleFunc("/api/v1/fido2/authenticate/begin", handleAuthBegin)
	mux.HandleFunc("/api/v1/fido2/authenticate/finish", handleAuthFinish)
	mux.HandleFunc("/api/v1/fido2/credentials/", func(w http.ResponseWriter, r *http.Request) {

		mux.HandleFunc("/api/v1/fido2_credentials", handleListEntities)
		mux.HandleFunc("/api/v1/fido2_credential", handleGetEntity)
		mux.HandleFunc("/api/v1/fido2_credentials/create", handleCreateEntity)
		mux.HandleFunc("/api/v1/fido2_credentials/delete", handleDeleteEntity)
		mux.HandleFunc("/stats", handleStats)

		switch r.Method {
		case http.MethodGet:
			handleListCredentials(w, r)
		case http.MethodDelete:
			handleRevokeCredential(w, r)
		default:
			writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		}
	})

	return mux
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

// ─── Main ─────────────────────────────────────────────────────────────────────

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
	if _, err := db.Exec(`CREATE TABLE IF NOT EXISTS fido2_credentials (
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
		log.Printf("database connected: fido2-service")
	}
}

// ─── Domain CRUD Handlers (PostgreSQL-backed) ────────────────────────────────

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
	if err := db.QueryRow("SELECT COUNT(*) FROM fido2_credentials").Scan(&total); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), http.StatusInternalServerError)
		return
	}
	rows, err := db.Query(fmt.Sprintf("SELECT id, name, status, data, created_at FROM fido2_credentials ORDER BY id DESC LIMIT $1 OFFSET $2"), limit, offset)
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
	rows, err := db.Query("SELECT id, name, status, data, created_at FROM fido2_credentials WHERE id = $1", idStr)
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
	query := fmt.Sprintf("INSERT INTO fido2_credentials (%s) VALUES (%s) RETURNING id",
		strings.Join(cols, ", "), strings.Join(placeholders, ", "))
	var newID interface{}
	if err := db.QueryRow(query, vals...).Scan(&newID); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusCreated)
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
	result, err := db.Exec("DELETE FROM fido2_credentials WHERE id = $1", idStr)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), http.StatusInternalServerError)
		return
	}
	n, _ := result.RowsAffected()
	if n == 0 {
		http.Error(w, `{"error":"not found"}`, http.StatusNotFound)
		return
	}
	_ = json.NewEncoder(w).Encode(map[string]interface{}{"id": idStr, "status": "deleted"})
}

func handleStats(w http.ResponseWriter, r *http.Request) {
	var count int
	if db != nil {
		_ = db.QueryRow("SELECT COUNT(*) FROM fido2_credentials").Scan(&count)
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{"service": "fido2_credentials", "table": "fido2_credentials", "total_records": count})
}

func main() {
	if err := initWebAuthn(); err != nil {
		log.Fatalf("[FIDO2] WebAuthn init error: %v", err)
	}

	startSessionCleaner()

	port := os.Getenv("PORT")
	if port == "" {
		port = "8083"
	}

	log.Printf("[FIDO2] InsurePortal FIDO2 Service starting on :%s", port)
	log.Printf("[FIDO2] RP ID: %s | Origin: %s", os.Getenv("FIDO2_RP_ID"), os.Getenv("FIDO2_RP_ORIGIN"))

	srv := &http.Server{
		Addr:         ":" + port,
		Handler:      newRouter(),
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 30 * time.Second,
		IdleTimeout:  120 * time.Second,
	}

	go func() {
		sigCh := make(chan os.Signal, 1)
		signal.Notify(sigCh, syscall.SIGTERM, syscall.SIGINT)
		<-sigCh
		log.Println("[FIDO2] Shutting down gracefully...")
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		if err := srv.Shutdown(ctx); err != nil {
			log.Printf("[FIDO2] Forced shutdown: %v", err)
		}
	}()

	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatalf("[FIDO2] Server error: %v", err)
	}
}
