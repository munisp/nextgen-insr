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

// ─── Persistence ────────────────────────────────────────────────────────────
//
// 2026-10-01 (C2-fido2, audit item A8): the former in-memory
// userStore/sessionStore/credStore maps are REMOVED. Postgres (see store.go)
// is the authoritative store for users, credentials and ceremony sessions;
// restart no longer destroys registered passkeys. Fail-closed: boot aborts if
// PG is unreachable, and ceremony handlers return explicit 5xx errors on any
// store failure — there is no silent memory-only fallback.

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

// requireAdminKey gates admin endpoints. Fail-CLOSED (2026-10-02,
// C2-fido2-fix): when FIDO2_ADMIN_KEY is unset/empty every admin request is
// DENIED — the previous "allow in dev" behaviour was a fail-open authz check
// and is removed. A loud warning is emitted at boot (see warnIfAdminKeyUnset).
func requireAdminKey(r *http.Request) bool {
	adminKey := os.Getenv("FIDO2_ADMIN_KEY")
	if adminKey == "" {
		return false // fail-closed: no key configured → no admin access
	}
	return r.Header.Get("X-Admin-Key") == adminKey
}

// warnIfAdminKeyUnset logs a loud boot warning when the admin key is not
// configured, since all admin-gated endpoints will deny every request.
func warnIfAdminKeyUnset() {
	if os.Getenv("FIDO2_ADMIN_KEY") == "" {
		log.Printf("[FIDO2] WARNING: FIDO2_ADMIN_KEY is not set — all admin endpoints (credential revocation, legacy CRUD, stats) will DENY every request (fail-closed). Set FIDO2_ADMIN_KEY to enable them.")
	}
}

