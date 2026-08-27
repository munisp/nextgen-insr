package main

// Real Keycloak JWKS JWT authentication middleware (stdlib only).
//
// Behavior:
//   - Fetches the realm JWKS from {KEYCLOAK_URL}/realms/{KEYCLOAK_REALM}/protocol/openid-connect/certs
//     and caches it with a TTL (KEYCLOAK_JWKS_TTL_SECONDS, default 300s).
//   - Verifies RS256 signature, exp (and nbf when present), and the iss claim
//     against {KEYCLOAK_URL}/realms/{KEYCLOAK_REALM}.
//   - FAIL-CLOSED: any error (missing/malformed token, bad signature, expired,
//     wrong issuer, JWKS unreachable, KEYCLOAK_URL unset) results in HTTP 401.
//     A service without a configured KEYCLOAK_URL rejects every authenticated
//     request — it never silently allows.
//   - Identity (user_id / tenant_id / roles) is taken ONLY from validated
//     token claims. Attacker-controlled X-User-ID / X-Tenant-ID headers are
//     stripped, never trusted.

import (
	"context"
	"crypto"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"math/big"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"
)

type keycloakJWKSConfig struct {
	issuer  string
	jwksURL string
}

func loadKeycloakJWKSConfig() (*keycloakJWKSConfig, error) {
	base := strings.TrimRight(strings.TrimSpace(os.Getenv("KEYCLOAK_URL")), "/")
	if base == "" {
		return nil, errors.New("KEYCLOAK_URL is not configured")
	}
	realm := strings.TrimSpace(os.Getenv("KEYCLOAK_REALM"))
	if realm == "" {
		realm = "insureportal"
	}
	return &keycloakJWKSConfig{
		issuer:  base + "/realms/" + realm,
		jwksURL: base + "/realms/" + realm + "/protocol/openid-connect/certs",
	}, nil
}

// jwksCache caches the realm signing keys with a TTL. Unknown kids trigger a
// single throttled re-fetch to tolerate key rotation without enabling a
// refresh-amplification DoS.
type jwksCache struct {
	url          string
	ttl          time.Duration
	client       *http.Client
	mu           sync.RWMutex
	keys         map[string]*rsa.PublicKey
	expiry       time.Time
	lastFetch    time.Time
	minRefetchIn time.Duration
}

func newJWKSCache(url string) *jwksCache {
	ttl := 300 * time.Second
	if v := strings.TrimSpace(os.Getenv("KEYCLOAK_JWKS_TTL_SECONDS")); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			ttl = time.Duration(n) * time.Second
		}
	}
	return &jwksCache{
		url:          url,
		ttl:          ttl,
		client:       &http.Client{Timeout: 10 * time.Second},
		keys:         make(map[string]*rsa.PublicKey),
		minRefetchIn: 30 * time.Second,
	}
}

func (c *jwksCache) lookup(ctx context.Context, kid string) (*rsa.PublicKey, error) {
	c.mu.RLock()
	fresh := time.Now().Before(c.expiry)
	key, ok := c.keys[kid]
	c.mu.RUnlock()
	if fresh && ok {
		return key, nil
	}
	if err := c.refresh(ctx); err != nil {
		return nil, err
	}
	c.mu.RLock()
	key, ok = c.keys[kid]
	c.mu.RUnlock()
	if !ok {
		return nil, fmt.Errorf("no JWKS key for kid %q", kid)
	}
	return key, nil
}

func (c *jwksCache) refresh(ctx context.Context) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	now := time.Now()
	// Another goroutine may have refreshed while we waited for the lock; also
	// throttle forced refetches on cache miss to minRefetchIn.
	if now.Before(c.expiry) || (!c.lastFetch.IsZero() && now.Sub(c.lastFetch) < c.minRefetchIn) {
		return nil
	}
	c.lastFetch = now

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.url, nil)
	if err != nil {
		return err
	}
	resp, err := c.client.Do(req)
	if err != nil {
		return fmt.Errorf("JWKS fetch failed: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("JWKS endpoint returned status %d", resp.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return err
	}
	var set struct {
		Keys []struct {
			Kty string `json:"kty"`
			Kid string `json:"kid"`
			Alg string `json:"alg"`
			Use string `json:"use"`
			N   string `json:"n"`
			E   string `json:"e"`
		} `json:"keys"`
	}
	if err := json.Unmarshal(body, &set); err != nil {
		return fmt.Errorf("invalid JWKS document: %w", err)
	}
	keys := make(map[string]*rsa.PublicKey, len(set.Keys))
	for _, k := range set.Keys {
		if k.Kty != "RSA" || k.Kid == "" || k.N == "" || k.E == "" {
			continue
		}
		if k.Alg != "" && k.Alg != "RS256" {
			continue
		}
		nBytes, err := base64.RawURLEncoding.DecodeString(k.N)
		if err != nil {
			continue
		}
		eBytes, err := base64.RawURLEncoding.DecodeString(k.E)
		if err != nil {
			continue
		}
		e := 0
		for _, b := range eBytes {
			e = e<<8 | int(b)
		}
		if e < 3 {
			continue
		}
		keys[k.Kid] = &rsa.PublicKey{N: new(big.Int).SetBytes(nBytes), E: e}
	}
	if len(keys) == 0 {
		return errors.New("JWKS document contained no usable RSA keys")
	}
	c.keys = keys
	c.expiry = now.Add(c.ttl)
	return nil
}

