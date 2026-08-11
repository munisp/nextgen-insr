package temporal

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"os"
	"sync"
	"time"
)

var validWorkflowID = regexp.MustCompile(`^[a-zA-Z0-9_\-.:]+$`)

type TemporalClient struct {
	baseURL   string
	namespace string
	client    *http.Client
	mu        sync.Mutex
	cbOpen    bool
	cbUntil   time.Time
}

func NewTemporalClient() *TemporalClient {
	addr := os.Getenv("TEMPORAL_URL")
	if addr == "" {
		addr = "http://localhost:7233"
	}
	return &TemporalClient{
		baseURL:   addr,
		namespace: envOr("TEMPORAL_NAMESPACE", "default"),
		client:    &http.Client{Timeout: 30 * time.Second},
	}
}

type WorkflowExecution struct {
	WorkflowID string `json:"workflow_id"`
	RunID      string `json:"run_id"`
	Status     string `json:"status,omitempty"`
}

type RetryPolicy struct {
	MaxAttempts     int           `json:"maximum_attempts"`
	InitialInterval time.Duration `json:"-"`
	BackoffCoeff    float64       `json:"backoff_coefficient"`
	MaxInterval     time.Duration `json:"-"`
}

var DefaultRetryPolicy = RetryPolicy{
	MaxAttempts:     3,
	InitialInterval: 1 * time.Second,
	BackoffCoeff:    2.0,
	MaxInterval:     30 * time.Second,
}

var FundFlowRetryPolicy = RetryPolicy{
	MaxAttempts:     5,
	InitialInterval: 2 * time.Second,
	BackoffCoeff:    2.0,
	MaxInterval:     60 * time.Second,
}

type StartWorkflowRequest struct {
	WorkflowID          string        `json:"workflow_id"`
	WorkflowType        string        `json:"workflow_type"`
	TaskQueue           string        `json:"task_queue"`
	Input               interface{}   `json:"input"`
	Timeout             time.Duration `json:"-"`
	RetryPolicy         *RetryPolicy  `json:"-"`
	IdempotencyKey      string        `json:"idempotency_key,omitempty"`
	SearchAttributes    map[string]interface{} `json:"search_attributes,omitempty"`
}

func (t *TemporalClient) isCircuitOpen() bool {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.cbOpen && time.Now().Before(t.cbUntil) {
		return true
	}
	t.cbOpen = false
	return false
}

func (t *TemporalClient) tripCircuitBreaker() {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.cbOpen = true
	t.cbUntil = time.Now().Add(30 * time.Second)
}

