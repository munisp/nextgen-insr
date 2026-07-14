// Package redis provides a Go Redis client for distributed locking, caching, and session management.
package redis

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"time"

	goredis "github.com/go-redis/redis/v8"
	"go.uber.org/zap"
)

type Client struct {
	logger *zap.Logger
	rdb    *goredis.Client
}

func NewClient(logger *zap.Logger) *Client {
	redisURL := getEnv("REDIS_URL", "redis://redis:6379")
	opt, err := goredis.ParseURL(redisURL)
	if err != nil {
		logger.Warn("Redis URL parse failed", zap.Error(err))
		return &Client{logger: logger}
	}
	opt.DialTimeout = 5 * time.Second
	opt.ReadTimeout = 3 * time.Second
	opt.WriteTimeout = 3 * time.Second
	opt.PoolSize = 20
	opt.MinIdleConns = 5

	rdb := goredis.NewClient(opt)
	logger.Info("Redis client initialized", zap.String("url", redisURL))
	return &Client{logger: logger, rdb: rdb}
}

func (c *Client) Ping(ctx context.Context) string {
	if c.rdb == nil { return "not_configured" }
	if err := c.rdb.Ping(ctx).Err(); err != nil { return "unreachable" }
	return "ok"
}

func (c *Client) Close() {
	if c.rdb != nil { c.rdb.Close() }
}

// AcquireLock acquires a distributed lock using SET NX PX
func (c *Client) AcquireLock(ctx context.Context, key string, ttlMs int64) (bool, error) {
	if c.rdb == nil { return true, nil } // fail-open
	result, err := c.rdb.SetNX(ctx, "lock:"+key, "1", time.Duration(ttlMs)*time.Millisecond).Result()
	if err != nil { return true, nil } // fail-open
	return result, nil
}

// ReleaseLock releases a distributed lock
func (c *Client) ReleaseLock(ctx context.Context, key string) error {
	if c.rdb == nil { return nil }
	return c.rdb.Del(ctx, "lock:"+key).Err()
}

// ── HTTP Handlers ─────────────────────────────────────────────────────────────

func (c *Client) HealthHandler(w http.ResponseWriter, r *http.Request) {
	status := c.Ping(r.Context())
	code := http.StatusOK
	if status != "ok" { code = http.StatusServiceUnavailable }
	writeJSON(w, code, map[string]string{"status": status})
}

func (c *Client) AcquireLockHandler(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Key   string `json:"key"`
		TTLMs int64  `json:"ttlMs"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	acquired, err := c.AcquireLock(r.Context(), req.Key, req.TTLMs)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"acquired": acquired})
}

func (c *Client) ReleaseLockHandler(w http.ResponseWriter, r *http.Request) {
	key := r.PathValue("key")
	c.ReleaseLock(r.Context(), key) //nolint:errcheck
	writeJSON(w, http.StatusOK, map[string]string{"status": "released"})
}

func (c *Client) SetHandler(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Key   string      `json:"key"`
		Value interface{} `json:"value"`
		TTLMs int64       `json:"ttlMs,omitempty"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if c.rdb == nil {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
		return
	}
	val, _ := json.Marshal(req.Value)
	ttl := time.Duration(req.TTLMs) * time.Millisecond
	if ttl == 0 { ttl = 24 * time.Hour }
	c.rdb.Set(r.Context(), req.Key, val, ttl) //nolint:errcheck
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (c *Client) GetHandler(w http.ResponseWriter, r *http.Request) {
	key := r.PathValue("key")
	if c.rdb == nil {
		writeJSON(w, http.StatusNotFound, nil)
		return
	}
	val, err := c.rdb.Get(r.Context(), key).Result()
	if err == goredis.Nil {
		writeJSON(w, http.StatusNotFound, nil)
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	var result interface{}
	json.Unmarshal([]byte(val), &result)
	writeJSON(w, http.StatusOK, result)
}

func (c *Client) DeleteHandler(w http.ResponseWriter, r *http.Request) {
	key := r.PathValue("key")
	if c.rdb != nil { c.rdb.Del(r.Context(), key) } //nolint:errcheck
	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

func (c *Client) PipelineHandler(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "pipeline not supported via HTTP"})
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" { return v }
	return fallback
}

func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if v != nil { json.NewEncoder(w).Encode(v) }
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

var _ = fmt.Sprintf