// getOrCreateUser finds or creates a user in Postgres (authoritative store;
// credentials loaded from PG). Fail-closed: returns error on DB failure.
func getOrCreateUser(ctx context.Context, userID, userName, displayName string) (*User, error) {
	return store.ensureUser(ctx, userID, userName, displayName)
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

// writeDBError logs the raw DB error server-side and returns a GENERIC
// message to the client — raw pq error text (schema details, constraint
// names) must not leak over the wire. 2026-10-02 (C2-fido2-fix): wires the
// previously unused isPQClientError helper.
func writeDBError(w http.ResponseWriter, op string, err error) {
	log.Printf("[FIDO2] %s DB error: %v", op, err)
	if isPQClientError(err) {
		http.Error(w, `{"error":"invalid request"}`, http.StatusBadRequest)
		return
	}
	http.Error(w, `{"error":"internal database error"}`, http.StatusInternalServerError)
}

func handleHealth(w http.ResponseWriter, r *http.Request) {
	rpID := os.Getenv("FIDO2_RP_ID")
	if rpID == "" {
		rpID = "localhost"
	}
	// Fail-closed liveness (2026-10-01, C2-fido2): PG is the authoritative
	// store; report unhealthy when it is unreachable so orchestrators drain
	// this instance instead of serving ceremonies that cannot persist.
	// 2026-10-02 (C2-fido2-fix): bounded 5s ping timeout.
	pingCtx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	if err := db.PingContext(pingCtx); err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{
			"status":  "unavailable",
			"service": "insureportal-fido2",
			"error":   "database unreachable",
		})
		return
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

	user, err := getOrCreateUser(r.Context(), req.UserID, req.UserName, req.DisplayName)
	if err != nil {
		log.Printf("[FIDO2] ensure user error: %v", err)
		writeError(w, http.StatusInternalServerError, "user store unavailable")
		return
	}

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
	// Fail-closed (2026-10-01, C2-fido2): the ceremony challenge MUST be
	// durably stored before we answer; otherwise finish would be impossible.
	if err := store.saveSession(r.Context(), sessionID, sessionData); err != nil {
		log.Printf("[FIDO2] saveSession error: %v", err)
		writeError(w, http.StatusInternalServerError, "session store unavailable")
		return
	}

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

	sessionData, err := store.getSession(r.Context(), sessionID)
	if err != nil {
		log.Printf("[FIDO2] getSession error: %v", err)
		writeError(w, http.StatusInternalServerError, "session store unavailable")
		return
	}
	if sessionData == nil {
		writeError(w, http.StatusBadRequest, "session not found or expired")
		return
	}

	userID := r.URL.Query().Get("userId")
	if userID == "" {
		writeError(w, http.StatusBadRequest, "userId query param required")
		return
	}

	user, err := store.getUser(r.Context(), userID)
	if err != nil {
		log.Printf("[FIDO2] getUser error: %v", err)
		writeError(w, http.StatusInternalServerError, "user store unavailable")
		return
	}
	if user == nil {
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

	createdAt := time.Now()
	// Write-through to PG (authoritative). Fail-closed: no 201 unless durable.
	if err := store.saveCredential(r.Context(), userID, credential, "platform", createdAt); err != nil {
		log.Printf("[FIDO2] saveCredential error: %v", err)
		writeError(w, http.StatusInternalServerError, "credential store unavailable")
		return
	}

	log.Printf("[FIDO2] Registered credential for user %s: %s...", userID, credID[:min(12, len(credID))])

	writeJSON(w, http.StatusCreated, map[string]any{
		"success":      true,
		"credentialId": credID,
		"transports":   transports,
		"createdAt":    createdAt,
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
		user, uerr := store.getUser(r.Context(), req.UserID)
		if uerr != nil {
			log.Printf("[FIDO2] getUser error: %v", uerr)
			writeError(w, http.StatusInternalServerError, "user store unavailable")
			return
		}
		if user == nil {
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
	// Fail-closed (2026-10-01, C2-fido2): challenge must be durable before reply.
	if err := store.saveSession(r.Context(), sessionID, sessionData); err != nil {
		log.Printf("[FIDO2] saveSession error: %v", err)
		writeError(w, http.StatusInternalServerError, "session store unavailable")
		return
	}

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

	sessionData, err := store.getSession(r.Context(), sessionID)
	if err != nil {
		log.Printf("[FIDO2] getSession error: %v", err)
		writeError(w, http.StatusInternalServerError, "session store unavailable")
		return
	}
	if sessionData == nil {
		writeError(w, http.StatusBadRequest, "session not found or expired")
		return
	}

	userID := r.URL.Query().Get("userId")

	var credential *webauthn.Credential

	if userID != "" {
		user, uerr := store.getUser(r.Context(), userID)
		if uerr != nil {
			log.Printf("[FIDO2] getUser error: %v", uerr)
			writeError(w, http.StatusInternalServerError, "user store unavailable")
			return
		}
		if user == nil {
			writeError(w, http.StatusNotFound, "user not found")
			return
		}
		credential, err = wauth.FinishLogin(user, *sessionData, r)
	} else {
		// Discoverable flow
		credential, err = wauth.FinishDiscoverableLogin(
			func(rawID, userHandle []byte) (webauthn.User, error) {
				// PG is authoritative (2026-10-01, C2-fido2).
				user, uerr := store.getUserByCredentialID(r.Context(), rawID)
				if uerr != nil {
					return nil, uerr
				}
				if user == nil {
					return nil, fmt.Errorf("credential not found")
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
	// Fail-closed counter update: the durable sign_count/last_used_at must be
	// written before we report success, else cloned-authenticator detection
	// silently degrades after restart.
	ownerID, terr := store.touchCredential(r.Context(), credential.ID, credential.Authenticator.SignCount, credential.Authenticator.CloneWarning, now)
	if terr != nil {
		log.Printf("[FIDO2] touchCredential error: %v", terr)
		writeError(w, http.StatusInternalServerError, "credential store unavailable")
		return
	}
	if userID == "" {
		userID = ownerID
	}

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

	creds, err := store.listCredentials(r.Context(), userID)
	if err != nil {
		log.Printf("[FIDO2] listCredentials error: %v", err)
		writeError(w, http.StatusInternalServerError, "credential store unavailable")
		return
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

	// PG delete is authoritative (2026-10-01, C2-fido2).
	ownerID, found, err := store.deleteCredential(r.Context(), credID)
	if err != nil {
		log.Printf("[FIDO2] deleteCredential error: %v", err)
		writeError(w, http.StatusInternalServerError, "credential store unavailable")
		return
	}
	if !found {
		writeError(w, http.StatusNotFound, "credential not found")
		return
	}

	log.Printf("[FIDO2] Revoked credential %s... for user %s", credID[:min(12, len(credID))], ownerID)

	writeJSON(w, http.StatusOK, map[string]any{
		"success":      true,
		"credentialId": credID,
		"userId":       ownerID,
	})
}

// ─── Session cleanup goroutine ────────────────────────────────────────────────

// startSessionCleaner sweeps expired ceremony sessions from PG every minute.
// Expired rows are also rejected at read time (getSession filters on
// expires_at), so a missed sweep never extends a challenge's lifetime.
// 2026-10-01 (C2-fido2): previously this only logged the in-memory map size.
func startSessionCleaner() {
	go func() {
		ticker := time.NewTicker(1 * time.Minute)
		defer ticker.Stop()
		for range ticker.C {
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			n, err := store.cleanupExpiredSessions(ctx)
			cancel()
			if err != nil {
				log.Printf("[FIDO2] session cleanup error: %v", err)
			} else if n > 0 {
				log.Printf("[FIDO2] session cleanup: removed %d expired sessions", n)
			}
		}
	}()
}

// adminGate wraps an admin endpoint with the (fail-closed) admin-key check.
// 2026-10-02 (C2-fido2-fix).
func adminGate(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !requireAdminKey(r) {
			writeError(w, http.StatusUnauthorized, "admin key required")
			return
		}
		next(w, r)
	}
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

		switch r.Method {
		case http.MethodGet:
			handleListCredentials(w, r)
		case http.MethodDelete:
			handleRevokeCredential(w, r)
		default:
			writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		}
	})

	// Debug/admin CRUD endpoints. 2026-10-01 (C2-fido2): registered at router
	// construction — previously these were registered inside the credentials
	// closure on every request, panicking with duplicate-pattern registration.
	// 2026-10-02 (C2-fido2-fix): ALL of these are admin-gated — they read and
	// DELETE credential rows and previously had no authentication at all.
	mux.HandleFunc("/api/v1/fido2_credentials", adminGate(handleListEntities))
	mux.HandleFunc("/api/v1/fido2_credential", adminGate(handleGetEntity))
	mux.HandleFunc("/api/v1/fido2_credentials/create", adminGate(handleCreateEntity))
	mux.HandleFunc("/api/v1/fido2_credentials/delete", adminGate(handleDeleteEntity))
	mux.HandleFunc("/stats", adminGate(handleStats))

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

// initDB connects to Postgres, verifies connectivity, and runs the store DDL.
// Fail-closed (2026-10-01, C2-fido2): any failure is fatal — the service must
// never run with credentials/sessions in volatile process memory again.
func initDB() {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		log.Fatal("FATAL: DATABASE_URL environment variable is required")
	}
	var err error
	db, err = sql.Open("postgres", dsn)
	if err != nil {
		log.Fatalf("FATAL: database connection failed: %s", err.Error())
	}
	db.SetMaxOpenConns(25)
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(5 * time.Minute)
	db.SetConnMaxIdleTime(2 * time.Minute)

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if err := db.PingContext(ctx); err != nil {
		log.Fatalf("FATAL: database ping failed (fail-closed, refusing to start): %s", err.Error())
	}
	if err := initStore(ctx); err != nil {
		log.Fatalf("FATAL: store init failed (fail-closed, refusing to start): %s", err.Error())
	}
	log.Printf("database connected: fido2-service (Postgres authoritative store)")
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
		writeDBError(w, "list credentials(count)", err)
		return
	}
	rows, err := db.Query("SELECT id, name, status, data, created_at FROM fido2_credentials ORDER BY id DESC LIMIT $1 OFFSET $2", limit, offset)
	if err != nil {
		writeDBError(w, "list credentials", err)
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
		writeDBError(w, "get credential", err)
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
		writeDBError(w, "get credential(scan)", err)
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
		if !isSafeColumnName(k) {
			http.Error(w, `{"error":"invalid field name"}`, http.StatusBadRequest)
			return
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
		writeDBError(w, "create credential", err)
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
		writeDBError(w, "delete credential", err)
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
	// Fail-closed boot (2026-10-01, C2-fido2): PG must be reachable and the
	// schema installed BEFORE we accept any ceremony traffic. initDB was
	// previously never called, leaving db=nil.
	initDB()
	warnIfAdminKeyUnset() // 2026-10-02 (C2-fido2-fix): loud fail-closed notice

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

// isSafeColumnName enforces a strict whitelist on column names taken from
// request JSON keys and interpolated into dynamically built INSERT statements
// (values are always sent as $N bind parameters). Only [A-Za-z0-9_], starting
// with a letter or underscore, up to 63 chars (Postgres identifier limit) is
// accepted; callers reject anything else with HTTP 400. This closes SQL
// injection via crafted request keys.
func isSafeColumnName(name string) bool {
	if len(name) == 0 || len(name) > 63 {
		return false
	}
	for i := 0; i < len(name); i++ {
		c := name[i]
		switch {
		case c >= 'a' && c <= 'z', c >= 'A' && c <= 'Z', c == '_':
		case c >= '0' && c <= '9' && i > 0:
		default:
			return false
		}
	}
	return true
}
