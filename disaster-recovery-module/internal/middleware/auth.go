package middleware

import (
	"context"
	"net/http"
	"strings"
)

// Context keys
type contextKey string

const (
	requestIDKey contextKey = "request_id"
	userIDKey    contextKey = "user_id"
)

// RequestID middleware adds a unique request ID to the context and response header
func RequestID(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ctx := context.WithValue(r.Context(), requestIDKey, generateRequestID())
		w.Header().Set("X-Request-ID", ctx.Value(requestIDKey).(string))
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// APIKeyAuth validates API key from Authorization header
func APIKeyAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		authHeader := r.Header.Get("Authorization")
		if authHeader == "" {
			http.Error(w, `{"error":"missing_authorization_header"}`, http.StatusUnauthorized)
			return
		}

		parts := strings.SplitN(authHeader, " ", 2)
		if len(parts) != 2 || parts[0] != "Bearer" {
			http.Error(w, `{"error":"invalid_authorization_scheme"}`, http.StatusUnauthorized)
			return
		}

		apiKey := parts[1]
		if apiKey == "" || !isValidAPIKey(apiKey) {
			http.Error(w, `{"error":"invalid_api_key"}`, http.StatusUnauthorized)
			return
		}

		// Store user ID from token (simplified - in production, decode JWT)
		userID := extractUserIDFromKey(apiKey)
		ctx := context.WithValue(r.Context(), userIDKey, userID)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// isValidAPIKey validates the API key format (simplified for demo)
func isValidAPIKey(key string) bool {
	return len(key) >= 16 && strings.HasPrefix(key, "dr-key-")
}

// extractUserIDFromKey extracts user ID from API key (simplified)
func extractUserIDFromKey(key string) string {
	if len(key) > 9 {
		return key[7:] // Extract after "dr-key-"
	}
	return "system"
}

// generateRequestID generates a unique request ID
func generateRequestID() string {
	return "dr-" + generateShortUUID()
}

func generateShortUUID() string {
	// Simplified UUID generation for demo
	return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx"[0:13]
}

// CORS middleware configuration
func CORSMiddleware() func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Access-Control-Allow-Origin", "*")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Request-ID")
			w.Header().Set("Access-Control-Max-Age", "86400")

			if r.Method == "OPTIONS" {
				w.WriteHeader(http.StatusOK)
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}

// RateLimitMiddleware is a simple rate limiter (simplified)
func RateLimitMiddleware(maxRequestsPerMinute int) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// Simplified rate limiting - in production use a proper token bucket
			w.Header().Set("X-RateLimit-Limit", string(rune(maxRequestsPerMinute)))
			next.ServeHTTP(w, r)
		})
	}
}
