package audit

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"go.uber.org/zap"
)

const (
	IndexKYCAudit      = "kyc-audit-log"
	IndexKYCEvents     = "kyc-events"
	IndexKYBEvents     = "kyb-events"
	IndexKYCCompliance = "kyc-compliance"
	IndexKYCMetrics    = "kyc-metrics"
)

type AuditEntry struct {
	ID            string                 `json:"id"`
	SessionID     string                 `json:"session_id"`
	UserID        string                 `json:"user_id"`
	Action        string                 `json:"action"`
	Actor         string                 `json:"actor"`
	IPAddress     string                 `json:"ip_address"`
	UserAgent     string                 `json:"user_agent"`
	RequestMethod string                 `json:"request_method"`
	RequestPath   string                 `json:"request_path"`
	StatusCode    int                    `json:"status_code"`
	DurationMs    int                    `json:"duration_ms"`
	RiskScore     float64                `json:"risk_score"`
	Country       string                 `json:"country"`
	Metadata      map[string]interface{} `json:"metadata"`
	Timestamp     time.Time              `json:"@timestamp"`
}

type ComplianceReport struct {
	ReportID       string    `json:"report_id"`
	ReportType     string    `json:"report_type"`
	Period         string    `json:"period"`
	TotalVerified  int       `json:"total_verified"`
	TotalRejected  int       `json:"total_rejected"`
	TotalPending   int       `json:"total_pending"`
	AMLFlags       int       `json:"aml_flags"`
	PEPMatches     int       `json:"pep_matches"`
	AvgRiskScore   float64   `json:"avg_risk_score"`
	ComplianceRate float64   `json:"compliance_rate"`
	GeneratedAt    time.Time `json:"generated_at"`
}

type OpenSearchAuditor struct {
	baseURL    string
	httpClient *http.Client
	logger     *zap.Logger
}

func NewOpenSearchAuditor(logger *zap.Logger, baseURL string) (*OpenSearchAuditor, error) {
	if baseURL == "" {
		baseURL = "http://localhost:9200"
	}

	client := &http.Client{Timeout: 10 * time.Second}

	auditor := &OpenSearchAuditor{
		baseURL:    baseURL,
		httpClient: client,
		logger:     logger,
	}

	if err := auditor.createIndices(); err != nil {
		logger.Warn("opensearch_index_creation_failed", zap.Error(err))
	}

	return auditor, nil
}

func (a *OpenSearchAuditor) createIndices() error {
	indices := []struct {
		name    string
		mapping map[string]interface{}
	}{
		{
			name: IndexKYCAudit,
			mapping: map[string]interface{}{
				"mappings": map[string]interface{}{
					"properties": map[string]interface{}{
						"@timestamp":     map[string]string{"type": "date"},
						"session_id":     map[string]string{"type": "keyword"},
						"user_id":        map[string]string{"type": "keyword"},
						"action":         map[string]string{"type": "keyword"},
						"actor":          map[string]string{"type": "keyword"},
						"ip_address":     map[string]string{"type": "ip"},
						"status_code":    map[string]string{"type": "integer"},
						"duration_ms":    map[string]string{"type": "integer"},
						"risk_score":     map[string]string{"type": "float"},
						"country":        map[string]string{"type": "keyword"},
						"request_method": map[string]string{"type": "keyword"},
						"request_path":   map[string]string{"type": "keyword"},
					},
				},
				"settings": map[string]interface{}{
					"number_of_shards":   1,
					"number_of_replicas": 1,
					"index.lifecycle.name": "kyc-audit-policy",
				},
			},
		},
		{
			name: IndexKYCEvents,
			mapping: map[string]interface{}{
				"mappings": map[string]interface{}{
					"properties": map[string]interface{}{
						"@timestamp":  map[string]string{"type": "date"},
						"session_id":  map[string]string{"type": "keyword"},
						"user_id":     map[string]string{"type": "keyword"},
						"event_type":  map[string]string{"type": "keyword"},
						"source":      map[string]string{"type": "keyword"},
						"details":     map[string]string{"type": "text"},
					},
				},
			},
		},
		{
			name: IndexKYCCompliance,
			mapping: map[string]interface{}{
				"mappings": map[string]interface{}{
					"properties": map[string]interface{}{
						"generated_at":    map[string]string{"type": "date"},
						"report_type":     map[string]string{"type": "keyword"},
						"period":          map[string]string{"type": "keyword"},
						"total_verified":  map[string]string{"type": "integer"},
						"total_rejected":  map[string]string{"type": "integer"},
						"compliance_rate": map[string]string{"type": "float"},
						"avg_risk_score":  map[string]string{"type": "float"},
					},
				},
			},
		},
		{
			name: IndexKYCMetrics,
			mapping: map[string]interface{}{
				"mappings": map[string]interface{}{
					"properties": map[string]interface{}{
						"@timestamp":           map[string]string{"type": "date"},
						"metric_type":          map[string]string{"type": "keyword"},
						"verification_count":   map[string]string{"type": "integer"},
						"avg_duration_ms":      map[string]string{"type": "float"},
						"success_rate":         map[string]string{"type": "float"},
						"country":              map[string]string{"type": "keyword"},
					},
				},
			},
		},
	}

	for _, idx := range indices {
		body, _ := json.Marshal(idx.mapping)
		req, err := http.NewRequest(http.MethodPut, fmt.Sprintf("%s/%s", a.baseURL, idx.name), bytes.NewReader(body))
		if err != nil {
			continue
		}
		req.Header.Set("Content-Type", "application/json")

		resp, err := a.httpClient.Do(req)
		if err != nil {
			a.logger.Debug("opensearch_index_create_skip", zap.String("index", idx.name), zap.Error(err))
			continue
		}
		resp.Body.Close()
	}

	return nil
}

