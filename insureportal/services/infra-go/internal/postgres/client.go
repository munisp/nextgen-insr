// Package postgres provides a Go PostgreSQL connection pool manager and health monitor.
package postgres

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"go.uber.org/zap"
)

// Client manages a PostgreSQL connection pool
type Client struct {
	logger *zap.Logger
	pool   *pgxpool.Pool
}

// NewClient creates a new PostgreSQL client with connection pooling
func NewClient(logger *zap.Logger) *Client {
	dbURL := getEnv("DATABASE_URL", "postgresql://postgres:postgres@postgres:5432/insureportal")
	c := &Client{logger: logger}

	cfg, err := pgxpool.ParseConfig(dbURL)
	if err != nil {
		logger.Warn("PostgreSQL config parse failed", zap.Error(err))
		return c
	}

	cfg.MaxConns = 50
	cfg.MinConns = 5
	cfg.MaxConnLifetime = 30 * time.Minute
	cfg.MaxConnIdleTime = 5 * time.Minute
	cfg.HealthCheckPeriod = 30 * time.Second

	pool, err := pgxpool.NewWithConfig(context.Background(), cfg)
	if err != nil {
		logger.Warn("PostgreSQL pool creation failed", zap.Error(err))
		return c
	}

	c.pool = pool
	logger.Info("PostgreSQL connection pool initialized")
	return c
}

// Ping checks PostgreSQL availability
func (c *Client) Ping(ctx context.Context) string {
	if c.pool == nil {
		return "not_configured"
	}
	if err := c.pool.Ping(ctx); err != nil {
		return "unreachable"
	}
	return "ok"
}

// Close shuts down the connection pool
func (c *Client) Close() {
	if c.pool != nil {
		c.pool.Close()
	}
}

// HealthHandler handles GET /postgres/health
func (c *Client) HealthHandler(w http.ResponseWriter, r *http.Request) {
	status := c.Ping(r.Context())
	code := http.StatusOK
	if status != "ok" {
		code = http.StatusServiceUnavailable
	}
	writeJSON(w, code, map[string]string{"status": status})
}

// PoolStatsHandler handles GET /postgres/pool/stats
func (c *Client) PoolStatsHandler(w http.ResponseWriter, r *http.Request) {
	if c.pool == nil {
		writeJSON(w, http.StatusOK, map[string]int{"total": 0, "idle": 0, "inUse": 0})
		return
	}
	stats := c.pool.Stat()
	writeJSON(w, http.StatusOK, map[string]int32{
		"total":             stats.TotalConns(),
		"idle":              stats.IdleConns(),
		"inUse":             stats.AcquiredConns(),
		"maxConns":          stats.MaxConns(),
		"constructingConns": stats.ConstructingConns(),
	})
}

// QueryHandler handles POST /postgres/query
func (c *Client) QueryHandler(w http.ResponseWriter, r *http.Request) {
	writeError(w, http.StatusForbidden, "direct query execution not allowed via HTTP API")
}

// ExecHandler handles POST /postgres/exec
func (c *Client) ExecHandler(w http.ResponseWriter, r *http.Request) {
	writeError(w, http.StatusForbidden, "direct exec not allowed via HTTP API")
}

// MigrateHandler handles POST /postgres/migrate
func (c *Client) MigrateHandler(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{
		"status": "migrations managed by drizzle-kit",
	})
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if v != nil {
		_ = json.NewEncoder(w).Encode(v)
	}
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

var _ = fmt.Sprintf
