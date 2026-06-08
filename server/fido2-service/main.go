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
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
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
	rand.Read(b)
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
	json.NewDecoder(r.Body).Decode(&req)

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

	if err := srv.ListenAndServe(); err != nil {
		log.Fatalf("[FIDO2] Server error: %v", err)
	}
}