func (a *OpenSearchAuditor) IndexAuditEntry(ctx context.Context, entry AuditEntry) error {
	body, err := json.Marshal(entry)
	if err != nil {
		return fmt.Errorf("marshal audit entry: %w", err)
	}

	url := fmt.Sprintf("%s/%s/_doc/%s", a.baseURL, IndexKYCAudit, entry.ID)
	req, err := http.NewRequestWithContext(ctx, http.MethodPut, url, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := a.httpClient.Do(req)
	if err != nil {
		a.logger.Debug("opensearch_index_failed", zap.Error(err))
		return nil
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		a.logger.Warn("opensearch_index_error", zap.Int("status", resp.StatusCode), zap.String("id", entry.ID))
	}

	return nil
}

func (a *OpenSearchAuditor) IndexEvent(ctx context.Context, index string, id string, doc interface{}) error {
	body, err := json.Marshal(doc)
	if err != nil {
		return err
	}

	url := fmt.Sprintf("%s/%s/_doc/%s", a.baseURL, index, id)
	req, err := http.NewRequestWithContext(ctx, http.MethodPut, url, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := a.httpClient.Do(req)
	if err != nil {
		a.logger.Debug("opensearch_event_index_failed", zap.Error(err))
		return nil
	}
	defer resp.Body.Close()

	return nil
}

func (a *OpenSearchAuditor) SearchAuditLog(ctx context.Context, sessionID string, from, size int) ([]AuditEntry, int, error) {
	query := map[string]interface{}{
		"query": map[string]interface{}{
			"term": map[string]string{"session_id": sessionID},
		},
		"sort": []map[string]string{{"@timestamp": "desc"}},
		"from": from,
		"size": size,
	}

	body, _ := json.Marshal(query)
	url := fmt.Sprintf("%s/%s/_search", a.baseURL, IndexKYCAudit)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return nil, 0, err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := a.httpClient.Do(req)
	if err != nil {
		return nil, 0, err
	}
	defer resp.Body.Close()

	var result struct {
		Hits struct {
			Total struct {
				Value int `json:"value"`
			} `json:"total"`
			Hits []struct {
				Source AuditEntry `json:"_source"`
			} `json:"hits"`
		} `json:"hits"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, 0, err
	}

	entries := make([]AuditEntry, len(result.Hits.Hits))
	for i, hit := range result.Hits.Hits {
		entries[i] = hit.Source
	}

	return entries, result.Hits.Total.Value, nil
}

func (a *OpenSearchAuditor) GetComplianceMetrics(ctx context.Context, period string) (*ComplianceReport, error) {
	query := map[string]interface{}{
		"query": map[string]interface{}{
			"bool": map[string]interface{}{
				"filter": []map[string]interface{}{
					{"term": map[string]string{"report_type": "compliance"}},
					{"term": map[string]string{"period": period}},
				},
			},
		},
		"sort": []map[string]string{{"generated_at": "desc"}},
		"size": 1,
	}

	body, _ := json.Marshal(query)
	url := fmt.Sprintf("%s/%s/_search", a.baseURL, IndexKYCCompliance)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := a.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var result struct {
		Hits struct {
			Hits []struct {
				Source ComplianceReport `json:"_source"`
			} `json:"hits"`
		} `json:"hits"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, err
	}

	if len(result.Hits.Hits) == 0 {
		return nil, nil
	}

	return &result.Hits.Hits[0].Source, nil
}
