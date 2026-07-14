package middleware

import (
	"context"
	"net/http"
	"strings"
)

type contextKey string

const (
	requestIDKey contextKey = "request_id"
	userIDKey    contextKey = "user_id"
	tenantIDKey  contextKey = "tenant_id"
)

func RequestID(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ctx := context.WithValue(r.Context(), requestIDKey, "takaful-"+generateID())
		w.Header().Set("X-Request-ID", ctx.Value(requestIDKey).(string))
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func APIKeyAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		authHeader := r.Header.Get("Authorization")
		if authHeader == "" {
			w.Header().Set("Content-Type", "application/json")
			http.Error(w, `{"error":"missing_authorization_header"}`, http.StatusUnauthorized)
			return
		}
		parts := strings.SplitN(authHeader, " ", 2)
		if len(parts) != 2 || parts[0] != "Bearer" {
			w.Header().Set("Content-Type", "application/json")
			http.Error(w, `{"error":"invalid_authorization_scheme"}`, http.StatusUnauthorized)
			return
		}
		key := parts[1]
		if !isValidAPIKey(key) {
			w.Header().Set("Content-Type", "application/json")
			http.Error(w, `{"error":"invalid_api_key"}`, http.StatusUnauthorized)
			return
		}
		userID := "takaful-user-" + strings.Replace(key, "takaful-key-", "", 1)
		ctx := context.WithValue(r.Context(), userIDKey, userID)
		tenantID := r.Header.Get("X-Tenant-ID")
		if tenantID != "" {
			ctx = context.WithValue(ctx, tenantIDKey, tenantID)
		}
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func isValidAPIKey(key string) bool {
	return len(key) >= 12
}

func CORSMiddleware() func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Access-Control-Allow-Origin", "*")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Request-ID, X-Tenant-ID")
			w.Header().Set("Access-Control-Max-Age", "86400")
			if r.Method == "OPTIONS" {
				w.WriteHeader(http.StatusOK)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

func generateID() string {
	return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx"[0:13]
}
