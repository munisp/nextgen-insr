// Package temporal provides a Go client for Temporal workflow orchestration.
// Insurance workflows managed by Temporal:
//   - PolicyIssuanceWorkflow: KYC → underwriting → premium calc → policy creation → TigerBeetle
//   - ClaimProcessingWorkflow: FNOL → assessment → fraud check → approval → payout
//   - PremiumCollectionWorkflow: invoice → payment → receipt → ledger → commission
//   - PolicyRenewalWorkflow: expiry check → renewal quote → payment → renewal
//   - ReinsuranceCessionWorkflow: cession calc → treaty check → ledger → reporting
//   - IFRS17MeasurementWorkflow: GMM/PAA calculation → reserve update → reporting
//   - ComplianceReportingWorkflow: NAICOM/CBN report generation → submission
//   - FloatReplenishmentWorkflow: float check → top-up request → approval → transfer
package temporal

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"time"

	"go.uber.org/zap"
)

// Workflow type identifiers
const (
	WorkflowPolicyIssuance      = "PolicyIssuanceWorkflow"
	WorkflowClaimProcessing     = "ClaimProcessingWorkflow"
	WorkflowPremiumCollection   = "PremiumCollectionWorkflow"
	WorkflowPolicyRenewal       = "PolicyRenewalWorkflow"
	WorkflowReinsuranceCession  = "ReinsuranceCessionWorkflow"
	WorkflowIFRS17Measurement   = "IFRS17MeasurementWorkflow"
	WorkflowComplianceReporting = "ComplianceReportingWorkflow"
	WorkflowFloatReplenishment  = "FloatReplenishmentWorkflow"
	WorkflowKYCVerification     = "KYCVerificationWorkflow"
	WorkflowFraudInvestigation  = "FraudInvestigationWorkflow"
	WorkflowSettlement          = "SettlementWorkflow"
	WorkflowUnderwriting        = "UnderwritingWorkflow"
)

// Task queues
const (
	TaskQueueInsurance  = "insurance-queue"
	TaskQueueClaims     = "claims-queue"
	TaskQueueSettlement = "settlement-queue"
	TaskQueueCompliance = "compliance-queue"
	TaskQueueActuarial  = "actuarial-queue"
)

// StartWorkflowRequest is the request to start a Temporal workflow
type StartWorkflowRequest struct {
	WorkflowType string                 `json:"workflowType"`
	WorkflowID   string                 `json:"workflowId,omitempty"`
	TaskQueue    string                 `json:"taskQueue"`
	Input        map[string]interface{} `json:"input"`
	Options      *WorkflowOptions       `json:"options,omitempty"`
}

// WorkflowOptions configures workflow execution
type WorkflowOptions struct {
	ExecutionTimeout string       `json:"executionTimeout,omitempty"` // e.g. "24h"
	RunTimeout       string       `json:"runTimeout,omitempty"`
	TaskTimeout      string       `json:"taskTimeout,omitempty"`
	RetryPolicy      *RetryPolicy `json:"retryPolicy,omitempty"`
}

// RetryPolicy configures workflow retry behavior
type RetryPolicy struct {
	MaxAttempts        int      `json:"maxAttempts"`
	InitialInterval    string   `json:"initialInterval"`
	MaxInterval        string   `json:"maxInterval"`
	BackoffCoefficient float64  `json:"backoffCoefficient"`
	NonRetryableErrors []string `json:"nonRetryableErrors,omitempty"`
}

// WorkflowStatus represents the status of a running workflow
type WorkflowStatus struct {
	WorkflowID   string                 `json:"workflowId"`
	RunID        string                 `json:"runId"`
	Status       string                 `json:"status"`
	WorkflowType string                 `json:"workflowType"`
	StartTime    time.Time              `json:"startTime"`
	CloseTime    *time.Time             `json:"closeTime,omitempty"`
	Result       map[string]interface{} `json:"result,omitempty"`
	Error        string                 `json:"error,omitempty"`
}

// Client is the Temporal HTTP bridge client
type Client struct {
	logger     *zap.Logger
	address    string
	namespace  string
	httpClient *http.Client
}

// NewClient creates a new Temporal client
func NewClient(logger *zap.Logger) *Client {
	address := getEnv("TEMPORAL_HTTP_URL", "http://temporal:8080")
	namespace := getEnv("TEMPORAL_NAMESPACE", "insureportal-production")

	return &Client{
		logger:     logger,
		address:    address,
		namespace:  namespace,
		httpClient: &http.Client{Timeout: 15 * time.Second},
	}
}