func (t *TemporalClient) doRequest(ctx context.Context, method, url string, body []byte) ([]byte, error) {
	if t.isCircuitOpen() {
		return nil, fmt.Errorf("temporal circuit breaker open — retry after 30s")
	}
	var httpReq *http.Request
	var err error
	if body != nil {
		httpReq, err = http.NewRequestWithContext(ctx, method, url, bytes.NewReader(body))
	} else {
		httpReq, err = http.NewRequestWithContext(ctx, method, url, nil)
	}
	if err != nil {
		return nil, err
	}
	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := t.client.Do(httpReq)
	if err != nil {
		t.tripCircuitBreaker()
		return nil, fmt.Errorf("temporal request failed: %w", err)
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 500 {
		t.tripCircuitBreaker()
		return respBody, fmt.Errorf("temporal server error: %d", resp.StatusCode)
	}
	return respBody, nil
}

func (t *TemporalClient) StartWorkflow(ctx context.Context, req StartWorkflowRequest) (*WorkflowExecution, error) {
	retryPolicy := req.RetryPolicy
	if retryPolicy == nil {
		retryPolicy = &DefaultRetryPolicy
	}
	timeout := req.Timeout
	if timeout == 0 {
		timeout = 5 * time.Minute
	}

	payload := map[string]interface{}{
		"workflow_id":   req.WorkflowID,
		"workflow_type": map[string]string{"name": req.WorkflowType},
		"task_queue":    map[string]string{"name": req.TaskQueue},
		"input":         req.Input,
		"workflow_execution_timeout": fmt.Sprintf("%ds", int(timeout.Seconds())),
		"retry_policy": map[string]interface{}{
			"maximum_attempts":  retryPolicy.MaxAttempts,
			"initial_interval":  fmt.Sprintf("%ds", int(retryPolicy.InitialInterval.Seconds())),
			"backoff_coefficient": retryPolicy.BackoffCoeff,
			"maximum_interval":  fmt.Sprintf("%ds", int(retryPolicy.MaxInterval.Seconds())),
		},
	}
	if req.IdempotencyKey != "" {
		payload["request_id"] = req.IdempotencyKey
	}
	if len(req.SearchAttributes) > 0 {
		payload["search_attributes"] = req.SearchAttributes
	}

	body, _ := json.Marshal(payload)
	url := fmt.Sprintf("%s/api/v1/namespaces/%s/workflows", t.baseURL, t.namespace)

	respBody, err := t.doRequest(ctx, "POST", url, body)
	if err != nil {
		return nil, err
	}
	var result WorkflowExecution
	if err := json.Unmarshal(respBody, &result); err != nil {
		return nil, fmt.Errorf("temporal response parse error: %w", err)
	}
	result.WorkflowID = req.WorkflowID
	return &result, nil
}

func (t *TemporalClient) GetWorkflowStatus(ctx context.Context, workflowID, runID string) (map[string]interface{}, error) {
	url := fmt.Sprintf("%s/api/v1/namespaces/%s/workflows/%s/runs/%s", t.baseURL, t.namespace, workflowID, runID)
	respBody, err := t.doRequest(ctx, "GET", url, nil)
	if err != nil {
		return nil, err
	}
	var result map[string]interface{}
	json.Unmarshal(respBody, &result)
	return result, nil
}

func (t *TemporalClient) SignalWorkflow(ctx context.Context, workflowID, runID, signalName string, input interface{}) error {
	payload := map[string]interface{}{
		"signal_name": signalName,
		"input":       input,
	}
	body, _ := json.Marshal(payload)
	url := fmt.Sprintf("%s/api/v1/namespaces/%s/workflows/%s/runs/%s/signal", t.baseURL, t.namespace, workflowID, runID)
	_, err := t.doRequest(ctx, "POST", url, body)
	return err
}

func (t *TemporalClient) TerminateWorkflow(ctx context.Context, workflowID, runID, reason string) error {
	payload := map[string]interface{}{
		"reason": reason,
	}
	body, _ := json.Marshal(payload)
	url := fmt.Sprintf("%s/api/v1/namespaces/%s/workflows/%s/runs/%s/terminate", t.baseURL, t.namespace, workflowID, runID)
	_, err := t.doRequest(ctx, "POST", url, body)
	return err
}

func (t *TemporalClient) QueryWorkflow(ctx context.Context, workflowID, runID, queryType string) (interface{}, error) {
	payload := map[string]interface{}{
		"query": map[string]string{"query_type": queryType},
	}
	body, _ := json.Marshal(payload)
	url := fmt.Sprintf("%s/api/v1/namespaces/%s/workflows/%s/runs/%s/query", t.baseURL, t.namespace, workflowID, runID)
	respBody, err := t.doRequest(ctx, "POST", url, body)
	if err != nil {
		return nil, err
	}
	var result interface{}
	json.Unmarshal(respBody, &result)
	return result, nil
}

// StartFundFlowWorkflow starts a fund-flow workflow with enhanced retry and idempotency
func (t *TemporalClient) StartFundFlowWorkflow(ctx context.Context, workflowType, traceID string, input interface{}) (*WorkflowExecution, error) {
	return t.StartWorkflow(ctx, StartWorkflowRequest{
		WorkflowID:     fmt.Sprintf("fund-flow-%s-%s", workflowType, traceID),
		WorkflowType:   workflowType,
		TaskQueue:       "fund-flow-queue",
		Input:          input,
		Timeout:        10 * time.Minute,
		RetryPolicy:    &FundFlowRetryPolicy,
		IdempotencyKey: traceID,
	})
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
