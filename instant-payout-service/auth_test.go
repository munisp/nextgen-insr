package main

import (
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/http/httputil"
	"os"
	"testing"
	"time"
)

// testKeypair builds a signed RS256 token and a JWKS document for tests.
func testKeypair(t *testing.T) (*rsa.PrivateKey, string) {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	b64 := func(b []byte) string { return base64.RawURLEncoding.EncodeToString(b) }
	eBytes := []byte{byte(key.E >> 16), byte(key.E >> 8), byte(key.E)}
	jwksJSON := fmt.Sprintf(`{"keys":[{"kty":"RSA","kid":"test-key","alg":"RS256","use":"sig","n":%q,"e":%q}]}`,
		b64(key.N.Bytes()), b64(eBytes))
	return key, jwksJSON
}

func signToken(t *testing.T, key *rsa.PrivateKey, claims map[string]interface{}) string {
	t.Helper()
	b64 := func(b []byte) string { return base64.RawURLEncoding.EncodeToString(b) }
	header, _ := json.Marshal(map[string]string{"alg": "RS256", "kid": "test-key", "typ": "JWT"})
	payload, _ := json.Marshal(claims)
	signed := b64(header) + "." + b64(payload)
	digest := sha256.Sum256([]byte(signed))
	sig, err := rsa.SignPKCS1v15(rand.Reader, key, crypto.SHA256, digest[:])
	if err != nil {
		t.Fatal(err)
	}
	return signed + "." + b64(sig)
}

func setupJWKS(t *testing.T, jwksJSON string) func() {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(jwksJSON))
	}))
	oldURL := os.Getenv("KEYCLOAK_JWKS_URL")
	os.Setenv("KEYCLOAK_JWKS_URL", srv.URL)
	jwks.mu.Lock()
	jwks.url = srv.URL
	jwks.keys = map[string]*rsa.PublicKey{}
	jwks.fetchedAt = time.Time{}
	jwks.mu.Unlock()
	return func() {
		srv.Close()
		os.Setenv("KEYCLOAK_JWKS_URL", oldURL)
		jwks.mu.Lock()
		jwks.url = oldURL
		jwks.keys = map[string]*rsa.PublicKey{}
		jwks.mu.Unlock()
	}
}

func TestValidateJWTHappyPath(t *testing.T) {
	key, jwksJSON := testKeypair(t)
	cleanup := setupJWKS(t, jwksJSON)
	defer cleanup()

	token := signToken(t, key, map[string]interface{}{
		"sub":                "user-123",
		"preferred_username": "adjuster1",
		"tenant_id":          "tenant-9",
		"exp":                time.Now().Add(5 * time.Minute).Unix(),
		"realm_access":       map[string]interface{}{"roles": []string{"claims-adjuster"}},
	})
	claims, err := validateJWT(token)
	if err != nil {
		t.Fatalf("expected valid token, got %v", err)
	}
	if claims.Sub != "user-123" || claims.TenantID != "tenant-9" {
		t.Fatalf("wrong identity: %+v", claims)
	}
	if len(claims.Roles) != 1 || claims.Roles[0] != "claims-adjuster" {
		t.Fatalf("wrong roles: %+v", claims.Roles)
	}
}

func TestValidateJWTRejectsForgery(t *testing.T) {
	key, jwksJSON := testKeypair(t)
	cleanup := setupJWKS(t, jwksJSON)
	defer cleanup()

	// Token signed by a DIFFERENT key must be rejected.
	other, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	forged := signToken(t, other, map[string]interface{}{
		"sub": "attacker", "exp": time.Now().Add(5 * time.Minute).Unix(),
	})
	if _, err := validateJWT(forged); err == nil {
		t.Fatal("forged signature accepted")
	}
	_ = key
}

func TestValidateJWTRejectsExpiredAndAlgNone(t *testing.T) {
	key, jwksJSON := testKeypair(t)
	cleanup := setupJWKS(t, jwksJSON)
	defer cleanup()

	expired := signToken(t, key, map[string]interface{}{
		"sub": "user-1", "exp": time.Now().Add(-time.Hour).Unix(),
	})
	if _, err := validateJWT(expired); err == nil {
		t.Fatal("expired token accepted")
	}

	// alg=none style token (no valid signature segment) must fail.
	b64 := func(b []byte) string { return base64.RawURLEncoding.EncodeToString(b) }
	header, _ := json.Marshal(map[string]string{"alg": "none", "typ": "JWT"})
	payload, _ := json.Marshal(map[string]interface{}{"sub": "attacker", "exp": time.Now().Add(time.Hour).Unix()})
	if _, err := validateJWT(b64(header) + "." + b64(payload) + "."); err == nil {
		t.Fatal("alg=none token accepted")
	}
}

func TestAuthFailClosedWhenJWKSUnset(t *testing.T) {
	old := os.Getenv("KEYCLOAK_JWKS_URL")
	os.Unsetenv("KEYCLOAK_JWKS_URL")
	defer os.Setenv("KEYCLOAK_JWKS_URL", old)

	if !authMisconfigured() {
		t.Fatal("expected misconfigured when KEYCLOAK_JWKS_URL unset")
	}
	if _, err := validateJWT("a.b.c"); err == nil {
		t.Fatal("validation succeeded without JWKS config")
	}

	// Middleware must return 503, never pass the request through.
	called := false
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { called = true })
	os.Unsetenv("DEV_AUTH_BYPASS")
	req := httptest.NewRequest("GET", "/api/v1/payout/process", nil)
	req.Header.Set("Authorization", "Bearer whatever")
	rec := httptest.NewRecorder()
	keycloakAuthMiddleware(next).ServeHTTP(rec, req)
	if called {
		t.Fatal("request passed through without JWT config")
	}
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503, got %d", rec.Code)
	}
}

func TestMiddlewareRejectsMissingToken(t *testing.T) {
	os.Setenv("KEYCLOAK_JWKS_URL", "http://127.0.0.1:1/jwks")
	defer os.Unsetenv("KEYCLOAK_JWKS_URL")
	os.Unsetenv("DEV_AUTH_BYPASS")
	called := false
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { called = true })
	req := httptest.NewRequest("GET", "/api/v1/payouts/create", nil)
	rec := httptest.NewRecorder()
	keycloakAuthMiddleware(next).ServeHTTP(rec, req)
	if called || rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 without passthrough, got %d called=%v", rec.Code, called)
	}
	// Health probes stay open.
	req2 := httptest.NewRequest("GET", "/health", nil)
	rec2 := httptest.NewRecorder()
	keycloakAuthMiddleware(next).ServeHTTP(rec2, req2)
	if !called {
		t.Fatal("health probe blocked")
	}
}

func TestPermifyFailClosedInProd(t *testing.T) {
	oldEnv, oldAddr := os.Getenv("ENVIRONMENT"), os.Getenv("PERMIFY_ADDR")
	defer func() { os.Setenv("ENVIRONMENT", oldEnv); os.Setenv("PERMIFY_ADDR", oldAddr) }()

	os.Setenv("ENVIRONMENT", "production")
	os.Unsetenv("PERMIFY_ADDR")
	if permifyCheck(httptest.NewRequest("GET", "/", nil).Context(), "payout", "x", "process", "u") {
		t.Fatal("permify fail-open in production without PERMIFY_ADDR")
	}
	os.Setenv("ENVIRONMENT", "development")
	if !permifyCheck(httptest.NewRequest("GET", "/", nil).Context(), "payout", "x", "process", "u") {
		t.Fatal("permify should be permissive in non-prod without PERMIFY_ADDR")
	}
}

// dump helper kept for debugging failures
var _ = httputil.DumpRequest