// Ping checks Temporal availability
func (c *Client) Ping(ctx context.Context) string {
	req, err := http.NewRequestWithContext(ctx, "GET",
		fmt.Sprintf("%s/api/v1/namespaces/%s", c.address, c.namespace), nil)
	if err != nil {
		return "error"
	}
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return "unreachable"
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode == http.StatusOK {
		return "ok"
	}
	return fmt.Sprintf("http_%d", resp.StatusCode)
}

// Close cleans up the client
func (c *Client) Close() {}

// StartWorkflow starts a Temporal workflow via the HTTP API
func (c *Client) StartWorkflow(ctx context.Context, req StartWorkflowRequest) (*WorkflowStatus, error) {
	if req.WorkflowID == "" {
		req.WorkflowID = fmt.Sprintf("%s-%d", req.WorkflowType, time.Now().UnixNano())
	}

	body, err := json.Marshal(map[string]interface{}{
		"workflow_type": map[string]string{"name": req.WorkflowType},
		"task_queue":    map[string]string{"name": req.TaskQueue},
		"input":         map[string]interface{}{"payloads": []map[string]interface{}{{"data": req.Input}}},
	})
	if err != nil {
		return nil, fmt.Errorf("marshal request: %w", err)
	}

	url := fmt.Sprintf("%s/api/v1/namespaces/%s/workflows/%s",
		c.address, c.namespace, req.WorkflowID)
	httpReq, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		// Fail-open: return a mock status when Temporal is unavailable
		c.logger.Warn("Temporal unavailable, returning mock workflow status",
			zap.String("workflowType", req.WorkflowType),
			zap.Error(err))
		return &WorkflowStatus{
			WorkflowID:   req.WorkflowID,
			Status:       "QUEUED_OFFLINE",
			WorkflowType: req.WorkflowType,
			StartTime:    time.Now(),
		}, nil
	}
	defer func() { _ = resp.Body.Close() }()

	var result map[string]interface{}
	_ = json.NewDecoder(resp.Body).Decode(&result)

	runID := ""
	if rid, ok := result["run_id"].(string); ok {
		runID = rid
	}

	return &WorkflowStatus{
		WorkflowID:   req.WorkflowID,
		RunID:        runID,
		Status:       "RUNNING",
		WorkflowType: req.WorkflowType,
		StartTime:    time.Now(),
	}, nil
}

// ── HTTP Handlers ─────────────────────────────────────────────────────────────

// StartWorkflowHandler handles POST /temporal/workflows/start
func (c *Client) StartWorkflowHandler(w http.ResponseWriter, r *http.Request) {
	var req StartWorkflowRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}
	if req.WorkflowType == "" || req.TaskQueue == "" {
		writeError(w, http.StatusBadRequest, "workflowType and taskQueue are required")
		return
	}

	status, err := c.StartWorkflow(r.Context(), req)
	if err != nil {
		c.logger.Error("Start workflow failed", zap.String("type", req.WorkflowType), zap.Error(err))
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, status)
}

// SignalWorkflowHandler handles POST /temporal/workflows/signal
func (c *Client) SignalWorkflowHandler(w http.ResponseWriter, r *http.Request) {
	var req struct {
		WorkflowID string                 `json:"workflowId"`
		RunID      string                 `json:"runId,omitempty"`
		SignalName string                 `json:"signalName"`
		Input      map[string]interface{} `json:"input,omitempty"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	body, _ := json.Marshal(map[string]interface{}{
		"signal_name": req.SignalName,
		"input":       map[string]interface{}{"payloads": []map[string]interface{}{{"data": req.Input}}},
	})

	url := fmt.Sprintf("%s/api/v1/namespaces/%s/workflows/%s/signal/%s",
		c.address, c.namespace, req.WorkflowID, req.SignalName)
	httpReq, _ := http.NewRequestWithContext(r.Context(), "POST", url, bytes.NewReader(body))
	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		writeJSON(w, http.StatusAccepted, map[string]string{"status": "queued_offline"})
		return
	}
	defer func() { _ = resp.Body.Close() }()
	writeJSON(w, http.StatusAccepted, map[string]string{"status": "signaled"})
}

// CancelWorkflowHandler handles POST /temporal/workflows/cancel
func (c *Client) CancelWorkflowHandler(w http.ResponseWriter, r *http.Request) {
	var req struct {
		WorkflowID string `json:"workflowId"`
		Reason     string `json:"reason,omitempty"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	url := fmt.Sprintf("%s/api/v1/namespaces/%s/workflows/%s/cancel",
		c.address, c.namespace, req.WorkflowID)
	httpReq, _ := http.NewRequestWithContext(r.Context(), "POST", url, nil)

	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		writeJSON(w, http.StatusAccepted, map[string]string{"status": "cancel_queued"})
		return
	}
	defer func() { _ = resp.Body.Close() }()
	writeJSON(w, http.StatusOK, map[string]string{"status": "cancelled"})
}

