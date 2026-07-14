package temporal

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"time"
)

var validWorkflowID = regexp.MustCompile(`^[a-zA-Z0-9_\-.:]+$`)

type TemporalClient struct {
	baseURL   string
	namespace string
	client    *http.Client
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
}

type StartWorkflowRequest struct {
	WorkflowID   string        `json:"workflow_id"`
	WorkflowType string        `json:"workflow_type"`
	TaskQueue    string        `json:"task_queue"`
	Input        interface{}   `json:"input"`
	Timeout      time.Duration `json:"-"`
}

func (t *TemporalClient) StartWorkflow(ctx context.Context, req StartWorkflowRequest) (*WorkflowExecution, error) {
	if !validWorkflowID.MatchString(req.WorkflowID) {
		return nil, fmt.Errorf("invalid workflow_id: must match [a-zA-Z0-9_-.:]+")
	}
	payload := map[string]interface{}{
		"workflow_id":   req.WorkflowID,
		"workflow_type": map[string]string{"name": req.WorkflowType},
		"task_queue":    map[string]string{"name": req.TaskQueue},
		"input":         req.Input,
	}
	body, _ := json.Marshal(payload)
	apiURL := fmt.Sprintf("%s/api/v1/namespaces/%s/workflows", t.baseURL, url.PathEscape(t.namespace))
	httpReq, err := http.NewRequestWithContext(ctx, "POST", apiURL, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := t.client.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("temporal start workflow: %w", err)
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(resp.Body)

	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("temporal start workflow returned %d: %s", resp.StatusCode, string(respBody))
	}

	var result WorkflowExecution
	if err := json.Unmarshal(respBody, &result); err != nil {
		return nil, fmt.Errorf("temporal response parse error: %w", err)
	}
	result.WorkflowID = req.WorkflowID
	return &result, nil
}

func (t *TemporalClient) GetWorkflowStatus(ctx context.Context, workflowID, runID string) (map[string]interface{}, error) {
	if !validWorkflowID.MatchString(workflowID) {
		return nil, fmt.Errorf("invalid workflow_id: must match [a-zA-Z0-9_-.:]+")
	}
	statusURL := fmt.Sprintf("%s/api/v1/namespaces/%s/workflows/%s/runs/%s",
		t.baseURL, url.PathEscape(t.namespace), url.PathEscape(workflowID), url.PathEscape(runID))
	req, err := http.NewRequestWithContext(ctx, "GET", statusURL, nil)
	if err != nil {
		return nil, err
	}
	resp, err := t.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(resp.Body)

	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("temporal get workflow returned %d: %s", resp.StatusCode, string(respBody))
	}

	var result map[string]interface{}
	if err := json.Unmarshal(respBody, &result); err != nil {
		return nil, fmt.Errorf("temporal response parse error: %w", err)
	}
	return result, nil
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
