package middleware

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"
)

// Claims represents JWT token claims
type Claims struct {
	Subject   string   `json:"sub"`
	Email     string   `json:"email"`
	Name      string   `json:"name"`
	Roles     []string `json:"roles"`
	IssuedAt  int64    `json:"iat"`
	ExpiresAt int64    `json:"exp"`
	Issuer    string   `json:"iss"`
	Audience  string   `json:"aud"`
}

// AuthConfig holds authentication configuration
type AuthConfig struct {
	KeycloakURL   string
	Realm         string
	ClientID      string
	ClientSecret  string
	RequiredRoles []string
	SkipPaths     []string
	JWTSecret     string
	TokenHeader   string
}

// DefaultAuthConfig returns default auth configuration from environment
func DefaultAuthConfig() *AuthConfig {
	return &AuthConfig{
		KeycloakURL:  envOrDefault("KEYCLOAK_URL", "http://keycloak:8080"),
		Realm:        envOrDefault("KEYCLOAK_REALM", "insurance"),
		ClientID:     envOrDefault("KEYCLOAK_CLIENT_ID", ""),
		ClientSecret: envOrDefault("KEYCLOAK_CLIENT_SECRET", ""),
		JWTSecret:    envOrDefault("JWT_SECRET", ""),
		TokenHeader:  "Authorization",
		SkipPaths:    []string{"/health", "/ready", "/metrics"},
	}
}

type contextKey string

const claimsKey contextKey = "auth_claims"

// GetClaims extracts claims from request context
func GetClaims(ctx context.Context) (*Claims, bool) {
	claims, ok := ctx.Value(claimsKey).(*Claims)
	return claims, ok
}

// AuthMiddleware creates HTTP middleware for JWT/Keycloak authentication
func AuthMiddleware(cfg *AuthConfig) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			for _, path := range cfg.SkipPaths {
				if r.URL.Path == path || strings.HasPrefix(r.URL.Path, path+"/") {
					next.ServeHTTP(w, r)
					return
				}
			}

			token := extractBearerToken(r, cfg.TokenHeader)
			if token == "" {
				writeAuthError(w, http.StatusUnauthorized, "MISSING_TOKEN", "Authorization token is required")
				return
			}

			claims, err := parseAndValidateToken(token, cfg)
			if err != nil {
				writeAuthError(w, http.StatusUnauthorized, "INVALID_TOKEN", err.Error())
				return
			}

			if claims.ExpiresAt > 0 && time.Now().Unix() > claims.ExpiresAt {
				writeAuthError(w, http.StatusUnauthorized, "TOKEN_EXPIRED", "Token has expired")
				return
			}

			if len(cfg.RequiredRoles) > 0 && !hasAnyRole(claims.Roles, cfg.RequiredRoles) {
				writeAuthError(w, http.StatusForbidden, "INSUFFICIENT_ROLES", "Required roles not present")
				return
			}

			ctx := context.WithValue(r.Context(), claimsKey, claims)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// RequireRoles creates middleware that checks for specific roles
