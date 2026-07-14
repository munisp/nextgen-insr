package infra

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"go.uber.org/zap"
)

type OpenSearchClient struct {
	baseURL    string
	httpClient *http.Client
	logger     *zap.Logger
}

// Platform-wide index names
const (
	IndexAuditTrail  = "ngapp-audit-trail"
	IndexKYCEvents   = "ngapp-kyc-events"
	IndexCompliance  = "ngapp-compliance"
	IndexMetrics     = "ngapp-metrics"
	IndexPolicies    = "ngapp-policies"
	IndexClaims      = "ngapp-claims"
	IndexPayments    = "ngapp-payments"
	IndexFraud       = "ngapp-fraud-alerts"
	IndexSecurity    = "ngapp-security-events"
)

type AuditEntry struct {
	ID            string                 `json:"id"`
	Service       string                 `json:"service"`
	Action        string                 `json:"action"`
	EntityType    string                 `json:"entity_type,omitempty"`
	EntityID      string                 `json:"entity_id,omitempty"`
	Actor         string                 `json:"actor,omitempty"`
	IPAddress     string                 `json:"ip_address,omitempty"`
	UserAgent     string                 `json:"user_agent,omitempty"`
	Method        string                 `json:"method,omitempty"`
	Path          string                 `json:"path,omitempty"`
	StatusCode    int                    `json:"status_code,omitempty"`
	DurationMs    int                    `json:"duration_ms,omitempty"`
	KYCLevel      int                    `json:"kyc_level,omitempty"`
	Details       map[string]interface{} `json:"details,omitempty"`
	Timestamp     time.Time              `json:"timestamp"`
}

func NewOpenSearchClient(logger *zap.Logger, baseURL string) *OpenSearchClient {
	return &OpenSearchClient{
		baseURL:    baseURL,
		httpClient: &http.Client{Timeout: 10 * time.Second},
		logger:     logger,
	}
}

func (c *OpenSearchClient) Ping(ctx context.Context) error {
	req, err := http.NewRequestWithContext(ctx, "GET", c.baseURL+"/_cluster/health", nil)
	if err != nil {
		return err
	}
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("opensearch ping: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return fmt.Errorf("opensearch unhealthy: %d", resp.StatusCode)
	}
	return nil
}

// SetupPlatformIndices creates index templates and ILM policies for all platform indices.
func (c *OpenSearchClient) SetupPlatformIndices(ctx context.Context) error {
	indices := []string{IndexAuditTrail, IndexKYCEvents, IndexCompliance, IndexMetrics, IndexPolicies, IndexClaims, IndexPayments, IndexFraud, IndexSecurity}
	for _, idx := range indices {
		if err := c.createIndexIfNotExists(ctx, idx); err != nil {
			c.logger.Warn("index_creation_failed", zap.String("index", idx), zap.Error(err))
		}
	}
	if err := c.setupILMPolicy(ctx); err != nil {
		c.logger.Warn("ilm_policy_failed", zap.Error(err))
	}
	return nil
}

func (c *OpenSearchClient) createIndexIfNotExists(ctx context.Context, index string) error {
	mapping := map[string]interface{}{
		"settings": map[string]interface{}{
			"number_of_shards":   1,
			"number_of_replicas": 1,
			"refresh_interval":   "5s",
		},
		"mappings": map[string]interface{}{
			"properties": map[string]interface{}{
				"timestamp":   map[string]string{"type": "date"},
				"service":     map[string]string{"type": "keyword"},
				"action":      map[string]string{"type": "keyword"},
				"entity_type": map[string]string{"type": "keyword"},
				"entity_id":   map[string]string{"type": "keyword"},
				"actor":       map[string]string{"type": "keyword"},
				"ip_address":  map[string]string{"type": "ip"},
				"status_code": map[string]string{"type": "integer"},
				"duration_ms": map[string]string{"type": "integer"},
				"kyc_level":   map[string]string{"type": "integer"},
				"details":     map[string]string{"type": "object", "enabled": "true"},
			},
		},
	}
	data, _ := json.Marshal(mapping)
	req, err := http.NewRequestWithContext(ctx, "PUT", c.baseURL+"/"+index, bytes.NewReader(data))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	return nil
}

