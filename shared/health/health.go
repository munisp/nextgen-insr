package health

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"
)

// Status represents the health status
type Status string

const (
	StatusHealthy   Status = "healthy"
	StatusUnhealthy Status = "unhealthy"
	StatusDegraded  Status = "degraded"
)

// Check represents a single health check
type Check struct {
	Name        string                 `json:"name"`
	Status      Status                 `json:"status"`
	Message     string                 `json:"message,omitempty"`
	Duration    time.Duration          `json:"duration_ms"`
	LastChecked time.Time              `json:"last_checked"`
	Details     map[string]interface{} `json:"details,omitempty"`
}

// HealthResponse represents the overall health response
type HealthResponse struct {
	Status    Status            `json:"status"`
	Version   string            `json:"version"`
	Uptime    time.Duration     `json:"uptime_seconds"`
	Checks    map[string]*Check `json:"checks"`
	Timestamp time.Time         `json:"timestamp"`
}

// Checker is a function that performs a health check
type Checker func(ctx context.Context) *Check

// HealthService manages health checks
type HealthService struct {
	serviceName string
	version     string
	startTime   time.Time
	checkers    map[string]Checker
	mu          sync.RWMutex
	cache       *HealthResponse
	cacheTTL    time.Duration
	lastCheck   time.Time
}

// NewHealthService creates a new health service
func NewHealthService(serviceName, version string) *HealthService {
	return &HealthService{
		serviceName: serviceName,
		version:     version,
		startTime:   time.Now(),
		checkers:    make(map[string]Checker),
		cacheTTL:    5 * time.Second,
	}
}

// RegisterCheck registers a health check
func (h *HealthService) RegisterCheck(name string, checker Checker) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.checkers[name] = checker
}

// Check performs all health checks
func (h *HealthService) Check(ctx context.Context) *HealthResponse {
	h.mu.RLock()
	if h.cache != nil && time.Since(h.lastCheck) < h.cacheTTL {
		h.mu.RUnlock()
		return h.cache
	}
	h.mu.RUnlock()

	h.mu.Lock()
	defer h.mu.Unlock()

	checks := make(map[string]*Check)
	overallStatus := StatusHealthy

	var wg sync.WaitGroup
	var checkMu sync.Mutex

	for name, checker := range h.checkers {
		wg.Add(1)
		go func(name string, checker Checker) {
			defer wg.Done()
			check := checker(ctx)
			checkMu.Lock()
			checks[name] = check
			if check.Status == StatusUnhealthy {
				overallStatus = StatusUnhealthy
			} else if check.Status == StatusDegraded && overallStatus == StatusHealthy {
				overallStatus = StatusDegraded
			}
			checkMu.Unlock()
		}(name, checker)
	}

	wg.Wait()

	response := &HealthResponse{
		Status:    overallStatus,
		Version:   h.version,
		Uptime:    time.Since(h.startTime),
		Checks:    checks,
		Timestamp: time.Now(),
	}

	h.cache = response
	h.lastCheck = time.Now()

	return response
}

// HTTPHandler returns an HTTP handler for health checks
func (h *HealthService) HTTPHandler() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
		defer cancel()

		response := h.Check(ctx)

		w.Header().Set("Content-Type", "application/json")
		if response.Status == StatusUnhealthy {
			w.WriteHeader(http.StatusServiceUnavailable)
		} else if response.Status == StatusDegraded {
			w.WriteHeader(http.StatusOK)
		} else {
			w.WriteHeader(http.StatusOK)
		}

		_ = json.NewEncoder(w).Encode(response)
	}
}

// LivenessHandler returns a simple liveness probe handler
func (h *HealthService) LivenessHandler() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]string{
			"status":  "alive",
			"service": h.serviceName,
		})
	}
}

// ReadinessHandler returns a readiness probe handler
func (h *HealthService) ReadinessHandler() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
		defer cancel()

		response := h.Check(ctx)

		w.Header().Set("Content-Type", "application/json")
		if response.Status == StatusUnhealthy {
			w.WriteHeader(http.StatusServiceUnavailable)
			json.NewEncoder(w).Encode(map[string]string{
				"status": "not_ready",
				"reason": "health checks failing",
			})
			return
		}

		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]string{
			"status": "ready",
		})
	}
}

// Common health checkers

