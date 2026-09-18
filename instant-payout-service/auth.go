package main

import (
	"crypto"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"math/big"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"
)

// ─── Real JWT validation against Keycloak JWKS ──────────────────────────────
//
// The previous implementation decoded the bearer token and trusted the
// spoofable X-User-ID / X-Tenant-ID headers. This file implements real
// RS256 signature verification against the realm JWKS endpoint.
//
// Fail-closed policy:
//   - KEYCLOAK_JWKS_URL unset and ENVIRONMENT=production  -> 503 (startup misconfig)
//   - JWKS fetch/verify failure                           -> 401/503
//   - DEV_AUTH_BYPASS=true is honoured only outside production (handled by caller)

type jwksKey struct {
	Kty string `json:"kty"`
	Kid string `json:"kid"`
	Alg string `json:"alg"`
	Use string `json:"use"`
	N   string `json:"n"`
	E   string `json:"e"`
}

type jwksDoc struct {
	Keys []jwksKey `json:"keys"`
}

type jwksCache struct {
	mu        sync.RWMutex
	keys      map[string]*rsa.PublicKey
	fetchedAt time.Time
	ttl       time.Duration
	url       string
}

var jwks = &jwksCache{keys: map[string]*rsa.PublicKey{}, ttl: 10 * time.Minute}

func isProduction() bool { return os.Getenv("ENVIRONMENT") == "production" }

// authMisconfigured reports whether JWT validation cannot be performed.
func authMisconfigured() bool {
	return os.Getenv("KEYCLOAK_JWKS_URL") == ""
}

func b64urlDecode(s string) ([]byte, error) {
	return base64.RawURLEncoding.DecodeString(s)
}

func (c *jwksCache) fetchLocked() error {
	if c.url == "" {
		return fmt.Errorf("KEYCLOAK_JWKS_URL not configured")
	}
	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Get(c.url) // #nosec G107 -- operator-controlled env URL
	if err != nil {
		return fmt.Errorf("jwks fetch: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("jwks fetch: status %d", resp.StatusCode)
	}
	var doc jwksDoc
	if err := json.NewDecoder(resp.Body).Decode(&doc); err != nil {
		return fmt.Errorf("jwks decode: %w", err)
	}
	newKeys := map[string]*rsa.PublicKey{}
	for _, k := range doc.Keys {
		if k.Kty != "RSA" || k.N == "" || k.E == "" {
			continue
		}
		nb, err := b64urlDecode(k.N)
		if err != nil {
			continue
		}
		eb, err := b64urlDecode(k.E)
		if err != nil {
			continue
		}
		e := 0
		for _, b := range eb {
			e = e<<8 | int(b)
		}
		if e == 0 {
			continue
		}
		newKeys[k.Kid] = &rsa.PublicKey{N: new(big.Int).SetBytes(nb), E: e}
	}
	if len(newKeys) == 0 {
		return fmt.Errorf("jwks contained no usable RSA keys")
	}
	c.keys = newKeys
	c.fetchedAt = time.Now()
	return nil
}

// keyFor returns the public key for kid, refreshing the cache on miss/expiry.
func (c *jwksCache) keyFor(kid string) (*rsa.PublicKey, error) {
	c.mu.RLock()
	key, ok := c.keys[kid]
	fresh := time.Since(c.fetchedAt) < c.ttl
	c.mu.RUnlock()
	if ok && fresh {
		return key, nil
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if k, ok := c.keys[kid]; ok && time.Since(c.fetchedAt) < c.ttl {
		return k, nil
	}
	if err := c.fetchLocked(); err != nil {
		return nil, err
	}
	key, ok = c.keys[kid]
	if !ok {
		return nil, fmt.Errorf("unknown signing key id")
	}
	return key, nil
}

// tokenClaims is the verified identity extracted from the bearer token.
type tokenClaims struct {
	Sub      string
	Username string
	Email    string
	Roles    []string
	TenantID string
}

type rawClaims struct {
	Sub               string `json:"sub"`
	PreferredUsername string `json:"preferred_username"`
	Email             string `json:"email"`
	TenantID          string `json:"tenant_id"`
	Exp               int64  `json:"exp"`
	Iss               string `json:"iss"`
	RealmAccess       struct {
		Roles []string `json:"roles"`
	} `json:"realm_access"`
}

// validateJWT verifies the RS256 signature and expiry of a Keycloak token.
func validateJWT(tokenStr string) (*tokenClaims, error) {
	if authMisconfigured() {
		return nil, fmt.Errorf("jwt validation not configured")
	}
	parts := strings.Split(tokenStr, ".")
	if len(parts) != 3 {
		return nil, fmt.Errorf("malformed token")
	}
	headerBytes, err := b64urlDecode(parts[0])
	if err != nil {
		return nil, fmt.Errorf("malformed header")
	}
	var header struct {
		Alg string `json:"alg"`
		Kid string `json:"kid"`
	}
	if err := json.Unmarshal(headerBytes, &header); err != nil {
		return nil, fmt.Errorf("malformed header json")
	}
	if header.Alg != "RS256" {
		return nil, fmt.Errorf("unexpected alg")
	}
	key, err := jwks.keyFor(header.Kid)
	if err != nil {
		return nil, err
	}
	signed := parts[0] + "." + parts[1]
	sig, err := b64urlDecode(parts[2])
	if err != nil {
		return nil, fmt.Errorf("malformed signature")
	}
	digest := sha256.Sum256([]byte(signed))
	if err := rsa.VerifyPKCS1v15(key, crypto.SHA256, digest[:], sig); err != nil {
		return nil, fmt.Errorf("invalid signature")
	}
	payloadBytes, err := b64urlDecode(parts[1])
	if err != nil {
		return nil, fmt.Errorf("malformed payload")
	}
	var rc rawClaims
	if err := json.Unmarshal(payloadBytes, &rc); err != nil {
		return nil, fmt.Errorf("malformed claims")
	}
	if rc.Exp == 0 || time.Now().Unix() > rc.Exp {
		return nil, fmt.Errorf("token expired")
	}
	if iss := os.Getenv("KEYCLOAK_ISSUER"); iss != "" && rc.Iss != iss {
		return nil, fmt.Errorf("unexpected issuer")
	}
	if rc.Sub == "" {
		return nil, fmt.Errorf("missing subject")
	}
	return &tokenClaims{
		Sub:      rc.Sub,
		Username: rc.PreferredUsername,
		Email:    rc.Email,
		Roles:    rc.RealmAccess.Roles,
		TenantID: rc.TenantID,
	}, nil
}
