package healthagg

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"
)

// ServiceStatus represents a single service health status
type ServiceStatus struct {
	Name        string    `json:"name"`
	URL         string    `json:"url"`
	Status      string    `json:"status"`
	ResponseMs  int64     `json:"response_ms"`
	LastChecked time.Time `json:"last_checked"`
	Error       string    `json:"error,omitempty"`
}

// PlatformHealth represents the aggregate platform health
type PlatformHealth struct {
	OverallStatus string          `json:"overall_status"`
	Healthy       int             `json:"healthy_count"`
	Unhealthy     int             `json:"unhealthy_count"`
	Total         int             `json:"total_count"`
	Services      []ServiceStatus `json:"services"`
	CheckedAt     time.Time       `json:"checked_at"`
}

// Aggregator polls all registered services and aggregates health
type Aggregator struct {
	mu       sync.RWMutex
	services []ServiceEndpoint
	latest   *PlatformHealth
	client   *http.Client
}

// ServiceEndpoint describes a service to monitor
type ServiceEndpoint struct {
	Name      string
	HealthURL string
}

// NewAggregator creates a new health aggregator
func NewAggregator() *Aggregator {
	return &Aggregator{
		services: defaultServices(),
		client:   &http.Client{Timeout: 5 * time.Second},
	}
}

// CheckAll polls all services and returns aggregate health
func (a *Aggregator) CheckAll(ctx context.Context) *PlatformHealth {
	var wg sync.WaitGroup
	results := make([]ServiceStatus, len(a.services))

	for i, svc := range a.services {
		wg.Add(1)
		go func(idx int, ep ServiceEndpoint) {
			defer wg.Done()
			results[idx] = a.checkService(ctx, ep)
		}(i, svc)
	}

	wg.Wait()

	healthy := 0
	for _, r := range results {
		if r.Status == "healthy" {
			healthy++
		}
	}

	status := "healthy"
	if healthy == 0 {
		status = "unhealthy"
	} else if healthy < len(results) {
		status = "degraded"
	}

	health := &PlatformHealth{
		OverallStatus: status,
		Healthy:       healthy,
		Unhealthy:     len(results) - healthy,
		Total:         len(results),
		Services:      results,
		CheckedAt:     time.Now().UTC(),
	}

	a.mu.Lock()
	a.latest = health
	a.mu.Unlock()

	return health
}

func (a *Aggregator) checkService(ctx context.Context, ep ServiceEndpoint) ServiceStatus {
	start := time.Now()
	result := ServiceStatus{
		Name:        ep.Name,
		URL:         ep.HealthURL,
		LastChecked: time.Now().UTC(),
	}

	req, err := http.NewRequestWithContext(ctx, "GET", ep.HealthURL, nil)
	if err != nil {
		result.Status = "unhealthy"
		result.Error = err.Error()
		result.ResponseMs = time.Since(start).Milliseconds()
		return result
	}

	resp, err := a.client.Do(req)
	result.ResponseMs = time.Since(start).Milliseconds()

	if err != nil {
		result.Status = "unhealthy"
		result.Error = err.Error()
		return result
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		result.Status = "healthy"
	} else {
		result.Status = "unhealthy"
		result.Error = fmt.Sprintf("HTTP %d", resp.StatusCode)
	}

	return result
}

// HTTPHandler returns a handler serving the aggregate health dashboard
func (a *Aggregator) HTTPHandler() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
		defer cancel()

		health := a.CheckAll(ctx)
		w.Header().Set("Content-Type", "application/json")
		if health.OverallStatus == "unhealthy" {
			w.WriteHeader(http.StatusServiceUnavailable)
		}
		_ = json.NewEncoder(w).Encode(health)
	}
}

func defaultServices() []ServiceEndpoint {
	return []ServiceEndpoint{
		{Name: "liveness-service", HealthURL: "http://liveness-service:8002/health"},
		{Name: "aml-screening", HealthURL: "http://aml-screening-service:8003/health"},
		{Name: "kyc-orchestrator", HealthURL: "http://kyc-orchestrator-service:8004/health"},
		{Name: "risk-scoring", HealthURL: "http://risk-scoring-service:8005/health"},
		{Name: "policy-service", HealthURL: "http://policy-service:8010/health"},
		{Name: "claims-engine", HealthURL: "http://claims-adjudication-engine:8011/health"},
		{Name: "payment-service", HealthURL: "http://payment-service:8012/health"},
		{Name: "actuarial-module", HealthURL: "http://actuarial-module:8020/health"},
		{Name: "reinsurance", HealthURL: "http://reinsurance-management:8021/health"},
		{Name: "group-life-admin", HealthURL: "http://group-life-admin:8022/health"},
		{Name: "audit-trail", HealthURL: "http://audit-trail-system:8040/health"},
		{Name: "batch-processing", HealthURL: "http://batch-processing-engine:8041/health"},
		{Name: "feedback", HealthURL: "http://feedback-management:8042/health"},
		{Name: "commission", HealthURL: "http://agent-commission-management:8043/health"},
		{Name: "renewals", HealthURL: "http://policy-renewal-automation:8044/health"},
		{Name: "gdpr-compliance", HealthURL: "http://gdpr-compliance:8050/health"},
		{Name: "ndpr-compliance", HealthURL: "http://ndpr-compliance:8051/health"},
		{Name: "agent-mobile", HealthURL: "http://agent-mobile-app:8060/health"},
		{Name: "mobile-ios", HealthURL: "http://native-mobile-ios:8061/health"},
		{Name: "enhanced-kyc", HealthURL: "http://enhanced-kyc-kyb:8071/health"},
	}
}
