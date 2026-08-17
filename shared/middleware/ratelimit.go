package middleware

import (
	"net/http"
	"sync"
	"time"
)

// RateLimiter implements a token bucket rate limiter per key
type RateLimiter struct {
	mu      sync.Mutex
	buckets map[string]*tokenBucket
	rate    int
	burst   int
	cleanup time.Duration
}

type tokenBucket struct {
	tokens     float64
	lastRefill time.Time
}

// NewRateLimiter creates a rate limiter.
// rate: requests per second allowed. burst: max burst size.
func NewRateLimiter(rate, burst int) *RateLimiter {
	rl := &RateLimiter{
		buckets: make(map[string]*tokenBucket),
		rate:    rate,
		burst:   burst,
		cleanup: 5 * time.Minute,
	}
	go rl.cleanupLoop()
	return rl
}

// Allow checks if a request from the given key is allowed
func (rl *RateLimiter) Allow(key string) bool {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	b, ok := rl.buckets[key]
	now := time.Now()

	if !ok {
		rl.buckets[key] = &tokenBucket{
			tokens:     float64(rl.burst) - 1,
			lastRefill: now,
		}
		return true
	}

	elapsed := now.Sub(b.lastRefill).Seconds()
	b.tokens += elapsed * float64(rl.rate)
	if b.tokens > float64(rl.burst) {
		b.tokens = float64(rl.burst)
	}
	b.lastRefill = now

	if b.tokens >= 1 {
		b.tokens--
		return true
	}

	return false
}

// RateLimitMiddleware creates HTTP middleware using per-IP rate limiting
func RateLimitMiddleware(rate, burst int) func(http.Handler) http.Handler {
	limiter := NewRateLimiter(rate, burst)
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			key := r.RemoteAddr
			if forwarded := r.Header.Get("X-Forwarded-For"); forwarded != "" {
				key = forwarded
			}

			if !limiter.Allow(key) {
				w.Header().Set("Content-Type", "application/json")
				w.Header().Set("Retry-After", "1")
				w.WriteHeader(http.StatusTooManyRequests)
				_, _ = w.Write([]byte(`{"error":{"code":"RATE_LIMITED","message":"Too many requests"}}`))
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}

func (rl *RateLimiter) cleanupLoop() {
	ticker := time.NewTicker(rl.cleanup)
	defer ticker.Stop()

	for range ticker.C {
		rl.mu.Lock()
		now := time.Now()
		for key, b := range rl.buckets {
			if now.Sub(b.lastRefill) > rl.cleanup {
				delete(rl.buckets, key)
			}
		}
		rl.mu.Unlock()
	}
}
