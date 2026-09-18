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

// --- F4 audit test (NG-21) ---

func TestComplianceCheckCurrencyMismatch(t *testing.T) {
	body := `{"country":"NG","capital":9000000000,"currency":"USD","has_license":true,"data_local":true}`
	req := httptest.NewRequest(http.MethodPost, "/compliance/check", strings.NewReader(body))
	rec := httptest.NewRecorder()
	handleComplianceCheck(rec, req)
	var out struct {
		Compliant bool     `json:"compliant"`
		Issues    []string `json:"issues"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&out); err != nil {
		t.Fatal(err)
	}
	if out.Compliant {
		t.Fatal("USD-denominated product in NAICOM jurisdiction must NOT be compliant")
	}
	found := false
	for _, i := range out.Issues {
		if strings.Contains(i, "Currency mismatch") {
			found = true
		}
	}
	if !found {
		t.Fatalf("expected currency mismatch issue, got %v", out.Issues)
	}

	// Matching currency passes the currency check.
	body = `{"country":"NG","capital":9000000000,"currency":"NGN","has_license":true,"data_local":true}`
	req = httptest.NewRequest(http.MethodPost, "/compliance/check", strings.NewReader(body))
	rec = httptest.NewRecorder()
	handleComplianceCheck(rec, req)
	if err := json.NewDecoder(rec.Body).Decode(&out); err != nil {
		t.Fatal(err)
	}
	for _, i := range out.Issues {
		if strings.Contains(i, "Currency mismatch") {
			t.Fatalf("NGN product in Nigeria must not flag currency: %v", out.Issues)
		}
	}
}