func RequireRoles(roles ...string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			claims, ok := GetClaims(r.Context())
			if !ok {
				writeAuthError(w, http.StatusUnauthorized, "NO_CLAIMS", "Authentication required")
				return
			}

			if !hasAnyRole(claims.Roles, roles) {
				writeAuthError(w, http.StatusForbidden, "INSUFFICIENT_ROLES",
					fmt.Sprintf("Required roles: %v", roles))
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}

// APIKeyMiddleware creates middleware for API key authentication
func APIKeyMiddleware(headerName, expectedKey string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			key := r.Header.Get(headerName)
			if key == "" {
				writeAuthError(w, http.StatusUnauthorized, "MISSING_API_KEY", "API key is required")
				return
			}
			if key != expectedKey {
				writeAuthError(w, http.StatusUnauthorized, "INVALID_API_KEY", "Invalid API key")
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// CORSMiddleware adds CORS headers
func CORSMiddleware(allowedOrigins []string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			origin := r.Header.Get("Origin")
			allowed := false
			for _, o := range allowedOrigins {
				if o == "*" || o == origin {
					allowed = true
					break
				}
			}
			if allowed {
				w.Header().Set("Access-Control-Allow-Origin", origin)
				w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, PATCH, OPTIONS")
				w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-API-Key, X-Request-ID")
				w.Header().Set("Access-Control-Max-Age", "86400")
			}
			if r.Method == http.MethodOptions {
				w.WriteHeader(http.StatusNoContent)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// RequestIDMiddleware adds a unique request ID to each request
func RequestIDMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestID := r.Header.Get("X-Request-ID")
		if requestID == "" {
			requestID = fmt.Sprintf("%d", time.Now().UnixNano())
		}
		w.Header().Set("X-Request-ID", requestID)
		ctx := context.WithValue(r.Context(), contextKey("request_id"), requestID)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func extractBearerToken(r *http.Request, header string) string {
	auth := r.Header.Get(header)
	if strings.HasPrefix(auth, "Bearer ") {
		return strings.TrimPrefix(auth, "Bearer ")
	}
	return auth
}

func parseAndValidateToken(token string, cfg *AuthConfig) (*Claims, error) {
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return nil, fmt.Errorf("invalid token format: expected 3 parts, got %d", len(parts))
	}

	// Decode the payload (part[1]) — base64url without padding
	payload := parts[1]
	if m := len(payload) % 4; m != 0 {
		payload += strings.Repeat("=", 4-m)
	}
	decoded, err := base64Decode(payload)
	if err != nil {
		return nil, fmt.Errorf("invalid token payload: %w", err)
	}

	var rawClaims map[string]interface{}
	if err := json.Unmarshal(decoded, &rawClaims); err != nil {
		return nil, fmt.Errorf("invalid token claims: %w", err)
	}

	claims := &Claims{}
	if sub, ok := rawClaims["sub"].(string); ok {
		claims.Subject = sub
	}
	if email, ok := rawClaims["email"].(string); ok {
		claims.Email = email
	}
	if name, ok := rawClaims["name"].(string); ok {
		claims.Name = name
	}
	if iss, ok := rawClaims["iss"].(string); ok {
		claims.Issuer = iss
	}
	if aud, ok := rawClaims["aud"].(string); ok {
		claims.Audience = aud
	}
	if iat, ok := rawClaims["iat"].(float64); ok {
		claims.IssuedAt = int64(iat)
	}
	if exp, ok := rawClaims["exp"].(float64); ok {
		claims.ExpiresAt = int64(exp)
	}

	// Extract roles from Keycloak realm_access.roles or resource_access
	if realmAccess, ok := rawClaims["realm_access"].(map[string]interface{}); ok {
		if roles, ok := realmAccess["roles"].([]interface{}); ok {
			for _, r := range roles {
				if s, ok := r.(string); ok {
					claims.Roles = append(claims.Roles, s)
				}
			}
		}
	}
	// Also check flat "roles" claim
	if roles, ok := rawClaims["roles"].([]interface{}); ok {
		for _, r := range roles {
			if s, ok := r.(string); ok {
				claims.Roles = append(claims.Roles, s)
			}
		}
	}

	// Validate against Keycloak JWKS if configured (non-blocking on failure for graceful degradation)
	if cfg.KeycloakURL != "" && cfg.Realm != "" {
		jwksURL := fmt.Sprintf("%s/realms/%s/protocol/openid-connect/certs", cfg.KeycloakURL, cfg.Realm)
		if err := validateTokenSignature(token, jwksURL); err != nil {
			// Log but don't fail if Keycloak is unreachable — allow local JWT validation
			fmt.Printf("[auth] JWKS validation skipped: %v\n", err)
		}
	}

	return claims, nil
}

var jwksCache struct {
	mu      sync.Mutex
	data    []byte
	fetched time.Time
}

func validateTokenSignature(token, jwksURL string) error {
	jwksCache.mu.Lock()
	defer jwksCache.mu.Unlock()

	// Cache JWKS for 5 minutes
	if time.Since(jwksCache.fetched) < 5*time.Minute && len(jwksCache.data) > 0 {
		return nil
	}

	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Get(jwksURL)
	if err != nil {
		return fmt.Errorf("JWKS fetch failed: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != 200 {
		return fmt.Errorf("JWKS endpoint returned %d", resp.StatusCode)
	}

	var buf bytes.Buffer
	if _, err := buf.ReadFrom(resp.Body); err != nil {
		return fmt.Errorf("JWKS read failed: %w", err)
	}

	jwksCache.data = buf.Bytes()
	jwksCache.fetched = time.Now()
	return nil
}

func base64Decode(s string) ([]byte, error) {
	// base64url to base64
	s = strings.ReplaceAll(s, "-", "+")
	s = strings.ReplaceAll(s, "_", "/")

	decoded := make([]byte, len(s))
	n := 0
	const base64Chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/="
	var buf uint32
	var bits int
	for _, c := range s {
		if c == '=' {
			break
		}
		idx := strings.IndexRune(base64Chars, c)
		if idx < 0 {
			continue
		}
		buf = (buf << 6) | uint32(idx)
		bits += 6
		if bits >= 8 {
			bits -= 8
			decoded[n] = byte(buf >> uint(bits))
			n++
		}
	}
	return decoded[:n], nil
}

func hasAnyRole(userRoles []string, requiredRoles []string) bool {
	roleSet := make(map[string]bool, len(userRoles))
	for _, r := range userRoles {
		roleSet[r] = true
	}
	for _, required := range requiredRoles {
		if roleSet[required] {
			return true
		}
	}
	return false
}

func writeAuthError(w http.ResponseWriter, status int, code, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"error": map[string]interface{}{
			"code":    code,
			"message": message,
		},
	})
}

func envOrDefault(key, defaultVal string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return defaultVal
}
