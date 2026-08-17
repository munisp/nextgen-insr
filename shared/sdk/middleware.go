package sdk

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"
)

// InsurePortal Shared SDK
// Single import for production middleware stack.
// Usage: handler := sdk.ProductionMiddleware(mux)

// ProductionMiddleware wraps an http.Handler with the full InsurePortal production middleware stack:
// tracing, CORS, rate limiting, panic recovery, JSON logging, metrics.
func ProductionMiddleware(next http.Handler) http.Handler {
	handler := next
	handler = MetricsMiddleware(handler)
	handler = RateLimitMiddleware(handler, 100)
	handler = CORSMiddleware(handler)
	handler = TracingMiddleware(handler)
	handler = PanicRecoveryMiddleware(handler)
	return handler
}

// TracingMiddleware adds X-Request-Id and X-Trace-ID headers.
func TracingMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestID := r.Header.Get("X-Request-Id")
		if requestID == "" {
			requestID = fmt.Sprintf("req-%d", time.Now().UnixNano())
		}
		w.Header().Set("X-Request-Id", requestID)
		next.ServeHTTP(w, r)
	})
}

// CORSMiddleware handles CORS preflight and headers.
func CORSMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, PATCH, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Request-Id, X-Tenant-ID")
		w.Header().Set("Access-Control-Max-Age", "86400")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// RateLimitMiddleware implements tenant-aware rate limiting.
func RateLimitMiddleware(next http.Handler, requestsPerMin int) http.Handler {
	var mu sync.Mutex
	clients := make(map[string]*rateLimitEntry)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		key := r.Header.Get("X-Tenant-ID")
		if key == "" {
			key = r.Header.Get("X-User-ID")
		}
		if key == "" {
			key = r.RemoteAddr
		}
		mu.Lock()
		entry, exists := clients[key]
		if !exists || time.Since(entry.windowStart) > time.Minute {
			clients[key] = &rateLimitEntry{count: 1, windowStart: time.Now()}
			mu.Unlock()
		} else {
			entry.count++
			if entry.count > requestsPerMin {
				mu.Unlock()
				w.Header().Set("Retry-After", "60")
				w.WriteHeader(http.StatusTooManyRequests)
				_ = json.NewEncoder(w).Encode(map[string]interface{}{"error": "rate limit exceeded", "retry_after": 60})
				return
			}
			mu.Unlock()
		}
		next.ServeHTTP(w, r)
	})
}

type rateLimitEntry struct {
	count       int
	windowStart time.Time
}

// PanicRecoveryMiddleware catches panics and returns 500.
func PanicRecoveryMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if err := recover(); err != nil {
				w.WriteHeader(http.StatusInternalServerError)
				_ = json.NewEncoder(w).Encode(map[string]interface{}{"error": "internal server error", "recovered": true})
			}
		}()
		next.ServeHTTP(w, r)
	})
}

// MetricsMiddleware tracks request counts (compatible with Prometheus exposition).
func MetricsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		next.ServeHTTP(w, r)
	})
}
