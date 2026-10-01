package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestValidateQueryParam(t *testing.T) {
	tests := []struct {
		name   string
		query  string
		key    string
		maxLen int
		want   string
		err    bool
	}{
		{"valid", "?name=test", "name", 100, "test", false},
		{"empty", "", "name", 100, "", false},
		{"too long", "?name=toolongvalue", "name", 5, "", true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest("GET", "/test"+tt.query, nil)
			got, err := validateQueryParam(req, tt.key, tt.maxLen)
			if (err != nil) != tt.err {
				t.Errorf("err = %v, wantErr %v", err, tt.err)
			}
			if !tt.err && got != tt.want {
				t.Errorf("got %q, want %q", got, tt.want)
			}
		})
	}
}
func TestValidateIntParam(t *testing.T) {
	tests := []struct {
		name  string
		query string
		key   string
		want  int
		err   bool
	}{
		{"valid", "?page=5", "page", 5, false},
		{"empty", "", "page", 0, false},
		{"invalid", "?page=abc", "page", 0, true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest("GET", "/test"+tt.query, nil)
			got, err := validateIntParam(req, tt.key)
			if (err != nil) != tt.err {
				t.Errorf("err = %v, wantErr %v", err, tt.err)
			}
			if !tt.err && got != tt.want {
				t.Errorf("got %d, want %d", got, tt.want)
			}
		})
	}
}

// 2026-10-01 (R1c): regression tests for the offline-sync data-loss fix.
// /api/v1/sync must persist via the monolith and report honest per-item
// statuses — never a blanket synced:true.
func TestHandleSyncBatchForwardsClaim(t *testing.T) {
	var gotAuth, gotPath string
	var gotBody map[string]interface{}
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		gotPath = r.URL.Path
		_ = json.NewDecoder(r.Body).Decode(&gotBody)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"result":{"data":{"claimId":42}}}`))
	}))
	defer upstream.Close()

	oldURL, oldToken := monolithAPIURL, monolithServiceToken
	defer func() { monolithAPIURL, monolithServiceToken = oldURL, oldToken }()
	monolithAPIURL, monolithServiceToken = upstream.URL, "svc-token"
	cb.recordSuccess() // ensure breaker closed

	body := `{"operationId":"op_1","type":"CREATE","entity":"claim","payload":{"policyId":7,"type":"Motor Accident","description":"rear-end collision","amount":"250000","filedAt":"2026-09-30T10:00:00Z"}}`
	req := httptest.NewRequest("POST", "/api/v1/sync", strings.NewReader(body))
	rec := httptest.NewRecorder()
	handleSyncBatch(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (%s)", rec.Code, rec.Body.String())
	}
	var resp struct {
		Synced  bool             `json:"synced"`
		Results []syncItemResult `json:"results"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if !resp.Synced || len(resp.Results) != 1 || !resp.Results[0].Synced {
		t.Fatalf("expected synced item, got %+v", resp)
	}
	if gotPath != "/api/trpc/insuranceWorkflows.fileClaim" {
		t.Errorf("upstream path = %q", gotPath)
	}
	if gotAuth != "Bearer svc-token" {
		t.Errorf("upstream auth = %q", gotAuth)
	}
	input, _ := gotBody["json"].(map[string]interface{})
	if input["policyId"].(float64) != 7 || input["claimType"] != "Motor Accident" || input["claimedAmount"].(float64) != 250000 {
		t.Errorf("forwarded input wrong: %v", input)
	}
}

func TestHandleSyncBatchFailureStaysQueued(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"error":{"message":"Policy is not active","code":-32600}}`))
	}))
	defer upstream.Close()

	oldURL, oldToken := monolithAPIURL, monolithServiceToken
	defer func() { monolithAPIURL, monolithServiceToken = oldURL, oldToken }()
	monolithAPIURL, monolithServiceToken = upstream.URL, "svc-token"
	cb.recordSuccess()

	body := `{"items":[{"operationId":"op_bad","type":"CREATE","entity":"claim","payload":{"policyId":9,"type":"Health","description":"x","amount":100}}]}`
	req := httptest.NewRequest("POST", "/api/v1/sync", strings.NewReader(body))
	rec := httptest.NewRecorder()
	handleSyncBatch(rec, req)

	var resp struct {
		Synced  bool             `json:"synced"`
		Results []syncItemResult `json:"results"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if resp.Synced {
		t.Fatalf("upstream rejection must NOT be reported as synced: %+v", resp)
	}
	if len(resp.Results) != 1 || resp.Results[0].Synced || resp.Results[0].Error == "" {
		t.Fatalf("expected per-item failure with reason, got %+v", resp.Results)
	}
}

func TestHandleSyncBatchFailClosedWhenUnconfigured(t *testing.T) {
	oldURL, oldToken := monolithAPIURL, monolithServiceToken
	defer func() { monolithAPIURL, monolithServiceToken = oldURL, oldToken }()
	monolithAPIURL, monolithServiceToken = "", ""

	body := `{"operationId":"op_1","type":"CREATE","entity":"claim","payload":{"policyId":7,"type":"Motor","description":"x","amount":1}}`
	req := httptest.NewRequest("POST", "/api/v1/sync", strings.NewReader(body))
	rec := httptest.NewRecorder()
	handleSyncBatch(rec, req)
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503 (fail-closed)", rec.Code)
	}
	if strings.Contains(rec.Body.String(), `"synced":true`) {
		t.Fatal("must never claim synced when unconfigured")
	}
}

func TestHandleSyncBatchUnsupportedEntityRejected(t *testing.T) {
	oldURL, oldToken := monolithAPIURL, monolithServiceToken
	defer func() { monolithAPIURL, monolithServiceToken = oldURL, oldToken }()
	monolithAPIURL, monolithServiceToken = "http://127.0.0.1:1", "svc-token"

	body := `{"operationId":"op_x","type":"DELETE","entity":"policy","payload":{}}`
	req := httptest.NewRequest("POST", "/api/v1/sync", strings.NewReader(body))
	rec := httptest.NewRecorder()
	handleSyncBatch(rec, req)
	var resp struct {
		Synced  bool             `json:"synced"`
		Results []syncItemResult `json:"results"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &resp)
	if resp.Synced || len(resp.Results) != 1 || resp.Results[0].Synced {
		t.Fatalf("unsupported op must be rejected, got %+v", resp)
	}
}