func (c *OpenSearchClient) setupILMPolicy(ctx context.Context) error {
	policy := map[string]interface{}{
		"policy": map[string]interface{}{
			"description":   "NGApp platform index lifecycle",
			"default_state": "hot",
			"states": []map[string]interface{}{
				{
					"name": "hot",
					"actions": []map[string]interface{}{
						{"rollover": map[string]interface{}{"min_size": "10gb", "min_index_age": "7d"}},
					},
					"transitions": []map[string]interface{}{
						{"state_name": "warm", "conditions": map[string]interface{}{"min_index_age": "30d"}},
					},
				},
				{
					"name": "warm",
					"actions": []map[string]interface{}{
						{"replica_count": map[string]interface{}{"number_of_replicas": 0}},
					},
					"transitions": []map[string]interface{}{
						{"state_name": "delete", "conditions": map[string]interface{}{"min_index_age": "365d"}},
					},
				},
				{
					"name":    "delete",
					"actions": []map[string]interface{}{{"delete": map[string]interface{}{}}},
				},
			},
		},
	}
	data, _ := json.Marshal(policy)
	req, err := http.NewRequestWithContext(ctx, "PUT", c.baseURL+"/_plugins/_ism/policies/ngapp-lifecycle", bytes.NewReader(data))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	return nil
}

// IndexDocument indexes a single document.
func (c *OpenSearchClient) IndexDocument(ctx context.Context, index string, docID string, doc interface{}) error {
	data, err := json.Marshal(doc)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, "PUT", fmt.Sprintf("%s/%s/_doc/%s", c.baseURL, index, docID), bytes.NewReader(data))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("index document: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("index failed (%d): %s", resp.StatusCode, string(body))
	}
	return nil
}

// BulkIndex indexes multiple documents in a single request.
func (c *OpenSearchClient) BulkIndex(ctx context.Context, index string, docs map[string]interface{}) error {
	var buf bytes.Buffer
	for id, doc := range docs {
		meta := fmt.Sprintf(`{"index":{"_index":"%s","_id":"%s"}}`, index, id)
		buf.WriteString(meta + "\n")
		data, _ := json.Marshal(doc)
		buf.Write(data)
		buf.WriteString("\n")
	}
	req, err := http.NewRequestWithContext(ctx, "POST", c.baseURL+"/_bulk", &buf)
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/x-ndjson")
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("bulk index: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("bulk index failed (%d): %s", resp.StatusCode, string(body))
	}
	return nil
}

// IndexAudit indexes an audit trail entry.
func (c *OpenSearchClient) IndexAudit(ctx context.Context, entry AuditEntry) error {
	if entry.Timestamp.IsZero() {
		entry.Timestamp = time.Now()
	}
	return c.IndexDocument(ctx, IndexAuditTrail, entry.ID, entry)
}

// Search performs a search query on an index.
func (c *OpenSearchClient) Search(ctx context.Context, index string, query map[string]interface{}, from, size int) ([]map[string]interface{}, int, error) {
	body := map[string]interface{}{
		"query": query,
		"from":  from,
		"size":  size,
		"sort":  []map[string]interface{}{{"timestamp": map[string]string{"order": "desc"}}},
	}
	data, _ := json.Marshal(body)
	req, err := http.NewRequestWithContext(ctx, "POST", fmt.Sprintf("%s/%s/_search", c.baseURL, index), bytes.NewReader(data))
	if err != nil {
		return nil, 0, err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, 0, fmt.Errorf("search: %w", err)
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(resp.Body)
	var result map[string]interface{}
	json.Unmarshal(respBody, &result)

	hits, ok := result["hits"].(map[string]interface{})
	if !ok {
		return nil, 0, nil
	}
	total := 0
	if totalObj, ok := hits["total"].(map[string]interface{}); ok {
		if v, ok := totalObj["value"].(float64); ok {
			total = int(v)
		}
	}
	var docs []map[string]interface{}
	if hitList, ok := hits["hits"].([]interface{}); ok {
		for _, h := range hitList {
			if hit, ok := h.(map[string]interface{}); ok {
				if src, ok := hit["_source"].(map[string]interface{}); ok {
					docs = append(docs, src)
				}
			}
		}
	}
	return docs, total, nil
}

// GenerateComplianceReport queries audit data and generates a compliance summary.
func (c *OpenSearchClient) GenerateComplianceReport(ctx context.Context, startDate, endDate time.Time) (map[string]interface{}, error) {
	query := map[string]interface{}{
		"bool": map[string]interface{}{
			"filter": []map[string]interface{}{
				{"range": map[string]interface{}{
					"timestamp": map[string]interface{}{
						"gte": startDate.Format(time.RFC3339),
						"lte": endDate.Format(time.RFC3339),
					},
				}},
			},
		},
	}
	docs, total, err := c.Search(ctx, IndexAuditTrail, query, 0, 0)
	if err != nil {
		return nil, err
	}
	_ = docs
	return map[string]interface{}{
		"period_start":  startDate.Format(time.RFC3339),
		"period_end":    endDate.Format(time.RFC3339),
		"total_events":  total,
		"generated_at":  time.Now().Format(time.RFC3339),
	}, nil
}

func (c *OpenSearchClient) Close() {}
