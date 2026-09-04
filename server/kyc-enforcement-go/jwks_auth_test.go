package main

import (
	"context"
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"math/big"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func b64u(b []byte) string { return base64.RawURLEncoding.EncodeToString(b) }

func signTestToken(t *testing.T, key *rsa.PrivateKey, kid string, claims map[string]interface{}) string {
	t.Helper()
	header := b64u([]byte(fmt.Sprintf(`{"alg":"RS256","kid":%q}`, kid)))
	payload, err := json.Marshal(claims)
	if err != nil {
		t.Fatal(err)
	}
	body := header + "." + b64u(payload)
	sum := sha256.Sum256([]byte(body))
	sig, err := rsa.SignPKCS1v15(rand.Reader, key, crypto.SHA256, sum[:])
	if err != nil {
		t.Fatal(err)
	}
	return body + "." + b64u(sig)
}

// startTestJWKS serves a Keycloak-shaped JWKS document for key.
func startTestJWKS(t *testing.T, key *rsa.PublicKey, kid string) *httptest.Server {
	t.Helper()
	jwks := map[string]interface{}{
		"keys": []map[string]string{{
			"kty": "RSA", "kid": kid, "alg": "RS256", "use": "sig",
			"n": b64u(key.N.Bytes()),
			"e": b64u(big.NewInt(int64(key.E)).Bytes()),
		}},
	}
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(jwks)
	}))
}

func TestVerifyKeycloakBearerToken(t *testing.T) {
	priv, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	const kid = "test-key-1"
	srv := startTestJWKS(t, &priv.PublicKey, kid)
	defer srv.Close()

	cfg := &keycloakJWKSConfig{issuer: srv.URL + "/realms/test", jwksURL: srv.URL + "/certs"}
	cache := newJWKSCache(cfg.jwksURL)
	cache.ttl = time.Minute

	validClaims := func() map[string]interface{} {
		return map[string]interface{}{
			"iss": cfg.issuer,
			"sub": "user-123",
			"exp": time.Now().Add(10 * time.Minute).Unix(),
		}
	}

	t.Run("valid token accepted", func(t *testing.T) {
		tok := signTestToken(t, priv, kid, validClaims())
		claims, err := verifyKeycloakBearerToken(context.Background(), cfg, cache, tok)
		if err != nil {
			t.Fatalf("expected valid token, got error: %v", err)
		}
		if claims.Sub != "user-123" {
			t.Fatalf("unexpected sub: %q", claims.Sub)
		}
	})

	t.Run("expired token rejected", func(t *testing.T) {
		c := validClaims()
		c["exp"] = time.Now().Add(-time.Minute).Unix()
		if _, err := verifyKeycloakBearerToken(context.Background(), cfg, cache, signTestToken(t, priv, kid, c)); err == nil {
			t.Fatal("expected error for expired token")
		}
	})

	t.Run("wrong issuer rejected", func(t *testing.T) {
		c := validClaims()
		c["iss"] = srv.URL + "/realms/other"
		if _, err := verifyKeycloakBearerToken(context.Background(), cfg, cache, signTestToken(t, priv, kid, c)); err == nil {
			t.Fatal("expected error for wrong issuer")
		}
	})

	t.Run("forged signature rejected", func(t *testing.T) {
		other, err := rsa.GenerateKey(rand.Reader, 2048)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := verifyKeycloakBearerToken(context.Background(), cfg, cache, signTestToken(t, other, kid, validClaims())); err == nil {
			t.Fatal("expected error for forged signature")
		}
	})

	t.Run("unknown kid rejected", func(t *testing.T) {
		if _, err := verifyKeycloakBearerToken(context.Background(), cfg, cache, signTestToken(t, priv, "no-such-key", validClaims())); err == nil {
			t.Fatal("expected error for unknown kid")
		}
	})

	t.Run("malformed token rejected", func(t *testing.T) {
		for _, bad := range []string{"", "abc", "a.b", "a.b.c.d", "!!!.!!!.!!!"} {
			if _, err := verifyKeycloakBearerToken(context.Background(), cfg, cache, bad); err == nil {
				t.Fatalf("expected error for %q", bad)
			}
		}
	})
}

func TestKeycloakAuthMiddlewareFailClosed(t *testing.T) {
	priv, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	const kid = "mw-key"
	srv := startTestJWKS(t, &priv.PublicKey, kid)
	defer srv.Close()

	t.Setenv("KEYCLOAK_URL", srv.URL)
	t.Setenv("KEYCLOAK_REALM", "test")

	ok := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/health" {
			w.WriteHeader(http.StatusOK)
			return
		}
		if got := r.Header.Get("X-User-ID"); got != "" {
			t.Errorf("attacker X-User-ID header was not stripped: %q", got)
		}
		if uid, _ := r.Context().Value("user_id").(string); uid != "user-9" {
			t.Errorf("expected user_id from token claims, got %q", uid)
		}
		w.WriteHeader(http.StatusOK)
	})
	handler := keycloakAuthMiddleware(ok)

	// No token -> 401
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/v1/x", nil))
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("missing token: expected 401, got %d", rec.Code)
	}

	// Garbage token -> 401
	req := httptest.NewRequest(http.MethodGet, "/api/v1/x", nil)
	req.Header.Set("Authorization", "Bearer not-a-jwt")
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("garbage token: expected 401, got %d", rec.Code)
	}

	// Valid token -> 200, identity from claims not headers
	tok := signTestToken(t, priv, kid, map[string]interface{}{
		"iss": srv.URL + "/realms/test",
		"sub": "user-9",
		"exp": time.Now().Add(10 * time.Minute).Unix(),
	})
	req = httptest.NewRequest(http.MethodGet, "/api/v1/x", nil)
	req.Header.Set("Authorization", "Bearer "+tok)
	req.Header.Set("X-User-ID", "attacker")
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("valid token: expected 200, got %d", rec.Code)
	}

	// Health probe remains unauthenticated
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/health", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("health probe: expected 200, got %d", rec.Code)
	}
}