// GetWorkflowHandler handles GET /temporal/workflows/{workflowId}
func (c *Client) GetWorkflowHandler(w http.ResponseWriter, r *http.Request) {
	workflowID := r.PathValue("workflowId")
	url := fmt.Sprintf("%s/api/v1/namespaces/%s/workflows/%s",
		c.address, c.namespace, workflowID)
	req, _ := http.NewRequestWithContext(r.Context(), "GET", url, nil)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		writeJSON(w, http.StatusOK, WorkflowStatus{
			WorkflowID: workflowID,
			Status:     "UNKNOWN",
		})
		return
	}
	defer func() { _ = resp.Body.Close() }()

	var result interface{}
	_ = json.NewDecoder(resp.Body).Decode(&result)
	writeJSON(w, http.StatusOK, result)
}

// GetWorkflowHistoryHandler handles GET /temporal/workflows/{workflowId}/history
func (c *Client) GetWorkflowHistoryHandler(w http.ResponseWriter, r *http.Request) {
	workflowID := r.PathValue("workflowId")
	url := fmt.Sprintf("%s/api/v1/namespaces/%s/workflows/%s/history",
		c.address, c.namespace, workflowID)
	req, _ := http.NewRequestWithContext(r.Context(), "GET", url, nil)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]interface{}{"history": []interface{}{}})
		return
	}
	defer func() { _ = resp.Body.Close() }()

	var result interface{}
	_ = json.NewDecoder(resp.Body).Decode(&result)
	writeJSON(w, http.StatusOK, result)
}

// QueryWorkflowHandler handles POST /temporal/workflows/query
func (c *Client) QueryWorkflowHandler(w http.ResponseWriter, r *http.Request) {
	var req struct {
		WorkflowID string `json:"workflowId"`
		QueryType  string `json:"queryType"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	url := fmt.Sprintf("%s/api/v1/namespaces/%s/workflows/%s/query/%s",
		c.address, c.namespace, req.WorkflowID, req.QueryType)
	httpReq, _ := http.NewRequestWithContext(r.Context(), "POST", url, nil)

	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]interface{}{"result": nil})
		return
	}
	defer func() { _ = resp.Body.Close() }()

	var result interface{}
	_ = json.NewDecoder(resp.Body).Decode(&result)
	writeJSON(w, http.StatusOK, result)
}

// GetTaskQueueStatsHandler handles GET /temporal/task-queues/{taskQueue}/stats
func (c *Client) GetTaskQueueStatsHandler(w http.ResponseWriter, r *http.Request) {
	taskQueue := r.PathValue("taskQueue")
	url := fmt.Sprintf("%s/api/v1/namespaces/%s/task-queues/%s",
		c.address, c.namespace, taskQueue)
	req, _ := http.NewRequestWithContext(r.Context(), "GET", url, nil)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]interface{}{
			"taskQueue": taskQueue,
			"pollers":   0,
			"backlog":   0,
		})
		return
	}
	defer func() { _ = resp.Body.Close() }()

	var result interface{}
	_ = json.NewDecoder(resp.Body).Decode(&result)
	writeJSON(w, http.StatusOK, result)
}

// HealthHandler handles GET /temporal/health
func (c *Client) HealthHandler(w http.ResponseWriter, r *http.Request) {
	status := c.Ping(r.Context())
	code := http.StatusOK
	if status != "ok" {
		code = http.StatusServiceUnavailable
	}
	writeJSON(w, code, map[string]string{"status": status})
}

// ── Utility ───────────────────────────────────────────────────────────────────

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}