type keycloakValidatedClaims struct {
	Sub      string
	TenantID string
	Roles    []string
}

// verifyKeycloakBearerToken validates an RS256 Keycloak access token: JWKS
// signature, expiry, not-before, and issuer. Any failure is an error — the
// caller must fail closed.
func verifyKeycloakBearerToken(ctx context.Context, cfg *keycloakJWKSConfig, cache *jwksCache, token string) (*keycloakValidatedClaims, error) {
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return nil, errors.New("malformed JWT")
	}
	headerBytes, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return nil, errors.New("malformed JWT header")
	}
	var header struct {
		Alg string `json:"alg"`
		Kid string `json:"kid"`
	}
	if err := json.Unmarshal(headerBytes, &header); err != nil {
		return nil, errors.New("malformed JWT header")
	}
	if header.Alg != "RS256" {
		return nil, fmt.Errorf("unexpected alg %q", header.Alg)
	}
	if header.Kid == "" {
		return nil, errors.New("missing kid")
	}
	key, err := cache.lookup(ctx, header.Kid)
	if err != nil {
		return nil, err
	}
	sig, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil {
		return nil, errors.New("malformed JWT signature")
	}
	sum := sha256.Sum256([]byte(parts[0] + "." + parts[1]))
	if err := rsa.VerifyPKCS1v15(key, crypto.SHA256, sum[:], sig); err != nil {
		return nil, errors.New("invalid signature")
	}
	payloadBytes, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return nil, errors.New("malformed JWT payload")
	}
	var claims struct {
		Iss         string `json:"iss"`
		Sub         string `json:"sub"`
		Exp         int64  `json:"exp"`
		Nbf         int64  `json:"nbf"`
		TenantID    string `json:"tenant_id"`
		RealmAccess struct {
			Roles []string `json:"roles"`
		} `json:"realm_access"`
	}
	if err := json.Unmarshal(payloadBytes, &claims); err != nil {
		return nil, errors.New("malformed JWT claims")
	}
	now := time.Now().Unix()
	if claims.Exp == 0 || now >= claims.Exp {
		return nil, errors.New("token expired or missing exp")
	}
	if claims.Nbf > 0 && now < claims.Nbf {
		return nil, errors.New("token not yet valid")
	}
	if claims.Iss != cfg.issuer {
		return nil, fmt.Errorf("unexpected issuer %q", claims.Iss)
	}
	if claims.Sub == "" {
		return nil, errors.New("missing sub claim")
	}
	return &keycloakValidatedClaims{Sub: claims.Sub, TenantID: claims.TenantID, Roles: claims.RealmAccess.Roles}, nil
}

var (
	keycloakAuthOnce  sync.Once
	keycloakAuthCfg   *keycloakJWKSConfig
	keycloakAuthErr   error
	keycloakAuthCache *jwksCache
)

func writeAuthUnauthorized(w http.ResponseWriter, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusUnauthorized)
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"error": map[string]string{"code": "UNAUTHORIZED", "message": message},
	})
}

// keycloakAuthMiddleware enforces Keycloak RS256 JWT authentication on every
// request except liveness/readiness probes. It fails CLOSED: any validation
// error — including KEYCLOAK_URL not being configured — yields HTTP 401.
func keycloakAuthMiddleware(next http.Handler) http.Handler {
	keycloakAuthOnce.Do(func() {
		keycloakAuthCfg, keycloakAuthErr = loadKeycloakJWKSConfig()
		if keycloakAuthErr != nil {
			log.Printf("[auth] FAIL-CLOSED: %v — all authenticated requests will be rejected with 401", keycloakAuthErr)
			return
		}
		keycloakAuthCache = newJWKSCache(keycloakAuthCfg.jwksURL)
		log.Printf("[auth] Keycloak JWKS validation enabled (issuer=%s)", keycloakAuthCfg.issuer)
	})
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Skip auth for health/ready/live probes and metrics
		if r.URL.Path == "/health" || r.URL.Path == "/ready" || r.URL.Path == "/live" || r.URL.Path == "/metrics" {
			next.ServeHTTP(w, r)
			return
		}
		if keycloakAuthErr != nil {
			writeAuthUnauthorized(w, "authentication is not configured")
			return
		}
		auth := r.Header.Get("Authorization")
		if auth == "" || !strings.HasPrefix(auth, "Bearer ") {
			writeAuthUnauthorized(w, "missing bearer token")
			return
		}
		claims, err := verifyKeycloakBearerToken(r.Context(), keycloakAuthCfg, keycloakAuthCache, strings.TrimPrefix(auth, "Bearer "))
		if err != nil {
			log.Printf("[auth] token rejected: %v (remote=%s path=%s)", err, r.RemoteAddr, r.URL.Path)
			writeAuthUnauthorized(w, "invalid token")
			return
		}
		// Identity comes ONLY from validated claims. Strip attacker-supplied
		// identity headers so downstream code can never trust them.
		r.Header.Del("X-User-ID")
		r.Header.Del("X-Tenant-ID")
		ctx := context.WithValue(r.Context(), "user_id", claims.Sub)
		ctx = context.WithValue(ctx, "tenant_id", claims.TenantID)
		ctx = context.WithValue(ctx, "roles", claims.Roles)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}