// DatabaseChecker creates a database health checker
func DatabaseChecker(db *sql.DB) Checker {
	return func(ctx context.Context) *Check {
		start := time.Now()
		check := &Check{
			Name:        "database",
			LastChecked: time.Now(),
		}

		err := db.PingContext(ctx)
		check.Duration = time.Since(start)

		if err != nil {
			check.Status = StatusUnhealthy
			check.Message = fmt.Sprintf("database ping failed: %v", err)
			return check
		}

		stats := db.Stats()
		check.Status = StatusHealthy
		check.Details = map[string]interface{}{
			"open_connections": stats.OpenConnections,
			"in_use":           stats.InUse,
			"idle":             stats.Idle,
			"max_open":         stats.MaxOpenConnections,
		}

		if stats.OpenConnections >= stats.MaxOpenConnections {
			check.Status = StatusDegraded
			check.Message = "connection pool exhausted"
		}

		return check
	}
}

// RedisChecker creates a Redis health checker
type RedisClient interface {
	Ping(ctx context.Context) error
}

func RedisChecker(client RedisClient) Checker {
	return func(ctx context.Context) *Check {
		start := time.Now()
		check := &Check{
			Name:        "redis",
			LastChecked: time.Now(),
		}

		err := client.Ping(ctx)
		check.Duration = time.Since(start)

		if err != nil {
			check.Status = StatusUnhealthy
			check.Message = fmt.Sprintf("redis ping failed: %v", err)
			return check
		}

		check.Status = StatusHealthy
		return check
	}
}

// HTTPServiceChecker creates an HTTP service health checker
func HTTPServiceChecker(name, url string, timeout time.Duration) Checker {
	return func(ctx context.Context) *Check {
		start := time.Now()
		check := &Check{
			Name:        name,
			LastChecked: time.Now(),
		}

		client := &http.Client{Timeout: timeout}
		req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
		if err != nil {
			check.Status = StatusUnhealthy
			check.Message = fmt.Sprintf("failed to create request: %v", err)
			check.Duration = time.Since(start)
			return check
		}

		resp, err := client.Do(req)
		check.Duration = time.Since(start)

		if err != nil {
			check.Status = StatusUnhealthy
			check.Message = fmt.Sprintf("request failed: %v", err)
			return check
		}
		defer func() { _ = resp.Body.Close() }()

		if resp.StatusCode >= 500 {
			check.Status = StatusUnhealthy
			check.Message = fmt.Sprintf("service returned status %d", resp.StatusCode)
		} else if resp.StatusCode >= 400 {
			check.Status = StatusDegraded
			check.Message = fmt.Sprintf("service returned status %d", resp.StatusCode)
		} else {
			check.Status = StatusHealthy
		}

		check.Details = map[string]interface{}{
			"status_code": resp.StatusCode,
			"url":         url,
		}

		return check
	}
}

// KafkaChecker creates a Kafka health checker
type KafkaClient interface {
	Ping(ctx context.Context) error
	GetBrokers() []string
}

func KafkaChecker(client KafkaClient) Checker {
	return func(ctx context.Context) *Check {
		start := time.Now()
		check := &Check{
			Name:        "kafka",
			LastChecked: time.Now(),
		}

		err := client.Ping(ctx)
		check.Duration = time.Since(start)

		if err != nil {
			check.Status = StatusUnhealthy
			check.Message = fmt.Sprintf("kafka ping failed: %v", err)
			return check
		}

		check.Status = StatusHealthy
		check.Details = map[string]interface{}{
			"brokers": client.GetBrokers(),
		}

		return check
	}
}

// DiskSpaceChecker creates a disk space health checker
func DiskSpaceChecker(path string, minFreePercent float64) Checker {
	return func(ctx context.Context) *Check {
		start := time.Now()
		check := &Check{
			Name:        "disk_space",
			LastChecked: time.Now(),
		}

		// This would need syscall for actual implementation
		// Simplified version for demonstration
		check.Duration = time.Since(start)
		check.Status = StatusHealthy
		check.Details = map[string]interface{}{
			"path":             path,
			"min_free_percent": minFreePercent,
		}

		return check
	}
}

// MemoryChecker creates a memory health checker
func MemoryChecker(maxUsagePercent float64) Checker {
	return func(ctx context.Context) *Check {
		start := time.Now()
		check := &Check{
			Name:        "memory",
			LastChecked: time.Now(),
		}

		// This would need runtime.MemStats for actual implementation
		check.Duration = time.Since(start)
		check.Status = StatusHealthy
		check.Details = map[string]interface{}{
			"max_usage_percent": maxUsagePercent,
		}

		return check
	}
}
